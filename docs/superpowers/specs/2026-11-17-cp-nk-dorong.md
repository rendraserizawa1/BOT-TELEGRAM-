# CP & NK tersambung ke Railway lewat mode dorong

Status: **SELESAI & TERVERIFIKASI** (2026-11-17)

## Akar masalah (terbukti, bukan tebakan)

| # | Temuan | Bukti |
|---|---|---|
| 1 | CP **hidup**: 11 037 item, `lastSync` bergerak tiap 10 dtk, laporan 18 nota/24,8 jt | probe 3x |
| 2 | NK **hidup**: 5 250 item, `lastSync` bergerak, laporan 32 nota | probe 2x |
| 3 | Railway **tidak bisa menjangkau** keduanya (Tailscale dipensiunkan) | `/health` → `online=false`, "belum ada katalog dorongan dari PC" |
| 4 | Agen dorong **tidak pernah** mendorong CP/NK | `PUSH_TOKO=kefa` + filter URL loopback-only |
| 5 | Laporan CP **BEKU** di sumbernya | `update` umur 1737→1762→1788 dtk; `err: ENETUNREACH 192.168.77.250:5444` |
| 6 | Bridge mode dorong **selalu** membaca jenis `jual` | laporan merek/marketplace menerima bentuk kasir |

Kesimpulan penting: **CP tidak mati.** Yang rusak adalah jalur pengiriman datanya
ke Railway, ditambah DB laporan di mesin CP sendiri.

## Ukuran beban (dasar pemilihan jeda, bukan tebakan)

| Toko | Item | Katalog | Tarik | SSE kirim `items`? |
|---|---|---|---|---|
| KEFA | 4 708 | 781 KB | ~0,7 dtk (localhost) | **tidak** (cacat proxy, lihat catatan) |
| CP | 11 037 | 2 107 KB | ~1,1 dtk (tailnet) | ya (terbukti 01:32:15) |
| NK | 5 250 | 981 KB | ~0,5 dtk (tailnet) | ya (terbukti 01:47:13) |

Karena itu jeda pemantau stok berbeda per toko: **KEFA 3 dtk, CP 15 dtk,
NK 20 dtk**. Satu jeda global akan membuat CP/NK memakan bandwidth tailnet
terus-menerus, atau membuat KEFA tidak realtime.

Catatan: cacat proxy (`stok` tidak ikut dibandingkan, dan perbandingan berjalan
sebelum stok diisi) hanya terbukti pada proxy **KEFA**. Proxy CP/NK adalah build
berbeda dan **tidak** diasumsikan cacat — SSE keduanya memang mengirim `items`.

## Yang dikerjakan

### A. Bridge: jenis laporan yang benar (`ipos-bridge.js`)
- `ambilLaporanKasir` → `jual`, `ambilLaporanMerek` → `jual-merek`,
  `ambilLaporanMarketplace` → `jual-marketplace`.
- Rentang tanggal diperiksa: laporan dorongan hanya menjawab rentang yang
  benar-benar dikirim agen (hari ini). Rentang lain **ditolak dengan pesan
  jelas** — gagal terlihat jauh lebih baik daripada salah yang tersembunyi.

### B. Agen: sumber tailnet + profil per toko (`boot/push-agen.js`)
- `urlSumberSah()`: hanya loopback dan tailnet `100.64.0.0/10`. Tunnel publik
  ditolak — alamat itu untuk bot di Railway, bukan untuk agen.
- `profilToko()`: jeda stok/laporan/merek/marketplace per toko, semua bisa
  diatur lewat env. Default KEFA dipertahankan (3 dtk) → perilaku PC tidak berubah.
- Ikut mendorong `jual-merek` dan `jual-marketplace` (jeda 5 menit) beserta
  `dari`/`sampai` supaya bridge bisa menolak rentang yang salah.
- `alamatGanda()`: menolak jalan bila dua toko menunjuk alamat yang sama.

### C. Konfigurasi
- `boot/push-agen.env` (gitignored) diisi tiga toko: KEFA loopback, CP & NK tailnet.
  Ditulis oleh `boot/susun-env-agen.js` yang **tidak pernah mencetak rahasia**.
- `boot/jaga-push.ps1`: `push-agen.env` kini **selalu menimpa** env, bukan hanya
  mengisi yang kosong.

## Hasil (terverifikasi)

```
/health Railway
  CP    online=True total=11037 sse=True itemSegar=True
  NK    online=True total=5250  sse=True itemSegar=True
  KEFA  online=True total=4708  sse=True itemSegar=True
  push.cp/nk/kefa: items segar, denyut 9 dtk
  telegramPollErrorStreak=0, volumeOk=true
uji-jaminan.js: 19/19 — SEMUA JAMINAN TERPENUHI
pindai-rahasia.js: nol kebocoran
```

Agen: `mendorong cp (100.125.99.99), nk (100.110.152.33), kefa (127.0.0.1)`,
katalog 11037 / 5250 / 4708, SSE ketiganya tersambung, delta sudah mengalir.

Uji: 14+8+10+5+10+7+7+9+6 = **76** uji dorong, ditambah **3** uji penjaga
konfigurasi dan **19** uji agen tiga-toko. Semua lulus.

### Tiga cacat tambahan yang ikut ditemukan & diperbaiki

1. **`push-agen.env` tidak dibaca oleh agen** — hanya oleh wrapper PowerShell.
   Tanpa wrapper, `cp` jatuh ke default loopback yang sama dengan `kefa`,
   sehingga **katalog KEFA dikirim sebagai data CP** (4.708 item) tanpa error
   apa pun, dan `/health` tampak sehat. Ditemukan oleh uji tiga-toko, bukan oleh
   pembacaan kode.
2. **Wrapper PowerShell mengalahkan file** — `jaga-push.ps1` hanya mengisi env
   yang belum ada, sehingga wrapper lama terus mewariskan `PUSH_TOKO=kefa`
   walau file sudah `cp,nk,kefa`. Itu sebab agen sempat tetap hanya mendorong
   `kefa` sesudah file diperbarui.
3. **Bridge selalu membaca jenis `jual`** — memperbaiki KEFA yang sudah rusak
   sekarang, bukan hanya CP/NK.

## Yang TIDAK bisa diperbaiki dari sini

Laporan jual CP **beku di sumbernya**: `err: connect ENETUNREACH
192.168.77.250:5444`. Proxy CP tidak bisa mencapai DB iPos di mesinnya sendiri.
Bot kini menandainya jujur (`laporanBasi=true`, `laporanUmur≈2650 dtk`) alih-alih
menampilkan angka lama seolah segar.

Perbaikan butuh akses ke mesin admin Dimas (`100.125.99.99`, port 22 & 3389
terbuka). Di PC ini **tidak ada** kredensial tersimpan: `credentials rdp.xlsx`
tidak ditemukan, tidak ada kredensial RDP di `cmdkey`, dan SSH menolak
publickey. Menebak kredensial dilarang.

## Rollback

1. Kembalikan `boot/push-agen.env` dari cadangan (`%TEMP%\push-agen.env.bak`).
2. `git revert` commit ini.
3. Matikan rantai (`push-agen.js`, `jaga-push.js`, wrapper `jaga-push.ps1`) lalu
   `Start-ScheduledTask BCODE-JAGA-PUSH`.

Catatan: menambah/mengubah env hanya memengaruhi agen setelah rantai penjaga
dinyalakan ulang, karena env proses menang atas env modul.
