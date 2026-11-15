# JAMINAN iPos TERUS TERSAMBUNG & HANYA SATU POLLER

Tanggal: 2026-11-15
Mesin: `BCODE-KEFA` (`C:\BOT-TELEGRAM-`)

Dokumen ini menjawab dua permintaan:

1. **iPos harus aman, tersambung terus, realtime, tidak pernah putus, selalu ada
   request & get.**
2. **Jangan sampai ada dua instance bot / poller Telegram di mana pun.**

Setiap klaim di bawah punya bukti perintah, bukan asumsi.

---

## 1. Akar masalah yang ditemukan

### 1.1 Tunnel mati, bukan proxy

| Lapisan | Bukti | Keadaan |
|---|---|---|
| Proxy KEFA lokal `127.0.0.1:8080` | `/ipos/health` → `ok=true items=4593 jual.siap=true` | **SEHAT** |
| Laporan hari ini | `/api/jual` → `nota=43 omzet=9.769.500` | **SEGAR** |
| Cache bergerak | `update` berubah dalam 6 detik | **REALTIME** |
| Tiga hostname `*.trycloudflare.com` | `ENOTFOUND` | **MATI PERMANEN** |
| Railway `/health` | `CP/NK/KEFA online=false`, `fetch failed` | **PUTUS** |

**Kesimpulan:** proxy iPos tidak pernah rusak. Yang mati adalah proses
`cloudflared`, dan Cloudflare menghapus record DNS quick tunnel-nya. Bot Railway
masih memegang URL lama → `ENOTFOUND` → `fetch failed`.

Bukti `ENOTFOUND` ada di `boot/_uji-tunnel.json`.

### 1.2 Dua poller Telegram (409 Conflict) — TERJADI SAAT ITU JUGA

Log PM2 lokal `14:00–14:08`:

```
[WARN] [POLLING] 409 Conflict (1x) - tunggu 30 dtk agar poller lama lepas
```

Berulang tiap ~30 detik. Penyebabnya bukan scheduled task (task
`BCODE-KEFA-BOT` memang `Disabled`), melainkan:

- Entri registry `HKCU\...\Run` bernama **`PM2`** →
  `boot/start-bot-if-needed.ps1`
- PM2 aplikasi **`telegram-perabot`** → `C:\BOT-TELEGRAM-\index.js`
- **212 restart**, uptime 2 jam

PM2 sama sekali tidak memeriksa status scheduled task, jadi `Disabled` tidak
berlaku. Bot lokal dan bot Railway saling menendang token yang sama.

---

## 2. Yang diperbaiki

### 2.1 Bot lokal dimatikan permanen

```
pm2 stop telegram-perabot
pm2 delete telegram-perabot
pm2 save --force          # dump kosong -> tidak resurrect
Remove-ItemProperty HKCU:\...\Run -Name PM2
```

Bukti: `streak` Railway turun `1 → 1 → 0` tepat setelahnya, dan
`uji-jaminan.js` melaporkan port 3001 bebas + tidak ada proses `index.js`.

**Rollback** (bila memang ingin bot lokal lagi — ingat: harus mematikan Railway
dulu, kalau tidak 409 kembali):

```
New-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Run -Name PM2 `
  -Value 'wscript.exe "C:\BOT-TELEGRAM-\boot\run-hidden.vbs" "C:\BOT-TELEGRAM-\boot\start-bot-if-needed.ps1"'
