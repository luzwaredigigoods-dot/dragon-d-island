const { app, BrowserWindow, ipcMain, screen, shell, Tray, Menu, nativeImage, globalShortcut, dialog, clipboard, safeStorage, Notification } = require('electron');
const { createChat } = require('./claude-chat');
const { createMonitor } = require('./claude-monitor');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const WIN_H = 440; // cukup untuk panel tertinggi (halaman Claude) + naga
const isWin = process.platform === 'win32';

// Tes otomatis memakai folder data terpisah, supaya todo, shelf, catatan, dan pengaturan
// pengguna tidak tersentuh (lihat tests/helpers.js).
if (process.env.PULAU_USER_DATA) {
  app.setPath('userData', process.env.PULAU_USER_DATA);
  app.setPath('documents', path.join(process.env.PULAU_USER_DATA, 'Documents'));
}

app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const APP_NAME = 'Dragon Dynamic Island';
const APP_ID = 'com.dragondynamicisland.app';
const OLD_NAME = 'Pulau'; // nama aplikasi sebelum versi 3.2

// Pindahan data dari versi lama bernama "Pulau" (todo, shelf, catatan, pengaturan), sekali saja.
// Electron sudah membuat folder data baru sebelum kode ini berjalan, jadi "sudah pindah" ditandai
// dengan file penanda, bukan dengan ada-tidaknya folder. Penanda baru ditulis setelah penyalinan
// berhasil, supaya penyalinan yang terputus diulang saat aplikasi dibuka lagi.
let migration = '';
if (!process.env.PULAU_USER_DATA) {
  try {
    const oldDir = path.join(app.getPath('appData'), OLD_NAME);
    const newDir = app.getPath('userData');
    const marker = path.join(newDir, '.pindahan-dari-pulau');
    if (oldDir !== newDir && !fs.existsSync(marker)) {
      if (fs.existsSync(oldDir)) {
        const skip = /^(lockfile|LOCK|Singleton.*|Cache|Code Cache|GPUCache|DawnGraphiteCache|DawnWebGPUCache|Crashpad|DevToolsActivePort)$/i;
        fs.cpSync(oldDir, newDir, { recursive: true, force: true, filter: (src) => !skip.test(path.basename(src)) });
        migration = `data lama disalin dari ${oldDir}`;
      }
      fs.mkdirSync(newDir, { recursive: true });
      fs.writeFileSync(marker, new Date().toISOString());
    }
  } catch (err) {
    migration = `gagal menyalin data lama: ${String(err).slice(0, 200)}`;
  }
}
const MEDIA_SCRIPT = path.join(__dirname, 'media.ps1').replace('app.asar', 'app.asar.unpacked');
const WINWATCH_SCRIPT = path.join(__dirname, 'winwatch.ps1').replace('app.asar', 'app.asar.unpacked');
const ICON_SCRIPT = path.join(__dirname, 'iconhelper.ps1').replace('app.asar', 'app.asar.unpacked');

let win = null;
let tray = null;
let mediaProc = null;
let winProc = null;
let iconProc = null;
let catcher = null;
let quitting = false;
let isAdmin = false; // berjalan sebagai administrator: Windows memblokir seret-lepas dari Explorer

// ---------- Log & pengaturan ----------
// Catatan diagnosis di %APPDATA%\Dragon Dynamic Island\dragon-island.log (menu tray: "Buka file log").
let logPath = '';
function log(...parts) {
  try {
    if (!logPath) {
      logPath = path.join(app.getPath('userData'), 'dragon-island.log');
      try { if (fs.statSync(logPath).size > 300000) fs.renameSync(logPath, logPath + '.lama'); } catch (_) { /* belum ada */ }
    }
    const line = `${new Date().toISOString()} ${parts.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(' ')}\n`;
    fs.appendFileSync(logPath, line);
  } catch (_) { /* log tidak boleh mengganggu aplikasi */ }
}
let settings = { dodge: 'auto', claudeSound: 'naga', cloudOpen: 'desktop' }; // dodge: auto | always | off
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function loadSettings() {
  try { settings = Object.assign(settings, JSON.parse(fs.readFileSync(settingsPath(), 'utf8'))); } catch (_) { /* bawaan */ }
}
function saveSettings() {
  try { fs.writeFileSync(settingsPath(), JSON.stringify(settings)); } catch (_) { /* abaikan */ }
}
function send(channel, data) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// Jendela selebar layar supaya pulau bisa memanjang mengikuti isi shelf.
function placeWindow() {
  if (!win || win.isDestroyed()) return;
  const { bounds } = screen.getPrimaryDisplay();
  win.setBounds({ x: bounds.x, y: bounds.y, width: bounds.width, height: WIN_H });
}

