# Migrasi Bot Telegram ke BCODE-KEFA

Target: device MeshCentral `BCODE-KEFA` (komputer barcode toko, Windows).
Sumber paket: `migrasi-bcode-kefa.zip` (2,8 MB) — berisi kode + `harga_toko/*.xlsx` + `storage/*.json`.
TIDAK termasuk: `node_modules/`, `.env`, log.

## 1. Upload via MeshCentral

1. Di dashboard MeshCentral → device **BCODE-KEFA** → tab **Files**.
2. Upload `migrasi-bcode-kefa.zip` ke folder sementara, mis. `C:\Temp\`.
3. Buka **Connect → Terminal**, extract:
   ```powershell
   Expand-Archive C:\Temp\migrasi-bcode-kefa.zip -DestinationPath C:\BOT-TELEGRAM- -Force
   cd C:\BOT-TELEGRAM-
   ```

## 2. Instal runtime

```powershell
# Node.js LTS 20.x dari https://nodejs.org (atau winget:)
winget install OpenJS.NodeJS.LTS --silent
# tutup-buka terminal, lalu:
npm install -g pm2
npm install
```

## 3. Konfigurasi `.env`

```powershell
copy .env.example .env
notepad .env
```

Isi WAJIB (salin nilai dari server lama, JANGAN commit):
`BOT_TOKEN`, `ADMIN_ID`, `IPOS_URL`, `IPOS_KEY`, `IPOS_NK_URL`, `IPOS_NK_KEY`,
`IPOS_KEFA_URL`, `IPOS_KEFA_KEY`, `GITHUB_TOKEN`, dst.
Sesuaikan path Windows bila user berbeda. Cek konektivitas iPos dari mesin ini:
`curl http://<IPOS_URL>/api/items?key=<KEY>` harus 200.

## 4. Jalan + autostart

```powershell
node --check index.js
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # jalankan perintah yang dicetaknya
```

Verifikasi:
```powershell
pm2 status
curl http://127.0.0.1:3001/health
```

## 5. Watchdog (opsional, disarankan)

Skrip `watchdog-bot.ps1` masih memakai path lama (`C:\Users\kassa\...`).
Edit `$dir`, `$log`, `$nodeDir`, `$npmDir` sesuai user/folder di BCODE-KEFA,
lalu buat Scheduled Task `Watchdog-Bot-Telegram` tiap 2 menit.

## 6. Matikan bot lama

Setelah bot di BCODE-KEFA stabil (health OK + respons Telegram normal ≥ 1 hari):
di server lama jalankan `pm2 stop telegram-perabot` agar tidak dobel polling
(dua bot polling token sama = konflik `409`).
