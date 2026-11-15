'use strict';
(() => {
const api = window.api || null;
const $ = (id) => document.getElementById(id);
const wrap = $('wrap');
const dragon = $('dragon');

// ---------- penyimpanan ----------
const today = () => { const d = new Date(); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function load(key, def) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? def : v; } catch (_) { return def; }
}
function save(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (_) { /* penuh */ } }
const pad = (n) => String(n).padStart(2, '0');
const mmss = (s) => `${pad(Math.floor(s / 60))}:${pad(Math.floor(s % 60))}`;
const hhmm = (min) => `${pad(Math.floor(min / 60) % 24)}:${pad(min % 60)}`;

// ---------- ukuran pulau ----------
const BASE_W = 560;
const SHELF_PAGE = 1, PRAY_PAGE = 3, CLAUDE_PAGE = 5;
const BASE_H = 196, CLAUDE_H = 300; // tinggi panel; halaman Claude lebih tinggi untuk chat & daftar sesi
let islandH = BASE_H;
const PILL_W = 236; // lebar pil (sama dengan #island di style.css)
let islandW = BASE_W;
// Skala keseluruhan pulau + naga; bisa diganti dari menu tray (Ukuran).
let K = Math.min(1.2, Math.max(0.5, load('scale', 0.82)));
function shelfWidth() {
  const n = shelf.length;
  const hint = n <= 2 ? 200 : 64;
  return 60 + 18 + n * 84 + hint; // tepi panel + bingkai + ikon + area seret
}
function layout() {
  const max = Math.max(BASE_W, (window.innerWidth - 80) / K);
  islandW = pageIdx === SHELF_PAGE ? Math.min(max, Math.max(BASE_W, shelfWidth())) : BASE_W;
  islandH = pageIdx === CLAUDE_PAGE ? CLAUDE_H : BASE_H;
  document.documentElement.style.setProperty('--w', `${islandW}px`);
  document.documentElement.style.setProperty('--h', `${islandH}px`);
  document.documentElement.style.setProperty('--k', K);
  const open = wrap.classList.contains('expanded');
  // Area yang menerima klik: pulau + naga di bawahnya.
  if (!api) return;
  // bw/bh = badan hitam pulau (tanpa sudut membulat): tempat jendela penangkap seretan berada.
  if (hidden) api.setRect({ w: 0, h: 0, bw: 0, bh: 0 }); // tersembunyi: seluruh jendela tembus-klik
  else if (open) api.setRect({ w: (islandW + 56) * K, h: (islandH + 74) * K, bw: (islandW - 14) * K, bh: (islandH - 38) * K });
  else api.setRect({ w: (PILL_W + 36) * K, h: (38 + 56) * K, bw: (PILL_W - 34) * K, bh: (38 - 19) * K });
}
window.addEventListener('resize', () => layout());
if (api && api.onScale) api.onScale((k) => { K = Math.min(1.2, Math.max(0.5, Number(k) || 0.82)); save('scale', K); layout(); });

// ---------- buka / tutup pulau ----------
let hover = false, dragging = false, closeTimer = null, holdUntil = 0, lastActive = Date.now();
let dodge = false, hidden = false, summonTimer = null, lastCursor = null;
// Mata naga oranye: ada tugas Claude yang selesai dan belum dilihat. Kembali hijau setelah panel
// dibuka (sebentar, supaya sempat terlihat) atau setelah 15 menit.
let amberTimer = null;
function amberEyes(on) {
  clearTimeout(amberTimer);
  dragon.classList.toggle('amber', on);
  // Panel sedang terbuka: kabarnya sudah terlihat, jadi oranye hanya sebentar.
  if (on) amberTimer = setTimeout(() => amberEyes(false), wrap.classList.contains('expanded') ? 6000 : 15 * 60 * 1000);
}
function setExpanded(on) {
  if (on && hidden) setHidden(false);
  if (on && dragon.classList.contains('amber')) { clearTimeout(amberTimer); amberTimer = setTimeout(() => amberEyes(false), 2500); }
  wrap.classList.toggle('expanded', on);
  wrap.classList.toggle('collapsed', !on);
  dragon.classList.toggle('curious', on);
  if (on) wake();
  if (on && pageIdx === SHELF_PAGE) refreshSpecials();
  layout();
  if (!on && shelfEditing) setShelfEditing(false);
  if (!on && lastCursor) setTimeout(() => cursorTick(lastCursor), 60);
}
function setHidden(on) {
  if (hidden === on) return;
  hidden = on;
  wrap.classList.toggle('hidden', on);
  layout();
}
let closing = false;
function maybeClose() {
  clearTimeout(closeTimer);
  closing = true;
  closeTimer = setTimeout(() => {
    closing = false;
    const el = document.activeElement;
    if (el && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return;
    if (Date.now() < holdUntil) return maybeClose();
    if (!hover && !dragging) setExpanded(false);
  }, 380);
}
wrap.addEventListener('mouseenter', () => {
  hover = true; clearTimeout(closeTimer); closing = false;
  // Mode menyingkir: panel hanya dibuka lewat tepi atas layar (lihat cursorTick).
  if (!dodge || wrap.classList.contains('expanded')) setExpanded(true);
});
wrap.addEventListener('mouseleave', () => { hover = false; maybeClose(); });
document.addEventListener('focusout', () => { if (!hover) maybeClose(); });
// Pindah ke aplikasi lain saat sedang mengetik: lepaskan fokus supaya panel bisa menutup.
window.addEventListener('blur', () => { const el = document.activeElement; if (el && el.blur && el !== document.body) el.blur(); });

// ---------- menyingkir saat kursor mendekat ----------
// Aktif ketika ada jendela terbuka penuh di belakang pulau (atau dipaksa lewat menu tray).
//  - kursor mendekat  -> pulau mengecil dan bersembunyi ke atas, supaya isi jendela terlihat;
//  - kursor mentok di tepi atas layar -> pil muncul dulu, lalu panel terbuka penuh.
function cursorTick(p) {
  lastCursor = p;
  const cx = window.innerWidth / 2;
  const dx = Math.abs(p.x - cx);
  const open = wrap.classList.contains('expanded');
  // Panel terbuka tanpa kursor di atasnya (mis. dibuka pengingat atau tepi layar): tutup saat kursor menjauh.
  if (open && !hover && !dragging && !closing && (dx > (islandW / 2 + 50) * K || p.y > (islandH + 90) * K)) maybeClose();
  if (!dodge) { clearTimeout(summonTimer); summonTimer = null; setHidden(false); return; }
  if (open || dragging || Date.now() < holdUntil) { setHidden(false); return; }
  const halfPill = (PILL_W / 2) * K, pillH = 38 * K;
  const atEdge = p.y <= 1 && dx <= halfPill + 30;
  const onPill = !hidden && p.y <= pillH && dx <= halfPill;
  const near = dx <= halfPill + 110 && p.y <= pillH + 56 * K + 80;
  if (atEdge) {
    setHidden(false); wake();
    if (!summonTimer) summonTimer = setTimeout(() => {
      summonTimer = null;
      const q = lastCursor;
      if (dodge && q && q.y <= pillH && Math.abs(q.x - cx) <= halfPill + 30) setExpanded(true);
    }, 420);
  } else if (summonTimer && onPill) {
    // masih di atas pil: tunggu panel terbuka
  } else {
    clearTimeout(summonTimer); summonTimer = null;
    setHidden(near);
  }
}
if (api && api.onDodge) api.onDodge((on) => {
  dodge = !!on;
  if (lastCursor) cursorTick(lastCursor); else if (!dodge) setHidden(false);
});

function chime() { window.DragonSound.play('lonceng'); }
// Pengingat: pulau terbuka sendiri, berdenyut hijau, naga melompat, plus notifikasi Windows.
function alertUser(title, body, page, sound, noNotify) {
  wake();
  wrap.classList.add('alert');
  dragon.classList.remove('excited'); void dragon.offsetWidth; dragon.classList.add('excited');
  if (page != null) showPage(page);
  setHidden(false);
  holdUntil = Date.now() + 12000;
  setExpanded(true);
  setTimeout(() => { wrap.classList.remove('alert'); dragon.classList.remove('excited'); if (!hover) maybeClose(); }, 12000);
  if (sound) chime();
  if (!noNotify) { try { new Notification(title, { body }); } catch (_) { /* notifikasi tidak tersedia */ } }
}

// ---------- naga ----------
function wake() { lastActive = Date.now(); dragon.classList.remove('sleep', 'sleepy'); }
// Ekspresi sesaat: senang, sedih, melompat, memiringkan kepala.
const moodTimers = {};
function mood(cls, ms) {
  wake();
  dragon.classList.remove(cls); void dragon.offsetWidth; dragon.classList.add(cls);
  clearTimeout(moodTimers[cls]);
  moodTimers[cls] = setTimeout(() => dragon.classList.remove(cls), ms);
}
dragon.addEventListener('click', () => { mood('happy', 1500); mood('hop', 900); mood('twitch', 700); });
function blinkLoop() {
  setTimeout(() => {
    if (!dragon.classList.contains('sleep')) {
      dragon.classList.add('blink');
      setTimeout(() => dragon.classList.remove('blink'), 130);
      if (Math.random() < 0.25) setTimeout(() => { // kedip ganda
        dragon.classList.add('blink'); setTimeout(() => dragon.classList.remove('blink'), 120);
      }, 300);
    }
    blinkLoop();
  }, 2200 + Math.random() * 3800);
}
function twitchLoop() {
  setTimeout(() => {
    if (!dragon.classList.contains('sleep')) {
      dragon.classList.add('twitch'); setTimeout(() => dragon.classList.remove('twitch'), 700);
    }
    twitchLoop();
  }, 7000 + Math.random() * 9000);
}
// Pupil mengikuti kursor di seluruh layar; makin dekat kursor, pupil makin membulat.
function lookAt(x, y) {
  const r = dragon.getBoundingClientRect();
  const dx = x - (r.left + r.width / 2), dy = y - (r.top + r.height / 2);
  const dist = Math.hypot(dx, dy) || 1;
  const reach = Math.min(1, dist / 160);
  dragon.style.setProperty('--px', `${((dx / dist) * 7 * reach).toFixed(2)}px`);
  dragon.style.setProperty('--py', `${((dy / dist) * 5 * reach).toFixed(2)}px`);
  // Makin dekat kursor, pupil makin bulat; kursor yang jauh dipandang curiga.
  dragon.style.setProperty('--near', Math.max(0, 1 - dist / 520).toFixed(2));
  dragon.classList.toggle('suspicious', dist > 900 && !wrap.classList.contains('expanded'));
  wake();
}
if (api) api.onCursor((p) => { lookAt(p.x, p.y); cursorTick(p); });
else window.addEventListener('mousemove', (e) => lookAt(e.clientX, e.clientY));
setInterval(() => { // mengantuk setelah 25 detik tanpa gerakan kursor, tertidur setelah 45 detik
  const quiet = !wrap.classList.contains('expanded') && !media.playing;
  const idleMs = Date.now() - lastActive;
  dragon.classList.toggle('sleepy', quiet && idleMs > 25000 && idleMs <= 45000);
  dragon.classList.toggle('sleep', quiet && idleMs > 45000);
}, 1000);
function tiltLoop() { // sesekali memiringkan kepala, penasaran
  setTimeout(() => {
    if (!dragon.classList.contains('sleep') && !media.playing) mood(Math.random() < 0.5 ? 'tiltL' : 'tiltR', 1400);
    tiltLoop();
  }, 9000 + Math.random() * 12000);
}

// ---------- navigasi halaman ----------
const pages = [...document.querySelectorAll('.page')];
let pageIdx = Math.min(load('page2', 0), pages.length - 1);
const dots = $('dots');
// Baris bawah: satu ikon per fitur, klik untuk langsung pindah ke fitur itu.
pages.forEach((pg, i) => {
  const d = document.createElement('button');
  d.className = 'navicon';
  d.title = pg.dataset.label || '';
  d.setAttribute('aria-label', pg.dataset.label || `Halaman ${i + 1}`);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#n-${pg.dataset.icon}`);
  svg.appendChild(use);
  d.appendChild(svg);
  d.addEventListener('click', () => clickPage(i));
  dots.appendChild(d);
});
// Ikon Trash berubah kosong/berisi: segarkan saat Shelf ditampilkan (paling sering tiap 10 detik).
let specialsRefreshed = 0;
async function refreshSpecials() {
  if (!api || Date.now() - specialsRefreshed < 10000) return;
  specialsRefreshed = Date.now();
  let changed = false;
  for (const item of shelf.filter((x) => x.special)) {
    const info = await api.shelfInfo(item.path);
    if (info && info.icon && info.icon !== item.icon) { item.icon = info.icon; changed = true; }
  }
  if (changed) { save('shelf', shelf); renderShelf(); }
}
function showPage(i) {
  pageIdx = (i + pages.length) % pages.length;
  pages.forEach((p, n) => p.classList.toggle('active', n === pageIdx));
  [...dots.children].forEach((d, n) => d.classList.toggle('on', n === pageIdx));
  $('pageTitle').innerHTML = pages[pageIdx].dataset.title;
  bindShelfButtons();
  if ($('noteCount')) noteChanged();
  save('page2', pageIdx);
  layout();
  if (pageIdx === SHELF_PAGE && wrap.classList.contains('expanded')) refreshSpecials();
}
// Pindah halaman lewat klik: tinggi panel bisa berubah (Claude lebih tinggi) sehingga kursor tiba-tiba
// berada di luar panel. Tahan sebentar supaya pulau tidak langsung menutup.
function clickPage(i) {
  const next = (i + pages.length) % pages.length;
  if (pageIdx === CLAUDE_PAGE && next !== CLAUDE_PAGE) holdUntil = Math.max(holdUntil, Date.now() + 1500);
  showPage(i);
}
$('prev').onclick = () => clickPage(pageIdx - 1);
$('next').onclick = () => clickPage(pageIdx + 1);
wrap.addEventListener('wheel', (e) => {
  if (e.target.closest('#todoList, .overlay, textarea, #clList, #clLog')) return;
  const sh = $('shelf');
  if (e.target.closest('#shelfBox') && sh.scrollWidth > sh.clientWidth + 1) { sh.scrollLeft += e.deltaY || e.deltaX; return; }
  showPage(pageIdx + (e.deltaY > 0 ? 1 : -1));
}, { passive: true });

// ---------- jam & baterai ----------
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function tickClock() {
  const d = new Date();
  const t = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  $('time').textContent = t; $('pillTime').textContent = t;
  $('pillDate').querySelector('.dow').textContent = `${DAYS[d.getDay()]} `;
  $('pillDate').querySelector('.dm').textContent = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  $('date').textContent = `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
function initBattery() {
  if (!navigator.getBattery) return;
  navigator.getBattery().then((b) => {
    const upd = () => document.querySelectorAll('[data-batt]').forEach((el) => {
      el.style.setProperty('--lvl', Math.max(0.15, b.level));
      el.classList.toggle('low', b.level <= 0.2 && !b.charging);
      el.classList.toggle('mid', b.level > 0.2 && b.level <= 0.4 && !b.charging);
      el.classList.toggle('charging', b.charging);
      el.title = `Baterai ${Math.round(b.level * 100)}%${b.charging ? ' · mengisi' : ''}`;
    });
    upd(); b.addEventListener('levelchange', upd); b.addEventListener('chargingchange', upd);
  }).catch(() => {});
}

// ---------- media ----------
const media = { playing: false, last: null };
const thumb = { title: '', data: '' }; // sampul lagu, dikirim terpisah saat lagu berganti
function renderMedia(m) {
  media.playing = !!(m && m.has && m.status === 'Playing');
  $('pillWave').hidden = !media.playing;
  dragon.classList.toggle('bob', media.playing);
  $('mediaPlayIcon').setAttribute('href', media.playing ? '#i-pause' : '#i-play');
  $('mediaArtIcon').setAttribute('href', media.playing ? '#i-play' : '#i-note');
  const art = $('mediaArt');
  const showThumb = !!(m && m.has && thumb.data && thumb.title === (m.title || ''));
  art.classList.toggle('thumb', showThumb);
  art.style.backgroundImage = showThumb ? `url("${thumb.data}")` : '';
  if (!m || !m.has) {
    $('mediaTitle').textContent = 'Tidak ada media';
    $('mediaArtist').textContent = api && api.platform !== 'win32' ? 'Kontrol media hanya tersedia di Windows'
      : m && m.error ? 'Info lagu tidak terbaca; tombol tetap mengirim tombol media' : 'Putar musik atau video untuk mengendalikannya';
    $('mediaArtist').title = m && m.error ? m.error : '';
    $('mediaPos').textContent = '00:00'; $('mediaRem').textContent = '-00:00'; $('mediaFill').style.width = '0';
    return;
  }
  $('mediaTitle').textContent = m.title || m.app || 'Media';
  $('mediaArtist').textContent = m.artist || '';
  const dur = m.duration || 0, pos = Math.min(m.position || 0, dur || Infinity);
  $('mediaPos').textContent = mmss(pos);
  $('mediaRem').textContent = '-' + mmss(Math.max(0, dur - pos));
  $('mediaFill').style.width = dur ? `${(pos / dur) * 100}%` : '0';
}
document.querySelectorAll('[data-media]').forEach((b) => {
  b.onclick = () => api && api.mediaCommand(b.dataset.media);
});
if (api) api.onMedia((m) => { media.last = m; renderMedia(m); });
if (api && api.onThumb) api.onThumb((t) => {
  if (!t || typeof t.thumb !== 'string' || !/^data:image\//.test(t.thumb)) return;
  thumb.title = t.title || ''; thumb.data = t.thumb;
  if (media.last) renderMedia(media.last);
});

// ---------- shelf ----------
let shelf = load('shelf', []);
// Mode Edit: tombol hapus (x) dan Clear hanya ada di mode ini; keluar otomatis saat panel menutup.
let shelfEditing = false;
function setShelfEditing(on) {
  shelfEditing = !!on;
  $('shelfBox').classList.toggle('editing', shelfEditing);
  document.querySelectorAll('#shelf .file').forEach((n) => { n.draggable = !shelfEditing; });
  const ed = $('shelfEdit'), clr = $('shelfClear');
  if (ed) { ed.textContent = shelfEditing ? 'Selesai' : 'Edit'; ed.classList.toggle('on', shelfEditing); ed.hidden = !shelf.length && !shelfEditing; }
  if (clr) clr.hidden = !shelfEditing || !shelf.length;
}
function bindShelfButtons() {
  const ed = $('shelfEdit'), clr = $('shelfClear');
  if (ed) ed.onclick = () => setShelfEditing(!shelfEditing);
  if (clr) clr.onclick = () => { if (shelf.length) mood('sad', 1500); shelf = []; saveShelf(); setShelfEditing(false); };
  setShelfEditing(shelfEditing);
}
const APP_EXT = /\.(lnk|url|exe|appref-ms)$/i;
function fmtSize(b) {
  if (b < 0) return 'Folder';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${Math.round(b / 1024)} KB`;
  if (b < 1073741824) return `${(b / 1048576).toFixed(1)} MB`;
  return `${(b / 1073741824).toFixed(1)} GB`;
}
function saveShelf() { save('shelf', shelf); renderShelf(); }
function renderShelf(fresh) {
  const box = $('shelf');
  box.textContent = '';
  $('shelfHint').classList.toggle('small', shelf.length > 2);
  setShelfEditing(shelfEditing && shelf.length > 0);
  shelf.forEach((f, i) => {
    const isApp = APP_EXT.test(f.name);
    const el = document.createElement('div');
    el.className = 'file'; el.draggable = !shelfEditing; el.title = f.path; el.dataset.path = f.path;
    if (!fresh || !fresh.includes(f.path)) el.style.animation = 'none';
    let ic;
    if (f.icon) { ic = document.createElement('img'); ic.src = f.icon; ic.alt = ''; }
    else { ic = document.createElement('div'); ic.textContent = '📄'; }
    ic.className = 'ic'; el.appendChild(ic);
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = isApp ? f.name.replace(APP_EXT, '') : f.name; el.appendChild(nm);
    const sz = document.createElement('div'); sz.className = 'sz'; sz.textContent = isApp || f.special ? '' : fmtSize(f.size); el.appendChild(sz);
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '✕'; x.setAttribute('aria-label', 'Hapus dari shelf');
    x.onclick = (e) => {
      e.stopPropagation(); el.classList.add('gone');
      setTimeout(() => { shelf = shelf.filter((s) => s.path !== f.path); saveShelf(); }, 190);
    };
    el.appendChild(x);
    // Klik: ikon melompat lalu aplikasi/file dibuka.
    el.onclick = () => {
      if (shelfEditing || el.classList.contains('launch')) return; // mode Edit: klik tidak membuka
      el.style.animation = ''; el.classList.add('launch'); mood('happy', 1300);
      setTimeout(() => api && api.shelfOpen(f.path), 240);
      setTimeout(() => el.classList.remove('launch'), 1500);
    };
    el.oncontextmenu = (e) => { e.preventDefault(); if (api) api.shelfReveal(f.path); };
    el.ondragstart = (e) => { e.preventDefault(); if (api && !shelfEditing) api.shelfDrag(f.path); };
    // Mode Edit: tahan dan geser ikon untuk mengubah urutannya.
    el.addEventListener('pointerdown', (e) => {
      if (!shelfEditing || e.button !== 0 || e.target.closest('.x')) return;
      e.preventDefault();
      el.classList.add('moving');
      const move = (ev) => {
        const sibs = [...box.querySelectorAll('.file')];
        const me = sibs.indexOf(el);
        const mid = (o) => { const r = o.getBoundingClientRect(); return r.left + r.width / 2; };
        // geser ke kiri: sisipkan sebelum ikon paling kiri yang titik tengahnya sudah dilewati
        for (let i = 0; i < me; i++) if (ev.clientX < mid(sibs[i])) { box.insertBefore(el, sibs[i]); return; }
        // geser ke kanan: sisipkan setelah ikon paling kanan yang titik tengahnya sudah dilewati
        for (let i = sibs.length - 1; i > me; i--) if (ev.clientX > mid(sibs[i])) { box.insertBefore(el, sibs[i].nextSibling); return; }
      };
      // Didengarkan di jendela, bukan di ikon: memindahkan ikon di daftar memutus pelacakan pointer pada ikon itu.
      const done = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', done);
        window.removeEventListener('pointercancel', done);
        el.classList.remove('moving');
        const order = [...box.querySelectorAll('.file')].map((n) => n.dataset.path);
        const before = shelf.map((x) => x.path).join('|');
        shelf.sort((a, b) => order.indexOf(a.path) - order.indexOf(b.path));
        if (shelf.map((x) => x.path).join('|') !== before) save('shelf', shelf);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', done);
      window.addEventListener('pointercancel', done);
    });
    box.appendChild(el);
    void i;
  });
  layout();
}
// Efek "dock": ikon membesar mengikuti jarak kursor.
$('shelf').addEventListener('mousemove', (e) => {
  document.querySelectorAll('.file').forEach((el) => {
    const r = el.getBoundingClientRect();
    const d = Math.abs(e.clientX - (r.left + r.width / 2));
    el.style.setProperty('--s', (1 + 0.38 * Math.max(0, 1 - d / 130)).toFixed(3));
  });
});
$('shelf').addEventListener('mouseleave', () => {
  document.querySelectorAll('.file').forEach((el) => el.style.setProperty('--s', 1));
});
// Menambah file ke shelf (dari seret-lepas atau dialog pilih file).
async function addPaths(paths) {
  const fresh = [];
  for (const p of paths) {
    if (!p || shelf.some((x) => x.path === p)) continue;
    const info = await api.shelfInfo(p);
    if (info) { shelf.push(info); fresh.push(info.path); }
  }
  save('shelf', shelf); renderShelf(fresh);
  $('shelf').scrollLeft = $('shelf').scrollWidth;
  if (fresh.length) { mood('happy', 1600); mood('hop', 900); }
  return fresh.length;
}
function addInfos(infos) {
  const fresh = [];
  for (const info of infos) {
    if (!info || shelf.some((x) => x.path === info.path)) continue;
    shelf.push(info); fresh.push(info.path);
  }
  save('shelf', shelf); renderShelf(fresh);
  $('shelf').scrollLeft = $('shelf').scrollWidth;
  if (fresh.length) { mood('happy', 1600); mood('hop', 900); }
}
let HINT_TEXT = 'Seret file ke sini, atau klik untuk memilih aplikasi';
if (api && api.onAdmin) api.onAdmin((on) => {
  if (!on) return;
  // Windows memblokir seret-lepas dari Explorer ke aplikasi yang berjalan sebagai administrator.
  HINT_TEXT = 'Dragon Dynamic Island berjalan sebagai administrator, jadi seret file diblokir Windows. Klik untuk memilih aplikasi.';
  $('shelfHint').querySelector('span').textContent = HINT_TEXT;
});
function hintMessage(text) {
  const span = $('shelfHint').querySelector('span');
  span.textContent = text;
  $('shelfHint').classList.remove('small');
  setTimeout(() => { span.textContent = HINT_TEXT; renderShelf(); }, 4500);
}
$('shelfHint').querySelector('span').textContent = HINT_TEXT;
// Pemilih aplikasi: daftar shortcut dari Desktop dan Start Menu, bisa dicari.
let appsAll = [];
const appInfo = new Map(); // path -> info (dengan ikon), diambil saat tampil
function renderApps() {
  const q = $('appSearch').value.trim().toLowerCase();
  const list = $('appList');
  list.textContent = '';
  appsAll.filter((a) => !q || a.name.toLowerCase().includes(q)).slice(0, 40).forEach((a) => {
    const el = document.createElement('div');
    el.className = 'app' + (shelf.some((x) => x.path === a.path) ? ' added' : '');
    el.title = a.name;
    const setIcon = (info) => {
      const old = el.querySelector('.ic');
      if (!info || !info.icon || !old) return;
      const img = document.createElement('img'); img.className = 'ic'; img.alt = ''; img.src = info.icon;
      old.replaceWith(img);
    };
    const ph = document.createElement('div'); ph.className = 'ic'; el.appendChild(ph);
    const nm = document.createElement('div'); nm.className = 'nm'; nm.textContent = a.name; el.appendChild(nm);
    if (appInfo.has(a.path)) setIcon(appInfo.get(a.path));
    else if (api) api.shelfInfo(a.path).then((info) => { appInfo.set(a.path, info); setIcon(info); });
    el.onclick = async () => {
      if (shelf.some((x) => x.path === a.path)) { // klik lagi = keluarkan dari shelf
        shelf = shelf.filter((x) => x.path !== a.path); saveShelf(); el.classList.remove('added'); return;
      }
      const info = appInfo.get(a.path) || (api && await api.shelfInfo(a.path));
      if (!info) return;
      addInfos([info]); el.classList.add('added');
    };
    list.appendChild(el);
  });
}
$('shelfHint').addEventListener('click', async () => {
  if (!api) return;
  $('appPicker').hidden = false;
  $('appSearch').value = '';
  // My Computer & Trash selalu di urutan teratas, supaya bisa ditambahkan lagi bila terhapus.
  appsAll = [...(await api.shelfSpecials()), ...(await api.appsList())];
  renderApps();
  $('appSearch').focus();
});
$('appSearch').addEventListener('input', renderApps);
$('appSearch').addEventListener('keydown', (e) => { if (e.key === 'Escape') $('appClose').click(); });
$('appClose').onclick = () => { $('appPicker').hidden = true; $('appSearch').blur(); };
$('appFile').onclick = async () => {
  holdUntil = Date.now() + 1500;
  addInfos(await api.shelfPick());
  renderApps();
};
$('appList').addEventListener('wheel', (e) => { $('appList').scrollLeft += e.deltaY || e.deltaX; }, { passive: true });

// Menyeret file ke pulau: buka otomatis dan pindah ke halaman Shelf.
// Akhir seretan dideteksi dari berhentinya 'dragover' (bukan 'dragleave', yang juga muncul
// setiap kali kursor berpindah antar-elemen dan dulu membuat panel menutup di tengah seretan).
let dragSeen = 0;
function beginDrag(e) {
  dragSeen = Date.now();
  if (dragging) return;
  dragging = true;
  if (api) api.log(`seret masuk: ${[...(e.dataTransfer ? e.dataTransfer.types : [])].join(',')}`);
  setExpanded(true); showPage(SHELF_PAGE); wrap.classList.add('dragover'); dragon.classList.add('hungry');
}
function endDrag() {
  if (!dragging) return;
  dragging = false; wrap.classList.remove('dragover'); dragon.classList.remove('hungry');
  if (!hover) maybeClose();
}
window.addEventListener('dragenter', (e) => { e.preventDefault(); beginDrag(e); });
window.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  beginDrag(e);
});
setInterval(() => { if (dragging && !externalDrag && Date.now() - dragSeen > 1200) endDrag(); }, 300);
// Seretan yang ditangkap jendela penangkap (lihat main.js): tampilan hanya mengikuti.
let externalDrag = false;
if (api && api.onDragStart) {
  api.onDragStart(() => {
    externalDrag = true;
    if (!dragging) { dragging = true; setExpanded(true); showPage(SHELF_PAGE); wrap.classList.add('dragover'); dragon.classList.add('hungry'); }
  });
  api.onDragEnd(() => { externalDrag = false; endDrag(); });
  api.onDragDrop((d) => {
    const infos = (d && d.infos) || [];
    addInfos(infos);
    if (!infos.length) hintMessage(d && d.tried ? 'File itu tidak bisa dibaca.' : 'Item ini tidak punya file. Klik di sini untuk memilih aplikasi.');
    holdUntil = Math.max(holdUntil, Date.now() + 2500);
  });
}
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const dt = e.dataTransfer;
  const paths = [];
  if (api && dt) {
    for (const file of [...dt.files]) {
      try { const p = api.pathForFile(file); if (p) paths.push(p); } catch (err) { api.log(`pathForFile gagal: ${err}`); }
    }
    if (!paths.length) { // beberapa sumber hanya memberi teks/URL
      const text = dt.getData('text/uri-list') || dt.getData('text/plain') || '';
      for (const line of text.split(/\r?\n/)) {
        const t = line.trim();
        if (/^file:\/\//i.test(t)) { try { paths.push(decodeURIComponent(new URL(t).pathname).replace(/^\/([A-Za-z]:)/, '$1').replace(/\//g, '\\')); } catch (_) { /* bukan URL */ } }
        else if (/^[A-Za-z]:\\/.test(t)) paths.push(t);
      }
    }
    api.log(`lepas: jenis=${[...dt.types].join(',')} file=${dt.files.length} path=${paths.length}`);
  }
  const added = api ? await addPaths(paths) : 0;
  if (api) api.log(`ditambahkan ke shelf: ${added}`);
  if (!paths.length) hintMessage('Item ini tidak punya file. Klik di sini untuk memilih file/aplikasi.');
  endDrag(); dragSeen = 0;
  holdUntil = Math.max(holdUntil, Date.now() + 2500);
});
window.addEventListener('error', (e) => { if (api) api.log(`error: ${e.message} @${e.lineno}`); });
window.addEventListener('unhandledrejection', (e) => { if (api) api.log(`rejection: ${e.reason}`); });

