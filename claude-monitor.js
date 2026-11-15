'use strict';
// Pemantau sesi Claude Code di komputer ini (proses utama).
//
// Claude Code mengirim kabar lewat hooks bertipe "http" (POST JSON ke server lokal ini) dan
// lewat status line (persentase batas 5 jam / 7 hari). Keduanya mekanisme resmi Claude Code;
// file transkrip tidak dibaca karena formatnya internal dan bisa berubah tiap versi.
// Sesi cloud (claude.ai/code) tidak membaca pengaturan lokal, jadi tidak ikut terpantau.
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const PORT = Number(process.env.PULAU_CLAUDE_PORT) || 47723;
const BASE = '/dragon-island';
const DAY = 24 * 60 * 60 * 1000;
// Sesi "Bekerja" yang tidak mengirim kabar selama ini dianggap "Tanpa kabar": kabar "selesai"-nya
// mungkin hilang (mesin cloud mati, laptop offline, hook gagal). Saat Claude benar-benar bekerja,
// setiap alat yang dipakai mengirim kabar, jadi jeda sepanjang ini jarang terjadi.
const STALE_MS = Number(process.env.PULAU_CLAUDE_STALE_MS) || 15 * 60 * 1000;
// Event yang dipasang ke ~/.claude/settings.json
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'];

