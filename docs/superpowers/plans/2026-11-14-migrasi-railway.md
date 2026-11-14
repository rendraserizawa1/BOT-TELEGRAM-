# Migrasi BOT-TELEGRAM ke Railway — Rencana Implementasi

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat bot Telegram ini bisa hidup 24/7 di Railway tanpa kehilangan satu fitur pun, dengan bot lokal tetap berjalan identik sebagai jalur rollback.

**Architecture:** Semua perubahan kode bersifat *aditif dengan fallback*: setiap path dan perilaku baru dibaca dari environment variable dan jatuh kembali ke nilai sekarang bila tidak diisi. Jadi menjalankan kode yang sama di PC menghasilkan perilaku persis seperti hari ini, sementara di container Railway semua path diarahkan ke satu volume `/data`. Tiga sumber iPos dijangkau lewat tailnet (`tailscaled` userspace di container), proxy iPos KEFA dipindah ke server toko `192.168.1.199`, dan simpan nota SMB mendapat jaring pengaman lokal.

**Tech Stack:** Node.js 24 (butuh `node:sqlite`), Express, `node-telegram-bot-api`, SQLite WAL, Tailscale userspace networking, Docker, Railway Volume.

**Spec:** `C:\BOT-TELEGRAM-\boot\DESIGN-MIGRASI-RAILWAY.md`

## Global Constraints

- Node **24.x** di `Dockerfile` dan `package.json` `engines`. Node 20 mematikan `node:sqlite` secara senyap (`bot-db.js:56`).
- Replika Railway **wajib 1**. Kunci single-instance tidak berfungsi di Linux (`bot-instance-lock.js:67` `wmic`, `:86` `netstat -ano`), jadi scale >1 = poller ganda = `409 Conflict`.
- Jangan pernah mengisi `PORT` manual di Railway. Railway menyuntik otomatis; `bot-instance-lock.js:39` mengunci pada nilai itu.
- Tidak ada token/key/password di repo, dokumen, commit, atau database. Nilai hanya lewat Railway Variables.
- `data/`, `backup/`, `logs/`, `.env` tetap di `.gitignore`.
- Setiap perubahan path **wajib** punya fallback ke nilai lama, agar bot lokal tidak berubah perilaku.
- Semua suite lama harus tetap hijau: `verify-all.js` 25/25, `test-instance-lock.js` 28/28, `test-allowed-updates.js` 27/27, `test-penjaga-kesegaran.js` 17/17, `test-marketplace-total.js` 7/7.
- Jangan restart service Tailscale di PC. Jangan sentuh Chrome sesi 3. Jangan matikan bot lokal sebelum Railway lulus semua uji.
- Logika bisnis iPos (harga, stok, kasir, marketplace, merek, nota, SO, backup Excel) **tidak boleh berubah**.

## Review Focus

- **Volume tidak ter-mount** → bot tetap start, menulis ke disk container, dan semua data hilang saat redeploy tanpa satu pun error. Harapan wajar: bot menolak start atau berteriak keras. Ditangani Task 2 (penanda volume) + Task 8 (uji redeploy).
- **`node:sqlite` tidak tersedia** → seluruh DB jadi no-op senyap (`bot-db.js:56`). Harapan wajar: gagal start dengan pesan jelas. Ditangani Task 1.
- **Dua replika** → dua poller `getUpdates`, `409 Conflict`, tombol inline mati. Harapan wajar: instance kedua menolak jalan. Ditangani Task 5.
- **Share SMB tidak terjangkau** → nota pengguna hilang tanpa jejak. Harapan wajar: nota tersimpan lokal + admin diberi tahu. Ditangani Task 4.
- **Kunci Tailscale kedaluwarsa** → bot hidup tapi seluruh data iPos mati dan tampak seperti "toko tutup". Harapan wajar: status jelas "tidak terjangkau", bukan angka basi. Ditangani Task 6.

---

### Task 1: Fail-fast bila `node:sqlite` tidak tersedia

**Files:**
- Modify: `bot-db.js:14-19`, `bot-db.js:54-57`
- Create: `boot/test-db-require.js`
- Modify: `package.json` (`engines.node`), `Dockerfile`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `bot-db.js` mengekspor `tersedia()` → `boolean`; `init()` melempar `Error` bila `DatabaseSync` null **dan** `process.env.DB_ALLOW_DEGRADED !== '1'`.