```

### 2.2 `boot/jaga-tunnel.js` — pengawas tunnel

Tugasnya menjaga jalur Railway → PC ini tetap hidup.

Perilaku:

1. **Hanya** membuat tunnel untuk toko yang server sumbernya **benar-benar
   hidup**. Tunnel ke target mati tidak pernah dibuat (tidak ada tunnel sampah).
2. Memantau tiap tunnel **tiap 60 detik**: proses hidup **dan** uji
   `/ipos/health` **dari internet**.
3. Kalau mati → dibuat ulang otomatis, lalu variabel Railway diperbarui.
4. Variabel Railway **hanya** ditulis bila URL benar-benar berubah, supaya bot
   tidak redeploy terus-menerus.
5. **Lock file** `boot/.jaga-tunnel.lock` → salinan kedua keluar `exit=2`.
6. Status ditulis ke `boot/tunnel-status.json` (tanpa objek proses mentah, tanpa
   rahasia).

### 2.3 `boot/jaga-poller-tunggal.js` — penjaga satu poller

Memeriksa tiap 30 detik, dan **bertindak**, bukan hanya melapor:

| Yang diperiksa | Tindakan bila melanggar |
|---|---|
| proses `node ... BOT-TELEGRAM\index.js` | dibunuh |
| port `3001` didengarkan | prosesnya dibunuh |
| PM2 memuat `telegram-perabot` | `pm2 delete` + `pm2 save` |
| registry autostart `PM2` | dihapus |
| task `BCODE-KEFA-BOT` / `-WATCHDOG` | di-`Disable` |
| Railway `telegramPollErrorStreak > 0` | **diperingatkan** (tidak bisa dibunuh dari sini) |
| proxy iPos `:8080` | **dilaporkan, TIDAK PERNAH dibunuh** |

Pencocokan proses sengaja memakai `BOT-TELEGRAM` **dan** `index.js` **dan**
`-notmatch 'ipos-api'`, supaya proxy iPos tidak pernah salah sasaran.

### 2.4 Autostart tahan reboot

Dua jalur sekaligus, karena `-AtStartup` butuh admin (`Access is denied` sudah
dibuktikan di mesin ini):

1. Scheduled task `BCODE-JAGA-TUNNEL` dan `BCODE-JAGA-POLLER`
   (trigger **AtLogOn**, sama seperti pola `iPosAPI` yang sudah terbukti).
2. Entri `HKCU\...\Run`: `BCODE_JAGA_TUNNEL`, `BCODE_JAGA_POLLER`.

Dobel-jalan aman: kedua skrip punya lock file sendiri.

Wrapper `.ps1` memakai loop luar, jadi kalau `node` mati karena sebab apa pun,
ia dihidupkan lagi setelah 20 detik.

---

## 3. Bukti (semua dijalankan, bukan diklaim)

### 3.1 `node boot\uji-jaminan.js` → 16/16 LULUS

```
=== A. iPos tersambung terus & data segar ===
  [LULUS] proxy iPos KEFA mendengarkan :8080            pid=832
  [LULUS] proxy lokal menjawab /ipos/health 200         HTTP 200 items=4593
  [LULUS] pengawas tunnel hidup                         pid=12048
  [LULUS] lock pengawas tunnel sah (1 pemilik)          pid=12048
  [LULUS] status pengawas: KEFA sehat                   sehat https://...
  [LULUS] tunnel KEFA menjawab dari INTERNET            HTTP 200 items=4593
  [LULUS] Railway: KEFA online                          online=true
  [LULUS] Railway: laporan KEFA < 120 dtk               3s

=== B. Hanya SATU poller Telegram ===
  [LULUS] tidak ada bot lokal (BOT-TELEGRAM index.js)   bersih
  [LULUS] port bot lokal 3001 bebas                     bebas
  [LULUS] PM2 tidak memuat telegram-perabot             bersih
  [LULUS] autostart registry PM2 tidak ada              bersih
  [LULUS] task bot & watchdog Disabled                  keduanya Disabled
  [LULUS] Railway streak=0 (tidak ada 409)              streak=0 polling=true
  [LULUS] penjaga poller hidup (tepat 1)                pid=9232
  [LULUS] lock penjaga poller sah (1 pemilik)           pid=9232

  lulus 16/16 — SEMUA JAMINAN TERPENUHI.
