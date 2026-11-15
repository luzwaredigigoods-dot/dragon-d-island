'use strict';
// Halaman Claude: pemasangan hooks ke settings.json Claude Code, kabar sesi (bekerja / butuh izin /
// selesai), batas pemakaian dari status line, dan chat cepat lewat Claude API (server tiruan).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { sleep, launch } = require('./helpers');
const fakeApi = require('./fake-claude-api');

let t, api, port, token;
const claudeSettings = () => path.join(t.dir, 'claude-config', 'settings.json');
const readClaude = () => JSON.parse(fs.readFileSync(claudeSettings(), 'utf8'));
function post(route, body, headers = { 'X-Dragon-Island': token }) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: `/dragon-island/${route}`, method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: d }));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}
const hook = (session, cwd, event, extra = {}) => post('hook', { session_id: session, cwd, transcript_path: 'x.jsonl', permission_mode: 'default', hook_event_name: event, ...extra });
const rows = () => t.win.$$eval('#clList .cs', (l) => l.map((e) => `${e.classList[1]}|${e.querySelector('.nm').firstChild.textContent}|${e.querySelector('.dt').textContent}`));

before(async () => {
  api = await fakeApi.start('Pakai git stash untuk menyimpan perubahan sementara.');
  port = 20000 + Math.floor(Math.random() * 30000);
  t = await launch({ env: { PULAU_CLAUDE_PORT: String(port), ANTHROPIC_BASE_URL: api.url } });
  await t.seed();
  token = JSON.parse(fs.readFileSync(path.join(t.dir, 'settings.json'), 'utf8')).hookToken;
  assert.match(token, /^[0-9a-f]{36}$/);
});
after(async () => {
  if (t) { assert.deepEqual(t.errors, [], 'tidak boleh ada error di tampilan'); await t.close(); }
  if (api) api.close();
});

test('pasang hooks: pengaturan Claude Code lain tetap utuh, cadangan dibuat, tidak dobel', async () => {
  fs.mkdirSync(path.dirname(claudeSettings()), { recursive: true });
  const mine = {
    model: 'opus',
    statusLine: { type: 'command', command: '~/.claude/punya-saya.sh' },
    hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo selesai' }] }] },
  };
  fs.writeFileSync(claudeSettings(), JSON.stringify(mine));
  await t.open();
  await t.page(6);
  assert.match(await t.title(), /^Claude/);
  assert.match(await t.win.textContent('#clEmpty'), /Pasang/);

  await t.win.click('#clInstall');
  await sleep(400);
  const cfg = readClaude();
  assert.equal(cfg.model, 'opus');
  assert.deepEqual(cfg.statusLine, mine.statusLine, 'status line milik pengguna tidak ditimpa');
  assert.match(await t.win.textContent('#clHookInfo'), /status line/i);
  const events = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'];
  assert.deepEqual(Object.keys(cfg.hooks).sort(), [...events].sort());
  assert.equal(cfg.hooks.Stop.length, 2, 'hook Stop milik pengguna tetap ada');
  assert.equal(cfg.hooks.Stop[0].hooks[0].command, 'echo selesai');
  const ours = cfg.hooks.Stop[1].hooks[0];
  assert.deepEqual(ours, { type: 'http', url: `http://127.0.0.1:${port}/dragon-island/hook`, headers: { 'X-Dragon-Island': token }, timeout: 3 });
  const backups = fs.readdirSync(path.dirname(claudeSettings())).filter((f) => f.startsWith('settings.json.cadangan-dragon-'));
  assert.equal(backups.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(claudeSettings()), backups[0]), 'utf8')), mine);

  await t.win.evaluate(() => window.api.claude.install());
  assert.equal(readClaude().hooks.Stop.length, 2, 'memasang ulang tidak membuat hook dobel');
  assert.match(await t.win.textContent('#clEmpty'), /Belum ada sesi/);
});

