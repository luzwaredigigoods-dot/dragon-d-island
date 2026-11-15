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

Lainnya:

- **Pil:** tanggal, jam, indikator musik, dan hitung mundur sholat (≤30 menit).
- **Mode menyingkir:** saat ada jendela terbuka penuh, pulau naik bersembunyi ketika kursor mendekat; dorong kursor ke tepi atas layar untuk memanggilnya.
- **Naga:** mata mengikuti kursor, berkedip, dan berekspresi (senang, sedih, curiga, mengantuk, tidur).
- **Tray:** tampilkan/sembunyikan (Ctrl+Alt+I), jalankan saat Windows menyala, ukuran, mode menyingkir, shortcut Desktop, dan file log.

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

36 tes menjalankan aplikasi sungguhan (Electron, lewat Playwright) dan memeriksa pil dan panel, navigasi, media, shelf (lebar, mode Edit, urutan, ikon bawaan, pemilih aplikasi), seret file, mode menyingkir, naga, notes, waktu dan pengingat sholat, serta pemindahan data dari nama lama "Pulau". Butuh sekitar 2 menit; tes pengingat sholat menunggu sampai pergantian menit berikutnya.

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
| `scripts/` | Pembuatan zip Windows dan penanaman ikon ke `.exe` |
| `tests/` | Tes otomatis (`npm test`); `helpers.js` menjalankan aplikasi dengan folder data sementara |

Data pengguna (todo, shelf, catatan, pengaturan) dan `dragon-island.log` tersimpan di `%APPDATA%\Dragon Dynamic Island`.
