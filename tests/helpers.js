'use strict';
// Alat bantu tes: menjalankan Pulau sungguhan (Electron) lewat Playwright, dengan folder data
// sementara sendiri supaya data pengguna tidak tersentuh.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { _electron } = require('playwright');
const electronPath = require('electron');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 15000) {
  const end = Date.now() + timeout;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('waitFor: waktu habis');
    await sleep(100);
  }
}

// Menggeser jadwal sholat supaya tidak ada pengingat dalam 20 menit ke depan (pengingat
// membuka panel sendiri dan mengacaukan tes). Mengembalikan nilai `adjust` untuk localStorage.
function quietPrayerAdjust() {
  const Prayer = require(path.join(ROOT, 'renderer', 'prayer.js'));
  const d = new Date();
  const now = d.getHours() * 60 + d.getMinutes();
  for (let adj = 0; adj < 240; adj += 7) {
    const t = Prayer.compute(d, -7.3274, 108.2207, -d.getTimezoneOffset() / 60, adj);
    const clash = ['subuh', 'dzuhur', 'ashar', 'maghrib', 'isya'].some((k) => {
      const diff = (t[k] - now + 1440) % 1440;
      return diff <= 20 || diff >= 1438;
    });
    if (!clash) return adj;
  }
  return 0;
}

async function launch({ env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pulau-test-'));
  const app = await _electron.launch({
    executablePath: electronPath,
    args: [ROOT, '--no-sandbox', '--disable-gpu'],
    env: {
      ...process.env,
      PULAU_USER_DATA: dir,
      // Port, folder Claude Code, dan kunci API sendiri supaya tidak bertabrakan dengan aplikasi/pengaturan sungguhan.
      PULAU_CLAUDE_PORT: String(20000 + Math.floor(Math.random() * 30000)),
      CLAUDE_CONFIG_DIR: path.join(dir, 'claude-config'),
      ANTHROPIC_API_KEY: '',
      ...env,
    },
  });
  const find = (part) => app.windows().find((w) => w.url().includes(part));
  const win = await waitFor(() => find('renderer/index.html'));
  const catcher = await waitFor(() => find('catcher.html'));
  const errors = [];
  win.on('pageerror', (e) => errors.push(String(e)));
  catcher.on('pageerror', (e) => errors.push('penangkap: ' + e));
  await win.waitForSelector('#wrap');

  const ctx = {
    app, win, catcher, dir, errors,
    cx: 0,
    // Kirim pesan dari proses utama ke tampilan, seperti yang dilakukan main.js.
    send: (channel, data) => app.evaluate(({ BrowserWindow }, [ch, d]) => {
      BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('renderer/index.html')).webContents.send(ch, d);
    }, [channel, data]),
    // Posisi kursor di layar (biasanya dikirim main.js tiap 50 ms).
    cursor: async (x, y, wait = 150) => { await ctx.send('cursor', { x, y }); await sleep(wait); },
    wrapClass: () => win.evaluate(() => document.getElementById('wrap').className),
    dragonClass: () => win.evaluate(() => document.getElementById('dragon').className),
    title: async () => (await win.textContent('#pageTitle')).trim(),
    // Isi localStorage lalu muat ulang. Ikon bawaan dan pengingat sholat dimatikan kecuali diminta.
    seed: async (data = {}) => {
      const base = {
        specialsAdded: true,
        pray: { city: 'Tasikmalaya', lat: -7.3274, lng: 108.2207, before: 0, adjust: quietPrayerAdjust(), sound: false },
      };
      const all = { ...base, ...data };
      await win.evaluate((items) => {
        localStorage.clear();
        for (const [k, v] of Object.entries(items)) if (v !== undefined) localStorage.setItem(k, JSON.stringify(v));
      }, all);
      await win.reload();
      await win.waitForSelector('#wrap');
      await sleep(500);
    },
    // Buka panel dengan mengarahkan mouse ke pil.
    open: async () => { await win.mouse.move(ctx.cx, 80); await win.mouse.move(ctx.cx, 10); await sleep(600); },
    page: async (n) => { await win.click(`#dots .navicon:nth-child(${n})`); await sleep(350); },
    fileInfo: (p) => win.evaluate((x) => window.api.shelfInfo(x), p),
    close: async () => {
      try { await app.close(); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    },
  };
  ctx.cx = (await win.evaluate(() => innerWidth)) / 2;
  return ctx;
}

// Item shelf tiruan (file yang tidak ada), dengan ikon dari file sungguhan di repo.
async function fakeShelf(ctx, names) {
  const info = await ctx.fileInfo(path.join(ROOT, 'package.json'));
  return names.map((n) => ({ ...info, path: path.join(ctx.dir, 'tidak-ada', n), name: n }));
}

module.exports = { ROOT, sleep, waitFor, launch, fakeShelf };
