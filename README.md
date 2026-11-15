# Dragon Dynamic Island

Dynamic island pribadi untuk Windows: pil kecil di tepi atas layar, dengan naga hitam bermata hijau yang menggantung dan mengintip dari bawahnya. Arahkan kursor ke pil untuk membuka panel.

## Fitur

| Halaman | Isi |
|---|---|
| Media | Judul, sampul, posisi, dan tombol putar/jeda/berikutnya untuk media yang sedang diputar di Windows (Spotify, YouTube di browser, dll.) |
| Shelf | Ikon file dan aplikasi, jumlah tak terbatas; pulau memanjang mengikuti isinya. Bawaan: My Computer dan Trash. Mode **Edit** untuk menghapus dan mengubah urutan |
| Todo List | Tugas harian; yang belum selesai terbawa ke hari berikutnya |
| Jadwal Sholat | Lima waktu sholat (kriteria Kemenag) dan pengingat sebelum serta saat masuk waktu |
| Notes | Catatan cepat; tempel, salin, dan simpan ke `Documents\Dragon Dynamic Island Notes` sebagai `.txt` |
| Claude | **Sesi Claude Code** di komputer ini dalam 24 jam terakhir (bekerja / butuh izin / selesai), notifikasi saat selesai atau butuh izin, batas pemakaian 5 jam & 7 hari; **chat cepat** lewat Claude API |

Lainnya:

- **Pil:** tanggal, jam, indikator musik, dan hitung mundur sholat (≤30 menit).
- **Mode menyingkir:** saat ada jendela terbuka penuh, pulau naik bersembunyi ketika kursor mendekat; dorong kursor ke tepi atas layar untuk memanggilnya.
- **Naga:** mata mengikuti kursor, berkedip, dan berekspresi (senang, sedih, curiga, mengantuk, tidur).
- **Tray:** tampilkan/sembunyikan (Ctrl+Alt+I), jalankan saat Windows menyala, ukuran, mode menyingkir, shortcut Desktop, dan file log.

## Fitur Claude

### Sesi Claude Code

Klik **Pasang** di halaman Claude. Dragon Dynamic Island menambahkan hooks bertipe `http` ke `~/.claude/settings.json` (cadangan `settings.json.cadangan-dragon-*` dibuat lebih dulu; hook dan pengaturan Anda yang lain tidak diubah). Claude Code lalu mengirim kabar ke server lokal `127.0.0.1:47723` setiap kali sesi mulai bekerja, memakai alat, meminta izin, selesai, gagal, atau ditutup.

- **Butuh izin:** pulau terbuka sendiri di halaman Claude, naga melompat, dan muncul notifikasi Windows.
- **Selesai:** notifikasi Windows, tanda ✓ di pil, naga senang.
- **Pil:** jumlah sesi yang sedang bekerja (oranye) atau "izin" (berkedip) bila ada yang menunggu.
- Klik sebuah sesi untuk melihat perintah terakhir, membuka foldernya, atau menyalin perintah `claude --resume` untuk melanjutkannya.

Batasan:

- Hanya sesi **lokal** (terminal, aplikasi desktop Claude, VS Code). Sesi cloud di claude.ai/code tidak membaca pengaturan di komputer Anda dan tidak punya API untuk dibaca dari luar, jadi tidak terpantau. Tombol **Sesi cloud ↗** membuka daftarnya di claude.ai/code; aplikasi Claude di HP dan aplikasi desktop Claude juga menampilkannya.
- Sesi yang sudah berjalan sebelum pemasangan baru muncul setelah ada kabar berikutnya.
- Bila Dragon Dynamic Island sedang tidak berjalan, hook gagal tersambung. Claude Code tetap bekerja normal, tetapi bisa menampilkan catatan "hook error". Klik **Lepas** untuk mencabut hooks.
- File transkrip Claude Code tidak dibaca, karena formatnya internal dan bisa berubah tiap versi.

### Sesi cloud (claude.ai/code)