// ---------- todo ----------
const todo = Object.assign({ day: today(), items: [] }, load('todo', {}));
function saveTodo() { save('todo', todo); renderTodo(); }
function renderTodo() {
  const ul = $('todoList');
  ul.textContent = '';
  todo.items.forEach((t, i) => {
    const li = document.createElement('li');
    if (t.done) li.className = 'done';
    const ck = document.createElement('span'); ck.className = 'ck'; ck.textContent = t.done ? '✓' : '';
    const tx = document.createElement('span'); tx.className = 'tx'; tx.textContent = t.text; tx.title = t.text;
    const del = document.createElement('button'); del.className = 'del'; del.textContent = '✕'; del.setAttribute('aria-label', 'Hapus tugas');
    del.onclick = (e) => { e.stopPropagation(); todo.items.splice(i, 1); saveTodo(); mood('sad', 1400); };
    li.onclick = () => {
      t.done = !t.done; saveTodo();
      if (!t.done) return;
      mood('happy', 1500);
      if (todo.items.every((x) => x.done)) mood('hop', 900); // semua tugas beres
    };
    li.append(ck, tx, del);
    ul.appendChild(li);
  });
  $('todoCount').textContent = `${todo.items.filter((t) => t.done).length}/${todo.items.length}`;
}
$('todoAdd').onclick = () => $('todoInput').focus();
$('todoEdit').onclick = () => {
  const on = $('todoList').classList.toggle('editing');
  $('todoEdit').classList.toggle('on', on);
};
$('todoInput').addEventListener('keydown', (e) => {
  const inp = e.target;
  if (e.key === 'Enter' && inp.value.trim()) {
    todo.items.push({ text: inp.value.trim(), done: false }); inp.value = ''; saveTodo();
    $('todoList').scrollTop = $('todoList').scrollHeight;
  }
  if (e.key === 'Escape') inp.blur();
});

