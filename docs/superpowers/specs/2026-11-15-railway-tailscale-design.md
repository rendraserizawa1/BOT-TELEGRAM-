> ## ⚠️ DOKUMEN INI SUDAH DIGANTIKAN — JANGAN DIIKUTI
>
> Pendekatan Tailscale di bawah **gagal dan sudah dipensiunkan**. Sebabnya
> terukur: node Railway tidak punya jalur langsung ke PC (CGNAT), sehingga
> semua trafik lewat DERP relay dan 780 KB terputus dengan
> `UND_ERR_SOCKET` / `SOCKS5 connection timeout`.
>
> Yang dipakai sekarang: **arah DORONG (PC → Railway)**.
> Baca: `docs/superpowers/specs/2026-11-16-ipos-dorong-final.md`
>
> `TS_AUTHKEY`, `TS_PROBE_*`, `IPOS_TAILSCALE_PROXY` sudah dikosongkan
> dan task `BCODE-JAGA-TUNNEL` sudah Disabled.

---
# Design: Railway masuk jaringan Tailscale (Opsi A1)

Tanggal: 2026-11-15
Status: **menunggu persetujuan** (revisi 2 â€” setelah builder check)

## 1. Intent & why

Bot di Railway harus membaca iPos dari jaringan toko. Sekarang jalurnya lewat
tunnel quick Cloudflare dari PC ini, dan jalur itu **terbukti rusak secara
struktural**, bukan sekadar tidak stabil:

| Bukti (2026-11-15) | Arti |
|---|---|
| 3 hostname `*.trycloudflare.com` â†’ `ENOTFOUND` | URL mati permanen begitu proses cloudflared mati |
| `/ipos/api/events` lewat tunnel: HTTP 200, `text/event-stream`, **0 byte dalam 150 detik** | Cloudflare membekukan body SSE â†’ kanal realtime mati |
| `umurKoneksiDetik` bot: 66 â†’ 0 â†’ 31 â†’ 61 â†’ 5 â†’ 35 â†’ 65 | SSE putus tiap ~66â€“90 dtk (batas diam klien) |
| PC harus hidup 24/7 | PC hanya dijadwalkan hidup sampai 20:00 |

Tujuan: Railway menjadi anggota tailnet sendiri, lalu memakai **HTTP iPos yang
sudah ada** lewat IP Tailscale. Tidak ada lagi tunnel, tidak ada URL yang
berubah, tidak ada ketergantungan pada PC ini untuk CP/NK.

## 2. Goals

1. Container Railway menjalankan `tailscaled` mode userspace dan terdaftar di
   tailnet sebagai node `bcode-railway`.
2. Bot memakai URL iPos tetap: `http://100.125.99.99:8080/ipos` (CP),
   `http://100.110.152.33:8080/ipos` (NK), dan proxy KEFA lewat tailnet.
3. **Hanya** panggilan iPos yang lewat tailnet. Telegram, GitHub, Gemini/Groq/
   OpenRouter tetap langsung.
4. SSE kembali hidup (tidak ada buffering perantara) sehingga realtime nyata.
5. Setiap perubahan punya fallback ke nilai sekarang â†’ perilaku di PC **tidak
   berubah sama sekali** dan rollback cukup mengosongkan satu variabel.
6. Tidak menambah poller kedua, tidak menyentuh `.github/workflows/bot.yml`.

## 3. Non-goals

- Tidak memindahkan proxy KEFA ke `192.168.1.199` (Opsi D, terpisah).
- Tidak memperbaiki CP/NK yang sedang mati karena listrik di lokasi CP.
- Tidak mengubah cara bot memanggil Telegram.
- Tidak memakai `tailscale serve`/`funnel` (kita hanya butuh koneksi **keluar**).

## 4. Anti-goals

- Bot berhenti start karena Tailscale gagal â†’ **wajib** tetap jalan, bukan mati.
- Telegram ikut lewat proxy â†’ pesan lambat/terputus.
- `TS_AUTHKEY` tercetak di log atau masuk repo.
- Ada dua proses bot/poller.
- **Deploy yang tidak pernah stabil** karena ada proses lain yang menimpa
  variabel `IPOS_*_URL` (lihat Â§7.1 â€” ini nyata, bukan hipotetis).

## 5. Pendekatan yang dipertimbangkan

| # | Pendekatan | Trade-off | Putusan |
|---|---|---|---|
| **A1** | `tailscaled -tun=userspace-networking -outbound-http-proxy-listen=127.0.0.1:1056` + proxy per-permintaan untuk iPos saja | image +37 MB, +1 dependensi, butuh auth key | **DIPILIH** |
| A2 | A1 + URL cadangan tunnel | butuh PC hidup | **sebagian dipakai**: cadangan berupa *URL kedua* (bisa tailnet atau tunnel), bukan logika tunnel |
| A3 | Tetap tunnel (status quo) | sudah terbukti rapuh (Â§1) | ditolak |
| A4 | `setGlobalDispatcher(EnvHttpProxyAgent)` | **semua** fetch ikut proxy termasuk Telegram | ditolak (melanggar goal 3) |
| A5 | `tailscale serve` di PC + akses masuk | tetap bergantung PC | ditolak |