Sesi cloud berjalan di server Anthropic dan tidak membaca pengaturan di laptop. Agar kabarnya sampai ke pulau, laptop dibuka lewat Tailscale Funnel, dan environment cloud memasang hook di setiap mesin sesi lewat *setup script*. Pemasangannya sekali per environment; berlaku untuk semua sesi di environment itu, dengan repo apa pun maupun tanpa repo.

1. **Tailscale Funnel di laptop:** halaman Claude → **Cloud** → **Salin perintah Tailscale**, lalu jalankan: `tailscale funnel --bg --set-path /dragon-island http://127.0.0.1:47723`. Hanya port 443 yang bisa dipakai, karena proxy jaringan sesi cloud memutus port lain (teruji 15 Nov 2026: 8443 dan 10000 gagal).
2. **Alamat publik:** isi `https://nama-laptop.tailnet.ts.net` di panel Cloud, lalu **Simpan**.
3. **Token:** di claude.ai/code, buka pengaturan environment, lalu tambahkan variabel `DRAGON_ISLAND_TOKEN` berisi **Token cloud** dari panel. Alamat Funnel harus bisa dijangkau dari environment itu (daftar host yang diizinkan atau network secret untuk host tersebut).
4. **Setup script environment:** isi dengan [`scripts/cloud-setup-script.sh`](scripts/cloud-setup-script.sh), setelah alamatnya diganti dengan alamat Funnel Anda. Skrip ini menulis hook ke `~/.claude/settings.json` di mesin cloud (teruji: Claude Code di sesi cloud membaca berkas itu), tidak menimpa pengaturan lain, dan tidak berisi token.

Sesi cloud tampil berlabel **CLOUD**, dengan tombol **Buka di claude.ai** dan **Salin perintah teleport**. Butuh izin dan selesai memberi notifikasi yang sama seperti sesi lokal.

Catatan:

- **Hanya sesi baru:** setup script dan variabel environment hanya berlaku untuk sesi yang mesinnya dibuat setelah pemasangan. Sesi lama baru ikut setelah mesinnya dibuat ulang.
- **Laptop harus menyala:** kabar hanya sampai saat laptop menyala dan Dragon Dynamic Island berjalan. Bila tidak, Claude Code tetap bekerja normal tetapi bisa menampilkan catatan "hook error".
- **Keamanan:** Funnel hanya membuka jalur penerima kabar ini, dan setiap kabar wajib membawa token. Yang bisa dilakukan pemilik token hanyalah mengirim kabar palsu ke pulau; server tidak menjalankan perintah apa pun. Ganti token di panel (dan di variabel environment) bila bocor.
- **Tidak resmi:** dua hal di luar dokumentasi Claude Code. ID sesi cloud diambil dari variabel `CLAUDE_CODE_REMOTE_SESSION_ID`, dan setup script bergantung pada sesi cloud yang membaca `~/.claude/settings.json` di mesinnya. Keduanya teruji, tetapi bisa berubah di versi mendatang.
- **Alternatif per repo:** tombol **Salin hook repo** di panel Cloud menyalin isi `.claude/settings.json` untuk di-commit ke satu repo, bila environment tidak bisa diberi setup script.

### Batas pemakaian

Persentase batas 5 jam dan 7 hari diambil dari *status line* Claude Code (skrip `statusline.ps1`, dipasang bersama hooks). Status line itu juga menampilkan model, konteks, dan persentase batas di Claude Code sendiri. Batasannya:

- Data ini hanya ada untuk pelanggan Pro/Max dan diperbarui saat ada sesi yang berjalan.
- Bila Anda sudah memakai status line lain, status line Anda tidak ditimpa dan persentase batas tidak ditampilkan.

### Chat cepat

Tab **Chat** memakai Claude API dengan model Claude Opus 5.5 (bisa diganti Sonnet 5.5 atau Haiku 5.5), effort rendah supaya cepat, dan jawaban mengalir bertahap.

- **Kunci API:** dibutuhkan, dibuat di platform.claude.com. Pemakaian API ditagih terpisah dari langganan Claude.
- **Penyimpanan kunci:** terenkripsi oleh Windows di `%APPDATA%\Dragon Dynamic Island\claude-key.bin` dan tidak pernah dikirim ke tampilan.
- **Fallback otomatis:** untuk Opus dan Sonnet, bila model menolak permintaan karena pengaman, API mengulang di model cadangan yang sesuai.
- **Biaya:** token dan perkiraan biaya hari ini tampil di atas chat.

