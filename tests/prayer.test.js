'use strict';
// Perhitungan waktu sholat (tanpa Electron).
const test = require('node:test');
const assert = require('node:assert/strict');
const Prayer = require('../renderer/prayer.js');

const ORDER = ['subuh', 'terbit', 'dzuhur', 'ashar', 'maghrib', 'isya'];
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

test('urutan waktu benar dan masuk akal untuk kota-kota Indonesia sepanjang tahun', () => {
  for (const [name, lat, lng] of Prayer.CITIES) {
    for (let month = 0; month < 12; month++) {
      const t = Prayer.compute(new Date(2026, month, 15), lat, lng, 7, 0);
      for (let i = 1; i < ORDER.length; i++) {
        assert.ok(t[ORDER[i - 1]] < t[ORDER[i]], `${name} bulan ${month + 1}: ${ORDER[i - 1]} ${hhmm(t[ORDER[i - 1]])} harus sebelum ${ORDER[i]} ${hhmm(t[ORDER[i]])}`);
      }
      // Indonesia dekat khatulistiwa: siang hari 11,5-13 jam, Isya 70-90 menit setelah Maghrib.
      const day = t.maghrib - t.terbit;
      assert.ok(day > 690 && day < 780, `${name} bulan ${month + 1}: panjang siang ${day} menit`);
      const gap = t.isya - t.maghrib;
      assert.ok(gap >= 65 && gap <= 90, `${name} bulan ${month + 1}: Maghrib-Isya ${gap} menit`);
    }
  }
});

test('zona waktu WIB: Dzuhur di Jawa antara 11:15 dan 12:12 sepanjang tahun', () => {
  for (const name of ['Jakarta', 'Bandung', 'Tasikmalaya', 'Semarang', 'Surabaya']) {
    const [, lat, lng] = Prayer.CITIES.find(([n]) => n === name);
    for (let month = 0; month < 12; month++) {
      const t = Prayer.compute(new Date(2026, month, 15), lat, lng, 7, 0);
      assert.ok(t.dzuhur >= 11 * 60 + 15 && t.dzuhur <= 12 * 60 + 12, `${name} bulan ${month + 1}: Dzuhur ${hhmm(t.dzuhur)}`);
    }
  }
});

test('koreksi menit menggeser semua waktu sholat tetapi tidak waktu terbit', () => {
  const d = new Date(2026, 10, 15);
  const a = Prayer.compute(d, -7.3274, 108.2207, 7, 0);
  const b = Prayer.compute(d, -7.3274, 108.2207, 7, 3);
  for (const k of ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya']) assert.equal(b[k] - a[k], 3, k);
  assert.equal(b.terbit, a.terbit);
});
