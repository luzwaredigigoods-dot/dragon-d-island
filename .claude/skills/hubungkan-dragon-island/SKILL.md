---
name: hubungkan-dragon-island
description: Menghubungkan sesi Claude Code cloud (claude.ai/code) ke aplikasi Dragon Dynamic Island di laptop pengguna supaya sesi itu tampil di pulau (bekerja, butuh izin, selesai) lewat hook curl ke Tailscale Funnel. Pakai saat pengguna minta "hubungkan ke island/pulau", "agar sesi cloud tampil di pulau", "pasang hook dragon island", atau sesi cloud tidak muncul di pulau.
---

# Hubungkan sesi cloud ke Dragon Dynamic Island

Sesi cloud berjalan di server Anthropic, jadi pulau di laptop hanya tahu lewat sinyal yang dikirim sesi itu.
Skill ini memasang hook di `~/.claude/settings.json` sesi ini; tiap kejadian (mulai, izin, selesai, dll.)
dikirim dengan `curl` ke alamat Tailscale Funnel laptop. Pakai `curl`, bukan hook bertipe `http`: di VM
cloud, hook `http` tidak lewat proxy jaringan dan memunculkan "hook error".

## Langkah

1. **Periksa token.** Jalankan `[ -n "$DRAGON_ISLAND_TOKEN" ] && echo ada || echo tidak-ada` (jangan cetak nilainya).
2. **Ada** → jalankan, dari folder skill ini:
   `python3 scripts/pasang_hook.py`
   Tidak ada rahasia yang ditulis ke berkas; hook membaca variabel saat berjalan.
3. **Tidak ada** (sesi lama atau environment belum diberi variabel) → minta pengguna menempelkan **Token cloud**
   dari pulau (halaman Claude → tombol Cloud). Jelaskan singkat bahwa tokennya akan tertulis di settings sesi ini
   dan terlihat di riwayat percakapan; token ini hanya bisa mengirim kabar sesi, tidak bisa membaca apa pun dari
   laptop. Lalu jalankan: `python3 scripts/pasang_hook.py --token <TOKEN>`.
   Jangan menyalin token ke berkas lain, commit, atau pesan balasan.
4. **Alamat Funnel lain?** Tambahkan `--url https://nama-laptop.tailnet.ts.net` (atau set `DRAGON_ISLAND_URL`).
5. **Laporkan** hasil pemeriksaan koneksi dari skrip, apa adanya:
   - `ok` → beri tahu pengguna: kirim satu pesan lagi, sesi akan muncul di pulau.
   - `token` → token salah; minta salin ulang dari panel Cloud.
   - `jaringan` → pulau belum berjalan atau Funnel mati; beri perintah
     `tailscale funnel --bg --set-path /dragon-island 47723`.
   - `tanpa-token` → koneksi belum bisa diperiksa (ulangi dengan `--token`).
6. Hanya periksa koneksi, tanpa mengubah apa pun: `python3 scripts/pasang_hook.py --cek`.

## Catatan

- Skrip aman dijalankan ulang (hook milik Dragon Dynamic Island diganti, hook lain tetap).
- Hook baru aktif untuk pesan berikutnya, bukan pesan yang sedang berjalan.
- Untuk semua sesi baru sekaligus, pasang `scripts/cloud-setup-script.sh` (repo dragon-d-island) sebagai
  Setup script environment dan beri environment variabel `DRAGON_ISLAND_TOKEN`; skill ini untuk sesi yang
  sudah berjalan atau saat sesi tidak muncul.
- Jangan pernah menulis token ke repo atau mengirimnya ke layanan selain alamat Funnel pengguna.