test('panel Cloud: alamat & token tersimpan, perintah Tailscale dan hook repo bisa disalin', async () => {
  const { win } = t;
  await t.app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
  await win.click('#clCloud');
  assert.equal(await win.evaluate(() => document.getElementById('clCloudBox').hidden), false);
  const cloudToken = JSON.parse(fs.readFileSync(path.join(t.dir, 'settings.json'), 'utf8')).cloudToken;
  assert.match(cloudToken, /^[0-9a-f]{48}$/);
  assert.notEqual(cloudToken, token, 'token cloud berbeda dari token lokal');
  assert.equal(await win.inputValue('#clCloudToken'), cloudToken);
  assert.match(await win.textContent('#clCloudStatus'), /belum ada kabar/);

  await win.fill('#clCloudUrl', 'http://laptop.example');
  await win.click('#clCloudSave');
  await sleep(200);
  assert.match(await win.textContent('#clCloudStatus'), /https:\/\//, 'alamat tanpa https ditolak');
  await win.fill('#clCloudUrl', 'https://laptop.tailnet.ts.net:10000/');
  await win.click('#clCloudSave');
  await sleep(200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(t.dir, 'settings.json'), 'utf8')).cloudUrl, 'https://laptop.tailnet.ts.net:10000');

  await win.click('#clCloudFunnel');
  assert.equal(await t.app.evaluate(({ clipboard }) => clipboard.readText()), `tailscale funnel --bg --set-path /dragon-island http://127.0.0.1:${port}`);
  await win.click('#clCloudSnippet');
  await sleep(300);
  // Yang disalin: setup script untuk environment cloud. Jalankan di HOME sementara, lalu periksa hasilnya.
  const script = await t.app.evaluate(({ clipboard }) => clipboard.readText());
  assert.ok(!script.includes(cloudToken), 'token tidak ikut tertulis di setup script');
  const home = fs.mkdtempSync(path.join(require('os').tmpdir(), 'pulau-home-'));
  require('child_process').execFileSync('bash', ['-c', script], { env: { ...process.env, HOME: home } });
  require('child_process').execFileSync('bash', ['-c', script], { env: { ...process.env, HOME: home } }); // aman dijalankan ulang
  const cfg = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(Object.keys(cfg.hooks).sort(), ['Notification', 'PermissionRequest', 'PostToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'StopFailure', 'UserPromptSubmit']);
  assert.equal(cfg.hooks.Stop.length, 1, 'tidak dobel');
  const h = cfg.hooks.Stop[0].hooks[0];
  assert.equal(h.type, 'command', 'hook command + curl: hook http tidak lewat proxy jaringan cloud');
  assert.equal(h.async, true);
  assert.match(h.command, /^\[ -n "\$DRAGON_ISLAND_TOKEN" \] && curl .* https:\/\/laptop\.tailnet\.ts\.net:10000\/dragon-island\/hook .*X-Dragon-Island: \$DRAGON_ISLAND_TOKEN.*X-Dragon-Cloud-Session: \$CLAUDE_CODE_REMOTE_SESSION_ID.* --data-binary @-; true$/);
  fs.rmSync(home, { recursive: true, force: true });

  await win.click('#clCloudOpen');
  await sleep(150);
  assert.deepEqual(await t.app.evaluate(() => global.__opened), ['https://claude.ai/code']);
  await win.click('#clCloudClose');
});

test('server lokal menolak token salah dan mengabaikan kabar tanpa token', async () => {
  assert.equal((await post('hook', { session_id: 'x', hook_event_name: 'Stop' }, {})).status, 204, 'tanpa token: 2xx kosong, diabaikan');
  assert.equal((await post('hook', { session_id: 'x', hook_event_name: 'Stop' }, { 'X-Dragon-Island': 'salah' })).status, 403);
  await sleep(300);
  assert.deepEqual(await rows(), []);
});

test('kabar sesi: bekerja, butuh izin (pulau terbuka sendiri), lanjut bekerja, selesai', async () => {
  const { win } = t;
  await win.mouse.move(t.cx, 500);
  await t.cursor(t.cx + 500, 700, 900);
  assert.match(await t.wrapClass(), /collapsed/);

  const r = await hook('s1', 'C:\\Users\\dok\\proyek\\simrs-rme', 'UserPromptSubmit', { prompt: 'Buat draf CPPT pasien POD 2' });
  assert.equal(r.status, 204, 'hook dijawab 2xx tanpa isi supaya tidak mengubah keputusan Claude Code');
  assert.equal(r.body, '');
  await hook('s1', 'C:\\Users\\dok\\proyek\\simrs-rme', 'PostToolUse', { tool_name: 'Edit', tool_input: { file_path: 'C:\\Users\\dok\\proyek\\simrs-rme\\cppt.md' } });
  await sleep(300);
  assert.match(await win.$eval('#pillClaude', (e) => e.className), /working/);
  assert.equal(await win.$eval('#pillClaude', (e) => e.textContent.trim()), '1');

  await win.evaluate(() => { window.__sounds = []; if (window.__spied) return; window.__spied = true; const play = window.DragonSound.play; window.DragonSound.play = (k) => { window.__sounds.push(k); return play(k); }; });
  await hook('s2', '/home/dok/dragon-d-island', 'UserPromptSubmit', { prompt: 'tambahkan fitur cuaca' });
  await hook('s2', '/home/dok/dragon-d-island', 'PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm install axios' } });
  await sleep(500);
  assert.match(await t.wrapClass(), /expanded/, 'pulau terbuka sendiri saat Claude butuh izin');
  assert.match(await t.title(), /^Claude/);
  assert.match(await t.dragonClass(), /excited/);
  assert.match(await win.$eval('#pillClaude', (e) => e.className), /permission/);
  assert.deepEqual(await rows(), [
    'permission|dragon-d-island|Minta izin: Bash: npm install axios',
    'working|simrs-rme|Edit: cppt.md',
  ]);
  assert.equal(await win.textContent('#clCount'), '2');
  assert.deepEqual(await win.evaluate(() => window.__sounds), ['naga'], 'auman naga saat Claude butuh izin');

  await hook('s2', '/home/dok/dragon-d-island', 'PostToolUse', { tool_name: 'Bash', tool_input: { command: 'npm install axios' } });
  await hook('s1', 'C:\\Users\\dok\\proyek\\simrs-rme', 'Stop', { last_assistant_message: 'Draf CPPT sudah saya tulis di cppt.md.' });
  await sleep(400);
  assert.deepEqual(await rows(), [
    'working|dragon-d-island|Bash: npm install axios',
    'done|simrs-rme|Draf CPPT sudah saya tulis di cppt.md.',
  ]);
  assert.match(await t.dragonClass(), /happy/);
});

