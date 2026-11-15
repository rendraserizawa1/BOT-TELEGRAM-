# STATUS: Jalur iPos lewat Tailscale (Opsi A1)

Terakhir diperbarui: 2026-11-15

## Ringkasan satu paragraf

Container Railway sudah **mampu** menjadi anggota tailnet: biner Tailscale 1.102.4
terpasang di image, `tailscaled` userspace dijalankan entrypoint, dan seluruh kode
iPos sudah diarahkan lewat satu modul jalur yang bisa memakai proxy tailnet.
Yang **belum** ada hanya `TS_AUTHKEY` di Railway. Selama kunci itu kosong, bot
berjalan persis seperti sebelumnya (tanpa proxy) — itu memang rancangannya.

## Yang SUDAH terbukti (dengan bukti)

| # | Klaim | Bukti |
|---|---|---|
| 1 | `fetch` global Node 24 **menghormati** `dispatcher` dari `undici` eksternal | `boot/_uji-undici.json`: proxy menerima `CONNECT`; kontrol tanpa dispatcher **tidak** lewat proxy |
| 2 | Proxy HTTP **tidak menahan** body SSE | `boot/test-proxy-sse.js`: 11 potongan, 10 ping, rentang 2995 ms |
| 3 | Modul jalur berperilaku identik dengan `fetch` biasa saat proxy kosong | `boot/test-ipos-jalur.js`: 11/11 lulus, `dispatcher()===null` |
| 4 | Modul jalur bekerja pada **data nyata** lewat IP tailnet | `boot/test-jalur-nyata.js`: `/health` 275 ms, `/api/items` **4593** item, `/api/events` mengalir |
| 5 | Biner Tailscale ikut ke image dan terpasang | log build Railway: `[BUILD] tailscale 1.102.4 terpasang`, `[BUILD] tailscaled siap` |
| 6 | Tanpa `TS_AUTHKEY`, blok Tailscale **dilewati** dan bot tetap hidup | log Railway: `[TAILSCALE] dilewati (TS_AUTHKEY kosong)`; `telegramPollErrorStreak=0` |
| 7 | Proxy iPos :8080 mendengarkan di `0.0.0.0` dan terjangkau lewat IP tailnet | `0.0.0.0:8080 pid=832`; `http://100.123.166.13:8080/ipos/health` → `ok=true items=4593` |
| 8 | Firewall mengizinkan 8080 dari tailnet | aturan `iPos API 8080` = Allow / Inbound / Private / Enabled |
| 9 | Kode baru aktif di produksi dan fallback-nya benar | `/health` memuat `ipos.kefa.jalur = {proxyAktif:false, jalurDipakai:"utama"}` |
| 10 | iPos KEFA kembali online lewat tunnel yang ada | `/health`: `online=true sse=true total=4593 itemSegar=true` |
| 11 | Tidak ada poller kedua | `telegramPollErrorStreak=0`; `jaga-poller` pid 9232 hidup |

## Yang BELUM bisa dibuktikan (dan kenapa)

| Klaim | Penghalang |
|---|---|
| Node Railway benar-benar join tailnet | butuh `TS_AUTHKEY` |
| Proxy Tailscale meneruskan HTTP ke IP 100.x | butuh node join tailnet |
| SSE tetap mengalir **lewat** proxy Tailscale | butuh node join tailnet |
| ACL/tag tailnet tidak memblokir `bcode-railway` | butuh node join tailnet |
| `IPOS_*_URL` bisa dipindah ke IP tailnet | semua di atas harus lulus dulu |

## Kenapa proxy Tailscale aman dipakai (bukan tebakan)

`undici` `ProxyAgent` memakai `CONNECT` bahkan untuk target `http://` — ini
terbukti dari uji (`{"connect":"host:80"}`). Dokumentasi resmi Tailscale
menyatakan proxy HTTP userspace melayani **HTTP dan HTTPS**; HTTPS lewat proxy
HTTP berarti `CONNECT`. Karena itu `CONNECT` pasti dilayani.

Uji langsung di PC ini tidak bisa dijalankan: `tailscaled` kedua butuh named pipe
`\\.\pipe\...`, dan membuat named pipe ditolak dengan
*"This security ID may not be assigned as the owner of this object"* (butuh hak
admin). Jadi bukti CONNECT akan datang dari container itu sendiri lewat
`boot/uji-tailscale.js` — yang memang sudah dirancang untuk itu.

**Rencana cadangan bila ternyata CONNECT tidak dilayani:** jalankan SOCKS5 di
port yang sama (`--socks5-server`) dan pakai `Socks5ProxyAgent`. Dokumentasi
Tailscale mendukung keduanya di satu port. Perubahan hanya di `boot/ipos-jalur.js`
(satu tempat), bukan di 4 titik fetch.

## Langkah berikutnya (butuh 1 variabel)

1. Buat auth key Tailscale: **ephemeral**, **reusable**, tag `tag:bcode`.
2. Isi di Railway: `TS_AUTHKEY` (rahasia) dan `IPOS_TAILSCALE_PROXY=http://127.0.0.1:1056`.
   **JANGAN** ubah `IPOS_*_URL` dulu.
3. Deploy, lalu baca log: harus muncul `[TAILSCALE] siap hostname=bcode-railway`
   dan `[TAILSCALE] peer terlihat = N`.
4. Jalankan uji di dalam container:
   `railway ssh --service kefa-bot "node /app/boot/uji-tailscale.js"` → harus exit 0.
5. Baru ubah `IPOS_KEFA_URL=http://100.123.166.13:8080/ipos`, amati 5 menit:
   `umurKoneksiDetik` harus **naik monoton** (bukti tidak diputus).
6. Terakhir pensiunkan tunnel: `node boot\pensiun-tunnel.js`.

## Rollback (tanpa deploy ulang)

1. Kosongkan `IPOS_TAILSCALE_PROXY` di Railway → `ipos-jalur.js` kembali memakai
   `fetch` biasa.
2. Kembalikan `IPOS_*_URL` ke URL tunnel.
3. `Enable-ScheduledTask BCODE-JAGA-TUNNEL` untuk menghidupkan pengawas tunnel.

## Berkas yang terlibat

- `boot/ipos-jalur.js` — satu-satunya tempat yang tahu soal proxy + cadangan
- `boot/test-ipos-jalur.js`, `boot/test-proxy-sse.js`, `boot/test-jalur-nyata.js` — uji
- `boot/uji-tailscale.js` — uji di dalam container (sudah dikecualikan dari `.gitignore`)
- `boot/pensiun-tunnel.js` — pensiunkan pengawas tunnel setelah terbukti
- `docker-entrypoint.sh` — blok Tailscale (tidak pernah fatal)
- `Dockerfile` — unduh biner 1.102.4 saat build (tidak fatal bila gagal)
- `index.js` — `/health` melaporkan `tailscale.*` dan `ipos.<toko>.jalur.*`