- [ ] **Step 1: Tulis tes yang gagal**

`boot/test-db-require.js` — jalankan `bot-db.js` di proses anak dengan `node:sqlite` dipaksa tidak tersedia, lalu pastikan exit code != 0 dan stderr memuat `node:sqlite`.

```js
const { spawnSync } = require('child_process');
// Simulasikan Node 20: blokir modul node:sqlite lewat --require hook
const hook = `
const M = require('module');
const asli = M._load;
M._load = function (req, ...rest) {
  if (req === 'node:sqlite') { const e = new Error('Cannot find module node:sqlite'); e.code='MODULE_NOT_FOUND'; throw e; }
  return asli.call(this, req, ...rest);
};`;
const r = spawnSync(process.execPath, ['-e', hook + '\nrequire("./bot-db.js");'], { cwd: process.cwd(), encoding: 'utf8' });
if (r.status === 0) { console.error('GAGAL: harus exit != 0 saat node:sqlite tidak ada'); process.exit(1); }
if (!/node:sqlite/.test(r.stderr)) { console.error('GAGAL: pesan tidak menyebut node:sqlite'); process.exit(1); }
console.log('OK fail-fast node:sqlite');
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node boot\test-db-require.js`
Expected: `GAGAL: harus exit != 0 saat node:sqlite tidak ada` (karena sekarang hanya `console.error` lalu lanjut).

- [ ] **Step 3: Implementasi**

Di `bot-db.js`, setelah blok `try/catch` require, tambah:

```js
const ALLOW_DEGRADED = process.env.DB_ALLOW_DEGRADED === '1';
function tersedia() { return !!DatabaseSync; }
function pastikanTersedia() {
  if (DatabaseSync) return;
  const pesan = 'node:sqlite tidak tersedia. Butuh Node 22+ (Railway memakai 24.x). '
    + 'Tanpa ini SELURUH riwayat chat/sesi/file/log mati diam-diam. '
    + 'Set DB_ALLOW_DEGRADED=1 hanya bila memang sengaja.';
  if (!ALLOW_DEGRADED) throw new Error(pesan);
  console.error('[DB] ' + pesan);
}
```

Panggil `pastikanTersedia()` di baris pertama `init()` (menggantikan `if (!DatabaseSync) return null;`), dan tambahkan `tersedia` ke `module.exports`.