// Jendela penangkap seretan: polos, tidak transparan, tepat di bawah badan pulau yang hitam.
// (Jendela transparan pulau terbukti tidak menerima seret-lepas dari Windows.)
function createCatcher() {
  catcher = new BrowserWindow({
    width: 120, height: 16, x: 0, y: 0,
    type: 'toolbar', // tidak muncul di Alt+Tab
    frame: false,
    transparent: false,
    backgroundColor: '#0a0a0c',
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'catcher-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  catcher.setAlwaysOnTop(true, 'screen-saver');
  catcher.setMenuBarVisibility(false);
  catcher.loadFile(path.join(__dirname, 'catcher.html'));
  // Jendela pulau harus selalu berada di atas jendela penangkap.
  const raise = () => { if (win && !win.isDestroyed() && win.isVisible()) win.moveTop(); };
  catcher.on('focus', raise);
  catcher.on('show', raise);
  setInterval(() => { if (catcher && !catcher.isDestroyed() && catcher.isVisible()) raise(); }, 2500);
}

function createWindow() {
  const { bounds } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    width: bounds.width,
    height: WIN_H,
    x: bounds.x,
    y: bounds.y,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true);
  // Area transparan tidak menghalangi klik ke aplikasi di belakangnya.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.showInactive(); placeCatcher(); });
  win.on('closed', () => { if (catcher && !catcher.isDestroyed()) catcher.destroy(); });
  win.webContents.on('did-finish-load', () => { sendDodge(); if (isAdmin) send('admin', true); if (lastMediaError) send('media:update', { has: false, error: lastMediaError }); });
  win.webContents.on('render-process-gone', (_e, d) => log('renderer mati', d));
  screen.on('display-metrics-changed', () => { placeWindow(); placeCatcher(); });
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  tray = new Tray(icon.resize({ width: 16, height: 16, quality: 'best' }));
  tray.setToolTip(APP_NAME);
  buildTrayMenu();
  tray.on('click', toggleVisible);
}
function buildTrayMenu() {
  if (!tray) return;
  const dodgeItem = (label, value) => ({
    label, type: 'radio', checked: settings.dodge === value,
    click: () => { settings.dodge = value; saveSettings(); sendDodge(); },
  });
  const menu = Menu.buildFromTemplate([
      { label: 'Tampilkan / Sembunyikan  (Ctrl+Alt+I)', click: toggleVisible },
      {
        label: 'Jalankan saat Windows menyala',
        type: 'checkbox',
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked }),
      },
      {
        label: 'Ukuran',
        submenu: [['Sangat kecil', 0.66], ['Kecil', 0.82], ['Sedang', 1], ['Besar', 1.15]].map(([label, k]) => ({
          label, click: () => win && win.webContents.send('scale', k),
        })),
      },
      {
        label: 'Suara notifikasi Claude',
        submenu: [['Auman naga', 'naga'], ['Dering', 'dering'], ['Lonceng', 'lonceng'], ['Bunyi bawaan Windows', 'windows'], ['Tanpa suara', 'diam']].map(([label, v]) => ({
          label, type: 'radio', checked: settings.claudeSound === v,
          click: () => { settings.claudeSound = v; saveSettings(); log('suara notifikasi:', v); if (v !== 'windows' && v !== 'diam') send('sound:play', v); },
        })),
      },
      {
        label: 'Buka sesi cloud di',
        submenu: [['Aplikasi Claude Desktop (percobaan)', 'desktop'], ['Browser', 'browser']].map(([label, v]) => ({
          label, type: 'radio', checked: settings.cloudOpen === v,
          click: () => { settings.cloudOpen = v; saveSettings(); log('buka sesi cloud di:', v); },
        })),
      },
      {
        label: 'Menyingkir saat kursor mendekat',
        submenu: [
          dodgeItem('Otomatis (saat ada jendela terbuka penuh)', 'auto'),
          dodgeItem('Selalu', 'always'),
          dodgeItem('Mati', 'off'),
        ],
      },
      { label: 'Buat shortcut di Desktop', click: () => makeDesktopShortcut(true) },
      { label: 'Buka file log', click: () => { log('log dibuka'); shell.showItemInFolder(logPath); } },
      { type: 'separator' },
      { label: 'Keluar', click: () => app.quit() },
  ]);
  global.__trayMenu = menu; // dipakai tes
  tray.setContextMenu(menu);
}

// Shortcut berlogo di Desktop: dibuat sekali saat pertama dijalankan, atau lewat menu tray.
function makeDesktopShortcut(force) {
  if (!isWin || !app.isPackaged && !force) return;
  try {
    const flag = path.join(app.getPath('userData'), 'shortcut-dibuat-v2');
    if (!force && fs.existsSync(flag)) return;
    const desktop = app.getPath('desktop');
    const link = path.join(desktop, APP_NAME + '.lnk');
    shell.writeShortcutLink(link, fs.existsSync(link) ? 'update' : 'create', {
      target: process.execPath,
      cwd: path.dirname(process.execPath),
      description: APP_NAME,
      icon: process.execPath,
      iconIndex: 0,
      appUserModelId: APP_ID,
    });
    fs.writeFileSync(flag, new Date().toISOString());
    log('shortcut Desktop dibuat:', path.basename(link));
    // Shortcut lama "Pulau" dihapus, tetapi hanya bila memang menunjuk ke Pulau.exe.
    const old = path.join(desktop, OLD_NAME + '.lnk');
    if (fs.existsSync(old)) {
      try {
        if (/(^|[\\/])Pulau\.exe$/i.test(shell.readShortcutLink(old).target || '')) { fs.unlinkSync(old); log('shortcut lama dihapus:', path.basename(old)); }
      } catch (_) { /* biarkan */ }
    }
  } catch (err) { log('shortcut Desktop gagal:', String(err)); }
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) { win.hide(); if (catcher && !catcher.isDestroyed()) catcher.hide(); }
  else { win.showInactive(); placeCatcher(); }
}

