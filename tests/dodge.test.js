'use strict';
// Mode menyingkir: pulau bersembunyi saat kursor mendekat (ada jendela terbuka penuh),
// dan terbuka saat kursor mentok di tepi atas layar.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { sleep, launch } = require('./helpers');

let t;
before(async () => { t = await launch(); await t.seed(); });
after(async () => { if (t) { assert.deepEqual(t.errors, [], 'tidak boleh ada error di tampilan'); await t.close(); } });

const state = async () => {
  const c = await t.wrapClass();
  return c.includes('hidden') ? 'sembunyi' : c.includes('expanded') ? 'terbuka' : 'pil';
};

test('tanpa jendela penuh: kursor mendekat tidak menyembunyikan pulau', async () => {
  await t.cursor(300, 600);
  assert.equal(await state(), 'pil');
  await t.cursor(t.cx + 40, 60);
  assert.equal(await state(), 'pil');
});

test('dengan jendela penuh: mendekat = sembunyi, mentok tepi atas = pil lalu panel', async () => {
  await t.send('dodge', true);
  await t.cursor(300, 600, 400);
  assert.equal(await state(), 'pil', 'kursor jauh: pil tetap terlihat');
  await t.cursor(t.cx + 60, 70, 450);
  assert.equal(await state(), 'sembunyi');
  await t.cursor(t.cx + 20, 20, 300);
  assert.equal(await state(), 'sembunyi', 'masih di area pil tapi belum mentok');
  await t.cursor(t.cx + 10, 0, 200);
  assert.equal(await state(), 'pil', 'mentok tepi: pil muncul dulu');
  await sleep(500);
  assert.equal(await state(), 'terbuka', 'lalu panel terbuka');
});

test('panel yang dibuka lewat tepi bisa dipakai, lalu menutup saat kursor pergi', async () => {
  const { win } = t;
  await win.mouse.move(t.cx, 60);
  await sleep(200);
  const before = await t.title();
  await win.click('#next');
  assert.notEqual(await t.title(), before);
  await win.mouse.move(t.cx, 400);
  await t.cursor(t.cx, 400, 700);
  assert.equal(await state(), 'pil');
});

test('tepi atas jauh dari pil tidak memanggil pulau; menyentuh tepi lalu pergi tidak membuka panel', async () => {
  await t.cursor(t.cx - 500, 0, 600);
  assert.equal(await state(), 'pil');
  await t.cursor(t.cx, 0, 100);
  await t.cursor(t.cx + 400, 300, 700);
  assert.equal(await state(), 'pil');
});

test('panel menutup saat kursor menjauh walau tanpa sinyal mouseleave', async () => {
  await t.cursor(t.cx, 0, 700);
  assert.equal(await state(), 'terbuka');
  await t.cursor(t.cx + 600, 500, 800);
  assert.equal(await state(), 'pil');
  await t.send('dodge', false);
  await t.cursor(t.cx + 60, 70, 300);
  assert.equal(await state(), 'pil', 'mode menyingkir mati');
});