Ubah `package.json`: `"node": "20.x"` → `"node": "24.x"`.
Ubah `Dockerfile`: `FROM node:20-slim` → `FROM node:24-slim`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node boot\test-db-require.js`
Expected: `OK fail-fast node:sqlite`
Run: `node boot\verify-all.js`
Expected: `25/25 PASS`

- [ ] **Step 5: Commit**

```bash
git add bot-db.js boot/test-db-require.js package.json Dockerfile
git commit -m "fix(db): gagal keras bila node:sqlite tidak ada, Node 24"
```

---

### Task 2: Path dari environment dengan fallback ke nilai sekarang

**Files:**
- Modify: `bot-db.js:21-26`
- Modify: `index.js:91-115`
- Create: `boot/test-path-env.js`

**Interfaces:**
- Consumes: `bot-db.js` dari Task 1.
- Produces: `DATA_DIR`/`STORAGE_DIR`/`LOGS_DIR`/`HARGA_DIR` env. `CONFIG.paths` tetap punya kunci yang sama persis (`storage`, `members`, `kontak`, `sesi`, `disapa`, `pending`, `stockopname`, `beritaacara`, `soShared`, `roleLaporan`, `excelFolder`, `excelPerToko.{nk,tdm,oesapa,kefa,cp}`, `logs`, `backupLaporan`, `backupHarga`) sehingga 25 pemakaian `__dirname` di `index.js` tidak perlu disentuh.

- [ ] **Step 1: Tulis tes yang gagal**

`boot/test-path-env.js`:

```js
const path = require('path');
process.env.DATA_DIR = '/data';
process.env.STORAGE_DIR = '/data/storage';
process.env.LOGS_DIR = '/data/logs';
process.env.HARGA_DIR = '/data/harga_toko';
const db = require('../bot-db.js');
const p = db.paths();
const cek = [
  [p.db, '/data/bot.db', 'DB_PATH'],
  [p.files, '/data/files', 'FILES_DIR'],
  [p.backups, '/data/backups', 'BACKUP_DIR'],
  [p.secure, '/data/secure', 'SECURE_DIR'],
];
let gagal = 0;
for (const [dapat, harap, nama] of cek) {
  if (path.resolve(dapat) !== path.resolve(harap)) { console.error(`GAGAL ${nama}: ${dapat} != ${harap}`); gagal++; }
}
if (gagal) process.exit(1);
console.log('OK path dari env');
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node boot\test-path-env.js`
Expected: `GAGAL DB_PATH: ...` lalu exit 1 (`db.paths` belum ada).

- [ ] **Step 3: Implementasi**

`bot-db.js:21-26` ganti menjadi:

```js
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'bot.db');
const FILES_DIR = path.join(DATA_DIR, 'files');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SECURE_DIR = path.join(DATA_DIR, 'secure');
```

Tambah ke `module.exports`: `paths: () => ({ db: DB_PATH, files: FILES_DIR, backups: BACKUP_DIR, secure: SECURE_DIR, root: DATA_DIR })`.

`index.js:91-115` — sisipkan di atas `paths:`:

```js
const STORAGE_DIR = process.env.STORAGE_DIR || path.join(__dirname, 'storage');
const LOGS_DIR = process.env.LOGS_DIR || path.join(__dirname, 'logs');
const HARGA_DIR = process.env.HARGA_DIR || path.join(__dirname, 'harga_toko');
```

lalu ganti setiap `path.join(__dirname, 'storage', X)` → `path.join(STORAGE_DIR, X)`, `path.join(__dirname, 'logs', 'error.log')` → `path.join(LOGS_DIR, 'error.log')`, dan `path.join(__dirname, 'harga_toko', X)` → `path.join(HARGA_DIR, X)`.

**Wajib juga:** `index.js:6277` `POLL_OFFSET_FILE` dan `index.js:138` `[CONFIG.paths.storage, path.dirname(CONFIG.paths.logs), CONFIG.paths.excelFolder]` tetap memakai `CONFIG.paths` (otomatis ikut). Ganti `index.js:6277` menjadi `path.join(CONFIG.paths.storage, 'polling_offset.json')` — ini **bug laten**: nilai sekarang `path.join(__dirname,'storage',...)` mengabaikan `STORAGE_DIR`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node boot\test-path-env.js`
Expected: `OK path dari env`
Run: `node boot\verify-all.js`
Expected: `25/25 PASS`

- [ ] **Step 5: Commit**

```bash
git add bot-db.js index.js boot/test-path-env.js
git commit -m "feat(paths): path data/storage/logs/harga dari env, fallback ke __dirname"
```

---

### Task 3: Penanda volume — berteriak bila `/data` tidak persisten

**Files:**
- Create: `boot/volume-check.js`
- Modify: `index.js` (dekat `index.js:138`, setelah pembuatan folder)

**Interfaces:**
- Consumes: `CONFIG.paths.storage` dari Task 2.
- Produces: `periksaVolume()` → `{ ok: boolean, alasan: string }`; dipanggil saat startup, menulis `[VOLUME]` ke log dan mengirim notifikasi admin bila gagal.

- [ ] **Step 1: Tulis tes yang gagal**

`boot/test-volume-check.js`:

```js
const fs = require('fs'), os = require('os'), path = require('path');
const { periksaVolume } = require('./volume-check.js');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vol-'));
// 1) folder biasa, tanpa penanda -> harus ok (mode lokal)
const a = periksaVolume(tmp);
if (!a.ok) { console.error('GAGAL: folder biasa harus ok, dapat: ' + a.alasan); process.exit(1); }
// 2) EXPECT_VOLUME=1 tapi tanpa penanda -> harus gagal
process.env.EXPECT_VOLUME = '1';
const b = periksaVolume(tmp);
if (b.ok) { console.error('GAGAL: EXPECT_VOLUME=1 tanpa penanda harus gagal'); process.exit(1); }
// 3) ada penanda -> harus ok
fs.writeFileSync(path.join(tmp, '.volume-ok'), '1');
const c = periksaVolume(tmp);
if (!c.ok) { console.error('GAGAL: dengan penanda harus ok, dapat: ' + c.alasan); process.exit(1); }
console.log('OK volume-check 3/3');
```

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node boot\test-volume-check.js`
Expected: `Cannot find module './volume-check.js'`

- [ ] **Step 3: Implementasi**

`boot/volume-check.js` — ekspor `periksaVolume(dir)`:
- bila `process.env.EXPECT_VOLUME !== '1'` → `{ ok: true, alasan: 'mode lokal' }`
- bila ada `path.join(dir, '.volume-ok')` → `{ ok: true, alasan: 'penanda ada' }`
- selain itu → `{ ok: false, alasan: 'EXPECT_VOLUME=1 tetapi ' + dir + ' tidak punya penanda .volume-ok' }`

Di `index.js` setelah folder dibuat, panggil dan bila `!ok` → `console.error('[VOLUME] ' + alasan)` + `log.error('VOLUME', alasan)` + kirim ke `CONFIG.adminId`; jangan `process.exit` (biar bot tetap melayani chat) tetapi status `/health` diberi `volumeOk:false`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node boot\test-volume-check.js`
Expected: `OK volume-check 3/3`
Run: `node boot\verify-all.js`
Expected: `25/25 PASS`