// ---------- notes ----------
// Catatan cepat: tersimpan otomatis di aplikasi; "Simpan" menulisnya ke file .txt.
const noteEl = $('noteText');
noteEl.value = load('note', '');
let noteTimer = null;
function noteChanged() {
  const n = noteEl.value.length;
  const c = $('noteCount');
  if (c) c.textContent = n ? `${n} huruf` : '';
  clearTimeout(noteTimer);
  noteTimer = setTimeout(() => save('note', noteEl.value), 300);
}
let noteStatusTimer = null;
function noteStatus(text, onClick) {
  const el = $('noteStatus');
  el.textContent = text;
  el.classList.toggle('link', !!onClick);
  el.onclick = onClick || null;
  clearTimeout(noteStatusTimer);
  noteStatusTimer = setTimeout(() => { el.textContent = ''; el.onclick = null; }, onClick ? 9000 : 2500);
}
function noteInsert(text) {
  if (!text) return;
  const a = noteEl.selectionStart, b = noteEl.selectionEnd;
  noteEl.setRangeText(text, a, b, 'end');
  noteChanged();
}
noteEl.addEventListener('input', noteChanged);
noteEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') noteEl.blur();
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); $('noteSave').click(); }
});
$('notePaste').onclick = async () => {
  const text = api ? await api.clipRead() : '';
  if (!text) { noteStatus('Clipboard kosong (bukan teks)'); return; }
  // tempelan baru dimulai di baris baru bila catatan sudah berisi
  const needBreak = noteEl.value && noteEl.selectionStart === noteEl.value.length && !noteEl.value.endsWith('\n');
  noteInsert((needBreak ? '\n' : '') + text);
  noteEl.scrollTop = noteEl.scrollHeight;
  noteStatus('Ditempel');
};
$('noteCopy').onclick = () => {
  const a = noteEl.selectionStart, b = noteEl.selectionEnd;
  const text = a !== b ? noteEl.value.slice(a, b) : noteEl.value;
  if (!text) { noteStatus('Catatan masih kosong'); return; }
  if (api) api.clipWrite(text);
  noteStatus(a !== b ? 'Bagian terpilih disalin' : 'Seluruh catatan disalin');
};
$('noteSave').onclick = async () => {
  if (!noteEl.value.trim()) { noteStatus('Catatan masih kosong'); return; }
  const res = api ? await api.noteSave(noteEl.value) : null;
  if (res && res.ok) { noteStatus(`Tersimpan: ${res.name} (klik untuk buka folder)`, () => api.shelfReveal(res.path)); mood('happy', 1300); }
  else noteStatus(`Gagal menyimpan${res && res.error ? ': ' + res.error : ''}`);
};
let noteClearArmed = 0;
$('noteClear').onclick = () => {
  if (!noteEl.value) return;
  if (Date.now() - noteClearArmed > 3000) { // klik dua kali agar tidak terhapus tanpa sengaja
    noteClearArmed = Date.now(); $('noteClear').textContent = 'Yakin?';
    setTimeout(() => { $('noteClear').textContent = 'Hapus'; }, 3000);
    return;
  }
  noteClearArmed = 0; $('noteClear').textContent = 'Hapus';
  noteEl.value = ''; noteChanged(); mood('sad', 1200);
};

