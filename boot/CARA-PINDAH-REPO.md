# Cara Memindahkan Repo ke Akun genjiopenminded@gmail.com

Repo saat ini: `rendraserizawa1/BOT-TELEGRAM-` (privat).
Tujuan: pindah penuh ke akun `genjiopenminded@gmail.com`, repo lama diarsipkan.

Saya **tidak bisa** login ke akun Anda (tidak ada akses browser/email).
Langkah di bawah butuh Anda. Saya hanya bisa menyiapkan dan memverifikasi.

---

## 1. Buat repo baru (di akun genjiopenminded)

1. Login GitHub sebagai `genjiopenminded@gmail.com`.
2. New repository → nama `BOT-TELEGRAM-` → **Private**.
3. Jangan centang "Initialize with README" (biar tidak ada commit bentrok).

## 2. Buat Personal Access Token

Settings → Developer settings → Personal access tokens → Tokens (classic)
→ Generate new token:
- Scope: `repo` (full)
- Expiration: sesuai kebijakan Anda (disarankan 90 hari, catat tanggalnya)

Simpan token itu. **Jangan** kirim ke chat, jangan tempel ke file repo.

## 3. Ganti remote dan push

Di PC ini, jalankan sendiri (bukan lewat saya, agar token tidak masuk log):

```powershell
cd C:\BOT-TELEGRAM-
git remote set-url origin https://github.com/genjiopenminded/BOT-TELEGRAM-.git
git push -u origin main
```

Saat diminta kredensial, masukkan username `genjiopenminded` dan token di atas.

## 4. Verifikasi

```powershell
git ls-remote --heads origin
```

Harus menunjuk commit yang sama dengan `git rev-parse HEAD`.

## 5. Arsipkan repo lama (jangan hapus dulu)

Biarkan `rendraserizawa1/BOT-TELEGRAM-` ada sampai Railway terbukti stabil
minimal 1 minggu. Setelah itu baru:
- Settings → Archive this repository, atau
- hapus permanen bila Anda yakin.

## 6. Repo data `BOT-TELEGRAM-DATA`

Repo ini berisi `harga_toko/*.xlsx` yang diunduh `docker-entrypoint.sh`.
Keputusan yang perlu Anda ambil:

**Opsi A — tetap di rendraserizawa1**
Tidak ada perubahan. `GITHUB_USERNAME`/`GITHUB_REPO` tetap seperti sekarang.

**Opsi B — pindah juga ke genjiopenminded**
1. Buat repo `BOT-TELEGRAM-DATA` (Private) di akun baru.
2. Salin isi branch `data-storage` (5 file `harga_toko/*.xlsx`).
3. Ubah di Railway: `GITHUB_USERNAME=genjiopenminded`, `GITHUB_TOKEN=<token akun baru>`.

Tanpa salah satu opsi ini, `harga_toko` kosong dan fitur harga Excel tidak jalan.

---

## Catatan keamanan

- Token lama di `.env` (`GITHUB_TOKEN`) hanya punya akses ke repo
  `rendraserizawa1`. Setelah pindah, token itu **tidak** bisa push ke repo baru.
- Jangan pernah `git add .env`. `.gitignore` sudah menolaknya, dan `.dockerignore`
  juga, tetapi tetap periksa `git status` sebelum commit.
- `data/` berisi `bot.db` (riwayat chat, sesi, kredensial) dan
  `data/secure/env.backup` (salinan `.env`). Keduanya sudah di-ignore.