- [ ] **Step 5: Commit**

```bash
git add boot/volume-check.js boot/test-volume-check.js index.js
git commit -m "feat(volume): deteksi volume tidak persisten dan beri tahu admin"
```

---

### Task 4: Nota — fallback lokal + notifikasi admin

**Files:**
- Modify: `index.js:11439-11472` (`simpanFileNota`)
- Modify: `index.js:121-125` (komentar "TANPA fallback")
- Create: `boot/test-nota-fallback.js`

**Interfaces:**
- Consumes: `CONFIG.paths.storage`, `CONFIG.adminId`, `kirim()`, `log`.
- Produces: `simpanNotaKeShare(info, cfg, imageBuffer)` → `{ ok, path }`; `simpanNotaFallback(info, imageBuffer, err)` → `{ ok, path }`. `simpanFileNota` memakai keduanya.

- [ ] **Step 1: Tulis tes yang gagal**

`boot/test-nota-fallback.js` — tes perilaku murni tanpa Telegram: bangun folder share di direktori sementara yang **tidak bisa ditulis** (di Windows: pakai path ke drive tidak ada, mis. `Q:\tidak-ada`), panggil `simpanNotaFallback`, pastikan file tersimpan di folder fallback dan hasilnya `{ ok: true }` dengan `path` menunjuk ke folder fallback.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node boot\test-nota-fallback.js`
Expected: fungsi belum ada → gagal.

- [ ] **Step 3: Implementasi**

Pecah `simpanFileNota` menjadi tiga fungsi di `index.js`:

1. `simpanNotaKeShare(info, cfg, imageBuffer)` — isi lama `try` block (`mkdirSync` recursive, cek folder, uji tulis `.tulis-uji`, `writeFileSync`), mengembalikan `{ ok:true, path: fullPath }` atau `{ ok:false, error: err.message }`.
2. `simpanNotaFallback(info, imageBuffer, alasanShare)` — tulis ke `path.join(CONFIG.paths.storage, 'nota-gagal')`, nama file `buildNamaFileNota(info)`; kembalikan `{ ok:true, path }`.
3. `simpanFileNota` memanggil (1); bila `!ok` panggil (2) lalu kirim ke `CONFIG.adminId`:

```
⚠️ NOTA TERSIMPAN LOKAL (share tidak terjangkau)
🔖 <nama>
📁 <path>
❗ <alasanShare>
```

dan ke pengguna kirim pesan sukses yang jujur menyebut "tersimpan di penyimpanan bot, akan disalin ke share saat tersedia".

Ubah komentar `index.js:122` dan `:11446` dari "TANPA fallback" menjadi menjelaskan fallback baru.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node boot\test-nota-fallback.js`
Expected: PASS
Run: `node boot\verify-all.js`
Expected: `25/25 PASS`

- [ ] **Step 5: Commit**

```bash
git add index.js boot/test-nota-fallback.js
git commit -m "feat(nota): fallback lokal + notifikasi admin bila share SMB gagal"
```

---

### Task 5: Tolak replika kedua (pengganti kunci Windows)

**Files:**
- Create: `boot/replika-guard.js`
- Modify: `index.js` (dekat `index.js:24`, setelah `_lockMod`)
- Create: `boot/test-replika-guard.js`

**Interfaces:**
- Consumes: `PORT_DEFAULT` dari `bot-instance-lock.js`.
- Produces: `pastikanSatuReplika(port)` → `{ ok, alasan }`; di Linux memakai `process.env.RAILWAY_REPLICA_COUNT` bila ada, dan **selalu** memaksa `RAILWAY_REPLICA_COUNT > 1` menjadi fatal.