// ---------- Proses pembantu PowerShell ----------
// Menjalankan skrip .ps1 yang menulis satu baris JSON per kejadian ke stdout.
function runHelper(name, script, extraArgs, onMessage, onGone) {
  let proc;
  try {
    proc = spawn(
      'powershell.exe',
      ['-NoProfile', '-NoLogo', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, ...extraArgs],
      { windowsHide: true }
    );
  } catch (err) {
    log(name, 'gagal dijalankan:', String(err));
    onGone(String(err));
    return null;
  }
  let buf = '';
  let errText = '';
  proc.stdout.setEncoding('utf8');
  proc.stdout.on('data', (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('{')) { if (line) log(name, 'keluaran:', line.slice(0, 300)); continue; }
      try { onMessage(JSON.parse(line)); } catch (_) { log(name, 'baris rusak:', line.slice(0, 300)); }
    }
  });
  proc.stderr.setEncoding('utf8');
  proc.stderr.on('data', (chunk) => { errText = (errText + chunk).slice(-2000); });
  proc.on('error', (err) => { log(name, 'error proses:', String(err)); onGone(String(err)); });
  proc.on('exit', (code) => {
    if (errText.trim()) log(name, 'stderr:', errText.trim());
    log(name, 'berhenti, kode', code);
    if (!quitting) onGone(errText.trim().split('\n')[0] || `berhenti (kode ${code})`);
  });
  proc.stdin.on('error', () => { /* proses sudah mati */ });
  return proc;
}

// ---------- Media (Windows: System Media Transport Controls) ----------
let lastMediaError = '';
let mediaRestarts = 0;
let lastMediaLog = '';
function startMediaWatcher() {
  if (!isWin) return;
  mediaProc = runHelper('media', MEDIA_SCRIPT, [], (m) => {
    if (m.ready) { log('media siap', m); if (!m.winrt) lastMediaError = lastMediaError || 'Windows media tidak tersedia'; return; }
    if (m.error) { lastMediaError = m.error; log('media error:', m.error); send('media:update', { has: false, error: m.error }); return; }
    if (m.warn) { log('media peringatan:', m.warn); return; }
    if (m.thumb) { log('media sampul:', m.title, Math.round(m.thumb.length / 1024) + ' KB'); send('media:thumb', { title: m.title, thumb: m.thumb }); return; }
    // Catat hanya saat judul/status berubah, supaya log tidak penuh.
    const key = m.has ? `${m.app}|${m.title}|${m.status}` : 'kosong';
    if (key !== lastMediaLog) { lastMediaLog = key; log('media:', key); }
    if (!m.has && lastMediaError) m.error = lastMediaError;
    send('media:update', m);
  }, (reason) => {
    mediaProc = null;
    lastMediaError = reason;
    send('media:update', { has: false, error: reason });
    if (!quitting && mediaRestarts++ < 2) setTimeout(startMediaWatcher, 3000);
  });
}

function mediaCommand(action) {
  if (!['toggle', 'next', 'prev'].includes(action)) return;
  log('media perintah:', action, mediaProc ? '' : '(pembantu tidak jalan)');
  if (mediaProc) { try { mediaProc.stdin.write(action + '\n'); } catch (_) { /* proses sudah mati */ } }
}

// ---------- Jendela penuh di belakang pulau ----------
// "Menyingkir": pulau bersembunyi saat kursor mendekat dan baru muncul ketika kursor mentok
// di tepi atas layar. Aktif otomatis saat jendela yang sedang dipakai terbuka penuh.
let winState = 'normal';
function dodgeActive() {
  if (settings.dodge === 'always') return true;
  if (settings.dodge === 'off') return false;
  return winState === 'maximized' || winState === 'fullscreen';
}
function sendDodge() { send('dodge', dodgeActive()); }
function startWindowWatcher() {
  if (!isWin) return;
  winProc = runHelper('jendela', WINWATCH_SCRIPT, ['-SelfPid', String(process.pid)], (m) => {
    if (m.ready) { log('jendela siap'); return; }
    if (m.error) { log('jendela error:', m.error); return; }
    if (typeof m.lb === 'boolean') { lbDown = m.lb; return; }
    if (!m.state || m.state === 'self') return; // pulau sendiri yang aktif: pertahankan keadaan terakhir
    if (m.state !== winState) { winState = m.state; log('jendela:', winState); sendDodge(); }
  }, () => { winProc = null; lbDown = null; });
}