// ---------- Claude ----------
// Tab Sesi: sesi Claude Code di komputer ini (dikabarkan lewat hooks, lihat claude-monitor.js).
// Tab Chat: chat cepat lewat Claude API (claude-chat.js). Kunci API tidak pernah sampai ke tampilan.
let prayBusy = false, claudeBusy = false;
const cl = { state: null, chat: null, tab: load('clTab', 'sessions'), busy: false, model: load('clModel', 'claude-opus-5-5'), open: new Set(), flash: null };
const CL_STATUS = { working: 'Bekerja', permission: 'Butuh izin', done: 'Selesai', error: 'Error', idle: 'Menunggu', ended: 'Ditutup', stale: 'Tanpa kabar' };
function relTime(t) {
  const sec = Math.max(0, (Date.now() - t) / 1000);
  if (sec < 45) return 'baru saja';
  if (sec < 3600) return `${Math.round(sec / 60)} mnt lalu`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} j lalu`;
  return `${Math.floor(sec / 86400)} hr lalu`;
}
function fmtTokens(n) { return n >= 1e6 ? `${(n / 1e6).toFixed(1)} jt` : n >= 1e3 ? `${Math.round(n / 1e3)} rb` : String(n); }
function clSetTab(t) {
  cl.tab = t === 'chat' ? 'chat' : 'sessions';
  save('clTab', cl.tab);
  $('clSessions').hidden = cl.tab !== 'sessions';
  $('clChat').hidden = cl.tab !== 'chat';
  $('clTabSessions').classList.toggle('on', cl.tab === 'sessions');
  $('clTabChat').classList.toggle('on', cl.tab === 'chat');
  clRenderUsage();
  if (cl.tab === 'chat' && wrap.classList.contains('expanded') && pageIdx === CLAUDE_PAGE) setTimeout(() => $('clText').focus(), 50);
}
$('clTabSessions').onclick = () => clSetTab('sessions');
$('clTabChat').onclick = () => clSetTab('chat');

// Sisa usage langganan (batas 5 jam & 7 hari) dari status line Claude Code di laptop ini.
const USAGE_WINDOWS = [['five_hour', '5 jam', '5j'], ['seven_day', '7 hari', '7h']];
function usageLeft(w) {
  if (!w || w.used_percentage == null) return null;
  // Sudah lewat waktu reset sejak data terakhir: jatahnya penuh lagi.
  if (w.resets_at && w.resets_at * 1000 < Date.now()) return { left: 100, reset: true };
  return { left: Math.max(0, 100 - Math.round(w.used_percentage)), reset: false };
}
const barClass = (left) => 'bar' + (left <= 10 ? ' hot' : left <= 30 ? ' warn' : '');
function usageBar(left) {
  const bar = document.createElement('span'); bar.className = barClass(left);
  const fill = document.createElement('i'); fill.style.width = `${left}%`; bar.appendChild(fill);
  return bar;
}
function fmtReset(sec) {
  const d = new Date(sec * 1000);
  const sameDay = d.toDateString() === new Date().toDateString();
  return d.toLocaleString('id-ID', sameDay ? { hour: '2-digit', minute: '2-digit' } : { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
function clUsageNote() {
  const st = cl.state || {};
  if (!st.installed) return 'Klik "Pasang" di bawah supaya Claude Code di laptop ini mengirim data sisa usage.';
  if (st.statusLine === 'other') return 'Status line Claude Code Anda dipakai skrip lain, jadi data usage tidak sampai ke sini. Klik "Pakai status line pulau" untuk menggantinya (yang lama disimpan dan dikembalikan saat hooks dilepas).';
  return 'Data dikirim status line Claude Code setiap kali Claude membalas di terminal atau VS Code (paket Pro/Max). Sesi cloud tidak mengirim data ini.';
}
function clRenderUsage() {
  const el = $('clUsage');
  el.textContent = '';
  if (cl.tab === 'chat') {
    const u = cl.chat && cl.chat.usage && cl.chat.usage.today;
    el.title = '';
    if (u && u.requests) el.textContent = `Chat hari ini: ${u.requests} pesan · ${fmtTokens(u.input + u.output)} token · ~$${u.cost.toFixed(u.cost < 1 ? 3 : 2)}`;
    return;
  }
  el.title = 'Sisa usage langganan Claude: klik untuk rincian';
  const lim = cl.state && cl.state.limits;
  const parts = USAGE_WINDOWS.map(([k, , short]) => [usageLeft(lim && lim[k]), short]).filter(([u]) => u);
  if (!parts.length) el.textContent = 'Sisa usage: —';
  else {
    el.append('Sisa ');
    parts.forEach(([u, short], n) => {
      if (n) el.append(' · ');
      el.append(`${short} `, usageBar(u.left), `${u.left}%`);
    });
  }
  if (!$('clUsageBox').hidden) clRenderUsageBox();
}
function clRenderUsageBox() {
  const lim = cl.state && cl.state.limits;
  const rows = $('clUsageRows');
  rows.textContent = '';
  for (const [k, label] of USAGE_WINDOWS) {
    const w = lim && lim[k];
    const u = usageLeft(w);
    if (!u) continue;
    const r = document.createElement('div'); r.className = 'ur';
    const pct = document.createElement('b'); pct.textContent = `${u.left}%`;
    const note = document.createElement('small');
    note.textContent = u.reset ? 'Sudah reset sejak data terakhir' : `Terpakai ${100 - u.left}%${w.resets_at ? ` · reset ${fmtReset(w.resets_at)}` : ''}`;
    r.append(`Sisa ${label}`, usageBar(u.left), pct, note);
    rows.appendChild(r);
  }
  $('clUsageAge').textContent = lim && lim.at ? `· data ${relTime(lim.at)}` : '· belum ada data';
  $('clUsageNote').textContent = clUsageNote();
  const st = cl.state || {};
  $('clUsageStatus').hidden = !(st.installed && st.statusLine === 'other');
}
$('clUsage').onclick = () => { if (cl.tab === 'chat') return; $('clUsageBox').hidden = false; clRenderUsageBox(); };
$('clUsageClose').onclick = () => { $('clUsageBox').hidden = true; };
$('clUsageStatus').onclick = async () => {
  const r = await api.claude.useStatusLine();
  $('clUsageNote').textContent = r && r.ok ? 'Status line pulau dipasang. Data muncul setelah Claude membalas berikutnya.' : (r && r.error) || 'Gagal memasang status line.';
  $('clUsageStatus').hidden = !!(r && r.ok);
};

function clRenderSessions() {
  const st = cl.state;
  const list = $('clList');
  list.textContent = '';
  const sessions = (st && st.sessions) || [];
  const active = sessions.filter((x) => x.status === 'working' || x.status === 'permission').length;
  $('clCount').textContent = active ? String(active) : '';
  let empty = '';
  if (!st) empty = 'Memuat…';
  else if (!st.listening) empty = `Port ${st.port} sedang dipakai aplikasi lain, jadi kabar dari Claude Code tidak bisa diterima.`;
  else if (!st.installed) empty = 'Klik "Pasang" agar sesi Claude Code di komputer ini muncul di sini, lengkap dengan kabar saat selesai atau butuh izin. Ini menambahkan hooks ke settings.json Claude Code (cadangan dibuat otomatis).';
  else if (!sessions.length) empty = 'Belum ada sesi Claude Code lokal dalam 24 jam terakhir. Sesi yang berjalan setelah pemasangan akan muncul di sini. Sesi cloud: klik "Cloud".';
  $('clEmpty').textContent = empty;
  for (const s of sessions) {
    const li = document.createElement('li');
    li.className = `cs ${s.status}` + (cl.open.has(s.id) ? ' open' : '');
    const dot = document.createElement('span'); dot.className = 'dot';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = s.project || 'Sesi';
    if (s.origin === 'cloud') { const b = document.createElement('span'); b.className = 'badge'; b.textContent = 'CLOUD'; nm.appendChild(b); }
    if (s.title) { const sm = document.createElement('small'); sm.textContent = s.title; nm.appendChild(sm); }
    const tm = document.createElement('span'); tm.className = 'tm';
    tm.textContent = [CL_STATUS[s.status] || s.status, s.context != null ? `ctx ${s.context}%` : '', relTime(s.updatedAt)].filter(Boolean).join(' · ');
    const dt = document.createElement('span'); dt.className = 'dt'; dt.textContent = s.detail || '';
    const more = document.createElement('div'); more.className = 'more';
    if (s.prompt) { const p = document.createElement('p'); p.textContent = `Perintah terakhir: ${s.prompt}`; more.appendChild(p); }
    if (s.status === 'done' && s.detail) { const p = document.createElement('p'); p.textContent = `Jawaban: ${s.detail}`; more.appendChild(p); }
    const meta = [s.model, s.cost != null ? `~$${Number(s.cost).toFixed(2)} sesi ini` : '', s.cwd].filter(Boolean).join(' · ');
    if (meta) { const p = document.createElement('p'); p.className = 'dim'; p.textContent = meta; more.appendChild(p); }
    const row = document.createElement('div'); row.className = 'row';
    if (s.cloudId) {
      const b1 = document.createElement('button'); b1.className = 'chip'; b1.textContent = 'Buka sesi ↗';
      b1.title = 'Buka di aplikasi Claude Desktop atau browser (pilih di menu tray)';
      b1.onclick = (e) => { e.stopPropagation(); api.claude.openCloudSession(s.cloudId); };
      const b2 = document.createElement('button'); b2.className = 'chip'; b2.textContent = 'Salin perintah teleport';
      b2.title = 'Lanjutkan sesi cloud ini di terminal laptop (dari folder repo yang sama)';
      b2.onclick = (e) => { e.stopPropagation(); api.claude.copy(`claude --teleport ${s.cloudId}`); b2.textContent = 'Tersalin'; setTimeout(() => { b2.textContent = 'Salin perintah teleport'; }, 1500); };
      row.append(b1, b2);
    } else if (s.cwd) {
      const b0 = document.createElement('button'); b0.className = 'chip'; b0.textContent = 'Buka sesi ↗';
      b0.title = 'Buka di aplikasi Claude Desktop. Sesi dari terminal disalin ke Desktop sebagai sesi baru; jangan dilanjutkan di dua tempat sekaligus.';
      b0.onclick = async (e) => {
        e.stopPropagation();
        const r = await api.claude.openLocalSession(s.id);
        if (r && r.ok) return;
        b0.textContent = r && r.why === 'desktop' ? 'Claude Desktop tidak terpasang' : 'Gagal membuka';
        setTimeout(() => { b0.textContent = 'Buka sesi ↗'; }, 2500);
      };
      const b1 = document.createElement('button'); b1.className = 'chip'; b1.textContent = 'Buka folder';
      b1.onclick = (e) => { e.stopPropagation(); api.claude.openFolder(s.cwd); };
      const b2 = document.createElement('button'); b2.className = 'chip'; b2.textContent = 'Salin perintah lanjut';
      b2.title = 'Salin perintah untuk melanjutkan sesi ini di terminal';
      b2.onclick = (e) => { e.stopPropagation(); api.claude.copy(`cd "${s.cwd}"; claude --resume ${s.id}`); b2.textContent = 'Tersalin'; setTimeout(() => { b2.textContent = 'Salin perintah lanjut'; }, 1500); };
      row.append(b0, b1, b2);
    }
    more.appendChild(row);
    li.append(dot, nm, tm, dt, more);
    li.onclick = () => { if (cl.open.has(s.id)) cl.open.delete(s.id); else cl.open.add(s.id); li.classList.toggle('open'); };
    list.appendChild(li);
  }
  if (st) {
    $('clHookInfo').textContent = st.installed
      ? `Terhubung · sesi lokal${st.statusLine === 'other' ? ' · status line dipakai skrip lain' : ''}`
      : 'Belum terpasang';
    $('clInstall').textContent = st.installed ? 'Lepas' : 'Pasang';
    $('clInstall').classList.toggle('on', !st.installed);
  }
  clRenderPill();
  clRenderUsage();
}
function clRenderPill() {
  const sessions = (cl.state && cl.state.sessions) || [];
  const perm = sessions.filter((x) => x.status === 'permission').length;
  const work = sessions.filter((x) => x.status === 'working').length;
  const el = $('pillClaude');
  let cls = '', text = '';
  if (perm) { cls = 'permission'; text = perm > 1 ? `${perm} izin` : 'izin'; }
  else if (work) { cls = 'working'; text = String(work); }
  else if (cl.flash && Date.now() < cl.flash.until) { cls = 'done'; text = '✓'; }
  el.className = cls ? `on ${cls}` : '';
  el.querySelector('span').textContent = text;
  el.title = perm ? 'Claude butuh izin' : work ? `${work} sesi Claude Code sedang bekerja` : cls ? 'Claude selesai' : '';
  claudeBusy = !!cls;
  $('pill').classList.toggle('busy', prayBusy || claudeBusy);
}

let clInstallArmed = 0;
$('clInstall').onclick = async () => {
  const st = cl.state;
  if (st && st.installed) {
    if (Date.now() - clInstallArmed > 3000) { clInstallArmed = Date.now(); $('clInstall').textContent = 'Yakin lepas?'; return; }
    clInstallArmed = 0;
    const r = await api.claude.uninstall();
    if (!r.ok) $('clEmpty').textContent = r.error || 'Gagal melepas.';
    return;
  }
  const r = await api.claude.install();
  if (!r.ok) { $('clEmpty').textContent = r.error || 'Gagal memasang.'; return; }
  if (r.note) $('clHookInfo').textContent = r.note;
  mood('happy', 1400);
};
$('clClear').onclick = () => api.claude.clear();
// Panel sesi cloud: alamat publik (Tailscale Funnel), token, dan isi hook untuk repo.
function clRenderCloud() {
  const c = (cl.state && cl.state.cloud) || {};
  if (document.activeElement !== $('clCloudUrl')) $('clCloudUrl').value = c.url || '';
  if (document.activeElement !== $('clCloudToken')) $('clCloudToken').value = c.token || '';
  $('clCloudStatus').textContent = c.last ? `· kabar terakhir ${relTime(c.last)}` : '· belum ada kabar';
}
$('clCloud').onclick = () => { $('clCloudBox').hidden = false; clRenderCloud(); };
$('clCloudClose').onclick = () => { $('clCloudBox').hidden = true; };
$('clCloudOpen').onclick = () => api.claude.openCloud();
async function clSaveCloud() {
  const c = (cl.state && cl.state.cloud) || {};
  const v = { url: $('clCloudUrl').value };
  if ($('clCloudToken').value.trim() !== (c.token || '')) v.token = $('clCloudToken').value;
  const r = await api.claude.setCloud(v);
  $('clCloudStatus').textContent = r.ok ? '· tersimpan' : `· ${r.error}`;
  return r.ok;
}
$('clCloudSave').onclick = clSaveCloud;
function clFlash(btn, text) { const old = btn.textContent; btn.textContent = text; setTimeout(() => { btn.textContent = old; }, 1500); }
$('clCloudFunnel').onclick = () => {
  const port = (cl.state && cl.state.port) || 47723;
  // Port 443 dengan jalur khusus: proxy jaringan sesi cloud hanya meneruskan port 443 (port lain diputus).
  api.claude.copy(`tailscale funnel --bg --set-path /dragon-island http://127.0.0.1:${port}`);
  clFlash($('clCloudFunnel'), 'Tersalin');
};
$('clCloudSnippet').onclick = async () => {
  if (!(await clSaveCloud())) return;
  api.claude.copy(await api.claude.cloudSnippet());
  clFlash($('clCloudSnippet'), 'Tersalin');
};

