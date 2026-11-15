# Pulau

Dynamic island pribadi untuk Windows: pil kecil di tepi atas layar, dengan naga hitam bermata hijau yang menggantung dan mengintip dari bawahnya. Arahkan kursor ke pil untuk membuka panel.

## Fitur

| Halaman | Isi |
|---|---|
| Media | Judul, sampul, posisi, dan tombol putar/jeda/berikutnya untuk media yang sedang diputar di Windows (Spotify, YouTube di browser, dll.) |
| Shelf | Ikon file dan aplikasi, jumlah tak terbatas; pulau memanjang mengikuti isinya. Bawaan: My Computer dan Trash. Mode **Edit** untuk menghapus dan mengubah urutan |
| Todo List | Tugas harian; yang belum selesai terbawa ke hari berikutnya |
| Jadwal Sholat | Lima waktu sholat (kriteria Kemenag) dan pengingat sebelum serta saat masuk waktu |
| Notes | Catatan cepat; tempel, salin, dan simpan ke `Documents\Pulau Notes` sebagai `.txt` |

Lainnya:

- **Pil:** tanggal, jam, indikator musik, dan hitung mundur sholat (≤30 menit).
- **Mode menyingkir:** saat ada jendela terbuka penuh, pulau naik bersembunyi ketika kursor mendekat; dorong kursor ke tepi atas layar untuk memanggilnya.
- **Naga:** mata mengikuti kursor, berkedip, dan berekspresi (senang, sedih, curiga, mengantuk, tidur).
- **Tray:** tampilkan/sembunyikan (Ctrl+Alt+I), jalankan saat Windows menyala, ukuran, mode menyingkir, shortcut Desktop, dan file log.

## Menjalankan

Untuk pengguna: buat zip Windows (lihat di bawah), ekstrak, lalu jalankan `Pulau.exe`.

Jangan jalankan sebagai administrator. Windows memblokir seret file dari Explorer ke aplikasi yang berjalan sebagai admin.

Untuk pengembangan:

```bash
npm install
```

```bash
npm start
```

Fitur media, deteksi jendela penuh, ikon aplikasi Store, serta My Computer/Trash memakai PowerShell dan hanya berjalan di Windows.

## Membuat zip Windows

```bash
npm run build:win
```

Hasilnya `dist/Pulau-v<versi>-win-x64.zip`. Skrip mengunduh Electron untuk Windows, menanam logo ke `Pulau.exe`, dan menyalin kode aplikasi ke `resources/app`. Bisa dijalankan dari Linux, macOS, atau Git Bash; butuh `node`, `curl`, `unzip`, dan `zip`.

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

Data pengguna (todo, shelf, catatan, pengaturan) dan `pulau.log` tersimpan di `%APPDATA%\Pulau`.