// ---------- Kursor & seretan ----------
// Jendela pulau tembus-klik kecuali saat kursor berada di atas pulau. Posisi kursor dipantau
// dari sini dan dikirim ke tampilan agar mata naga bisa mengikuti kursor di seluruh layar.
//
// Seret-lepas: jendela pulau transparan dan tidak menerima seretan dari Windows, jadi selama
// ada seretan jendela pulau dibiarkan tembus-klik dan jendela penangkap di bawahnya yang
// menerima file. Seretan dikenali dari tombol mouse yang sudah ditekan saat kursor masuk
// area pulau (dari winwatch.ps1), atau dari jendela penangkap yang melaporkan seretan masuk.
let hit = { w: 240, h: 90 };        // area pulau + naga (untuk klik)
let body = { w: 120, h: 16 };       // badan hitam pulau saat ini (untuk jendela penangkap)
let ignoring = true;
let lastCursor = '';
let toggleLogs = 0;
let lbDown = null;                  // null = belum diketahui (pembantu tidak jalan)
let wasInside = false;
let enteredWithButton = false;
let enteredAt = 0;
let dragMode = false;
let dragStarted = 0;
let lastCatch = 0;
let releasedAt = 0;
let dragLogs = 0;

ipcMain.on('island:rect', (_e, r) => {
  if (!r || !Number.isFinite(r.w) || !Number.isFinite(r.h)) return;
  hit = { w: r.w, h: r.h };
  if (Number.isFinite(r.bw) && Number.isFinite(r.bh)) body = { w: r.bw, h: r.bh };
  // Saat seretan berlangsung, tunggu animasi panel membuka supaya kotak hitam tidak mendahuluinya.
  if (dragMode) setTimeout(placeCatcher, 300); else placeCatcher();
});
function placeCatcher() {
  if (!catcher || catcher.isDestroyed() || !win || win.isDestroyed()) return;
  try {
    if (!win.isVisible() || body.w < 8 || body.h < 4) { if (catcher.isVisible()) catcher.hide(); return; }
    const b = win.getBounds();
    const w = Math.max(8, Math.floor(body.w)), h = Math.max(4, Math.floor(body.h));
    catcher.setBounds({ x: Math.round(b.x + (b.width - w) / 2), y: b.y, width: w, height: h });
    if (!catcher.isVisible()) catcher.showInactive();
  } catch (err) { log('penangkap gagal ditempatkan:', String(err)); }
}
function startDragMode(reason) {
  if (dragMode) return;
  dragMode = true; dragStarted = Date.now(); lastCatch = Date.now(); releasedAt = 0;
  if (dragLogs++ < 40) log('seretan mulai (' + reason + ')');
  if (!ignoring) { ignoring = true; win.setIgnoreMouseEvents(true, { forward: true }); }
  send('drag:start');
}
function endDragMode(reason) {
  if (!dragMode) return;
  dragMode = false;
  if (dragLogs++ < 40) log('seretan selesai (' + reason + ')');
  send('drag:end');
  setTimeout(placeCatcher, 450);
}
ipcMain.on('catch:enter', (_e, types) => {
  lastCatch = Date.now();
  if (dragLogs++ < 40) log('penangkap: seret masuk', Array.isArray(types) ? types.join(',') : '');
  startDragMode('penangkap');
});
ipcMain.on('catch:over', () => { lastCatch = Date.now(); if (!dragMode) startDragMode('penangkap'); });
ipcMain.on('catch:drop', async (_e, paths, note) => {
  const list = Array.isArray(paths) ? paths.map(String) : [];
  log('penangkap: lepas', list.length, 'path |', String(note || '').slice(0, 300));
  const infos = (await Promise.all(list.map(fileInfo))).filter(Boolean);
  send('drag:drop', { infos, tried: list.length });
  setTimeout(() => endDragMode('lepas'), 150);
});

function watchCursor() {
  setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    const now = Date.now();
    const p = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const cx = b.x + b.width / 2;
    const inside = p.x >= cx - hit.w / 2 && p.x <= cx + hit.w / 2 && p.y >= b.y && p.y <= b.y + hit.h;
    if (inside && !wasInside) { enteredWithButton = lbDown === true; enteredAt = now; }
    if (!inside) enteredWithButton = false;
    wasInside = inside;

    // Kursor masuk area pulau dengan tombol sudah ditekan = sedang menyeret sesuatu.
    if (inside && enteredWithButton && lbDown === true) startDragMode('tombol');
    if (dragMode) {
      if (lbDown === false) { if (!releasedAt) releasedAt = now; } else releasedAt = 0;
      if (releasedAt && now - releasedAt > 700) endDragMode('tombol dilepas');            // beri waktu untuk 'lepas'
      else if (lbDown === null && now - lastCatch > 1200) endDragMode('tidak ada gerakan');
      else if (lbDown === true && !inside && now - lastCatch > 800) endDragMode('keluar area');
      else if (now - dragStarted > 120000) endDragMode('batas waktu');
    }

    let interactive = inside && !dragMode;
    // Tanpa info tombol mouse: tunda sebentar agar jendela penangkap sempat melihat seretan.
    if (interactive && lbDown === null && now - enteredAt < 220) interactive = false;
    if (interactive === ignoring) {
      ignoring = !interactive;
      win.setIgnoreMouseEvents(ignoring, { forward: true });
      if (toggleLogs++ < 30) log('tembus-klik', ignoring ? 'nyala' : 'mati', `kursor ${p.x},${p.y}`, `area ${Math.round(hit.w)}x${Math.round(hit.h)}`);
    }
    const key = `${p.x},${p.y}`;
    if (key !== lastCursor) {
      lastCursor = key;
      win.webContents.send('cursor', { x: p.x - b.x, y: p.y - b.y });
    }
  }, 50);
}

