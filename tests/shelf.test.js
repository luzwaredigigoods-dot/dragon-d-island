'use strict';
// Shelf: lebar mengikuti isi, efek dock, mode Edit (hapus & urutan), ikon bawaan, pemilih aplikasi.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { sleep, launch, fakeShelf } = require('./helpers');

// Folder shortcut tiruan untuk pemilih aplikasi (Desktop & Start Menu).
const apps = fs.mkdtempSync(path.join(os.tmpdir(), 'pulau-apps-'));
for (const f of ['Desktop/A.L.U.N.A. - Masterplan.lnk', 'Desktop/Luzware Business.lnk', 'Programs/Chrome Apps/WhatsApp Web.lnk',
  'Programs/Office/Word.lnk', 'Programs/Uninstall Foo.lnk', 'Programs/Spotify.lnk', 'Programs/catatan.txt']) {
  fs.mkdirSync(path.join(apps, path.dirname(f)), { recursive: true });
  fs.writeFileSync(path.join(apps, f), 'x');
}

let t;
before(async () => {
  t = await launch({ env: { PULAU_APP_DIRS: [path.join(apps, 'Desktop'), path.join(apps, 'Programs')].join(path.delimiter) } });
  await t.seed();
});
after(async () => {
  if (t) { assert.deepEqual(t.errors, [], 'tidak boleh ada error di tampilan'); await t.close(); }
  fs.rmSync(apps, { recursive: true, force: true });
});

const names = () => t.win.$$eval('.file .nm', (l) => l.map((e) => e.textContent));
const islandW = () => t.win.$eval('#island', (e) => Math.round(e.getBoundingClientRect().width));
async function openShelf(items) {
  if (items) await t.seed({ shelf: items });
  await t.open();
  await t.page(2);
}

test('pulau memanjang mengikuti jumlah ikon dan bisa digulir bila melebihi layar', async () => {
  const widths = [];
  for (const n of [2, 8, 16, 60]) {
    await openShelf(await fakeShelf(t, Array.from({ length: n }, (_, i) => `Aplikasi ${i}.lnk`)));
    assert.equal((await names()).length, n);
    widths.push(await islandW());
    await t.win.mouse.move(t.cx, 500);
    await sleep(700);
  }
  assert.ok(widths[1] > widths[0] && widths[2] > widths[1], `lebar harus bertambah: ${widths}`);
  const screenW = await t.win.evaluate(() => innerWidth);
  assert.ok(widths[3] <= screenW, `tidak melebihi layar (${widths[3]} > ${screenW})`);
  await t.open();
  assert.ok(await t.win.$eval('#shelf', (e) => e.scrollWidth > e.clientWidth + 1), '60 ikon harus bisa digulir');
});

test('efek dock: ikon di bawah kursor membesar, klik memicu animasi buka', async () => {
  await openShelf(await fakeShelf(t, ['A.lnk', 'B.lnk', 'C.lnk', 'D.lnk', 'E.lnk']));
  const box = await (await t.win.$('.file:nth-child(3) .ic')).boundingBox();
  await t.win.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await sleep(250);
  const scales = (await t.win.$$eval('.file', (l) => l.map((e) => Number(e.style.getPropertyValue('--s') || 1))));
  assert.ok(scales[2] > 1.3 && scales[2] === Math.max(...scales), `skala: ${scales}`);
  assert.ok(scales[0] < scales[1] && scales[1] < scales[2], `skala menurun menjauhi kursor: ${scales}`);
  await t.win.mouse.down();
  await t.win.mouse.up();
  await sleep(120);
  assert.match(await t.win.$eval('.file:nth-child(3)', (e) => e.className), /launch/);
  assert.deepEqual(await names(), ['A', 'B', 'C', 'D', 'E'], 'nama shortcut tampil tanpa .lnk');
});

test('mode Edit: tombol hapus dan Clear hanya ada di mode Edit', async () => {
  const { win } = t;
  await openShelf(await fakeShelf(t, ['A.lnk', 'B.lnk', 'C.lnk', 'D.lnk']));
  const visible = (sel) => win.$eval(sel, (e) => !e.hidden && getComputedStyle(e).display !== 'none');
  assert.equal(await visible('#shelfClear'), false);
  // klik di posisi tombol hapus tanpa mode Edit tidak menghapus apa pun
  const [x, y] = await win.$eval('.file:nth-child(2) .x', (e) => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; });
  await win.mouse.move(x, y);
  await sleep(200);
  assert.equal(await win.$eval('.file:nth-child(2) .x', (e) => getComputedStyle(e).opacity), '0');
  await win.mouse.click(x, y);
  await sleep(400);
  assert.equal((await names()).length, 4);

  await win.click('#shelfEdit');
  assert.equal(await win.textContent('#shelfEdit'), 'Selesai');
  assert.equal(await visible('#shelfClear'), true);
  await win.click('.file:nth-child(3) .ic', { force: true });
  await sleep(200);
  assert.doesNotMatch(await win.$eval('.file:nth-child(3)', (e) => e.className), /launch/, 'klik ikon saat Edit tidak membuka');
  await win.click('.file:nth-child(2) .x', { force: true });
  await sleep(450);
  assert.deepEqual(await names(), ['A', 'C', 'D']);

  // panel menutup = keluar dari mode Edit
  await win.mouse.move(t.cx, 500);
  await sleep(900);
  await t.open();
  assert.equal(await win.textContent('#shelfEdit'), 'Edit');
  await win.click('#shelfEdit');
  await win.click('#shelfClear');
  await sleep(300);
  assert.deepEqual(await names(), []);
  assert.equal(await visible('#shelfEdit'), false, 'tombol Edit hilang saat shelf kosong');
});

