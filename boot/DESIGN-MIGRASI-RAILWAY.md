# Desain Migrasi BOT-TELEGRAM ke Railway

Status: **DRAF — menunggu persetujuan**
Tanggal: 2026-11-14
Tujuan: bot Telegram hidup 24/7 di Railway, semua fitur yang berlaku sekarang ikut pindah.

---

## 1. Ringkasan

Migrasi **bisa dilakukan**, tapi bukan "upload lalu jalan". Ada 5 penghalang nyata
yang sudah saya buktikan dengan pengukuran, bukan asumsi. Dokumen ini menjelaskan
penghalang itu, cara mengatasinya, dan urutan kerjanya.

Kesimpulan utama:

- Bot Telegram + dashboard + AI + backup + database **bisa** hidup 24/7 di Railway.
- Data iPos CP & NK **bisa** realtime 24/7 (keduanya di Tailscale, selalu nyala).
- Data iPos KEFA **hanya** bisa 24/7 kalau proxy-nya dipindah ke server toko
  `192.168.1.199` (Opsi D — sudah Anda pilih).
- Simpan nota ke share SMB perlu fallback (sudah Anda pilih).

---

## 2. Arsitektur Sekarang (bukti terukur)

### 2.1 Tiga sumber data iPos, tiga perilaku berbeda

| Toko | URL sekarang | Lokasi sebenarnya | Selalu nyala? |
|---|---|---|---|
| CP | `http://100.125.99.99:8080/ipos` | Tailscale CGNAT `100.64.0.0/10` | Ya (perangkat toko) |
| NK | `http://100.110.152.33:8080/ipos` | Tailscale CGNAT | Ya (perangkat toko) |
| KEFA | `http://127.0.0.1:8080/ipos` | proses `node server.js` di PC ini (pid 832) | **Tidak — PC mati jam 20:00** |

Bukti route table (dari PC ini):

```
100.125.99.99    255.255.255.255   On-link   100.123.166.13    5
100.110.152.33   255.255.255.255   On-link   100.123.166.13    5
```

Interface `Tailscale` = `100.123.166.13`. Artinya CP & NK hanya terjangkau lewat
tailnet. Railway tidak punya jalur ke sana tanpa ikut tailnet.

### 2.2 iPos KEFA ternyata cuma proxy PostgreSQL

`C:\Users\rdpadmin\ipos-api\server.js` = 679 baris, baris 35:

```js
const pool = new pg.Pool({ ... database: PGDATABASE, max: 4, ... });
```

Dokumentasi `DATABASE-KEFA2025.md`:

> Server `SRV` = `192.168.1.199`, port `5444`, PostgreSQL 9.5.3
> Database produksi `i5_KEFA2025` (238 MB), skema sama seperti NK/CP

Dan route table PC ini:

```
192.168.1.0  255.255.255.0  On-link  192.168.1.197  (Ethernet, LAN toko)
```

**`192.168.1.0/24` TIDAK diiklankan ke tailnet** — hanya On-link di LAN toko.
Ini penting: proxy KEFA tidak bisa sekadar dipindah ke Railway, karena Railway
tidak bisa menjangkau PostgreSQL-nya.

### 2.3 Konsekuensi jam 20:00 (kondisi sekarang)

Kalau PC dimatikan: iPos KEFA mati. Fitur KEFA (harga, stok, kasir, marketplace,
merek) ikut mati. Fitur CP & NK tidak terpengaruh.

### 2.4 Ketergantungan filesystem

Bot menulis ke disk lokal. Di container tanpa volume, semua ini **hilang setiap
redeploy**:

| Path | Isi | Ukuran sekarang |
|---|---|---|
| `data/` | `bot.db` + WAL (riwayat chat, sesi, file, kredensial), `data/backups/`, `data/secure/env.backup`, `data/files/` | 51,14 MB / 126 file |
| `storage/` | sesi.json, disapa.json, pending.json, stockopname.json, berita_acara.json, so_shared.json, role_laporan.json, backup_laporan.json, backup_harga.json, polling_offset.json, temp_*.xlsx | 10,28 MB / 149 file |
| `logs/` | error.log, service-out.log | 0,49 MB / 99 file |
| `harga_toko/` | 5 file Excel harga (cp, kefa, nk, oesapa, tdm) | 3,42 MB / 5 file |
| `backup/` | snapshot manual | 27,06 MB / 69 file |

Path lengkap di `index.js:92–114` dan `bot-db.js:21–24`.

### 2.5 Ketergantungan Windows