// ---------- IPC ----------
ipcMain.on('media:command', (_e, action) => mediaCommand(action));
ipcMain.on('log', (_e, msg) => log('tampilan:', String(msg).slice(0, 500)));

// ---------- Claude: chat cepat & pemantau sesi Claude Code ----------
let chat = null;
let monitor = null;
function notifyWindows(title, body) {
  try {
    if (!Notification.isSupported()) return;
    // Bunyi bawaan Windows hanya dipakai bila dipilih; suara lain dimainkan oleh pulau sendiri.
    const n = new Notification({ title, body, silent: settings.claudeSound !== 'windows' });
    n.on('click', () => { if (win && !win.isDestroyed()) { win.showInactive(); send('claude:open'); } });
    n.show();
  } catch (err) { log('notifikasi gagal:', String(err)); }
}
function startClaude() {
  const userDataDir = app.getPath('userData');
  chat = createChat({ safeStorage, userDataDir, log, send });
  monitor = createMonitor({
    userDataDir, settings, saveSettings, log, appDir: __dirname,
    onChange: (snap) => send('claude:state', snap),
    onAlert: (a) => {
      const s = a.session;
      const who = s.project || 'Claude Code';
      if (a.kind === 'permission') notifyWindows(`${who}: Claude butuh izin`, s.detail || 'Buka sesi Claude Code untuk menjawab.');
      else if (a.kind === 'done') notifyWindows(`${who}: Claude selesai`, s.detail || 'Tugas selesai.');
      else if (a.kind === 'error') notifyWindows(`${who}: Claude berhenti karena error`, s.detail || '');
      send('claude:alert', { ...a, sound: settings.claudeSound });
    },
  });
}
ipcMain.handle('claude:status', () => ({ chat: chat ? chat.status() : null, monitor: monitor ? monitor.snapshot() : null }));
ipcMain.handle('claude:setKey', (_e, key) => (chat ? chat.setKey(key) : { ok: false }));
ipcMain.handle('claude:ask', (_e, text, model) => (chat ? chat.ask(text, model) : { ok: false, error: 'Belum siap' }));
ipcMain.on('claude:reset', () => { if (chat) chat.reset(); });
ipcMain.on('claude:stop', () => { if (chat) chat.stop(); });
ipcMain.handle('claude:install', () => (monitor ? monitor.install() : { ok: false }));
ipcMain.handle('claude:uninstall', () => (monitor ? monitor.uninstall() : { ok: false }));
ipcMain.on('claude:clear', () => { if (monitor) monitor.clearFinished(); });
ipcMain.handle('claude:setCloud', (_e, v) => (monitor ? monitor.setCloud(v || {}) : { ok: false }));
ipcMain.handle('claude:cloudSnippet', () => (monitor ? monitor.cloudSnippet() : ''));
ipcMain.on('claude:openCloudSession', (_e, id) => {
  if (!/^(cse|session)_[A-Za-z0-9]{8,64}$/.test(String(id))) return;
  // Variabel CLAUDE_CODE_REMOTE_SESSION_ID berawalan cse_, alamat webnya session_ (akhiran sama).
  openClaude(`code/${String(id).replace(/^cse_/, 'session_')}`);
});
ipcMain.on('claude:openFolder', (_e, dir) => { if (dir && fs.existsSync(String(dir))) shell.openPath(String(dir)); });
// Membuka halaman claude.ai di aplikasi Claude Desktop (tautan claude://claude.ai/...) bila aplikasinya
// terpasang dan dipilih di menu tray; selain itu di browser. Membuka sesi tertentu lewat tautan
// claude:// tidak didokumentasikan Anthropic, jadi pilihan Desktop masih percobaan.
const CLAUDE_WEB = 'https://claude.ai';
function desktopInstalled() {
  try { return !!app.getApplicationNameForProtocol('claude://'); } catch (_) { return false; }
}
function openClaude(pathPart) {
  const web = `${CLAUDE_WEB}/${pathPart}`;
  if (settings.cloudOpen === 'desktop' && desktopInstalled()) {
    const deep = `claude://claude.ai/${pathPart}`;
    log('buka di Claude Desktop:', deep);
    shell.openExternal(deep).catch((err) => { log('Claude Desktop gagal, pakai browser:', String(err)); shell.openExternal(web); });
    return;
  }
  log('buka di browser:', web);
  shell.openExternal(web);
}
ipcMain.on('claude:openCloud', () => openClaude('code'));
ipcMain.on('claude:copy', (_e, text) => { try { clipboard.writeText(String(text)); } catch (_) { /* abaikan */ } });
// ---------- Ikon ----------
function expandEnv(p) {
  return String(p || '').replace(/%([^%]+)%/g, (m, name) => process.env[name] || process.env[name.toUpperCase()] || m);
}
// Gambar kosong (tembus pandang seluruhnya) dianggap gagal.
function usable(img) {
  try {
    if (!img || img.isEmpty()) return false;
    const { width, height } = img.getSize();
    if (width < 8 || height < 8) return false;
    const bmp = img.toBitmap();
    for (let i = 3; i < bmp.length; i += 4 * 7) if (bmp[i] > 24) return true;
    return false;
  } catch (_) { return false; }
}
async function iconFromFile(file) {
  if (!file) return null;
  if (/\.ico$/i.test(file)) { // file .ico: ambil langsung, tanpa panah shortcut
    try { const img = nativeImage.createFromPath(file); if (usable(img)) return img; } catch (_) { /* lanjut */ }
  }
  if (isWin) {
    try { const img = await nativeImage.createThumbnailFromPath(file, { width: 96, height: 96 }); if (usable(img)) return img; } catch (_) { /* lanjut */ }
  }
  try { const img = await app.getFileIcon(file, { size: 'large' }); if (usable(img)) return img; } catch (_) { /* lanjut */ }
  return null;
}
// Ikon tujuan shortcut lewat shell Windows (iconhelper.ps1): untuk shortcut yang tidak menunjuk
// ke file, mis. aplikasi Microsoft Store. Mengembalikan nativeImage atau null.
let iconSeq = 0;
let iconStarts = 0;
const iconWaiters = new Map();
function shellLinkIcon(lnkPath) {
  return new Promise((resolve) => {
    if (!isWin) { resolve(null); return; }
    if (!iconProc) {
      if (iconStarts++ >= 3) { resolve(null); return; }
      iconProc = runHelper('ikon', ICON_SCRIPT, [], (m) => {
        if (m.ready) { log('pembantu ikon siap'); return; }
        if (m.id == null) { if (m.error) log('pembantu ikon error:', m.error); return; }
        const waiter = iconWaiters.get(String(m.id));
        if (!waiter) return;
        iconWaiters.delete(String(m.id));
        clearTimeout(waiter.timer);
        if (m.png) {
          try { waiter.resolve(nativeImage.createFromBuffer(Buffer.from(m.png, 'base64'))); return; } catch (err) { log('ikon tujuan rusak:', waiter.name, String(err)); }
        } else log('ikon tujuan gagal:', waiter.name, '-', m.error);
        waiter.resolve(null);
      }, () => {
        iconProc = null;
        for (const [, waiter] of iconWaiters) { clearTimeout(waiter.timer); waiter.resolve(null); }
        iconWaiters.clear();
      });
      if (!iconProc) { resolve(null); return; }
    }
    const id = String(++iconSeq);
    const timer = setTimeout(() => { iconWaiters.delete(id); log('ikon tujuan: tidak ada jawaban untuk', path.basename(lnkPath)); resolve(null); }, 15000);
    iconWaiters.set(id, { resolve, timer, name: path.basename(lnkPath) });
    try { iconProc.stdin.write(`${id}|${lnkPath}\n`, 'utf8'); } catch (_) { clearTimeout(timer); iconWaiters.delete(id); resolve(null); }
  });
}
// Ikon aplikasi untuk shelf. Untuk shortcut, ikon diambil dari sumber aslinya (file .ico atau
// program tujuannya), bukan dari file shortcut, supaya tidak ada panah shortcut di pojoknya.
async function iconFor(filePath) {
  const tried = [];
  let img = null;
  if (isWin && /\.lnk$/i.test(filePath)) {
    try {
      const d = shell.readShortcutLink(filePath);
      for (const src of [expandEnv(d.icon), expandEnv(d.target)]) {
        if (!src || !fs.existsSync(src)) { if (src) tried.push('tidak ada: ' + path.basename(src)); continue; }
        img = await iconFromFile(src);
        tried.push((img ? 'ok: ' : 'gagal: ') + path.basename(src));
        if (img) break;
      }
    } catch (err) { tried.push('shortcut tak terbaca: ' + String(err).slice(0, 80)); }
    if (!img) { // tujuan bukan file (aplikasi Store/MSIX): minta ikonnya ke shell Windows
      const viaShell = await shellLinkIcon(filePath);
      img = usable(viaShell) ? viaShell : null;
      tried.push((img ? 'ok' : 'gagal') + ': tujuan shortcut lewat shell');
    }
  } else if (/\.url$/i.test(filePath)) {
    try {
      const m = /^IconFile=(.+)$/im.exec(fs.readFileSync(filePath, 'utf8'));
      const src = m && expandEnv(m[1].trim());
      if (src && fs.existsSync(src)) { img = await iconFromFile(src); tried.push((img ? 'ok: ' : 'gagal: ') + path.basename(src)); }
    } catch (_) { /* lanjut */ }
  }
  if (!img) { img = await iconFromFile(filePath); tried.push((img ? 'ok' : 'gagal') + ': file itu sendiri'); }
  log('ikon', path.basename(filePath), '->', tried.join('; '));
  if (!img) return '';
  const { width } = img.getSize();
  return (width > 128 ? img.resize({ width: 128, quality: 'best' }) : img).toDataURL();
}
// ---------- Ikon bawaan: My Computer & Trash ----------
// Bukan file sungguhan, jadi punya path buatan "pulau:..." dan dibuka lewat Explorer.
const svgIcon = (body) => 'data:image/svg+xml;base64,' + Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48">${body}</svg>`).toString('base64');
const SPECIAL = {
  'pulau:computer': {
    name: 'My Computer',
    shellName: '::{20D04FE0-3AEA-1069-A2D8-08002B30309D}',
    open: 'shell:MyComputerFolder',
    // cadangan bila ikon Windows tidak bisa diambil
    fallback: svgIcon('<rect x="5" y="8" width="38" height="25" rx="3" fill="#3b8ff5"/><rect x="8" y="11" width="32" height="19" rx="1.5" fill="#bfe0ff"/><rect x="20" y="33" width="8" height="5" fill="#8a96a8"/><rect x="13" y="38" width="22" height="3" rx="1.5" fill="#c5ccd6"/>'),
  },
  'pulau:trash': {
    name: 'Trash',
    shellName: '::{645FF040-5081-101B-9F08-00AA002F954E}',
    open: 'shell:RecycleBinFolder',
    fallback: svgIcon('<path d="M12 14h24l-2.2 27a3 3 0 0 1-3 2.8H17.2a3 3 0 0 1-3-2.8z" fill="#d7dde5"/><rect x="9" y="9" width="30" height="5" rx="2" fill="#aab4c2"/><rect x="19" y="5" width="10" height="5" rx="2" fill="#aab4c2"/><path d="M19 19v19M24 19v19M29 19v19" stroke="#8a96a8" stroke-width="2" stroke-linecap="round"/>'),
  },
};
async function specialInfo(id) {
  const sp = SPECIAL[id];
  let icon = '';
  if (isWin) {
    const img = await shellLinkIcon(sp.shellName);
    if (usable(img)) icon = img.toDataURL();
    log('ikon', sp.name, '->', icon ? 'ok: dari Windows' : 'gagal: pakai cadangan');
  }
  return { path: id, name: sp.name, size: -2, icon: icon || sp.fallback, special: true };
}
function openSpecial(id) {
  const sp = SPECIAL[id];
  if (!sp) return false;
  if (isWin) spawn('explorer.exe', [sp.open], { windowsHide: false, detached: true, stdio: 'ignore' }).unref();
  log('buka', sp.name);
  return true;
}