test('mode Edit: tahan dan geser ikon untuk mengubah urutan, urutan tersimpan', async () => {
  const { win } = t;
  await openShelf(await fakeShelf(t, ['A.lnk', 'B.lnk', 'C.lnk', 'D.lnk', 'E.lnk']));
  const order = async () => (await names()).join('');
  const stored = () => win.evaluate(() => JSON.parse(localStorage.getItem('shelf')).map((x) => x.name[0]).join(''));
  const center = async (n) => { const b = await (await win.$(`.file:nth-child(${n})`)).boundingBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
  const drag = async (from, to) => {
    const [x1, y1] = await center(from);
    const [x2] = await center(to);
    await win.mouse.move(x1, y1);
    await win.mouse.down();
    for (let i = 1; i <= 10; i++) { await win.mouse.move(x1 + ((x2 - x1) * i) / 10 + (i === 10 ? Math.sign(x2 - x1) * 6 : 0), y1); await sleep(20); }
    await win.mouse.up();
    await sleep(200);
  };
  await drag(1, 3);
  assert.equal(await order(), 'ABCDE', 'tanpa mode Edit urutan tidak berubah');
  await win.mouse.move(t.cx, 10);
  await sleep(1700);
  await win.click('#shelfEdit');
  await drag(1, 3);
  assert.equal(await order(), 'BCADE');
  await drag(5, 1);
  assert.equal(await order(), 'EBCAD');
  assert.equal(await stored(), 'EBCAD');
  await win.reload();
  await win.waitForSelector('#wrap');
  await sleep(400);
  assert.equal(await order(), 'EBCAD', 'urutan bertahan setelah dibuka ulang');
});

test('ikon bawaan My Computer & Trash: dipasang sekali, bisa dihapus, bisa ditambah lagi', async () => {
  const { win } = t;
  await t.seed({ specialsAdded: undefined, shelf: await fakeShelf(t, ['CapCut.lnk']) });
  await sleep(800);
  await t.open();
  await t.page(2);
  assert.deepEqual(await names(), ['My Computer', 'Trash', 'CapCut']);
  assert.deepEqual(await win.$$eval('.file .sz', (l) => l.map((e) => e.textContent)), ['', '', '']);
  await win.reload();
  await win.waitForSelector('#wrap');
  await sleep(800);
  assert.deepEqual(await win.$$eval('.file .nm', (l) => l.map((e) => e.textContent)), ['My Computer', 'Trash', 'CapCut'], 'tidak dobel');

  await t.open();
  await t.page(2);
  await win.click('#shelfEdit');
  await win.click('.file:nth-child(2) .x', { force: true });
  await sleep(450);
  await win.click('#shelfEdit');
  await win.reload();
  await win.waitForSelector('#wrap');
  await sleep(800);
  assert.deepEqual(await win.$$eval('.file .nm', (l) => l.map((e) => e.textContent)), ['My Computer', 'CapCut'], 'Trash yang dihapus tidak muncul sendiri');

  await t.open();
  await t.page(2);
  await win.click('#shelfHint');
  await sleep(700);
  const list = await win.$$eval('.app .nm', (l) => l.map((e) => e.textContent));
  assert.deepEqual(list.slice(0, 2), ['My Computer', 'Trash'], 'ikon bawaan di urutan teratas pemilih');
  await win.click('.app:has-text("Trash")');
  await sleep(400);
  await win.click('#appClose');
  await sleep(300);
  assert.deepEqual(await names(), ['My Computer', 'CapCut', 'Trash']);
});

test('pemilih aplikasi: membaca shortcut Desktop & Start Menu, bisa dicari, menyimpan shortcut-nya', async () => {
  const { win } = t;
  await openShelf([]);
  await win.click('#shelfHint');
  await sleep(700);
  const list = (await win.$$eval('.app .nm', (l) => l.map((e) => e.textContent))).slice(2);
  assert.deepEqual(list, ['A.L.U.N.A. - Masterplan', 'Luzware Business', 'Spotify', 'WhatsApp Web', 'Word'], 'tanpa uninstaller & file non-shortcut, urut abjad');
  await win.fill('#appSearch', 'a.l');
  await sleep(200);
  assert.deepEqual(await win.$$eval('.app .nm', (l) => l.map((e) => e.textContent)), ['A.L.U.N.A. - Masterplan']);
  await win.click('.app');
  await win.fill('#appSearch', '');
  await win.click('.app:has-text("WhatsApp")');
  await sleep(300);
  assert.deepEqual(await win.$$eval('.app.added .nm', (l) => l.map((e) => e.textContent)), ['A.L.U.N.A. - Masterplan', 'WhatsApp Web']);
  await win.click('.app:has-text("WhatsApp")');
  await sleep(200);
  await win.click('#appClose');
  await sleep(300);
  const saved = await win.evaluate(() => JSON.parse(localStorage.getItem('shelf')).map((x) => x.path));
  assert.equal(saved.length, 1, 'klik kedua mengeluarkan WhatsApp lagi');
  assert.ok(saved[0].endsWith(path.join('Desktop', 'A.L.U.N.A. - Masterplan.lnk')), 'yang disimpan file shortcut-nya, bukan program tujuannya');
});