| Lokasi | Isi | Perilaku di Linux |
|---|---|---|
| `index.js:123–124` | Path UNC `\\100.125.99.99\...` untuk simpan nota | Gagal — bukan path POSIX |
| `bot-instance-lock.js:67` | `wmic process ...` untuk identitas proses | `wmic` tidak ada → `infoProses()` → `null` |
| `bot-instance-lock.js:86` | `netstat -ano -p TCP` | sintaks beda → gagal → `null` |

Efek `null` pada lock: `pemilikLockSah()` mengembalikan `null` = "tidak bisa
dipastikan", dan aturan desainnya adalah **jangan pernah memblokir diri sendiri**.
Jadi di Linux lock selalu bisa diambil. Aman **hanya jika** replika = 1.
Kalau Railway di-scale >1, akan terjadi poller ganda → `409 Conflict`.
**Wajib: 1 replika.**

### 2.6 Versi Node — bug senyap paling berbahaya

| Sumber | Versi |
|---|---|
| `Dockerfile` | `node:20-slim` |
| `package.json` `engines` | `20.x` |
| Node di PC ini | `v24.22.0` |

`bot-db.js:16` memakai `require('node:sqlite')` — hanya ada di Node 22+.
`bot-db.js:56`:

```js
if (!DatabaseSync) return null;
```

Artinya di Node 20 **semua fungsi DB mengembalikan `null` tanpa error**.
Seluruh riwayat chat, sesi, file, log proses, backup DB, dan metadata kredensial
**hilang diam-diam**. Tidak ada pesan error, tidak ada crash. Ini tidak pernah
terlihat di PC ini karena lokal sudah Node 24.

**Wajib: Node 24 di image.**

### 2.7 Port

| Lokasi | Nilai |
|---|---|
| `bot-instance-lock.js:39` | `PORT_DEFAULT = Number(process.env.PORT \|\| 3001)` |
| `index.js:120` | `webPort: process.env.PORT \|\| 3000` |
| `index.js:14845` | `PORT = process.env.PORT \|\| CONFIG.webPort \|\| 3000` |

Semua konsisten memakai `process.env.PORT` lebih dulu. Railway menyuntik `PORT`
otomatis → tidak perlu perubahan kode. Tapi kunci single-instance mengunci pada
port itu, jadi **jangan** set `PORT` manual.

### 2.8 Aset yang sudah siap (kabar baik)

- `Dockerfile`, `Procfile`, `docker-entrypoint.sh` sudah ada di repo.
- `docker-entrypoint.sh` sudah mengunduh 5 `harga_toko/*.xlsx` dari
  `rendraserizawa1/BOT-TELEGRAM-DATA@data-storage` — **terverifikasi ada**:
  `cp.xlsx, kefa.xlsx, nk.xlsx, oesapa.xlsx, tdm.xlsx`.
- `index.js` memakai `__dirname` (25 tempat) → path relatif aman di container.
- `bot-db.js` memakai `path.join(__dirname, 'data')` → bisa diarahkan ke volume.

---

## 3. Arsitektur Tujuan

```
                        ┌──────────────────────────────┐
                        │   Railway (1 replika)        │
                        │                              │
                        │  node:24-slim                │
                        │  ├─ index.js (bot + dash)    │
                        │  ├─ tailscaled (userspace)   │
                        │  └─ /data  ← Railway Volume  │
                        │       ├─ data/  (bot.db)     │
                        │       ├─ storage/            │
                        │       ├─ logs/               │
                        │       └─ harga_toko/         │
                        └───────────┬──────────────────┘
                                    │ tailnet (100.x)
                    ┌───────────────┼───────────────┐
                    │               │               │
              ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼──────────┐
              │ iPos CP   │   │ iPos NK   │   │ iPos KEFA      │
              │100.125.    │   │100.110.   │   │ proxy DIPINDAH │
              │99.99:8080  │   │152.33:8080│   │ ke 192.168.1.  │
              └───────────┘   └───────────┘   │ 199 (server    │
                                              │ toko, 24/7)    │
                                              └───────┬────────┘
                                                      │ LAN
                                              ┌───────▼────────┐
                                              │ PostgreSQL     │
                                              │ 192.168.1.199  │
                                              │ :5444          │
                                              └────────────────┘
```

Prinsip: **tidak ada logika bisnis yang diubah.** Yang berubah hanya lokasi
proses dan cara menjangkau jaringan.

---

## 4. Cara Mengatasi Tiap Penghalang

### 4.1 Tailscale di dalam container