// ---- chat ----
let clAiEl = null;
function clAddMsg(cls, text) {
  const el = document.createElement('div');
  el.className = `msg ${cls}`;
  el.textContent = text;
  $('clLog').appendChild(el);
  $('clLog').scrollTop = $('clLog').scrollHeight;
  return el;
}
function clSetBusy(b) {
  cl.busy = b;
  $('clSend').textContent = b ? 'Stop' : 'Kirim';
  $('clSend').classList.toggle('stop', b);
}
function clShowKey(show) {
  $('clKeyBox').hidden = !show;
  if (!show) return;
  const c = cl.chat || {};
  $('clKey').value = '';
  $('clKeyInfo').textContent = c.fromEnv
    ? 'Kunci diambil dari variabel ANTHROPIC_API_KEY di komputer ini.'
    : c.hasKey
      ? 'Kunci sudah tersimpan' + (c.encryption ? ' (terenkripsi oleh Windows).' : ' di memori saja; akan hilang saat aplikasi ditutup.') + ' Isi untuk mengganti.'
      : 'Chat memakai Claude API (ditagih per pemakaian, terpisah dari langganan Claude). Buat kunci di platform.claude.com, menu API Keys.';
  setTimeout(() => $('clKey').focus(), 30);
}
async function clRefreshChat() { const st = await api.claude.status(); cl.chat = st.chat; clRenderUsage(); }
async function clSend() {
  if (cl.busy) { api.claude.stop(); return; }
  const text = $('clText').value.trim();
  if (!text) return;
  if (!cl.chat || !cl.chat.hasKey) { clShowKey(true); return; }
  $('clText').value = ''; clGrow();
  clAddMsg('me', text);
  clAiEl = clAddMsg('ai wait', '');
  clSetBusy(true);
  dragon.classList.add('curious');
  const r = await api.claude.ask(text, cl.model);
  clSetBusy(false);
  const el = clAiEl; clAiEl = null;
  el.classList.remove('wait');
  if (r.ok) {
    el.textContent = r.text || el.textContent;
    const meta = document.createElement('span'); meta.className = 'meta';
    const label = (cl.chat.models.find((m) => m.id === r.model) || {}).label || r.model || '';
    meta.textContent = [label, r.note].filter(Boolean).join(' · ');
    const cp = document.createElement('span'); cp.className = 'cp'; cp.textContent = 'salin';
    cp.onclick = () => { api.claude.copy(el.firstChild ? el.firstChild.textContent : ''); cp.textContent = 'tersalin'; };
    meta.appendChild(cp);
    el.appendChild(meta);
    if (r.usage) { cl.chat.usage = r.usage; clRenderUsage(); }
    mood('happy', 900);
  } else {
    if (!el.textContent) el.remove();
    clAddMsg('err', r.error || 'Gagal');
    if (/Kunci API ditolak|Belum ada kunci/.test(r.error || '')) clShowKey(true);
  }
  $('clLog').scrollTop = $('clLog').scrollHeight;
}
function clGrow() { const t = $('clText'); t.style.height = 'auto'; t.style.height = `${Math.min(72, t.scrollHeight)}px`; }
$('clText').addEventListener('input', clGrow);
$('clText').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); clSend(); }
  if (e.key === 'Escape') $('clText').blur();
});
$('clSend').onclick = clSend;
$('clNew').onclick = () => { if (api) api.claude.reset(); $('clLog').textContent = ''; clSetBusy(false); $('clText').focus(); };
$('clModel').onchange = () => { cl.model = $('clModel').value; save('clModel', cl.model); };
$('clKeyBtn').onclick = () => clShowKey(true);
$('clKeyCancel').onclick = () => clShowKey(false);
$('clKey').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('clKeySave').click(); if (e.key === 'Escape') clShowKey(false); });
$('clKeySave').onclick = async () => {
  const r = await api.claude.setKey($('clKey').value);
  if (!r.ok) { $('clKeyInfo').textContent = r.error; return; }
  $('clKey').value = '';
  await clRefreshChat();
  clShowKey(false);
  $('clText').focus();
};
$('clKeyDel').onclick = async () => { await api.claude.setKey(''); await clRefreshChat(); clShowKey(true); };

