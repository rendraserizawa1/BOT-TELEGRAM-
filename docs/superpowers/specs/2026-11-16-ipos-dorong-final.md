# iPos â†’ Railway: Arsitektur DORONG (final)

**Status: TERPASANG dan TERBUKTI.** Dokumen ini menggantikan
`2026-11-15-railway-tailscale-design.md`. Tailscale dan Cloudflare tunnel
sudah **dipensiunkan**; jangan dihidupkan lagi.

---

## 1. Keputusan: arah dorong, bukan tarik

Selama ini bot di Railway **menarik** data dari iPos di PC. Itu mustahil
bekerja andal, dan sudah dibuktikan gagal dua kali dengan pengukuran:

| Percobaan | Hasil terukur | Sebab |
|---|---|---|
| Cloudflare quick tunnel | ketiga hostname `*.trycloudflare.com` â†’ `ENOTFOUND`; body SSE 0 byte / 150 dtk | proses cloudflared mati; tunnel menahan body |
| Tailscale userspace | `/health` 200, tetapi `/api/items` (780 KB) putus `UND_ERR_SOCKET` / `SOCKS5 connection timeout` | node Railway tidak punya jalur langsung ke PC (**CGNAT**) â†’ semua lewat DERP relay |

Keduanya gagal karena sebab yang sama: **PC tidak bisa dijangkau dari luar.**

Arah dorong membalik masalahnya. Terukur: **780 KB dari PC ke Railway dalam
0,81 detik** lewat HTTPS publik biasa.

Yang lebih penting: **tidak ada sambungan yang harus dijaga.** Tidak ada
tunnel yang bisa mati, tidak ada relay yang bisa timeout. Kalau satu kiriman
gagal, kiriman berikutnya menyusul. Itulah arti "tidak pernah putus" yang
benar-benar bisa dijamin â€” bukan janji, melainkan sifat arsitekturnya.

```
   PC (di balik CGNAT)                    Railway
   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”                   â”Œâ”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”
   â”‚ proxy iPos :8080 â”‚                   â”‚ index.js            â”‚
   â”‚        â”‚         â”‚                   â”‚  POST /api/ipos/pushâ”‚
   â”‚        â–¼         â”‚   HTTPS publik    â”‚        â”‚            â”‚
   â”‚  push-agen.js â”€â”€â”€â”¼â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â–¶â”‚        â–¼            â”‚
   â”‚   (SSE lokal)    â”‚   POST 780 KB     â”‚  push-gudang        â”‚
   â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜                   â”‚        â”‚            â”‚
                                          â”‚        â–¼            â”‚
                                          â”‚  ipos-bridge        â”‚
                                          â”‚  (pakai data)       â”‚
                                          â””â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”˜
```

---

## 2. Berkas dan perannya

| Berkas | Peran |
|---|---|
| `boot/push-penerima.js` | Logika murni penerima: token, validasi, penggabungan delta, status. Bisa diuji tanpa server. |
| `boot/push-gudang.js` | **Instans tunggal** yang dipakai bersama HTTP (tulis) dan bridge (baca). |
| `boot/push-agen.js` | Berjalan di **PC**: langganan SSE proxy lokal, dorong katalog/delta/laporan/denyut. |
| `boot/jaga-push.js` | Penjaga di PC: pastikan agen hidup, **tepat satu**, dan data di server segar. |
| `boot/jaga-push.ps1` | Wrapper task; memuat `boot/push-agen.env`. |
| `boot/push-agen.env` | `PUSH_URL` + `PUSH_TOKEN`. **Diabaikan git** â€” jangan pernah di-commit. |

### Kenapa gudang harus modul tunggal

`require` Node menyimpan satu instans per modul. Kalau `index.js` dan
`ipos-bridge.js` masing-masing membuat penerima sendiri, HTTP akan menulis ke
gudang yang **berbeda** dari yang dibaca bridge. Data masuk, bot tetap melihat
kosong, dan penyebabnya tidak terlihat sama sekali. Karena itu keduanya
me-`require` `boot/push-gudang` yang sama.

---

## 3. Aliran data

1. **Katalog penuh** (`items`) â€” saat agen mulai, dan tiap 15 menit.
2. **Delta** (`items-ubah`) â€” setiap frame `items` dari SSE proxy lokal.
   Biasanya 1â€“5 baris, bukan 780 KB.