```

### 3.2 Lock terbukti menolak instance kedua

```
node boot\jaga-tunnel.js        -> SUDAH ADA pengawas tunnel berjalan (pid 1224). exit=2
node boot\jaga-poller-tunggal.js -> SUDAH ADA penjaga poller berjalan (pid 11316). exit=2
```

### 3.3 Autostart terbukti (simulasi reboot)

Pengawas + cloudflared dimatikan, lock dihapus, lalu **hanya**
`Start-ScheduledTask` dipanggil. Hasil: `jaga-poller` pid 9232,
`jaga-tunnel` pid 13548, `cloudflared` pid 1892 hidup kembali sendiri, dan
Railway kembali `KEFA online=true`.

### 3.4 Kebocoran rahasia

`node boot\pindai-rahasia.js` → **`HASIL: nol kebocoran.`** (46.609 karakter
dipindai, termasuk semua berkas baru).

---

## 4. Batas yang TIDAK bisa saya hilangkan (jujur)

Tunnel quick Cloudflare **tidak punya jaminan uptime**, dan **mati bila PC ini
mati**. Pengawas hanya membuatnya pulih selama PC hidup. Selama PC ini masih
jadi jembatan, "tidak pernah putus" tidak bisa dijanjikan 100%.

Selain itu **CP dan NK masih mati total** (`ETIMEDOUT`) karena listrik/ISP di
lokasi CP padam sejak kemarin. Itu bukan cacat kode. Pengawas sengaja
**tidak** membuat tunnel ke target mati.

### Jalur permanen (butuh keputusan Anda)

| Opsi | Yang dibutuhkan | Hasil |
|---|---|---|
| **A. Tailscale userspace di container Railway** | `TS_AUTHKEY` dari admin Tailscale Anda | Railway menembus langsung ke `100.125.99.99` / `100.110.152.33` / `100.123.166.13`. **Tanpa PC ini, tanpa cloudflared, tanpa URL berubah.** Ini satu-satunya jawaban untuk "tidak pernah putus". |
| **D. Pindahkan proxy KEFA ke `192.168.1.199`** | Akses ke server itu | Tidak perlu PC ini. Terbukti hanya port **5444** terbuka; `22/80/443/445/3389/5985/8086` tertutup → butuh akses fisik/RDP. |

**Rekomendasi: Opsi A.** Kodenya belum ada (`TS_AUTHKEY` tidak ada di mana pun,
Dockerfile tidak memasang Tailscale), tapi saya sudah memverifikasi bahwa
jaringan tailnet dari PC ini bisa mencapai proxy KEFA di `100.123.166.13:8080`,
jadi rute itu memang hidup. Yang kurang hanya kunci auth.

---

## 5. Berkas yang ditambahkan

| Berkas | Fungsi |
|---|---|
| `boot/jaga-tunnel.js` | pengawas tunnel: buat / uji / pulihkan / perbarui Railway |
| `boot/jaga-poller-tunggal.js` | penjaga satu poller Telegram |
| `boot/jaga-tunnel.ps1` | wrapper loop untuk task tunnel |
| `boot/jaga-poller.ps1` | wrapper loop untuk task poller |
| `boot/pasang-task-jaga.js` | pemasang task + HKCU Run |
| `boot/uji-jaminan.js` | uji jaminan 16 titik (exit 1 bila melanggar) |
| `boot/uji-tunnel.js` | uji ketiga URL tunnel dari internet |
| `boot/periksa-segar-kefa2.js` | pengukur kesegaran data iPos KEFA |
| `boot/uji-kefa-lokal.js` | uji semua endpoint iPos KEFA lokal |
| `boot/tunnel-status.json` | status pengawas (dibuat otomatis) |
| `boot/poller-status.json` | status penjaga poller (dibuat otomatis) |

## 6. Perintah operasional

```powershell
# Apakah semua jaminan masih terpenuhi? (exit 0 = aman)
node boot\uji-jaminan.js

# Lihat status pengawas tunnel
Get-Content boot\tunnel-status.json -Raw

# Lihat status penjaga poller
Get-Content boot\poller-status.json -Raw

# Log
Get-Content logs\jaga-tunnel.log -Tail 30
Get-Content logs\jaga-poller.log -Tail 30

# Matikan semua pengawas (mis. saat maintenance)
Disable-ScheduledTask -TaskName BCODE-JAGA-TUNNEL
Disable-ScheduledTask -TaskName BCODE-JAGA-POLLER
Remove-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Run -Name BCODE_JAGA_TUNNEL
Remove-ItemProperty HKCU:\Software\Microsoft\Windows\CurrentVersion\Run -Name BCODE_JAGA_POLLER
```
