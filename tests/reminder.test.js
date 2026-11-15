'use strict';
// Pengingat sholat: tepat saat masuk waktu, pulau terbuka sendiri di halaman Jadwal Sholat
// dan naga melompat. Tes ini menunggu sampai pergantian menit berikutnya (maks. ~70 detik).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { sleep, launch } = require('./helpers');
const Prayer = require('../renderer/prayer.js');

let t;
before(async () => { t = await launch(); });
after(async () => { if (t) { assert.deepEqual(t.errors, [], 'tidak boleh ada error di tampilan'); await t.close(); } });

test('pengingat menyala tepat saat masuk waktu sholat', { timeout: 120000 }, async () => {
  // Geser jadwal supaya salah satu waktu sholat jatuh tepat di menit berikutnya.
  const d = new Date();
  const now = d.getHours() * 60 + d.getMinutes();
  const lat = -7.3274, lng = 108.2207;
  const times = Prayer.compute(d, lat, lng, -d.getTimezoneOffset() / 60, 0);
  const [, adjust] = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya']
    .map((k) => [k, now + 1 - times[k]])
    .sort((a, b) => Math.abs(a[1]) - Math.abs(b[1]))[0];
  await t.seed({ pray: { city: 'Tasikmalaya', lat, lng, before: 0, adjust, sound: false } });
  await t.cursor(t.cx + 500, 700, 500);
  assert.match(await t.wrapClass(), /collapsed/);

  await t.win.waitForFunction(() => document.getElementById('wrap').classList.contains('alert'), null, { timeout: 75000 });
  await sleep(500);
  assert.match(await t.wrapClass(), /expanded/);
  assert.match(await t.title(), /^Jadwal Sholat/);
  assert.match(await t.dragonClass(), /excited/);
  assert.match(await t.win.textContent('.pt.past:last-of-type, .pt.next, #prayRow'), /\d\d:\d\d/);

  await t.cursor(t.cx + 600, 700, 13000);
  assert.match(await t.wrapClass(), /collapsed/, 'menutup sendiri setelah pengingat selesai');
});