Tailscale punya mode userspace yang tidak butuh `/dev/net/tun` atau
`NET_ADMIN` — cocok untuk Railway. Pola umum:

- `tailscaled --tun=userspace-networking --socks5-server=localhost:1055`
- `tailscale up --authkey=$TS_AUTHKEY --hostname=bcode-railway`
- Aplikasi memakai proxy SOCKS5 untuk keluar ke tailnet, **atau** memakai
  `tailscale serve`/`http` bila perlu masuk.

Yang perlu diputuskan nanti (lihat §12): apakah Node diarahkan lewat SOCKS5
(perlu penyesuaian di `ipos-bridge.js`), atau memakai `tailscale up` dengan
`--accept-routes` lalu routing biasa.

**Auth key** dibuat di admin Tailscale akun Anda — saya tidak bisa membuatnya.

### 4.2 Pindahkan proxy iPos KEFA ke `192.168.1.199` (Opsi D)

Proxy `server.js` (679 baris) hanya butuh: `pg`, `.env` berisi kredensial DB,
dan port 8080. Langkahnya:

1. Pastikan `192.168.1.199` punya Node.js (atau Docker).
2. Salin `server.js` + `package.json` + `.env` (kredensial DB) ke sana.
3. Jalankan sebagai service yang auto-start (systemd / NSSM / Task Scheduler).
4. **Buka port 8080 ke tailnet**, bukan ke internet publik:
   - Pasang Tailscale di `192.168.1.199`, **atau**
   - Jadikan PC toko sebagai subnet router untuk `192.168.1.0/24`, **atau**
   - Pakai `tailscale serve` di server itu.
5. Verifikasi: dari luar LAN, `curl http://<ip-tailscale>:8080/ipos/health` → 200.
6. Baru ubah `IPOS_KEFA_URL` di Railway.

Risiko yang harus diterima: membuka port 8080 ke tailnet berarti siapa pun di
tailnet Anda bisa membaca data penjualan. Mitigasi: `IPOS_KEFA_KEY` tetap
diperiksa proxy, dan tailnet hanya berisi perangkat Anda.

### 4.3 Nota: fallback lokal + notifikasi admin

Sekarang `index.js:121–125` menulis ke `\\100.125.99.99\...` dan komentarnya
menegaskan "TANPA fallback". Rencana:

1. Deteksi apakah path share bisa ditulis (tes tulis file kecil, hapus lagi).
2. Kalau bisa → tulis seperti sekarang.
3. Kalau tidak → simpan ke `/data/storage/nota-gagal/`, catat di DB, dan kirim
   pesan ke `CONFIG.adminId` berisi nama file + alasan gagal.
4. Sediakan perintah admin untuk mengirim ulang nota yang tertunda.

Ini **tidak menghilangkan** perilaku sekarang di PC (share tetap jadi tujuan
utama). Hanya menambah jaring pengaman.

### 4.4 Volume Railway

Satu volume, satu mount point `/data`. Di dalam container, arahkan:

| Env | Nilai | Menggantikan |
|---|---|---|
| `DATA_DIR` | `/data` | `path.join(__dirname,'data')` di `bot-db.js:22` |
| `STORAGE_DIR` | `/data/storage` | `path.join(__dirname,'storage')` |
| `LOGS_DIR` | `/data/logs` | `path.join(__dirname,'logs')` |
| `HARGA_DIR` | `/data/harga_toko` | `path.join(__dirname,'harga_toko')` |

Perlu perubahan kode kecil: `CONFIG.paths` di `index.js:92–114` dan
`bot-db.js:21–24` dibaca dari env dengan fallback ke nilai sekarang. Dengan
fallback itu, **perilaku di PC tidak berubah sama sekali** — aman untuk rollback.

### 4.5 Node 24

- `Dockerfile`: `node:20-slim` → `node:24-slim`
- `package.json`: `engines.node` → `24.x`

Tambahkan pemeriksaan saat start: kalau `node:sqlite` tidak tersedia,
**berhenti dengan error jelas**, jangan lanjut diam-diam. Ini mengubah bug
senyap §2.6 menjadi kegagalan yang terlihat.

---

## 5. Variabel Lingkungan di Railway

Nama saja, **tanpa nilai**. Nilai diambil dari `.env` lokal Anda saat setup.