## 6. Desain

### 6.1 Alur

```
Railway container
 â”œâ”€ entrypoint.sh
 â”‚   â”œâ”€ (bila TS_AUTHKEY ada) jalankan tailscaled userspace di background
 â”‚   â”‚    â””â”€ outbound HTTP proxy 127.0.0.1:1056  (CONNECT ke tailnet)
 â”‚   â”œâ”€ tailscale up --authkey --hostname=bcode-railway --accept-routes
 â”‚   â””â”€ exec node index.js
 â””â”€ ipos-bridge.js
     â””â”€ fetchIpos(url, opsi)  â† pembungkus tunggal, HANYA untuk iPos
         â”œâ”€ percobaan 1: URL utama  + dispatcher proxy
         â””â”€ percobaan 2: URL cadangan (bila diisi) + fetch biasa
```

### 6.2 Perubahan berkas

| Berkas | Perubahan | Fallback |
|---|---|---|
| `Dockerfile` | unduh `tailscale_1.102.4_amd64.tgz` saat build â†’ `/usr/local/bin/{tailscale,tailscaled}`. Build **tidak gagal** bila unduhan gagal. | image lama tetap sah |
| `docker-entrypoint.sh` | blok baru: `TS_AUTHKEY` kosong â†’ lewati total (satu baris log). Ada â†’ jalankan tailscaled, `tailscale up`, tunggu siap maks 60 dtk. | tanpa `TS_AUTHKEY` perilaku **identik** sekarang |
| `package.json` | tambah `undici` (versi dipatok, lihat Â§6.6) | â€” |
| `boot/ipos-jalur.js` (baru) | `buatJalurIpos({urlUtama, urlCadangan, proxy})` â†’ `{ ambil(url), dispatcher, status() }`. Satu-satunya tempat yang tahu soal proxy & cadangan. | tanpa env â†’ `ambil()` = `fetch` biasa |
| `ipos-bridge.js` | 4 `fetch()` iPos diganti `jalur.ambil(...)`; SSE memakai URL yang sedang berhasil | tanpa env â†’ perilaku sekarang |
| `index.js` `/health` | tambah `tailscale:{aktif,hostname,siap}` dan `ipos.<toko>.jalur:{utama,cadangan,dipakai}` | field baru, tidak mengubah yang lama |
| `boot/uji-tailscale.js` (baru) | dijalankan **di dalam container** lewat `railway ssh` | â€” |
| `boot/jaga-tunnel.js` | **dipensiunkan** (lihat Â§7.1) | â€” |
| `boot/uji-jaminan.js` | assertion tunnel diganti assertion Tailscale | â€” |

### 6.3 Variabel Railway

| Variabel | Nilai | Catatan |
|---|---|---|
| `TS_AUTHKEY` | `tskey-auth-...` | **rahasia**, hanya di Railway |
| `IPOS_TAILSCALE_PROXY` | `http://127.0.0.1:1056` | kosong = fitur mati |
| `IPOS_URL` | `http://100.125.99.99:8080/ipos` | CP |
| `IPOS_NK_URL` | `http://100.110.152.33:8080/ipos` | NK |
| `IPOS_KEFA_URL` | `http://100.123.166.13:8080/ipos` | proxy KEFA di PC ini |
| `IPOS_KEFA_URL_CADANGAN` | URL tunnel (opsional) | hanya bila masih ingin jaring kedua |

`PORT` tetap **tidak** diisi. Replika tetap **1**.

### 6.4 Kenapa proxy per-permintaan, bukan global

`setGlobalDispatcher` membuat **semua** `fetch` lewat proxy, termasuk
`api.telegram.org`. Telegram lewat tailnet menambah latensi dan satu titik
gagal. Dengan dispatcher per-permintaan, hanya iPos yang dialihkan.

### 6.5 Kesiapan & kejujuran status

`/health` melaporkan `tailscale.siap` dari `tailscale status --json`
(`BackendState === "Running"`). Bila tailscaled gagal, `siap=false` dan bot
tetap jalan. **Tidak ada klaim "realtime" palsu.**

### 6.6 Mekanisme fetch yang dipakai (jawaban builder check #4)

Diuji empiris di PC ini (Node **24.22.0**, undici bawaan **7.29.1**, paket
undici **7.30.2**) dengan proxy HTTP palsu yang mencatat setiap permintaan:

- `fetch` **global** Node 24 dengan `dispatcher` dari paket undici eksternal:
  hasil uji dicatat di `boot/_uji-undici.json`.
- `undici.fetch` dengan `ProxyAgent` yang sama: pembanding.

**Aturan putusan:** bila `fetch` global **tidak** terbukti meneruskan ke proxy,
maka keempat titik panggil **wajib** memakai `undici.fetch`. Ini bukan pilihan
gaya: memakai dispatcher yang diabaikan berarti koneksi diam-diam tetap
langsung, yaitu kegagalan senyap yang justru ingin dihilangkan.

Karena `ipos-bridge.js` punya penanganan error yang bergantung pada bentuk error
(`formatError()` membaca `e.cause.errors[].code`, diuji byte-per-byte oleh
`boot/test-format-error.js`), penggantian mekanisme **wajib** disertai:
1. `boot/test-format-error.js` tetap lulus, dan
2. semantik `AbortController` pada SSE serta pengklasifikasi retry katalog
   (`ipos-bridge.js:116`) diuji ulang.

Versi `undici` dipatok **7.x** agar selaras dengan major yang dibawa Node 24.

### 6.7 Cadangan otomatis (jawaban builder check #3)

Anti-goal Â§4.1 menuntut "tetap jalan dengan jalur lama", bukan sekadar "tidak
crash". Karena itu cadangan dibuat **otomatis tetapi sederhana**:

- `IPOS_<TOKO>_URL_CADANGAN` (opsional). Kosong â†’ perilaku sekarang.
- `boot/ipos-jalur.js` mencoba **utama** dulu; bila gagal karena jaringan
  (bukan 404/401), ulangi **sekali** ke cadangan, lalu **ingat** jalur yang
  berhasil agar tidak mencoba-coba terus.
- SSE memakai jalur yang sedang berhasil; loop sambung-ulangnya sudah punya
  backoff eksponensial, jadi tidak perlu logika baru.
- `/health` melaporkan jalur mana yang dipakai, sehingga tidak ada tebak-tebakan.

Ini menambah satu modul + satu variabel per toko, bukan menulis ulang bridge.

## 7. Temuan builder check & jawabannya

### 7.1 `boot/jaga-tunnel.js` akan menimpa balik pekerjaan ini â€” NYATA

`jaga-tunnel.js:310-314` menulis `IPOS_*_URL` kembali ke URL tunnel setiap kali
nilainya berbeda, tiap 60 detik. Begitu `IPOS_KEFA_URL` diubah ke alamat
Tailscale, pengawas itu akan mengembalikannya, memicu redeploy, dan mengulang
tiap menit. **Deploy tidak akan pernah stabil.**

**Putusan:** pengawas tunnel **dipensiunkan** sebagai bagian dari pekerjaan ini.

Urutan wajib (tidak boleh dibalik):

1. Pasang Tailscale + verifikasi (tunnel masih hidup sebagai jalur utama).
2. Baru matikan: `Disable-ScheduledTask BCODE-JAGA-TUNNEL`,
   hapus HKCU `BCODE_JAGA_TUNNEL`, hentikan proses `jaga-tunnel.js`, matikan
   `cloudflared`.
3. Setelah itu ubah `IPOS_*_URL` ke alamat Tailscale.

Konsekuensi: `boot/uji-jaminan.js` **tidak boleh** lagi menguji pengawas tunnel
(16/16 versi lama tidak berlaku). Assertion-nya diganti menjadi:
`tailscale.siap=true`, `ipos.kefa.online=true`, SSE menerima keepalive,
tidak ada proses `jaga-tunnel`, tidak ada `cloudflared` yang tertinggal.

`boot/jaga-poller-tunggal.js` **tetap hidup** â€” tugasnya tidak berubah.

### 7.2 Cara menjalankan verifikasi di dalam container

`railway ssh` **tersedia** (sudah diverifikasi: `railway ssh [COMMAND]...`).
Jadi rencananya:

- `boot/uji-tailscale.js` dijalankan di dalam container lewat
  `railway ssh --service kefa-bot "node /app/boot/uji-tailscale.js"`.
- Ditambah **self-test saat boot**: entrypoint mencatat hasil
  `tailscale status` dan satu percobaan HTTP ke tiap iPos ke log, sehingga
  kegagalan terlihat tanpa perlu SSH.

Tidak ada staging; semua uji menyentuh layanan produksi. Karena itu urutan
cutover dibuat agar kegagalan build tidak mematikan jalur iPos:
**build dulu â†’ pastikan container sehat â†’ baru ubah variabel URL** â†’ dan
rollback = kosongkan `IPOS_TAILSCALE_PROXY` (satu variabel, tanpa deploy kode).

### 7.3 ACL, tag, dan firewall (jawaban builder check #5)

Yang **sudah diverifikasi** di PC ini:

- Interface `Tailscale` berprofil **Private**.
- Aturan firewall `iPos API 8080` = **Allow / Inbound / Private** â†’ inbound
  8080 lewat interface Tailscale **diizinkan** oleh firewall Windows.
- Proxy KEFA bind `0.0.0.0:8080`, dan `http://100.123.166.13:8080/ipos/health`
  menjawab dari PC ini.
- CP/NK punya IP `100.x` â†’ keduanya **node tailnet langsung**, bukan di balik
  subnet router. Jadi `--accept-routes` hanya berguna untuk `192.168.77.250`
  (DB CP), yang **tidak** dipakai jalur ini â†’ tidak ada ketergantungan subnet
  router.

Yang **belum bisa diverifikasi dari PC ini**: apakah ada ACL/tag khusus, dan
apakah 8080 benar-benar terjangkau **dari node lain**. Itu baru bisa diuji
setelah container bergabung. Karena itu uji pertama setelah `tailscale up`
adalah `curl` dari dalam container ke ketiga alamat â€” bukan dari PC ini.

Bila ternyata ACL memblokir, perbaikan ada di admin console (ACL/grant), dan
`tailscale up` mungkin perlu `--advertise-tags`. Perubahan itu **tidak** bisa
dilakukan dari repo.

### 7.4 CP/NK sedang mati (jawaban builder check #6)

Cutover dilakukan **bertahap per toko**, karena variabel URL memang terpisah:

| Tahap | Syarat | Bukti |
|---|---|---|
| 1. KEFA | sekarang | `online=true`, SSE â‰¥3 keepalive/60 dtk, 5 menit tanpa reset |
| 2. CP & NK | setelah listrik/ISP lokasi CP pulih | `online=true` untuk masing-masing |

KEFA dibuktikan **oleh pengamatan**. CP/NK dibuktikan **oleh konfigurasi**
(alamat benar, proxy hidup, rute tailnet sama) dan diverifikasi begitu hidup.
Ini keputusan sadar: menunggu CP/NK berarti menunda perbaikan KEFA tanpa
alasan.

## 8. Risiko & mitigasi

| Risiko | Mitigasi |
|---|---|
| Pengawas tunnel menimpa URL (Â§7.1) | pensiunkan lebih dulu, sebelum ubah variabel |
| Auth key kedaluwarsa | pakai key **reusable + ephemeral**; `/health` â†’ `siap=false` |
| `tailscaled` tidak mau jalan di Railway | blok entrypoint tidak fatal; bot tetap start |
| `fetch` global mengabaikan dispatcher (Â§6.6) | uji empiris; bila diabaikan â†’ pakai `undici.fetch` |
| ACL menolak node baru | uji `curl` dari dalam container sebelum ubah variabel |
| Image +37 MB | hanya saat build |

## 9. Cara membuktikan berhasil

1. Log Railway memuat `[TAILSCALE] siap hostname=bcode-railway`.
2. `railway ssh` â†’ `boot/uji-tailscale.js`: ketiga alamat iPos menjawab.
3. SSE menerima **â‰¥3 keepalive dalam 60 dtk** (sekarang **0 dalam 150 dtk**),
   dan `umurKoneksiDetik` **tidak pernah reset** selama 5 menit.
4. `/health`: `tailscale.siap=true`, `ipos.kefa.online=true`, `sse=true`.
5. `boot/uji-jaminan.js` (versi baru) lulus penuh.
6. `telegramPollErrorStreak=0` â€” Telegram tidak ikut proxy.

## 10. Rollback

1. Kosongkan `IPOS_TAILSCALE_PROXY` â†’ `ipos-jalur.js` memakai `fetch` biasa.
2. Isi kembali `IPOS_*_URL` ke URL tunnel (bila tunnel masih ingin dipakai),
   dan `Enable-ScheduledTask BCODE-JAGA-TUNNEL` untuk menghidupkan pengawasnya.
3. Kode tidak perlu di-deploy ulang.

## 11. Yang saya putuskan sendiri (bisa Anda koreksi)

- Versi Tailscale dipatok `1.102.4` (sama dengan PC).
- Proxy hanya untuk iPos, tidak global.
- Pengawas tunnel dipensiunkan (Â§7.1) â€” ini konsekuensi teknis, bukan selera.
- `IPOS_KEFA_URL` menunjuk PC ini dulu (`100.123.166.13`).
- Cadangan otomatis dibuat (Â§6.7) karena anti-goal menuntutnya.
- Cutover bertahap per toko (Â§7.4).

## 12. Yang masih dibutuhkan dari Anda

Auth key Tailscale **sudah diterima**. Karena kunci itu sudah tertulis di
percakapan, sebaiknya **di-rotasi** (revoke + buat baru) setelah pemasangan
terbukti jalan. Kunci baru cukup diganti di variabel Railway.