- [ ] **Step 1: Tulis tes yang gagal**

`boot/test-replika-guard.js` — tiga kasus: (a) `RAILWAY_REPLICA_COUNT` kosong → `ok:true`; (b) `'1'` → `ok:true`; (c) `'3'` → `ok:false` dan alasan memuat `409`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node boot\test-replika-guard.js`
Expected: `Cannot find module './replika-guard.js'`

- [ ] **Step 3: Implementasi**

`boot/replika-guard.js`:

```js
'use strict';
function pastikanSatuReplika() {
  const n = parseInt(process.env.RAILWAY_REPLICA_COUNT || '1', 10);
  if (Number.isFinite(n) && n > 1) {
    return { ok: false, alasan: `RAILWAY_REPLICA_COUNT=${n}. Kunci single-instance tidak berfungsi di Linux, `
      + 'sehingga >1 replika memicu poller ganda dan 409 Conflict. Set replika = 1.' };
  }
  return { ok: true, alasan: 'satu replika' };
}
module.exports = { pastikanSatuReplika };
```

Di `index.js`, setelah `_lockMod` dimuat: panggil `pastikanSatuReplika()`; bila `!ok` → `console.error` + `process.exit(3)` (exit != 0 agar Railway menandai deploy gagal).

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node boot\test-replika-guard.js`
Expected: `OK replika-guard 3/3`
Run: `node boot\verify-all.js`
Expected: `25/25 PASS`

- [ ] **Step 5: Commit**

```bash
git add boot/replika-guard.js boot/test-replika-guard.js index.js
git commit -m "feat(guard): tolak replika >1 untuk cegah 409 Conflict"
```

---

### Task 6: Status iPos jujur saat tailnet tidak terjangkau

**Files:**
- Modify: `index.js` (`/health` iPos block, `stempelKesegaran()`)
- Create: `boot/test-status-jujur.js`

**Interfaces:**
- Consumes: `status()` dari `ipos-bridge.js` (`online`, `sse`, `umurItemDetik`, `itemSegar`, `umurKoneksiDetik`).
- Produces: setiap blok toko di `/health` mendapat `alasanTidakSegar: string|null` dan `sejakKapan: number|null`.

- [ ] **Step 1: Tulis tes yang gagal**

`boot/test-status-jujur.js` — beri masukan palsu: `{online:false, itemSegar:false, umurItemDetik:9999}` → harap `alasanTidakSegar` memuat "tidak terjangkau"; `{online:true, itemSegar:false, umurItemDetik:400}` → harap memuat "data terakhir 400"; `{online:true, itemSegar:true}` → harap `null`.

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node boot\test-status-jujur.js`
Expected: gagal (fungsi belum ada).

- [ ] **Step 3: Implementasi**

Tambah `function alasanTidakSegar(s)` di `index.js` sesuai tiga aturan di Step 1, pakai di blok `/health` per toko dan di `stempelKesegaran()` (teks pengguna memakai kalimat yang sama).

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node boot\test-status-jujur.js`
Expected: PASS
Run: `node boot\verify-all.js`
Expected: `25/25 PASS`

- [ ] **Step 5: Commit**

```bash
git add index.js boot/test-status-jujur.js
git commit -m "feat(health): alasan eksplisit saat data iPos tidak segar"
```

---

### Task 7: Docker image produksi

**Files:**
- Modify: `Dockerfile`
- Modify: `docker-entrypoint.sh`
- Create: `.dockerignore` (modify: tambah `data/`, `backup/`, `*.db`, `boot/_*`)

**Interfaces:**
- Consumes: Task 1 (Node 24), Task 2 (env path), Task 5 (replika).
- Produces: image yang start dengan `DATA_DIR=/data` dan **tidak** memuat data pengguna.

- [ ] **Step 1: Verifikasi `.dockerignore` tidak membocorkan data**

Run: `git check-ignore -v data backup` lalu baca `.dockerignore`; pastikan `data`, `backup`, `*.db`, `*.db-wal`, `*.db-shm`, `.env` ada di daftar.

- [ ] **Step 2: Implementasi**