| Variabel | Sumber | Catatan |
|---|---|---|
| `BOT_TOKEN` | `.env` | wajib |
| `ADMIN_ID` | `.env` | wajib |
| `BOT_USERNAME` | `.env` | |
| `GITHUB_TOKEN` | `.env` | untuk repo data `BOT-TELEGRAM-DATA` |
| `GITHUB_USERNAME` | `.env` | |
| `GITHUB_REPO` | `.env` | |
| `GITHUB_BRANCH` | `.env` | `data-storage` |
| `ENCRYPT_PASSWORD` | `.env` | |
| `DASHBOARD_USER` / `DASHBOARD_PASS` | `.env` | |
| `SESSION_SECRET` | `.env` | |
| `MAX_MEMBER` | `.env` | |
| `GEMINI_KEY`, `GEMINI_KEY2`, `GEMINI_KEY3` | `.env` | |
| `GROQ_API_KEY`, `OPENROUTER_API_KEY` | `.env` | |
| `IPOS_URL`, `IPOS_KEY`, `IPOS_TOKO` | `.env` | CP |
| `IPOS_NK_URL`, `IPOS_NK_KEY`, `IPOS_NK_TOKO` | `.env` | NK |
| `IPOS_KEFA_URL`, `IPOS_KEFA_KEY`, `IPOS_KEFA_TOKO` | **diubah** | menunjuk ke proxy baru |
| `IPOS_SYNC_MS` | `.env` | `60000` |
| `TS_AUTHKEY` | **baru** | Tailscale auth key |
| `DATA_DIR`, `STORAGE_DIR`, `LOGS_DIR`, `HARGA_DIR` | **baru** | volume |
| `PORT` | **jangan diisi** | Railway menyuntik otomatis |

Aturan keamanan: **tidak ada** token/key di repo. `.env` tetap di `.gitignore`.
`data/secure/env.backup` tidak ikut di-commit (sudah dipastikan).

---

## 6. Migrasi Data

Urutan, sekali jalan:

1. **Snapshot DB konsisten.** `bot.db` sedang dipakai (ada `-wal` 4 MB).
   Pakai `VACUUM INTO` atau salinan via API backup yang sudah ada di
   `data/backups/` — jangan `copy` mentah sambil bot jalan.
2. Upload ke volume: `data/`, `storage/` (tanpa `temp_*.xlsx`), `logs/` (opsional).
3. `harga_toko/*.xlsx` sudah otomatis diunduh `docker-entrypoint.sh` — tidak
   perlu upload manual, tapi harus ada di repo data (terverifikasi ada).
4. **Jangan** upload `data/secure/env.backup`; gunakan Railway Variables.
5. Verifikasi setelah start: jumlah baris tabel `messages` sama dengan lokal.

---

## 7. Urutan Kerja yang Saya Usulkan

Tahap 1 — **persiapan, tidak menyentuh produksi**
1. Dokumen ini disetujui.
2. Ubah `Dockerfile` → Node 24, `package.json` → `24.x`.
3. Tambah env-override untuk path (dengan fallback, perilaku PC tidak berubah).
4. Tambah fail-fast bila `node:sqlite` tidak ada.
5. Tambah fallback nota (§4.3).
6. Jalankan `node boot\verify-all.js` + suite yang ada → harus tetap hijau.

Tahap 2 — **Railway**
7. Anda login Railway CLI di PC ini (sesi Anda).
8. Buat project, tambah volume `/data`, isi Variables.
9. Deploy. Verifikasi `/health`: `polling=true`, 3 toko online.
10. Uji: kirim `menu`, klik tombol inline, minta laporan kasir/marketplace/merek.

Tahap 3 — **KEFA 24/7**
11. Pasang proxy di `192.168.1.199`, buka ke tailnet.
12. Ubah `IPOS_KEFA_URL`, deploy ulang, verifikasi KEFA `itemSegar=true`.
13. Uji pukul 20:30 (setelah PC mati) → KEFA harus tetap hidup.

Tahap 4 — **repo**
14. Pindahkan repo ke akun `genjiopenminded@gmail.com`.
15. Arsipkan repo lama.

---

## 8. Verifikasi Keberhasilan

Wajib lulus semua:

| Uji | Cara | Kriteria |
|---|---|---|
| Bot hidup | `GET /health` | `polling=true`, `streak=0` |
| Tombol inline | tap tombol di Telegram | `telegramCallbackCount` naik |
| DB nyata | kirim pesan, cek DB | baris baru di `messages` |
| CP realtime | `/health` | `itemSegar=true` |
| NK realtime | `/health` | `itemSegar=true` |
| KEFA realtime | `/health` | `itemSegar=true` |
| Data tidak basi | `boot\verify-all.js` | 25/25 |
| Kesegaran | `boot\test-penjaga-kesegaran.js` | 17/17 |
| Marketplace | `boot\test-marketplace-total.js` | 7/7 |
| Restart aman | redeploy Railway | data tidak hilang, `messages` utuh |
| Setelah 20:00 | uji malam | KEFA tetap hidup, CP/NK tetap hidup |