test('detail sesi: perintah terakhir dan tombol salin perintah lanjut', async () => {
  const { win } = t;
  await t.cursor(t.cx + 600, 700, 13000); // tunggu pengingat izin selesai
  await t.open();
  await t.page(6);
  await win.click('#clList .cs:nth-child(2)');
  await sleep(200);
  assert.match(await win.textContent('#clList .cs:nth-child(2) .more'), /Perintah terakhir: Buat draf CPPT pasien POD 2/);
  await win.click('#clList .cs:nth-child(2) .more .chip:last-child');
  await sleep(200);
  assert.equal(await t.app.evaluate(({ clipboard }) => clipboard.readText()), 'cd "C:\\Users\\dok\\proyek\\simrs-rme"; claude --resume s1');
});

test('status line: baris status untuk Claude Code dan batas pemakaian 5 jam / 7 hari', async () => {
  const now = Math.floor(Date.now() / 1000);
  const r = await post('statusline', {
    session_id: 's1', model: { display_name: 'Opus 5.5' }, context_window: { used_percentage: 34.4 }, cost: { total_cost_usd: 0.41 },
    rate_limits: { five_hour: { used_percentage: 42, resets_at: now + 7200 }, seven_day: { used_percentage: 91, resets_at: now + 400000 } },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body, 'Opus 5.5 | ctx 34% | 5h 42% | 7d 91%');
  await sleep(300);
  assert.match(await t.win.textContent('#clUsage'), /5 jam\s*42%.*7 hari\s*91%/);
  assert.equal(await t.win.$$eval('#clUsage .bar.hot', (l) => l.length), 1, '7 hari di atas 90% ditandai merah');
  assert.match(await t.win.textContent('#clList .cs:nth-child(2) .tm'), /ctx 34%/);
});

test('sesi berakhir dan tombol Bersihkan menyembunyikan sesi yang sudah tidak aktif', async () => {
  await hook('s2', '/home/dok/dragon-d-island', 'SessionEnd', { reason: 'prompt_input_exit' });
  await hook('s3', '/home/dok/laporan', 'UserPromptSubmit', { prompt: 'ringkas jurnal' });
  await sleep(300);
  assert.deepEqual((await rows()).map((x) => x.split('|')[0]), ['working', 'done', 'ended']);
  await t.win.click('#clClear');
  await sleep(300);
  assert.deepEqual((await rows()).map((x) => x.split('|')[1]), ['laporan'], 'yang masih bekerja tetap tampil');
});

test('kabar sesi cloud: diterima dengan token cloud, berlabel CLOUD, tertaut ke claude.ai', async () => {
  const { win } = t;
  const cloudToken = JSON.parse(fs.readFileSync(path.join(t.dir, 'settings.json'), 'utf8')).cloudToken;
  const cloudHeaders = { 'X-Dragon-Island': cloudToken, 'X-Dragon-Cloud-Session': 'cse_013pJi9r3vWyj78HUdwWg1a7' };
  const body = (event, extra) => ({ session_id: 'c1', cwd: '/home/user/dragon-d-island', transcript_path: 'x', hook_event_name: event, ...extra });

  // Sesi lokal di repo yang memakai hook cloud: variabelnya kosong, jadi tanpa token. Diterima 2xx tapi diabaikan.
  const silent = await post('hook', body('UserPromptSubmit', { prompt: 'dari laptop' }), { 'X-Dragon-Island': '' });
  assert.equal(silent.status, 204);
  assert.equal((await post('statusline', { session_id: 'c1' }, cloudHeaders)).status, 403, 'status line hanya dari laptop');

  const r = await post('hook', body('UserPromptSubmit', { prompt: 'tambahkan fitur cuaca di cloud' }), cloudHeaders);
  assert.equal(r.status, 204);
  await post('hook', body('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm publish' } }), cloudHeaders);
  await sleep(500);
  assert.match(await t.wrapClass(), /expanded/, 'izin dari sesi cloud juga membuka pulau');
  const row = await win.$eval('#clList .cs:first-child', (e) => ({
    cls: e.className, name: e.querySelector('.nm').firstChild.textContent,
    badge: (e.querySelector('.nm .badge') || {}).textContent, title: (e.querySelector('.nm small') || {}).textContent,
    detail: e.querySelector('.dt').textContent,
  }));
  assert.match(row.cls, /permission/);
  assert.deepEqual([row.name, row.badge, row.title, row.detail], ['dragon-d-island', 'CLOUD', 'tambahkan fitur cuaca di cloud', 'Minta izin: Bash: npm publish']);

  await t.app.evaluate(({ shell }) => { global.__opened = []; shell.openExternal = async (u) => { global.__opened.push(u); }; });
  await win.click('#clList .cs:first-child');
  await sleep(150);
  const buttons = await win.$$eval('#clList .cs:first-child .more .chip', (l) => l.map((e) => e.textContent));
  assert.deepEqual(buttons, ['Buka sesi ↗', 'Salin perintah teleport'], 'sesi cloud tidak punya folder di laptop');
  // Claude Desktop tidak terpasang (di mesin tes): jatuh ke browser. ID cse_ diubah ke session_ untuk alamat web.
  await win.click('#clList .cs:first-child .more .chip:first-child');
  await win.click('#clList .cs:first-child .more .chip:last-child');
  await sleep(200);
  assert.deepEqual(await t.app.evaluate(() => global.__opened), ['https://claude.ai/code/session_013pJi9r3vWyj78HUdwWg1a7']);
  // Claude Desktop terpasang: tautan claude:// dipakai.
  await t.app.evaluate(({ app }) => { global.__opened = []; app.getApplicationNameForProtocol = (p) => (p === 'claude://' ? 'Claude' : ''); });
  await win.click('#clList .cs:first-child .more .chip:first-child');
  await sleep(200);
  assert.deepEqual(await t.app.evaluate(() => global.__opened), ['claude://claude.ai/code/session_013pJi9r3vWyj78HUdwWg1a7']);
  assert.equal(await t.app.evaluate(({ clipboard }) => clipboard.readText()), 'claude --teleport cse_013pJi9r3vWyj78HUdwWg1a7');

  // ID sesi yang tidak wajar tidak dipakai untuk tautan
  await post('hook', { ...body('Stop', { last_assistant_message: 'Selesai.' }), session_id: 'c2' }, { ...cloudHeaders, 'X-Dragon-Cloud-Session': 'cse_x"><script>' });
  await sleep(300);
  await win.click('#clCloud');
  assert.match(await win.textContent('#clCloudStatus'), /kabar terakhir baru saja/);
  await win.click('#clCloudClose');
  await t.cursor(t.cx + 600, 700, 12500); // tunggu pengingat izin selesai
});

