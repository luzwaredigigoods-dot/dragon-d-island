'use strict';
// Sesi "Bekerja" yang lama tidak mengirim kabar (mis. kabar "selesai"-nya hilang) ditandai "Tanpa kabar",
// tidak dihitung di pil, dan ikut terhapus oleh Bersihkan. Batas waktunya diperpendek untuk tes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { sleep, launch } = require('./helpers');

let t, port, token;
function hook(body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/dragon-island/hook', method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Dragon-Island': token } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}
const rows = () => t.win.$$eval('#clList .cs', (l) => l.map((e) => `${e.classList[1]}|${e.querySelector('.nm').firstChild.textContent}|${e.querySelector('.dt').textContent}`));

before(async () => {
  port = 20000 + Math.floor(Math.random() * 30000);
  t = await launch({ env: { PULAU_CLAUDE_PORT: String(port), PULAU_CLAUDE_STALE_MS: '2500' } });
  await t.seed();
  token = JSON.parse(fs.readFileSync(path.join(t.dir, 'settings.json'), 'utf8')).hookToken;
});
after(async () => { if (t) { assert.deepEqual(t.errors, [], 'tidak boleh ada error di tampilan'); await t.close(); } });

test('sesi yang diam berubah jadi "Tanpa kabar" tanpa perlu kabar baru, lalu bisa dibersihkan', async () => {
  const { win } = t;
  await hook({ session_id: 'diam', cwd: '/home/user/proyek', hook_event_name: 'UserPromptSubmit', prompt: 'kerjakan sesuatu' });
  await hook({ session_id: 'aktif', cwd: '/home/user/lain', hook_event_name: 'UserPromptSubmit', prompt: 'tugas lain' });
  await t.open();
  await t.page(6);
  assert.deepEqual((await rows()).map((r) => r.split('|')[0]), ['working', 'working']);
  assert.equal(await win.$eval('#pillClaude', (e) => e.textContent.trim()), '2');

  // "aktif" terus mengirim kabar; "diam" tidak.
  for (let i = 0; i < 5; i++) { await sleep(800); await hook({ session_id: 'aktif', cwd: '/home/user/lain', hook_event_name: 'PostToolUse', tool_name: 'Read', tool_input: { file_path: `/x/f${i}.js` } }); }
  await sleep(1200);
  assert.deepEqual(await rows(), [
    'working|lain|Read: f4.js',
    'stale|proyek|Tanpa kabar sejak: Mulai mengerjakan',
  ]);
  assert.match(await win.textContent('#clList .cs.stale .tm'), /^Tanpa kabar/);
  assert.equal(await win.$eval('#pillClaude', (e) => e.textContent.trim()), '1', 'pil hanya menghitung yang benar-benar bekerja');

  await hook({ session_id: 'aktif', cwd: '/home/user/lain', hook_event_name: 'Stop', last_assistant_message: 'Selesai.' });
  await sleep(300);
  await win.click('#clClear');
  await sleep(300);
  assert.deepEqual(await rows(), [], 'Bersihkan menghapus sesi selesai dan yang tanpa kabar');

  // Kabar baru dari sesi yang tadi diam: muncul lagi sebagai bekerja.
  await hook({ session_id: 'diam', cwd: '/home/user/proyek', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } });
  await sleep(300);
  assert.deepEqual(await rows(), ['working|proyek|Bash: npm test']);
});