function claudeDir() {
  return process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
}
// Nama file/folder terakhir dari jalur Windows maupun Unix (kabar bisa datang dari keduanya).
const baseName = (p) => String(p || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || String(p || '');
const clip = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// Ringkasan alat yang dipakai Claude, mis. "Bash: npm test" atau "Edit: main.js".
function toolSummary(name, input) {
  input = input || {};
  const arg = input.command || input.file_path || input.path || input.pattern || input.url || input.query || input.description || '';
  const short = /[\\/]/.test(arg) && !input.command ? baseName(arg) : arg;
  return clip(name + (short ? `: ${short}` : ''), 90);
}

function createMonitor({ userDataDir, settings, saveSettings, log, onChange, onAlert, appDir }) {
  const stateFile = path.join(userDataDir, 'claude-sessions.json');
  let sessions = {};
  let limits = null; // { five_hour, seven_day, model, at }
  try {
    const s = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    sessions = s.sessions || {};
    limits = s.limits || null;
  } catch (_) { /* belum ada */ }
  if (!settings.hookToken) { settings.hookToken = crypto.randomBytes(18).toString('hex'); saveSettings(); }
  const token = settings.hookToken;
  // Token terpisah untuk sesi cloud (dikirim lewat Tailscale Funnel dari server Anthropic).
  if (!settings.cloudToken) { settings.cloudToken = crypto.randomBytes(24).toString('hex'); saveSettings(); }
  let cloudLast = 0; // waktu kabar cloud terakhir

  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const cut = Date.now() - 3 * DAY;
      for (const [id, s] of Object.entries(sessions)) if (s.updatedAt < cut) delete sessions[id];
      try { fs.writeFileSync(stateFile, JSON.stringify({ sessions, limits })); } catch (_) { /* abaikan */ }
    }, 400);
  }

  function snapshot() {
    const cut = Date.now() - DAY;
    const rank = { permission: 0, working: 1, error: 2, stale: 3, done: 4, idle: 5, ended: 6 };
    const now = Date.now();
    const list = Object.values(sessions)
      .filter((s) => s.updatedAt >= cut && !s.hidden)
      .map((s) => (s.status === 'working' && now - s.updatedAt > STALE_MS ? { ...s, status: 'stale', detail: `Tanpa kabar sejak: ${s.detail || 'mulai bekerja'}` } : s))
      .sort((a, b) => (rank[a.status] - rank[b.status]) || (b.updatedAt - a.updatedAt));
    return {
      sessions: list,
      limits,
      installed: hooksInstalled(),
      statusLine: statusLineState(),
      listening,
      port: PORT,
      cloud: { token: settings.cloudToken, url: settings.cloudUrl || '', last: cloudLast },
    };
  }
  const changed = () => { persist(); onChange(snapshot()); };

  // ---------- event dari hooks ----------
  function handleHook(ev, meta = {}) {
    const id = String(ev.session_id || '');
    if (!id) return;
    const now = Date.now();
    const s = sessions[id] || (sessions[id] = { id, startedAt: now, status: 'idle', detail: '', prompt: '', title: '' });
    const prev = s.status;
    s.updatedAt = now;
    if (ev.cwd) { s.cwd = ev.cwd; s.project = baseName(ev.cwd); }
    if (ev.transcript_path) s.transcript = ev.transcript_path;
    if (ev.session_title) s.title = clip(ev.session_title, 80);
    s.hidden = false;
    if (meta.origin === 'cloud') {
      s.origin = 'cloud';
      if (meta.cloudId) s.cloudId = meta.cloudId;
      cloudLast = now;
    }
    const name = ev.hook_event_name;
    const sub = ev.agent_id ? ' (subagen)' : '';
    switch (name) {
      case 'SessionStart':
        if (ev.model) s.model = typeof ev.model === 'string' ? ev.model : (ev.model.display_name || ev.model.id || '');
        if (ev.source !== 'compact' && prev !== 'working') { s.status = 'idle'; s.detail = ev.source === 'resume' ? 'Dilanjutkan' : 'Sesi dimulai'; }
        break;
      case 'UserPromptSubmit':
        s.status = 'working';
        s.prompt = clip(ev.prompt, 200);
        if (!s.title) s.title = clip(ev.prompt, 60);
        s.detail = 'Mulai mengerjakan';
        s.workStart = now;
        break;
      case 'PostToolUse':
        s.status = 'working';
        s.detail = toolSummary(ev.tool_name, ev.tool_input) + sub;
        break;
      case 'PermissionRequest':
        s.status = 'permission';
        s.detail = 'Minta izin: ' + toolSummary(ev.tool_name, ev.tool_input);
        break;
      case 'Notification': {
        const type = ev.notification_type || '';
        if (type === 'permission_prompt' || type === 'elicitation_dialog' || type === 'elicitation_url_dialog' || type === 'agent_needs_input') {
          s.status = 'permission';
          s.detail = clip(ev.message || 'Butuh tanggapan Anda', 120);
        } else if (type === 'idle_prompt') {
          if (s.status !== 'done') s.status = 'idle';
          s.detail = clip(ev.message || 'Menunggu perintah', 120);
        } else {
          return persist(); // auth_success, agent_completed, dll.: tidak mengubah tampilan
        }
        break;
      }
      case 'Stop':
        s.status = 'done';
        s.detail = clip(ev.last_assistant_message || 'Selesai', 160);
        s.doneAt = now;
        break;
      case 'StopFailure':
        s.status = 'error';
        s.detail = clip(`Gagal: ${ev.error || ''} ${ev.error_details || ''}`, 160);
        break;
      case 'SessionEnd':
        s.status = 'ended';
        s.detail = 'Sesi ditutup';
        break;
      default:
        return;
    }
    log('claude:', name, clip(s.project || id, 30), '->', s.status);
    // Kabar ke pengguna hanya saat keadaan berubah.
    if (s.status === 'permission' && prev !== 'permission') onAlert({ kind: 'permission', session: { ...s } });
    if (s.status === 'done' && prev !== 'done') onAlert({ kind: 'done', session: { ...s }, took: s.workStart ? now - s.workStart : 0 });
    if (s.status === 'error' && prev !== 'error') onAlert({ kind: 'error', session: { ...s } });
    changed();
  }

  // ---------- status line: batas pemakaian langganan ----------
  function handleStatusLine(j) {
    const id = String(j.session_id || '');
    const now = Date.now();
    if (j.rate_limits && (j.rate_limits.five_hour || j.rate_limits.seven_day)) {
      limits = { five_hour: j.rate_limits.five_hour || null, seven_day: j.rate_limits.seven_day || null, at: now };
    }
    if (id && sessions[id]) {
      const s = sessions[id];
      if (j.model && j.model.display_name) s.model = j.model.display_name;
      if (j.context_window && j.context_window.used_percentage != null) s.context = Math.round(j.context_window.used_percentage);
      if (j.cost && j.cost.total_cost_usd != null) s.cost = j.cost.total_cost_usd;
      if (j.session_name) s.title = clip(j.session_name, 80);
    }
    changed();
    // Teks yang tampil di baris status Claude Code (ASCII saja supaya aman di semua terminal).
    const parts = [];
    if (j.model && j.model.display_name) parts.push(j.model.display_name);
    if (j.context_window && j.context_window.used_percentage != null) parts.push(`ctx ${Math.round(j.context_window.used_percentage)}%`);
    const lim = (w, label) => (w && w.used_percentage != null ? `${label} ${Math.round(w.used_percentage)}%` : '');
    if (limits) parts.push(lim(limits.five_hour, '5h'), lim(limits.seven_day, '7d'));
    return parts.filter(Boolean).join(' | ');
  }

  // ---------- server lokal ----------
  let listening = false;
  const server = http.createServer((req, res) => {
    const done = (code, body = '', type = 'text/plain; charset=utf-8') => {
      res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      res.end(body);
    };
    // Token wajib: header khusus tidak bisa dikirim halaman web tanpa izin CORS, jadi situs lain tidak bisa memalsukan kabar.
    // Jalur boleh diawali awalan lain (mis. dari proxy), yang menentukan hanya akhirannya.
    const route = String(req.url || '').split('?')[0];
    const kind = route.endsWith('/hook') ? 'hook' : route.endsWith('/statusline') ? 'statusline' : '';
    const given = String(req.headers['x-dragon-island'] || '');
    const origin = given && given === token ? 'local' : given && given === settings.cloudToken ? 'cloud' : '';
    if (req.method !== 'POST' || !kind) return done(404);
    // Tanpa token sama sekali: sesi lokal di repo yang memakai hook cloud (variabelnya kosong di laptop).
    // Dijawab 2xx kosong supaya Claude Code tidak menampilkan "hook error"; isinya diabaikan.
    if (!given && kind === 'hook') { req.resume(); return done(204); }
    if (!origin || (kind === 'statusline' && origin !== 'local')) return done(403);
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 1e6) req.destroy(); else chunks.push(c); });
    req.on('end', () => {
      let j;
      try { j = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch (_) { return done(400); }
      try {
        if (kind === 'hook') {
          const cid = String(req.headers['x-dragon-cloud-session'] || '');
          handleHook(j, { origin, cloudId: /^(cse|session)_[A-Za-z0-9]{8,64}$/.test(cid) ? cid : '' });
          return done(204); // 2xx tanpa isi: tidak mengubah keputusan Claude Code
        }
        if (kind === 'statusline') return done(200, handleStatusLine(j));
        return done(404);
      } catch (err) {
        log('claude: gagal memproses', String(err).slice(0, 160));
        return done(204);
      }
    });
  });
  server.on('error', (err) => { listening = false; log('claude: server lokal gagal:', String(err)); onChange(snapshot()); });
  server.listen(PORT, '127.0.0.1', () => { listening = true; log('claude: mendengarkan di 127.0.0.1:' + PORT); onChange(snapshot()); });

  // ---------- pemasangan ke ~/.claude/settings.json ----------
  const hookUrl = `http://127.0.0.1:${PORT}${BASE}/hook`;
  const isOurs = (h) => h && typeof h.url === 'string' && h.url.includes(`${BASE}/hook`);
  const settingsFile = () => path.join(claudeDir(), 'settings.json');
  function readClaudeSettings() {
    const f = settingsFile();
    if (!fs.existsSync(f)) return {};
    const text = fs.readFileSync(f, 'utf8');
    if (!text.trim()) return {};
    return JSON.parse(text); // sengaja dibiarkan error bila JSON rusak: jangan menimpa file yang tidak terbaca
  }
  function writeClaudeSettings(obj) {
    const f = settingsFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f)) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      fs.copyFileSync(f, `${f}.cadangan-dragon-${stamp}`);
    }
    fs.writeFileSync(f, JSON.stringify(obj, null, 2) + '\n');
  }
  function hooksInstalled() {
    try {
      const h = (readClaudeSettings().hooks) || {};
      return EVENTS.every((e) => (h[e] || []).some((g) => (g.hooks || []).some(isOurs)));
    } catch (_) { return false; }
  }
  const statusScriptPath = () => path.join(userDataDir, 'statusline.ps1');
  const isOurStatus = (sl) => sl && typeof sl.command === 'string' && sl.command.includes('statusline.ps1') && sl.command.includes('dragon');
  function statusLineState() {
    try {
      const sl = readClaudeSettings().statusLine;
      if (!sl) return 'none';
      return isOurStatus(sl) ? 'ours' : 'other';
    } catch (_) { return 'unknown'; }
  }

  function install() {
    let cfg;
    try { cfg = readClaudeSettings(); } catch (err) {
      return { ok: false, error: `settings.json Claude Code tidak bisa dibaca (${clip(err.message, 80)}). Tidak ada yang diubah.` };
    }
    cfg.hooks = cfg.hooks || {};
    for (const e of EVENTS) {
      const groups = (cfg.hooks[e] || []).filter((g) => !(g.hooks || []).some(isOurs));
      groups.push({ hooks: [{ type: 'http', url: hookUrl, headers: { 'X-Dragon-Island': token }, timeout: 3 }] });
      cfg.hooks[e] = groups;
    }
    // Status line hanya dipasang bila belum ada milik pengguna sendiri.
    let statusNote = '';
    const sl = cfg.statusLine;
    if (!sl || isOurStatus(sl)) {
      fs.copyFileSync(path.join(appDir, 'statusline.ps1'), statusScriptPath());
      const script = statusScriptPath().replace(/\\/g, '/');
      cfg.statusLine = {
        type: 'command',
        command: `powershell -NoProfile -ExecutionPolicy Bypass -File "${script}" -Url http://127.0.0.1:${PORT}${BASE}/statusline -Token ${token} -Tag dragon`,
      };
    } else {
      statusNote = 'Status line Claude Code Anda sudah dipakai skrip lain, jadi persentase batas 5 jam/7 hari tidak bisa ditampilkan.';
    }
    try { writeClaudeSettings(cfg); } catch (err) {
      return { ok: false, error: `Gagal menulis settings.json: ${clip(err.message, 100)}` };
    }
    log('claude: hooks dipasang', statusNote ? '(status line milik pengguna dibiarkan)' : '+ status line');
    changed();
    return { ok: true, note: statusNote };
  }

  function uninstall() {
    let cfg;
    try { cfg = readClaudeSettings(); } catch (err) {
      return { ok: false, error: `settings.json Claude Code tidak bisa dibaca (${clip(err.message, 80)}).` };
    }
    if (cfg.hooks) {
      for (const e of Object.keys(cfg.hooks)) {
        const groups = (cfg.hooks[e] || []).filter((g) => !(g.hooks || []).some(isOurs));
        if (groups.length) cfg.hooks[e] = groups; else delete cfg.hooks[e];
      }
      if (!Object.keys(cfg.hooks).length) delete cfg.hooks;
    }
    if (isOurStatus(cfg.statusLine)) delete cfg.statusLine;
    try { writeClaudeSettings(cfg); } catch (err) {
      return { ok: false, error: `Gagal menulis settings.json: ${clip(err.message, 100)}` };
    }
    log('claude: hooks dilepas');
    changed();
    return { ok: true };
  }

  // ---------- sesi cloud ----------
  function setCloud({ url, token: newToken } = {}) {
    if (url !== undefined) {
      url = String(url).trim().replace(/\/+$/, '');
      if (url && !/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(url)) return { ok: false, error: 'Alamat harus berbentuk https://nama-host atau https://nama-host:port' };
      settings.cloudUrl = url;
    }
    if (newToken !== undefined) {
      newToken = String(newToken).trim();
      if (!/^[A-Za-z0-9_-]{24,128}$/.test(newToken)) return { ok: false, error: 'Token harus 24-128 huruf/angka' };
      settings.cloudToken = newToken;
    }
    saveSettings();
    changed();
    return { ok: true };
  }
  // Setup script untuk environment cloud (claude.ai/code): menulis hook ke ~/.claude/settings.json di
  // mesin sesi cloud. Hook bertipe command menjalankan curl, karena curl lewat proxy jaringan cloud
  // sedangkan hook bertipe http tidak (teruji 15 Nov 2026). Token dibaca dari variabel DRAGON_ISLAND_TOKEN.
  function cloudSnippet() {
    const base = settings.cloudUrl || 'https://NAMA-LAPTOP.tailnet.ts.net';
    const url = `${base}${BASE}/hook`;
    return `# Dragon Dynamic Island: kirim kabar sesi cloud ke laptop. Hook command + curl (curl lewat proxy jaringan cloud;
# hook bertipe http tidak). Token dari variabel environment DRAGON_ISLAND_TOKEN; tanpa token, hook diam.
python3 - <<'PY'
import json, os
URL = "${url}"
p = os.path.expanduser("~/.claude/settings.json")
os.makedirs(os.path.dirname(p), exist_ok=True)
try:
    cfg = json.load(open(p))
except Exception:
    cfg = {}
cmd = ('[ -n "$DRAGON_ISLAND_TOKEN" ] && curl -sS -m 8 -o /dev/null -X POST ' + URL +
       ' -H "Content-Type: application/json" -H "X-Dragon-Island: $DRAGON_ISLAND_TOKEN"'
       ' -H "X-Dragon-Cloud-Session: $CLAUDE_CODE_REMOTE_SESSION_ID" --data-binary @-; true')
h = {"type": "command", "command": cmd, "async": True, "timeout": 10}
ours = lambda x: "/dragon-island/" in str(x.get("url", "")) + str(x.get("command", ""))
hooks = cfg.setdefault("hooks", {})
for e in ${JSON.stringify(EVENTS).replace(/","/g, '", "')}:
    keep = [g for g in hooks.get(e, []) if not any(ours(x) for x in g.get("hooks", []))]
    hooks[e] = keep + [{"hooks": [h]}]
json.dump(cfg, open(p, "w"), indent=2)
print("Dragon Dynamic Island: hooks terpasang di", p)
PY
`;
  }

  function clearFinished() {
    const now = Date.now();
    for (const s of Object.values(sessions)) {
      const stale = s.status === 'working' && now - s.updatedAt > STALE_MS;
      if (stale || s.status === 'done' || s.status === 'ended' || s.status === 'idle' || s.status === 'error') s.hidden = true;
    }
    changed();
  }

  // Sesi yang diam tidak mengirim kabar, jadi tampilan diperbarui berkala agar status "Tanpa kabar" muncul.
  const staleTimer = setInterval(() => {
    if (Object.values(sessions).some((x) => x.status === 'working' && !x.hidden)) onChange(snapshot());
  }, Math.min(30000, Math.max(500, Math.floor(STALE_MS / 3))));

  function close() { clearInterval(staleTimer); try { server.close(); } catch (_) { /* sudah tutup */ } }

  return { snapshot, install, uninstall, clearFinished, close, handleHook, handleStatusLine, setCloud, cloudSnippet };
}

module.exports = { createMonitor, PORT, EVENTS };
