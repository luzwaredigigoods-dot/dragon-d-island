'use strict';
// Ganti nama dari "Pulau" ke "Dragon Dynamic Island": data lama harus ikut pindah, sekali saja.
// Folder data aplikasi di Linux mengikuti XDG_CONFIG_HOME, jadi tes ini memakai folder sementara.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sleep, launch } = require('./helpers');

const config = fs.mkdtempSync(path.join(os.tmpdir(), 'pulau-config-'));
const oldDir = path.join(config, 'Pulau');
const newDir = path.join(config, 'Dragon Dynamic Island');
after(() => fs.rmSync(config, { recursive: true, force: true }));

test('data versi lama "Pulau" disalin ke folder nama baru saat pertama dijalankan', { skip: process.platform !== 'linux' && 'folder data hanya bisa dialihkan di Linux' }, async () => {
  // 1. Versi lama: isi data di %APPDATA%\Pulau
  const lama = await launch({ env: { XDG_CONFIG_HOME: config, PULAU_USER_DATA: oldDir } });
  await lama.seed({ todo: { day: '2999-1-1', items: [{ text: 'data dari Pulau', done: false }] }, note: 'catatan lama' });
  await lama.app.close();

  // 2. Versi baru tanpa folder data khusus: memakai folder bernama aplikasi baru
  const baru = await launch({ env: { XDG_CONFIG_HOME: config, PULAU_USER_DATA: '' } });
  try {
    await sleep(500);
    assert.ok(fs.existsSync(newDir), 'folder data baru dibuat');
    assert.ok(fs.existsSync(oldDir), 'folder lama tidak dihapus');
    assert.equal(await baru.win.inputValue('#noteText'), 'catatan lama');
    assert.deepEqual(await baru.win.$$eval('#todoList li .tx', (l) => l.map((e) => e.textContent)), ['data dari Pulau']);
    const log = fs.readFileSync(path.join(newDir, 'dragon-island.log'), 'utf8');
    assert.match(log, /data lama disalin dari .*Pulau/);
    assert.match(log, /=== Dragon Dynamic Island/);
    assert.deepEqual(baru.errors, []);
    // 3. Perubahan di versi baru tidak tertimpa data lama saat dibuka lagi
    await baru.win.fill('#noteText', 'catatan baru');
    await sleep(500);
  } finally {
    await baru.app.close();
  }
  const lagi = await launch({ env: { XDG_CONFIG_HOME: config, PULAU_USER_DATA: '' } });
  try {
    await sleep(500);
    assert.equal(await lagi.win.inputValue('#noteText'), 'catatan baru', 'penyalinan hanya terjadi sekali');
  } finally {
    await lagi.app.close();
  }
});