async function fileInfo(filePath) {
  if (SPECIAL[filePath]) return specialInfo(filePath);
  try {
    const st = fs.statSync(filePath);
    const icon = await iconFor(filePath);
    return { path: filePath, name: path.basename(filePath), size: st.isDirectory() ? -1 : st.size, icon };
  } catch (err) {
    log('file tidak terbaca:', filePath, String(err));
    return null;
  }
}
// Tingkat hak akses proses: seret-lepas dari Explorer diblokir Windows bila aplikasi berjalan sebagai admin.
function logIntegrity() {
  if (!isWin) return;
  try {
    const { execFile } = require('child_process');
    execFile('whoami', ['/groups'], { windowsHide: true, timeout: 8000 }, (err, out) => {
      if (err) { log('hak akses: tidak terbaca', String(err).slice(0, 120)); return; }
      const level = /S-1-16-16384/.test(out) ? 'SYSTEM' : /S-1-16-12288/.test(out) ? 'TINGGI (admin)' : /S-1-16-8192/.test(out) ? 'sedang (normal)' : /S-1-16-4096/.test(out) ? 'rendah' : 'tidak dikenal';
      log('hak akses proses:', level);
      isAdmin = /S-1-16-(12288|16384)/.test(out);
      if (isAdmin) send('admin', true);
    });
  } catch (err) { log('hak akses: gagal', String(err)); }
}
// Daftar aplikasi = shortcut di Desktop dan Start Menu. Shortcut-nya sendiri yang disimpan
// (bukan program tujuannya), supaya aplikasi-web/PWA terbuka sebagai aplikasinya, bukan browser kosong.
function appDirs() {
  if (process.env.PULAU_APP_DIRS) return process.env.PULAU_APP_DIRS.split(path.delimiter);
  const dirs = [];
  try { dirs.push(app.getPath('desktop')); } catch (_) { /* tidak ada */ }
  if (process.env.PUBLIC) dirs.push(path.join(process.env.PUBLIC, 'Desktop'));
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  if (process.env.ProgramData) dirs.push(path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'));
  return dirs;
}
function scanApps() {
  const found = new Map();
  const skip = /uninstall|unins\d|readme|license|lisensi|help|bantuan|manual|website|documentation/i;
  const walk = (dir, depth) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (depth < 4) walk(full, depth + 1); continue; }
      if (!/\.(lnk|url|appref-ms)$/i.test(e.name)) continue;
      const name = e.name.replace(/\.(lnk|url|appref-ms)$/i, '');
      if (skip.test(name)) continue;
      const key = name.toLowerCase();
      if (!found.has(key)) found.set(key, { path: full, name });
    }
  };
  for (const d of appDirs()) walk(d, 0);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, 'id', { sensitivity: 'base' }));
}
ipcMain.handle('apps:list', () => {
  const list = scanApps();
  log('daftar aplikasi:', list.length);
  return list;
});
// Memilih file/aplikasi lewat dialog: cara pasti selain seret-lepas.
ipcMain.handle('shelf:pick', async () => {
  const startMenu = process.env.ProgramData ? path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs') : undefined;
  const res = await dialog.showOpenDialog({
    title: 'Tambahkan file atau aplikasi ke Shelf',
    defaultPath: startMenu,
    properties: ['openFile', 'multiSelections'],
  });
  if (res.canceled) return [];
  log('dipilih lewat dialog:', res.filePaths.length);
  return (await Promise.all(res.filePaths.map(fileInfo))).filter(Boolean);
});
ipcMain.handle('shelf:info', (_e, filePath) => fileInfo(String(filePath)));
// ---------- Notes ----------
ipcMain.handle('clip:read', () => { try { return clipboard.readText(); } catch (_) { return ''; } });
ipcMain.on('clip:write', (_e, text) => { try { clipboard.writeText(String(text)); } catch (err) { log('clipboard gagal:', String(err)); } });
// Menyimpan catatan sebagai file .txt di Documents\Dragon Dynamic Island Notes (nama file = tanggal & jam).
ipcMain.handle('note:save', (_e, text) => {
  try {
    const dir = path.join(app.getPath('documents'), APP_NAME + ' Notes');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const base = `Catatan ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}.${pad(d.getMinutes())}`;
    let file = path.join(dir, base + '.txt');
    for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base} (${i}).txt`);
    // BOM agar Notepad lama membaca huruf non-Latin dengan benar; baris baru gaya Windows.
    fs.writeFileSync(file, '\uFEFF' + String(text).replace(/\r?\n/g, '\r\n'), 'utf8');
    log('catatan disimpan:', path.basename(file), String(text).length, 'huruf');
    return { ok: true, path: file, name: path.basename(file) };
  } catch (err) {
    log('catatan gagal disimpan:', String(err));
    return { ok: false, error: String(err && err.message || err).slice(0, 120) };
  }
});
ipcMain.on('shelf:open', (_e, filePath) => { if (!openSpecial(filePath)) shell.openPath(filePath); });
ipcMain.on('shelf:reveal', (_e, filePath) => { if (!openSpecial(filePath)) shell.showItemInFolder(filePath); });
ipcMain.handle('shelf:specials', () => Object.keys(SPECIAL).map((id) => ({ path: id, name: SPECIAL[id].name })));
ipcMain.on('shelf:drag', async (e, filePath) => {
  if (SPECIAL[filePath] || !fs.existsSync(String(filePath))) return; // file sudah dihapus: tidak ada yang bisa diseret
  try {
    const icon = await app.getFileIcon(filePath, { size: 'normal' });
    e.sender.startDrag({ file: filePath, icon });
  } catch (_) { /* file sudah tidak ada */ }
});

// ---------- App ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (isWin) app.setAppUserModelId(APP_ID);
    loadSettings();
    if (migration) log(migration);
    log('===', APP_NAME, app.getVersion(), 'mulai ===', process.platform, process.getSystemVersion(), 'layar', screen.getPrimaryDisplay().size, 'skala', screen.getPrimaryDisplay().scaleFactor);
    logIntegrity();
    try { startClaude(); } catch (err) { log('fitur Claude gagal dimulai:', String(err)); }
    try { createCatcher(); } catch (err) { log('penangkap gagal dibuat:', String(err)); }
    createWindow();
    try { createTray(); } catch (err) { log('tray gagal:', String(err)); }
    startMediaWatcher();
    startWindowWatcher();
    makeDesktopShortcut(false);
    watchCursor();
    globalShortcut.register('Control+Alt+I', toggleVisible);
  });
  app.on('will-quit', () => {
    quitting = true;
    globalShortcut.unregisterAll();
    if (monitor) monitor.close();
    for (const p of [mediaProc, winProc, iconProc]) { if (p) { try { p.stdin.end(); p.kill(); } catch (_) { /* sudah mati */ } } }
  });
  app.on('window-all-closed', () => app.quit());
}