if (api && api.claude) {
  api.claude.onDelta((d) => {
    if (!clAiEl) return;
    clAiEl.textContent += d;
    $('clLog').scrollTop = $('clLog').scrollHeight;
  });
  api.claude.onState((st) => { cl.state = st; clRenderSessions(); if (!$('clCloudBox').hidden) clRenderCloud(); });
  api.claude.onAlert((a) => {
    const s = a.session || {};
    // Suara pilihan (menu tray > Suara notifikasi Claude); "windows" = bunyi notifikasi Windows saja.
    if (a.sound && a.sound !== 'windows' && a.sound !== 'diam') window.DragonSound.play(a.sound, a.kind);
    const who = s.project || 'Claude Code';
    if (a.kind === 'permission') {
      clSetTab('sessions');
      // Notifikasi Windows dikirim proses utama; di sini pulau terbuka di halaman Claude.
      alertUser(`${who}: Claude butuh izin`, s.detail || '', CLAUDE_PAGE, false, true);
    } else if (a.kind === 'done') {
      cl.flash = { until: Date.now() + 10000 };
      mood('happy', 1600); mood('hop', 900);
      amberEyes(true);
      setTimeout(clRenderPill, 10100);
    } else if (a.kind === 'error') {
      mood('sad', 1600);
    }
    clRenderPill();
  });
  api.claude.onPlaySound((kind) => window.DragonSound.play(kind, 'permission'));
  api.claude.onOpen(() => { setHidden(false); holdUntil = Date.now() + 8000; setExpanded(true); showPage(CLAUDE_PAGE); clSetTab('sessions'); });
  api.claude.reset(); // tampilan baru dimuat: mulai percakapan baru juga di proses utama
  api.claude.status().then((st) => {
    cl.chat = st.chat; cl.state = st.monitor;
    const sel = $('clModel');
    for (const m of (cl.chat && cl.chat.models) || []) sel.add(new Option(m.label, m.id));
    if ([...sel.options].some((o) => o.value === cl.model)) sel.value = cl.model; else cl.model = sel.value;
    clRenderSessions();
  });
}
clSetTab(cl.tab);
setInterval(() => { if (pageIdx === CLAUDE_PAGE && wrap.classList.contains('expanded') && !$('clSessions').hidden) clRenderSessions(); }, 20000);

