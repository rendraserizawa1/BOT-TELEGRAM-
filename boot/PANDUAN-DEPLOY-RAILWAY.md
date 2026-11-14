# Panduan Deploy ke Railway

Status kode: **SIAP**. Task 1–7 selesai, semua suite hijau.
Yang tersisa hanya langkah yang butuh akun Anda.

---

## 0. Prasyarat

- Akun Railway (genjiopenminded@gmail.com)
- Tailscale auth key (dibuat di admin Tailscale akun Anda)
- Repo GitHub berisi kode ini

---

## 1. Yang SUDAH selesai di kode

| Perubahan | File | Kenapa |
|---|---|---|
| Node 24 | `Dockerfile`, `package.json` | `node:sqlite` hanya ada di Node 22+. Di Node 20 seluruh DB mati senyap |
| Gagal keras bila `node:sqlite` hilang | `bot-db.js` | Dulu `return null` → riwayat/sesi/file hilang tanpa error |
| Path dari env + fallback | `bot-db.js`, `index.js` | Data harus di volume `/data`, tapi PC tidak boleh berubah |
| Deteksi volume tidak persisten | `boot/volume-check.js`, `/health` | Volume lupa dipasang = data hilang tiap redeploy |
| Tolak replika >1 | `boot/replika-guard.js` | Kunci file eksklusif di volume (`open 'wx'`); lock Windows lama tak jalan di Linux |
| Nota: fallback lokal + notif admin | `boot/nota-simpan.js`, `index.js` | Path UNC tidak ada di container |
| **Perbaikan path share nota** | `index.js` | Path lama menunjuk share yang TIDAK ADA (bug pra-ada) |
| Alasan eksplisit data tidak segar | `boot/status-jujur.js`, `/health` | Pengguna tidak boleh melihat angka basi tanpa sebab |
| `railway.json` | baru | 1 replika, healthcheck `/health`, restart ON_FAILURE |

---

## 2. Variabel yang WAJIB diisi di Railway

Ambil nilainya dari `.env` lokal. **Jangan** pernah menempelkan nilai ke repo.

```
BOT_TOKEN
ADMIN_ID
BOT_USERNAME
GITHUB_TOKEN
GITHUB_USERNAME
GITHUB_REPO
GITHUB_BRANCH
ENCRYPT_PASSWORD
DASHBOARD_USER
DASHBOARD_PASS
SESSION_SECRET
MAX_MEMBER
GEMINI_KEY
GEMINI_KEY2
GEMINI_KEY3
GROQ_API_KEY
OPENROUTER_API_KEY
IPOS_URL
IPOS_KEY
IPOS_TOKO
IPOS_SYNC_MS
IPOS_NK_URL
IPOS_NK_KEY
IPOS_NK_TOKO
IPOS_KEFA_URL      <-- diubah setelah proxy KEFA pindah (lihat PANDUAN-PROXY-KEFA.md)
IPOS_KEFA_KEY
IPOS_KEFA_TOKO
```

Variabel tambahan (sudah ada di Dockerfile, tidak perlu diisi ulang kecuali diubah):

```
DATA_DIR=/data
STORAGE_DIR=/data/storage
LOGS_DIR=/data/logs
HARGA_DIR=/data/harga_toko
EXPECT_VOLUME=1
```

**JANGAN isi `PORT`.** Railway menyuntiknya sendiri, dan kunci single-instance
mengunci pada nilai itu.

---

## 3. Langkah deploy

```bash
# 1. Install CLI
npm i -g @railway/cli

# 2. Login (buka browser, pakai akun genjiopenminded@gmail.com)
railway login

# 3. Buat project
railway init

# 4. Tambah volume -> WAJIB, mount ke /data
railway volume add --mount-path /data

# 5. Isi variables (satu per satu, atau lewat dashboard Railway)
railway variables --set "BOT_TOKEN=..."   # dst.

# 6. Deploy
railway up

# 7. Pantau log
railway logs
```

---

## 4. Verifikasi wajib

Jangan matikan bot lokal sebelum semua ini lulus.

| No | Uji | Cara | Lulus bila |
|---|---|---|---|
| 1 | Bot hidup | `curl https://<domain>/health` | `status:OK`, `polling:true`, `streak:0` |
| 2 | Volume persisten | lihat `volumeOk` + `volumeAlasan` | `true` |
| 3 | DB nyata | kirim pesan, cek `db.messages` | jumlahnya naik |
| 4 | Tombol inline | tap tombol di Telegram | `telegramCallbackCount` naik |
| 5 | CP realtime | `/health` | `ipos.cp.itemSegar:true` |
| 6 | NK realtime | `/health` | `ipos.nk.itemSegar:true` |
| 7 | KEFA realtime | `/health` | `ipos.kefa.itemSegar:true` |
| 8 | Redeploy aman | `railway redeploy`, cek `db.messages` | jumlah TIDAK turun |
| 9 | Data tidak basi | `node boot\verify-all.js` (arahkan ke domain) | 25/25 |
| 10 | Setelah 20:00 | uji malam | KEFA tetap `itemSegar:true` |

**Bukti `volumeOk` tidak bisa dipalsukan.** Nilainya `false` bila penanda
`.image-only` — yang dibuat saat BUILD image — masih terlihat di folder data.
Kalau volume benar-benar ter-mount, mount itu menutupi folder image sehingga
penandanya tidak terlihat. Entrypoint tidak pernah membuat penanda ini, jadi
"berhasil menulis ke /data" tidak bisa dipakai membohongi pemeriksaan.
Bila `RAILWAY_VOLUME_MOUNT_PATH` tersedia, nilainya juga dicocokkan.

---

## 5. Jebakan yang sudah diantisipasi

| Jebakan | Akibat | Sudah ditangani |
|---|---|---|
| Node 20 | DB mati senyap | Dockerfile Node 24 + gagal keras |
| Volume lupa | Data hilang tiap redeploy | `volumeOk` (penanda image) + notif admin |
| 2 replika | 409 Conflict, tombol mati | kunci file eksklusif di volume (`replika-guard.js`) |
| Path UNC di Linux | Nota hilang / "tersimpan" palsu | `bisaJadiShare()` tolak UNC di POSIX + fallback |
| SMB putus saat tulis | Nota 0 byte bernama benar | tulis atomik `.part` → rename |
| Nota jatuh ke fallback | Menumpuk, tak pernah dikirim | antrean + sapuan tiap 10 menit + `notaTertunda` |
| Lock `wmic`/`netstat` di Linux | Lock tak berfungsi | kunci file POSIX (`open 'wx'`) |
| Workflow GitHub Actions | Poller kedua | sudah `disabled_manually` |
| `PORT` diisi manual | Lock salah kunci | jangan diisi |

---

## 6. Rollback

Semua perubahan punya fallback ke nilai lama. Rollback:

1. `railway down` (atau hapus service)
2. Nyalakan bot lokal seperti biasa: `Start-ScheduledTask BCODE-KEFA-WATCHDOG`

Tidak ada perubahan skema DB, tidak ada migrasi yang merusak. Bot lokal dan
Railway memakai kode yang sama.
