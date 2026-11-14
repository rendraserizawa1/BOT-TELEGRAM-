# CATATAN DEPLOY RAILWAY — 14 November 2026

Status nyata setelah deploy pertama. Ditulis agar tidak ada klaim yang
melampaui bukti.

## Yang SUDAH terbukti berjalan

| Bukti | Nilai |
|---|---|
| Project | `bcode-kefa-bot` (`0ae904ce-9bfe-4969-b8eb-0ca96b1a3c23`) |
| Service | `kefa-bot` (`2cf8e05e-7801-4711-b370-4536c280310f`) |
| Volume | `kefa-bot-volume` di `/data`, 500 MB |
| Domain | https://kefa-bot-production.up.railway.app |
| Akun | genjiopenminded@gmail.com (device-code login) |
| `/health` | `status:OK`, `polling:true`, `streak:0` |
| `volumeOk` | `true` — `RAILWAY_VOLUME_MOUNT_PATH=/data` (penanda `.image-only` tidak terlihat = mount asli) |
| DB | `db.ready:true` (node:sqlite di Node v24.22.3) |
| Excel | 5/5 `harga_toko/*.xlsx` terunduh, 11.191 barang |
| Members | 11 |
| `notaTertunda` | 0 |
| `telegramCallbackCount` | 5 (tombol inline sampai) |

## Dua bug deploy yang ditemukan dan diperbaiki

### 1. Railway menolak `VOLUME` di Dockerfile
```
dockerfile invalid: docker VOLUME at Line 31 is not supported, use Railway Volumes
```
Instruksi `VOLUME ["/data"]` dihapus. Volume Railway dipasang di level
platform. Penanda `.image-only` TETAP dibuat saat build, dan justru itulah
bukti mount asli (terbukti: `volumeOk:true` di Railway).

### 2. `set -e` + `curl` tidak ada = bot TIDAK PERNAH dijalankan
```
/app/./entrypoint.sh: 40: curl: not found
```
`node:24-slim` tidak punya `curl`. Dengan `set -e`, kegagalan unduh mematikan
skrip SEBELUM `exec node index.js`, sehingga container restart berulang tanpa
satu pun pesan yang menjelaskan sebabnya.

Perbaikan: `set -e` dihapus, unduhan memakai `node` (fetch bawaan Node 24).
Log sekarang menunjukkan `[ENTRY] harga_toko: 5/5 terunduh` lalu
`[ENTRY] Selesai. Menjalankan bot...`.

## Jembatan iPos sementara (TIDAK untuk produksi)

Railway tidak punya jalur ke Tailscale CGNAT (`100.125.99.99`,
`100.110.152.33`) maupun ke `127.0.0.1` PC ini. Untuk membuktikan bahwa bot
Railway benar-benar bisa menyajikan data iPos, tiga tunnel Cloudflare
dijalankan dari PC:

| Toko | Tunnel | Hasil |
|---|---|---|
| KEFA | `diy-outputs-cube-intermediate.trycloudflare.com` | `online:true`, `itemSegar:true` |
| CP | `prisoners-choices-bracelet-settings.trycloudflare.com` | menunggu verifikasi |
| NK | `reaches-until-studying-nose.trycloudflare.com` | menunggu verifikasi |

**KETERBATASAN YANG HARUS DIINGAT:**
- `trycloudflare` adalah quick tunnel **tanpa akun dan TANPA jaminan uptime**.
- URL-nya **berubah setiap cloudflared dijalankan ulang**.
- Tunnel hidup **hanya selama PC ini hidup** — jadi ini BUKAN solusi 24/7.
- Kalau PC mati, CP/NK/KEFA kembali `online:false` di Railway.

Karena itu jembatan ini hanya untuk verifikasi. Solusi permanen tetap:
**Opsi D** — pindahkan proxy iPos KEFA ke server toko `192.168.1.199`
(port 5444 PostgreSQL TERBUKA dan sudah diuji tersambung: PostgreSQL 9.5.3,
database `i5_KEFA2025`, 104 tabel), lalu ekspos lewat Tailscale.

## Perintah CLI yang benar (jebakan yang sudah dilewati)

```powershell
# login tanpa menyerahkan password ke agen
railway login --browserless        # device-code, buka railway.com/activate

# opsi --service HARUS sebelum subcommand volume (kalau sesudah: error)
railway volume add --mount-path /data

# service harus di-link DULU, kalau tidak `volume add` PANIC (unwrap on None)
railway link --project <id> --service kefa-bot --environment production

# isi variabel dari .env tanpa mencetak nilainya
node boot\isi-variabel-railway.js

railway up --ci
railway domain
railway logs --deployment
```

## Peringatan deprecation

`railway.json` (Config as Code) **deprecated, berlaku sampai 2026-12-01**.
Setelah itu `numReplicas:1` di file itu tidak lagi dibaca. Karena itu
penjagaan replika TIDAK boleh bergantung padanya — `boot/replika-guard.js`
sekarang memakai kunci file eksklusif di volume (`open 'wx'`), yang tetap
bekerja tanpa `railway.json`. Migrasi: `railway config migrate`.

## Sisa pekerjaan

1. Verifikasi CP/NK/KEFA `itemSegar:true` setelah deploy terakhir.
2. Uji `db.messages` TIDAK turun setelah `railway redeploy` (bukti volume awet).
3. Uji tombol inline end-to-end (`telegramCallbackCount` naik).
4. Uji setelah jam 20:00.
5. Opsi D untuk solusi permanen (butuh akses admin `192.168.1.199`).
6. Pindah repo ke `genjiopenminded` (butuh PAT dengan scope `repo` + `workflow`).
7. Matikan bot lokal SETELAH semua di atas lulus (dua poller = 409 Conflict).