// ---------- sholat ----------
const PRAYERS = [['subuh', 'Subuh'], ['dzuhur', 'Dzuhur'], ['ashar', 'Ashar'], ['maghrib', 'Maghrib'], ['isya', 'Isya']];
const pray = Object.assign({ city: 'Tasikmalaya', lat: -7.3274, lng: 108.2207, before: 10, adjust: 0, sound: true }, load('pray', {}));
let prayDay = '', prayTimes = null;
const fired = new Set();
function computePray() {
  const d = new Date();
  prayDay = today();
  prayTimes = window.Prayer.compute(d, pray.lat, pray.lng, -d.getTimezoneOffset() / 60, pray.adjust);
}
function nextPrayer(nowMin) {
  for (const [k, label] of PRAYERS) if (prayTimes[k] > nowMin) return { k, label, at: prayTimes[k], tomorrow: false };
  return { k: 'subuh', label: 'Subuh', at: prayTimes.subuh + 1440, tomorrow: true };
}
function tickPray() {
  if (prayDay !== today()) { computePray(); fired.clear(); }
  const d = new Date();
  const nowMin = d.getHours() * 60 + d.getMinutes();
  const nx = nextPrayer(nowMin);
  const left = nx.at - nowMin;
  $('prayNext').textContent = nx.label;
  $('prayNextTime').textContent = hhmm(nx.at);
  const dur = left >= 60 ? `${Math.floor(left / 60)} j ${left % 60} mnt` : `${left} mnt`;
  $('prayInfo').textContent = `${dur} lagi · ${pray.city}${nx.tomorrow ? ' · besok' : ''}`;
  $('pillExtra').textContent = left <= 30 ? `${nx.label} ${left}m` : '';
  prayBusy = left <= 30;
  $('pill').classList.toggle('busy', prayBusy || claudeBusy);
  const row = $('prayRow');
  row.textContent = '';
  for (const [k, label] of PRAYERS) {
    const el = document.createElement('div');
    el.className = 'pt' + (k === nx.k && !nx.tomorrow ? ' next' : prayTimes[k] <= nowMin ? ' past' : '');
    el.append(label);
    const b = document.createElement('b'); b.textContent = hhmm(prayTimes[k]); el.appendChild(b);
    row.appendChild(el);
  }
  // Pengingat: tepat saat masuk waktu, dan beberapa menit sebelumnya.
  for (const [k, label] of PRAYERS) {
    const t = prayTimes[k];
    if (nowMin === t && !fired.has(k + ':at')) {
      fired.add(k + ':at');
      alertUser(`Waktu ${label} telah masuk`, `${hhmm(t)} · ${pray.city} dan sekitarnya`, PRAY_PAGE, pray.sound);
    } else if (pray.before > 0 && nowMin === t - pray.before && !fired.has(k + ':pre')) {
      fired.add(k + ':pre');
      alertUser(`${pray.before} menit lagi ${label}`, `Masuk pukul ${hhmm(t)}`, PRAY_PAGE, pray.sound);
    }
  }
}
const citySel = $('pCity');
window.Prayer.CITIES.forEach(([name]) => citySel.add(new Option(name, name)));
citySel.add(new Option('Lainnya (isi koordinat)', '__custom'));
citySel.onchange = () => {
  const c = window.Prayer.CITIES.find(([n]) => n === citySel.value);
  if (c) { $('pLat').value = c[1]; $('pLng').value = c[2]; }
};
$('praySettingsBtn').onclick = () => {
  citySel.value = window.Prayer.CITIES.some(([n]) => n === pray.city) ? pray.city : '__custom';
  $('pLat').value = pray.lat; $('pLng').value = pray.lng;
  $('pBefore').value = pray.before; $('pAdjust').value = pray.adjust; $('pSound').checked = pray.sound;
  $('praySettings').hidden = false;
};
$('pSave').onclick = () => {
  const lat = parseFloat($('pLat').value), lng = parseFloat($('pLng').value);
  if (Number.isFinite(lat) && Math.abs(lat) <= 66) pray.lat = lat;
  if (Number.isFinite(lng) && Math.abs(lng) <= 180) pray.lng = lng;
  const c = window.Prayer.CITIES.find(([n]) => n === citySel.value);
  pray.city = c && c[1] === pray.lat && c[2] === pray.lng ? c[0] : `${pray.lat.toFixed(2)}, ${pray.lng.toFixed(2)}`;
  pray.before = Math.min(60, Math.max(0, parseInt($('pBefore').value, 10) || 0));
  pray.adjust = Math.min(10, Math.max(-10, parseInt($('pAdjust').value, 10) || 0));
  pray.sound = $('pSound').checked;
  save('pray', pray);
  $('praySettings').hidden = true;
  computePray(); fired.clear(); tickPray();
};

