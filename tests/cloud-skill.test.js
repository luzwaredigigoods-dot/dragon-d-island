'use strict';
// Skill hubungkan-dragon-island: skrip pasang hook untuk sesi cloud. Memakai server palsu dan folder sementara,
// tidak menyentuh ~/.claude sungguhan.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { execFile } = require('child_process');
const { ROOT } = require('./helpers');

const SKILL = path.join(ROOT, '.claude', 'skills', 'hubungkan-dragon-island');
const SCRIPT = path.join(SKILL, 'scripts', 'pasang_hook.py');
const EVENTS = ['SessionStart', 'UserPromptSubmit', 'PostToolUse', 'PermissionRequest', 'Notification', 'Stop', 'StopFailure', 'SessionEnd'];
const GOOD = 'tokencloud' + 'a'.repeat(30);

let srv, base, dir, seen;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-test-'));
  seen = [];
  srv = http.createServer((req, res) => {
    let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
      seen.push({ url: req.url, token: req.headers['x-dragon-island'], body: b });
      res.writeHead(req.headers['x-dragon-island'] === GOOD ? 204 : 403); res.end();
    });
  });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${srv.address().port}`;
});
after(() => { srv.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// Asinkron: server palsu ada di proses yang sama, jadi proses utama tidak boleh terblokir saat skrip menunggu.
const run = (args, env = {}) => new Promise((resolve) => execFile('python3', ['-I', SCRIPT, ...args],
  { encoding: 'utf8', env: { PATH: process.env.PATH, ...env } }, (err, stdout, stderr) => resolve({ status: err ? (err.code || 1) : 0, stdout, stderr })));

test('SKILL.md punya nama dan deskripsi, tanpa token', () => {
  const md = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  assert.match(md, /^---\nname: hubungkan-dragon-island\ndescription: .{40,}\n---/);
  assert.doesNotMatch(md + fs.readFileSync(SCRIPT, 'utf8'), /[0-9a-f]{40,}/, 'tidak ada token tertanam');
});

test('mode variabel environment: hook ditulis tanpa rahasia, koneksi diperiksa, token tidak dicetak', async () => {
  const s = path.join(dir, 'a', 'settings.json');
  fs.mkdirSync(path.dirname(s), { recursive: true });
  fs.writeFileSync(s, JSON.stringify({ model: 'opus', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo selesai' }] }] } }));
  const r = await run(['--url', base, '--settings', s], { DRAGON_ISLAND_TOKEN: GOOD });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Pemeriksaan koneksi: ok/);
  assert.ok(!(r.stdout + r.stderr).includes(GOOD), 'token tidak boleh tercetak');
  const cfg = JSON.parse(fs.readFileSync(s, 'utf8'));
  assert.equal(cfg.model, 'opus');
  assert.deepEqual(Object.keys(cfg.hooks).sort(), [...EVENTS].sort());
  assert.equal(cfg.hooks.Stop.length, 2, 'hook Stop milik pengguna tetap ada');
  assert.equal(cfg.hooks.Stop[0].hooks[0].command, 'echo selesai');
  const h = cfg.hooks.Stop[1].hooks[0];
  assert.equal(h.type, 'command'); assert.equal(h.async, true);
  assert.match(h.command, /\$DRAGON_ISLAND_TOKEN/); assert.ok(!h.command.includes(GOOD));
  assert.match(h.command, new RegExp(`${base}/dragon-island/hook`));
  assert.match(h.command, /X-Dragon-Cloud-Session: \$CLAUDE_CODE_REMOTE_SESSION_ID/);
  assert.deepEqual(seen.at(-1), { url: '/dragon-island/hook', token: GOOD, body: '{}' });
  // dijalankan ulang: tidak dobel
  await run(['--url', base, '--settings', s], { DRAGON_ISLAND_TOKEN: GOOD });
  assert.equal(JSON.parse(fs.readFileSync(s, 'utf8')).hooks.Stop.length, 2);
});

test('mode --token: token ditulis ke settings (tanpa penjaga variabel), tidak dicetak', async () => {
  const s = path.join(dir, 'b', 'settings.json');
  const r = await run(['--url', base, '--token', GOOD, '--settings', s]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /token tertulis di berkas/);
  assert.ok(!(r.stdout + r.stderr).includes(GOOD));
  const cmd = JSON.parse(fs.readFileSync(s, 'utf8')).hooks.SessionStart[0].hooks[0].command;
  assert.ok(cmd.includes(`X-Dragon-Island: ${GOOD}`));
  assert.doesNotMatch(cmd, /^\[ -n/);
});

test('diagnosis: token salah, laptop tidak terjangkau, dan tanpa token', async () => {
  const s = path.join(dir, 'c', 'settings.json');
  const salah = await run(['--url', base, '--settings', s], { DRAGON_ISLAND_TOKEN: 'salah' });
  assert.equal(salah.status, 1);
  assert.match(salah.stdout, /Pemeriksaan koneksi: token\. .*salin ulang/);
  const mati = await run(['--url', 'http://127.0.0.1:9', '--settings', s], { DRAGON_ISLAND_TOKEN: GOOD });
  assert.equal(mati.status, 1);
  assert.match(mati.stdout, /Pemeriksaan koneksi: jaringan\. .*Funnel/);
  const none = await run(['--url', base, '--settings', s]);
  assert.equal(none.status, 0);
  assert.match(none.stdout, /Pemeriksaan koneksi: tanpa-token/);
});

test('--cek tidak mengubah apa pun; settings rusak tidak ditimpa; alamat tidak aman ditolak', async () => {
  const s = path.join(dir, 'd', 'settings.json');
  const cek = await run(['--cek', '--url', base, '--settings', s], { DRAGON_ISLAND_TOKEN: GOOD });
  assert.equal(cek.status, 0);
  assert.ok(!fs.existsSync(s), '--cek tidak membuat berkas');
  fs.mkdirSync(path.dirname(s), { recursive: true });
  fs.writeFileSync(s, '{rusak');
  const r = await run(['--url', base, '--settings', s]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /tidak bisa dibaca/);
  assert.equal(fs.readFileSync(s, 'utf8'), '{rusak', 'berkas rusak dibiarkan');
  const bad = await run(['--url', 'http://evil.example.com', '--settings', s], { DRAGON_ISLAND_TOKEN: GOOD });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /https/);
});

test('SKILL.md satu berkas: skrip tertanam identik dengan sumber, tanpa rujukan ke folder skill, dan bisa dijalankan', async () => {
  const gen = await new Promise((resolve) => execFile('python3', ['-I', path.join(ROOT, 'tools', 'make_skill_single.py')], { encoding: 'utf8' }, (e, o, er) => resolve({ ok: !e, out: o + er })));
  assert.ok(gen.ok, gen.out);
  const md = fs.readFileSync(path.join(ROOT, 'dist', 'skill-satu-berkas', 'SKILL.md'), 'utf8');
  assert.match(md, /^---\nname: hubungkan-dragon-island\ndescription: /);
  const m = /```python\n([\s\S]*?)\n```/.exec(md);
  assert.ok(m, 'blok skrip ada');
  const src = fs.readFileSync(SCRIPT, 'utf8');
  assert.equal(m[1].trimEnd(), src.trimEnd());
  assert.doesNotMatch(md.replace('scripts/cloud-setup-script.sh', ''), /scripts\//, 'tidak ada rujukan ke folder skill');
  assert.match(md, /python3 \/tmp\/pasang_hook\.py/);
  assert.doesNotMatch(md, /[0-9a-f]{40,}/, 'tanpa token');
  // skrip hasil ekstraksi benar-benar berjalan
  const f = path.join(dir, 'ekstrak.py');
  fs.writeFileSync(f, m[1] + '\n');
  const r = await new Promise((resolve) => execFile('python3', ['-I', f, '--cek', '--url', base], { encoding: 'utf8', env: { PATH: process.env.PATH, DRAGON_ISLAND_TOKEN: GOOD } }, (e, o) => resolve({ code: e ? 1 : 0, o })));
  assert.equal(r.code, 0);
  assert.match(r.o, /Pemeriksaan koneksi: ok/);
});