---

## 9. Rollback

Karena semua perubahan kode memakai **fallback ke nilai sekarang**, rollback =
matikan Railway, jalankan bot lokal seperti biasa. Tidak ada perubahan skema DB,
tidak ada migrasi data yang merusak.

Titik rollback yang harus dijaga:
- Snapshot `C:\BOT-TELEGRAM-\backup\` sebelum perubahan kode.
- Commit git sebelum migrasi (sudah ada: `55d4a92`).
- Bot lokal **tidak dimatikan** sampai Railway terbukti lulus §8.

---

## 10. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Tailscale di Railway gagal | iPos tidak terjangkau | Uji `/health` sebelum mematikan lokal |
| Auth key kedaluwarsa | bot kehilangan tailnet | Pakai key tanpa expiry + notifikasi admin |
| Railway di-scale >1 | `409 Conflict`, poller ganda | Kunci 1 replika (lock tidak efektif di Linux, §2.5) |
| Volume tidak ter-mount | data hilang tiap redeploy | Uji redeploy, cek `messages` |
| Node masih 20 | DB mati senyap | Fail-fast §4.5 |
| `192.168.1.199` tidak bisa diakses | KEFA mati setelah 20:00 | Opsi A saja sebagai fallback |
| SMB tidak terjangkau | nota gagal | Fallback lokal §4.3 |
| RAM Railway kurang | watchdog/paging | Ukur; lokal butuh ~100 MB RSS |
| IP publik iPos terbuka | data penjualan bocor | Hanya lewat tailnet, jangan port-forward |

---

## 11. Keputusan yang Sudah Diambil

| No | Keputusan | Pilihan Anda |
|---|---|---|
| 1 | Arsitektur | Opsi A (Tailscale di container) + Opsi D (proxy KEFA ke server toko) |
| 2 | KEFA 24/7 | Pindahkan proxy ke `192.168.1.199` |
| 3 | Nota SMB | Fallback lokal + notifikasi admin |
| 4 | Urutan | Tulis dokumen desain dulu, review sebelum ubah kode |
| 5 | Akses Railway | Anda install CLI & login sendiri di PC ini |
| 6 | Repo | Pindah penuh ke `genjiopenminded@gmail.com`, repo lama diarsipkan |

---

## 12. Yang Masih Terbuka

1. **Cara Node menjangkau tailnet.** Dua pilihan: (a) SOCKS5 proxy lokal dari
   `tailscaled --tun=userspace-networking --socks5-server`, perlu penyesuaian
   di `ipos-bridge.js`; (b) `tailscale up --accept-routes` dengan TUN bila
   Railway mengizinkannya. Saya perlu menguji (a) lebih dulu karena lebih pasti
   jalan tanpa privilege.
2. **Akses ke `192.168.1.199`.** Apakah Anda punya RDP/SSH/admin ke server itu?
   Tanpa ini, Opsi D tidak bisa dikerjakan dan KEFA tetap mati setelah 20:00.
3. **Batas resource Railway.** Paket mana yang dipakai? Bot lokal RSS ~100 MB
   tapi host Anda hanya 3.874 MB total dan sering paging. Perlu angka paket
   Railway Anda agar saya bisa menilai apakah cukup.
4. **Repo `BOT-TELEGRAM-DATA`.** Ikut dipindah ke akun baru, atau tetap di
   `rendraserizawa1`? Kalau pindah, `GITHUB_*` harus diubah.
5. **Nasib bot lokal.** Dimatikan permanen setelah Railway stabil, atau tetap
   jadi cadangan?
6. **Domain dashboard.** Railway memberi domain `*.up.railway.app`. Pakai itu,
   atau ada domain sendiri?

---

## 13. Yang Tidak Berubah

Ditegaskan agar tidak ada salah paham:

- Tidak ada logika bisnis iPos yang diubah (harga, stok, kasir, marketplace,
  merek, nota, SO, backup Excel).
- Tidak ada token/key yang masuk repo atau database.
- `.env` tetap di `.gitignore`; `data/` dan `backup/` tetap di-ignore.
- Format pesan, tombol, dan perintah bot tetap sama.
- Retensi SO dan mekanisme backup tetap sama.