// ---------- pergantian hari ----------
function rollDay() {
  const d = today();
  if (todo.day !== d) { // tugas selesai dibuang, yang belum selesai dibawa ke hari ini
    todo.day = d; todo.items = todo.items.filter((t) => !t.done); saveTodo();
  }
}

// ---------- mulai ----------
computePray();
showPage(pageIdx);
rollDay(); tickClock(); initBattery();
renderMedia(null); renderShelf(); renderTodo(); tickPray();
if (api) (async () => {
  // Pertama kali: My Computer & Trash dipasang di depan shelf.
  if (!load('specialsAdded', false)) {
    const add = [];
    for (const sp of await api.shelfSpecials()) {
      if (shelf.some((x) => x.path === sp.path)) continue;
      const info = await api.shelfInfo(sp.path);
      if (info) add.push(info);
    }
    shelf = [...add, ...shelf];
    save('specialsAdded', true); save('shelf', shelf); renderShelf();
  }
  let changed = false;
  for (const item of shelf) {
    const info = await api.shelfInfo(item.path);
    if (info && info.icon && info.icon !== item.icon) { item.icon = info.icon; changed = true; }
  }
  if (changed) { save('shelf', shelf); renderShelf(); }
})();
blinkLoop(); twitchLoop(); tiltLoop();
setInterval(() => { tickClock(); tickPray(); rollDay(); }, 1000);
})();