- `Dockerfile`: `node:24-slim`, `ENV NODE_ENV=production`, `ENV EXPECT_VOLUME=1`, `VOLUME ["/data"]`, `EXPOSE` pakai `${PORT:-3000}` (jangan hardcode), `USER node` bila izin volume memungkinkan (uji dulu; kalau gagal, tetap root dengan catatan).
- `docker-entrypoint.sh`: tambah `mkdir -p /data/{data,storage,logs,harga_toko}` dan buat `/data/.volume-ok`; pertahankan unduhan `harga_toko` yang sudah ada.
- `.dockerignore`: tambah `data`, `backup`, `*.db`, `*.db-wal`, `*.db-shm`, `boot/_*`, `tmp-*.js`.

- [ ] **Step 3: Build lokal untuk membuktikan image sehat**

Run: `docker build -t bcode-bot:uji .`
Expected: sukses. Bila Docker tidak tersedia di PC ini, catat dan lewati — verifikasi pindah ke Railway.

- [ ] **Step 4: Commit**

```bash
git add Dockerfile docker-entrypoint.sh .dockerignore
git commit -m "build(docker): Node 24, volume /data, entrypoint siapkan folder"
```

---

### Task 8: Deploy Railway + verifikasi

**Files:**
- Create: `railway.json` (healthcheck + restart policy)
- Create: `boot/VERIFIKASI-RAILWAY.md` (checklist hasil)

**Interfaces:**
- Consumes: semua task sebelumnya.
- Produces: URL publik, hasil uji tercatat.

- [ ] **Step 1: Konfigurasi**

`railway.json`: `"restartPolicyType": "ON_FAILURE"`, `"restartPolicyMaxRetries": 10`, `healthcheckPath: "/health"`, `healthcheckTimeout: 300`.

- [ ] **Step 2: Deploy (dijalankan pengguna)**

Pengguna menjalankan `railway login`, `railway init`, `railway volume add -m /data`, isi Variables sesuai §5 dokumen desain, `railway up`.

- [ ] **Step 3: Verifikasi wajib**

| Uji | Kriteria |
|---|---|
| `GET /health` | `polling=true`, `streak=0`, `volumeOk=true` |
| Tap tombol inline | `telegramCallbackCount` naik |
| Kirim pesan | baris baru di tabel `messages` |
| CP / NK / KEFA | `itemSegar=true` |
| `verify-all.js` | 25/25 |
| Redeploy | `messages` utuh, `itemSegar` kembali true |
| Pukul 20:30 | KEFA tetap hidup (bukti Opsi D berhasil) |

- [ ] **Step 4: Catat hasil**

Tulis angka nyata ke `boot/VERIFIKASI-RAILWAY.md`, commit.

---

### Task 9: Pindahkan repo ke akun genjiopenminded

**Files:**
- Modify: `.git/config` (remote)
- Create: `boot/CARA-PINDAH-REPO.md`

- [ ] **Step 1: Panduan untuk pengguna** — buat repo baru di akun `genjiopenminded@gmail.com`, buat PAT scope `repo`, jalankan `git remote set-url origin <url-baru>`, `git push -u origin main`.
- [ ] **Step 2: Verifikasi** — `git ls-remote --heads origin` menunjuk commit yang sama; repo lama diarsipkan (bukan dihapus) sampai Railway stabil.
- [ ] **Step 3: Commit**

---

### Task 10: Proxy iPos KEFA ke `192.168.1.199` (Opsi D)

**Files:**
- Create: `boot/PANDUAN-PROXY-KEFA.md`
- Modify: `boot/README.txt`

- [ ] **Step 1: Dokumen langkah** — salin `server.js` + `package.json` + `.env` DB ke server toko; jalankan sebagai service auto-start; buka port 8080 **hanya ke tailnet** (Tailscale di server itu, atau subnet router `192.168.1.0/24`); verifikasi `curl http://<ip-tailscale>:8080/ipos/health` → 200 dari luar LAN.
- [ ] **Step 2: Ubah `IPOS_KEFA_URL`** di Railway ke alamat baru, deploy ulang, verifikasi `itemSegar=true` setelah PC mati.
- [ ] **Step 3: Commit**

---

## Catatan Urutan

Task 1–7 aman dikerjakan sekarang: semuanya punya fallback, bot lokal tetap jalan, dan setiap task berakhir dengan `verify-all.js` hijau. Task 8–10 butuh aksi pengguna (login Railway, akses server toko, akun GitHub baru) dan tidak bisa saya lakukan sendiri.
