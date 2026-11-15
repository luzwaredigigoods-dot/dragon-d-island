'use strict';
// Naga: mata mengikuti kursor, berkedip, dan berekspresi sesuai kejadian.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { sleep, launch } = require('./helpers');

let t;
before(async () => { t = await launch(); await t.seed(); });
after(async () => { if (t) { assert.deepEqual(t.errors, [], 'tidak boleh ada error di tampilan'); await t.close(); } });

const pupil = () => t.win.evaluate(() => {
  const d = document.getElementById('dragon');
  return [parseFloat(d.style.getPropertyValue('--px')), parseFloat(d.style.getPropertyValue('--py'))];
});

test('pupil mengikuti arah kursor', async () => {
  await t.cursor(t.cx + 600, 300);
  const [rx] = await pupil();
  await t.cursor(t.cx - 600, 300);
  const [lx] = await pupil();
  assert.ok(rx > 3 && lx < -3, `kanan ${rx}, kiri ${lx}`);
});

test('kursor jauh di ujung layar: naga curiga', async () => {
  await t.cursor(5, 1000);
  assert.match(await t.dragonClass(), /suspicious/);
  await t.cursor(t.cx + 100, 200);
  assert.doesNotMatch(await t.dragonClass(), /suspicious/);
});

test('berkedip sendiri', async () => {
  const blinked = await t.win.evaluate(() => new Promise((resolve) => {
    const d = document.getElementById('dragon');
    const o = new MutationObserver(() => { if (d.classList.contains('blink')) { o.disconnect(); resolve(true); } });
    o.observe(d, { attributes: true });
    setTimeout(() => resolve(false), 9000);
  }));
  assert.equal(blinked, true);
});

test('ekspresi: penasaran saat panel terbuka, senang saat diklik dan tugas selesai, sedih saat dihapus', async () => {
  const { win } = t;
  await t.open();
  assert.match(await t.dragonClass(), /curious/);
  await win.click('#dragon');
  await sleep(150);
  assert.match(await t.dragonClass(), /happy/);
  assert.match(await t.dragonClass(), /hop/);
  await sleep(1700);
  await t.page(3);
  await win.fill('#todoInput', 'tes ekspresi');
  await win.press('#todoInput', 'Enter');
  await win.click('#todoList li:last-child');
  await sleep(150);
  assert.match(await t.dragonClass(), /happy/);
  await win.click('#todoEdit');
  await win.click('#todoList li:last-child .del');
  await sleep(150);
  assert.match(await t.dragonClass(), /sad/);
});