3. **Laporan** (`jual`) â€” tiap ~60 detik dan segera setelah ada nota.
4. **Denyut** (`denyut`) â€” tiap 30 detik, **tanpa data**. Bukti PC hidup.

### Aturan keselamatan (semua diuji)

- Token kosong di server â†’ endpoint menolak semua (**503**). Tidak pernah ada
  endpoint terbuka tanpa sengaja.
- Data kosong ditolak (**400**). Satu kiriman kosong tidak boleh menghapus
  katalog bagus yang sedang dipakai.
- Delta tanpa katalog penuh ditolak (**409**) â†’ PC mengirim katalog penuh.
  Tanpa aturan ini, delta 3 item akan membuat katalog tampak hanya 3 item.
- Data basi **tidak** diam-diam dipakai: bridge melempar error agar status
  melaporkan OFFLINE. Kegagalan harus terlihat.
- Token tidak pernah masuk status dan tidak pernah dicetak.

---

## 4. Dua batas kesegaran â€” dan kenapa HARUS berbeda

Ini kesalahan yang sudah pernah terjadi dan meninggalkan alarm palsu:

| Jenis | Batas | Alasan |
|---|---|---|
| **Katalog** | 1200 dtk (20 mnt) | Katalog penuh dikirim tiap 15 mnt; delta hanya saat ada item berubah. Toko sepi yang **sehat** pun berumur belasan menit. |
| **Laporan** | 180 dtk (3 mnt) | Laporan dikirim ulang tiap ~60 dtk, jadi 3 kiriman terlewat = pantas dicurigai. |

Dengan satu batas 180 dtk untuk keduanya, `/health` akan melaporkan "katalog
basi" **setiap malam** saat toko tutup. Alarm yang selalu berbunyi akan
diabaikan orang â€” dan itu lebih berbahaya daripada tidak punya alarm.

**Denyut** memisahkan dua hal yang berbeda:

- "data lama" â†’ normal kalau toko sepi
- "PC mati" â†’ masalah nyata

Tanpa denyut, keduanya tampak identik dari sisi server.

---

## 5. Pemulihan setelah redeploy

Penyimpanan penerima hanya di **memori**. Setiap redeploy/restart Railway
mengosongkannya. Tanpa penanganan, PC baru mengirim ulang saat jeda 15 menit
tiba â€” dan selama itu bot melayani toko **tanpa data**.

Karena itu denyut membawa `perluPenuh: true` bila server belum punya katalog.
Agen menanggapinya dengan mengirim katalog penuh **segera**.

**Terbukti:** setelah deploy, 4593 item kembali dalam **54 detik**.

---

## 6. Realtime â€” terukur

Delta yang dikirim lewat HTTP dipakai bridge dalam **1,2 detik**
(`umurKoneksiDetik` langsung 0). Ini bukan klaim: diukur pada produksi.

Rantainya: perubahan terdeteksi di PC â†’ agen mendorong delta â†’ bridge memantau
penghitung versi tiap 2 detik â†’ item diterapkan.

### âš ï¸ Cacat proxy lokal yang menjadi akar masalah "tidak realtime"

Ditemukan saat memverifikasi, di `C:\Users\rdpadmin\ipos-api\server.js`:

```js
// baris 124-125
if (!old || old.nama !== it.nama || old.satuan !== it.satuan
  || old.harga !== it.harga || old.harga2 !== it.harga2
  || old.hpp !== it.hpp || old.statusjual !== it.statusjual) berubah.push(it);
//              ^^^ `stok` TIDAK ikut dibandingkan

// baris 122-126  perbandingan berjalan di sini...
// baris 129-133  ...tetapi stok baru diisi DI SINI
```

Dua akibat yang keduanya mematikan realtime:

1. **`stok` tidak dibandingkan.** Nota penjualan mengubah stok, bukan harga â€”
   jadi `broadcast('items')` tidak pernah terpicu oleh penjualan.
2. **Perbandingan berjalan sebelum stok diisi**, sehingga saat dibandingkan
   `stok` semua item masih `0`.

**Dibuktikan dengan probe SSE 31 menit:** 3 frame `jual` masuk, frame `items`
**nol**.

Karena proxy adalah proses produksi yang sedang melayani toko (dan tidak boleh
dihentikan), perbaikan dipasang di **sisi agen**: agen membandingkan stok
sendiri (`kirimSelisihStok`) pada loop 3 detik, terpisah dari loop pengawas
30 detik. Hasilnya sama tanpa menyentuh produksi.