test('chat: minta kunci dulu, jawaban mengalir bertahap, lalu usage tercatat', async () => {
  const { win } = t;
  await t.open();
  await t.page(6);
  await win.click('#clTabChat');
  await win.fill('#clText', 'cara simpan perubahan git sementara?');
  await win.press('#clText', 'Enter');
  await sleep(200);
  assert.equal(await win.evaluate(() => document.getElementById('clKeyBox').hidden), false, 'kotak kunci muncul');
  await win.fill('#clKey', 'bukan-kunci');
  await win.click('#clKeySave');
  assert.match(await win.textContent('#clKeyInfo'), /Format kunci/);
  await win.fill('#clKey', 'sk-ant-api03-' + 'x'.repeat(40));
  await win.click('#clKeySave');
  await sleep(300);
  assert.equal(await win.evaluate(() => document.getElementById('clKeyBox').hidden), true);

  await win.fill('#clText', 'cara simpan perubahan git sementara?');
  await win.press('#clText', 'Enter');
  await sleep(120);
  const partial = await win.$eval('.msg.ai', (e) => e.textContent);
  assert.ok(partial.length > 0 && partial.length < 50, `jawaban tampil sebagian dulu: "${partial}"`);
  assert.equal(await win.textContent('#clSend'), 'Stop');
  await sleep(1200);
  assert.match(await win.$eval('.msg.ai', (e) => e.firstChild.textContent), /^Pakai git stash untuk menyimpan perubahan sementara\.$/);
  assert.match(await win.textContent('.msg.ai .meta'), /Opus 5\.5/);
  assert.match(await win.textContent('#clUsage'), /Chat hari ini: 1 pesan/);

  const req = api.calls.at(-1);
  assert.equal(req.url, '/v1/messages');
  assert.equal(req.body.model, 'claude-opus-5-5');
  assert.deepEqual(req.body.output_config, { effort: 'low' });
  assert.equal(req.body.fallbacks, 'default');
  assert.equal(req.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(req.body.stream, true);
  assert.equal(req.body.thinking, undefined, 'thinking tidak dikirim: Opus 5.5 selalu adaptif');
});

test('chat: percakapan berlanjut, tombol Baru memulai dari awal, Haiku tanpa fallback', async () => {
  const { win } = t;
  await win.fill('#clText', 'lalu cara mengembalikannya?');
  await win.press('#clText', 'Enter');
  await sleep(1300);
  const second = api.calls.at(-1).body.messages;
  assert.deepEqual(second.map((m) => m.role), ['user', 'assistant', 'user'], 'riwayat ikut terkirim');

  await win.click('#clNew');
  assert.equal(await win.$$eval('#clLog .msg', (l) => l.length), 0);
  await win.selectOption('#clModel', 'claude-haiku-5-5');
  await win.fill('#clText', 'halo');
  await win.press('#clText', 'Enter');
  await sleep(1300);
  const req = api.calls.at(-1);
  assert.deepEqual(req.body.messages.map((m) => m.role), ['user'], 'Baru = percakapan baru');
  assert.equal(req.body.model, 'claude-haiku-5-5');
  assert.equal(req.body.fallbacks, undefined, 'Haiku tidak punya fallback di server');
  assert.equal(req.headers['anthropic-beta'], undefined);
  await win.selectOption('#clModel', 'claude-opus-5-5');
});

test('chat: kunci ditolak memberi pesan jelas dan membuka kotak kunci', async () => {
  const bad = await fakeApi.start('', { status: 401 });
  const { win } = t;
  // arahkan klien ke server yang menolak kunci
  await t.app.evaluate((_e, url) => { process.env.ANTHROPIC_BASE_URL = url; }, bad.url);
  await win.fill('#clText', 'tes');
  await win.press('#clText', 'Enter');
  await sleep(800);
  assert.match(await win.textContent('.msg.err'), /Kunci API ditolak/);
  assert.equal(await win.evaluate(() => document.getElementById('clKeyBox').hidden), false);
  await win.click('#clKeyCancel');
  await t.app.evaluate((_e, url) => { process.env.ANTHROPIC_BASE_URL = url; }, api.url);
  bad.close();
});

test('lepas hooks: hanya milik Dragon Dynamic Island yang dihapus', async () => {
  const { win } = t;
  await win.click('#clTabSessions');
  await win.click('#clInstall');
  assert.equal(await win.textContent('#clInstall'), 'Yakin lepas?');
  await win.click('#clInstall');
  await sleep(400);
  const cfg = readClaude();
  assert.deepEqual(cfg.hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo selesai' }] }] });
  assert.deepEqual(cfg.statusLine, { type: 'command', command: '~/.claude/punya-saya.sh' });
  assert.equal(cfg.model, 'opus');
  assert.equal(await win.textContent('#clInstall'), 'Pasang');
});

test('suara notifikasi: pilihan dari menu tray tersimpan, contoh suaranya dimainkan, Tanpa suara diam', async () => {
  const { win } = t;
  await win.evaluate(() => { window.__sounds = []; if (window.__spied) return; window.__spied = true; const play = window.DragonSound.play; window.DragonSound.play = (k) => { window.__sounds.push(k); return play(k); }; });
  const pick = (label) => t.app.evaluate(({ Menu }, l) => {
    // menu tray dibuat ulang dari templat; cari item lewat menu konteks yang disimpan main.js
    const sub = global.__trayMenu.items.find((i) => i.label === 'Suara notifikasi Claude').submenu;
    sub.items.find((i) => i.label === l).click();
  }, label);
  await pick('Dering');
  await sleep(200);
  assert.equal(JSON.parse(fs.readFileSync(path.join(t.dir, 'settings.json'), 'utf8')).claudeSound, 'dering');
  await pick('Tanpa suara');
  await sleep(200);
  assert.deepEqual(await win.evaluate(() => window.__sounds), ['dering'], 'contoh suara diputar, Tanpa suara tidak berbunyi');
  for (const k of ['naga', 'dering', 'lonceng']) assert.ok(await win.evaluate((x) => window.DragonSound.play(x), k) > 0, `suara ${k} dapat dibuat`);
  await pick('Auman naga');
});