## Menjalankan

Untuk pengguna: buat zip Windows (lihat di bawah), ekstrak, lalu jalankan `Dragon Dynamic Island.exe`.

Versi sebelum 3.2 bernama **Pulau**. Saat pertama dijalankan, data dari `%APPDATA%\Pulau` (todo, shelf, catatan, pengaturan) disalin otomatis. Shortcut Desktop lama diganti yang baru; centang "Jalankan saat Windows menyala" perlu dinyalakan ulang dari tray.

Jangan jalankan sebagai administrator. Windows memblokir seret file dari Explorer ke aplikasi yang berjalan sebagai admin.

Untuk pengembangan:

```bash
npm install
```

```bash
npm start
```

Fitur media, deteksi jendela penuh, ikon aplikasi Store, serta My Computer/Trash memakai PowerShell dan hanya berjalan di Windows.

## Tes

```bash
npm test
```

Tes menjalankan aplikasi sungguhan (Electron, lewat Playwright) dan memeriksa pil dan panel, navigasi, media, shelf (lebar, mode Edit, urutan, ikon bawaan, pemilih aplikasi), seret file, mode menyingkir, naga, notes, waktu dan pengingat sholat, pemindahan data dari nama lama "Pulau", serta fitur Claude (hooks, status line, dan chat terhadap server Claude API tiruan). Butuh sekitar 2 menit; tes pengingat sholat menunggu sampai pergantian menit berikutnya.

Tes memakai folder data sementara sendiri, jadi todo, shelf, catatan, dan pengaturan Anda tidak tersentuh. Di Linux tanpa layar, jalankan lewat `xvfb-run`:

```bash
xvfb-run -a npm test
```

Bagian yang memakai PowerShell (media dari Windows, deteksi jendela penuh, ikon aplikasi Store dan My Computer/Trash) tidak bisa diuji otomatis di luar Windows; tes memakai data tiruan untuk tampilannya.

## Membuat zip Windows

```bash
npm run build:win
```

Hasilnya `dist/Dragon-Dynamic-Island-v<versi>-win-x64.zip`. Skrip mengunduh Electron untuk Windows, menanam logo dan nama ke `Dragon Dynamic Island.exe`, dan menyalin kode aplikasi ke `resources/app`. Bisa dijalankan dari Linux, macOS, atau Git Bash; butuh `node`, `curl`, `unzip`, dan `zip`.

## Struktur

| File | Fungsi |
|---|---|
| `main.js` | Proses utama: jendela, tray, kursor, seret file, ikon, notes, log |
| `preload.js` | Jembatan aman antara proses utama dan tampilan |
| `renderer/` | Tampilan pulau, naga, dan semua halaman |
| `renderer/prayer.js` | Perhitungan waktu sholat (tanpa internet) |
| `catcher.*` | Jendela penangkap seret file (jendela transparan tidak menerima seretan dari Windows) |
| `media.ps1` | Membaca dan mengendalikan media Windows, termasuk sampul |
| `winwatch.ps1` | Mendeteksi jendela terbuka penuh dan tombol mouse |
| `iconhelper.ps1` | Ikon aplikasi Store dan folder khusus Windows lewat shell |
| `claude-chat.js` | Chat cepat lewat Claude API (SDK `@anthropic-ai/sdk`), kunci terenkripsi, usage |
| `claude-monitor.js` | Server lokal penerima hooks & status line Claude Code, status sesi, pasang/lepas hooks |
| `statusline.ps1` | Status line Claude Code: meneruskan data sesi ke aplikasi dan mencetak baris status |
| `scripts/` | Pembuatan zip Windows dan penanaman ikon ke `.exe` |
| `tests/` | Tes otomatis (`npm test`); `helpers.js` menjalankan aplikasi dengan folder data sementara |

Data pengguna (todo, shelf, catatan, pengaturan) dan `dragon-island.log` tersimpan di `%APPDATA%\Dragon Dynamic Island`.