Dikunci oleh `boot/test-push-stok.js` (10/10) dan
`boot/test-push-stok-e2e.js` (7/7 â€” memakai proxy tiruan yang **sengaja**
tidak pernah mengirim frame `items`, persis seperti aslinya).

> Perbaikan permanen di proxy tetap disarankan saat ada jendela pemeliharaan:
> tambahkan `old.stok !== it.stok` ke perbandingan **dan** pindahkan
> perbandingan ke setelah stok diisi. Setelah itu deteksi di agen bisa
> dipertahankan sebagai lapisan kedua (tidak berbahaya, hanya sedikit
> redundan).

---

## 7. Konfigurasi

### Railway

| Variabel | Nilai |
|---|---|
| `PUSH_TOKEN` | rahasia 43 karakter |
| `IPOS_KEFA_URL` | **harus tetap terisi** (bridge dibuat hanya bila URL ada); tidak pernah di-fetch dalam mode dorong |
| `IPOS_TAILSCALE_PROXY` | kosong |
| `TS_AUTHKEY`, `TS_PROBE_*`, `UJI_*` | kosong (sudah dipensiunkan) |

### PC

`boot/push-agen.env`:
```
PUSH_URL=https://kefa-bot-production.up.railway.app
PUSH_TOKEN=<rahasia>
PUSH_TOKO=kefa
PUSH_JEDA_PENUH_MS=900000
```

Kunci iPos **tidak** disalin ke berkas ini. Agen membacanya langsung dari
`C:\Users\rdpadmin\ipos-api\.env` tanpa pernah mencetaknya.

### Autostart PC

| Task | State | Peran |
|---|---|---|
| `BCODE-JAGA-PUSH` | Ready | penjaga agen dorong |
| `BCODE-JAGA-POLLER` | Ready | pastikan hanya satu poller Telegram |
| `BCODE-JAGA-TUNNEL` | **Disabled** | dipensiunkan |
| `BCODE-KEFA-BOT` / `-WATCHDOG` | Disabled | bot hanya di Railway |
| `BCODE-KEFA-IPOS` | Running | proxy iPos (jangan dihentikan) |

---

## 8. Rollback

Mode dorong hanya aktif bila `PUSH_TOKEN` terisi. Untuk kembali ke perilaku
lama:

1. Kosongkan `PUSH_TOKEN` di Railway â†’ endpoint menolak semua, bridge kembali
   menarik dari `IPOS_*_URL`.
2. Hentikan `BCODE-JAGA-PUSH` + agen.

Tidak ada kode yang perlu diubah: seluruh jalur lama tetap utuh dan hanya
dilewati ketika mode dorong menyala.

---

## 9. Verifikasi

```powershell
node boot\uji-jaminan.js      # 19/19 â€” gerbang lengkap
node boot\test-push-penerima.js   # 14/14
node boot\test-push-delta.js      #  8/8
node boot\test-push-denyut.js     # 10/10
node boot\test-push-pulih.js      #  5/5
node boot\test-push-stok.js       # 10/10
node boot\test-push-stok-e2e.js   #  7/7
node boot\test-push-pendorong.js  #  7/7
node boot\test-push-integrasi.js  #  9/9
node boot\pindai-rahasia.js       # "HASIL: nol kebocoran"
```

`uji-jaminan.js` memeriksa **kedua sisi**: server (endpoint aktif, katalog
diterima, denyut segar, laporan segar) dan PC (agen tepat satu, penjaga hidup,
tidak ada bot lokal, tidak ada poller ganda).

---

## 10. Jebakan yang sudah terbukti

1. **`railway variables --set` bisa exit 0 tanpa menerapkan.** Selalu baca
   ulang dengan `--json` (buang BOM `\uFEFF`) dan bandingkan.
2. **Menyetel variabel Railway memicu redeploy** â†’ 60â€“90 dtk 502. Jangan
   menilai hasil di tengah jendela itu.
3. **`jaga-tunnel` lama menulis `IPOS_*_URL` ke Railway tiap 60 dtk.** Kalau
   dibiarkan, ia bisa menimpa konfigurasi dorong. Sudah dimatikan (task
   Disabled + HKCU Run dihapus).
4. **Jangan pernah menjalankan `index.js` di PC** â€” ia menjadi poller kedua dan
   memicu Telegram 409.
5. **Replika Railway harus 1.** Dua replika = dua poller.
6. **Node 24 wajib** (`node:sqlite` butuh 22+).
