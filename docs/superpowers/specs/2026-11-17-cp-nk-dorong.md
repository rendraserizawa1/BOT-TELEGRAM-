# CP & NK tersambung ke Railway lewat mode dorong

Status: **SELESAI & TERVERIFIKASI** (2026-11-17)

## Laporan TANGGAL LAMPAU (perbaikan lanjutan, 2026-11-17)

Keluhan: laporan marketplace CP **14/11/2026 dilaporkan KOSONG**, padahal di
sumbernya ada 6 nota / **Rp 26.583.000**.

### Akar masalah

Agen hanya mendorong laporan **hari ini**, dan bridge **menolak** rentang tanggal
lain. Penolakan itu niatnya benar — jangan menyajikan angka hari ini untuk
pertanyaan tanggal lain — tetapi akibatnya data yang **ADA** menjadi tidak bisa
diakses sama sekali. Penjaga rentang itu ditambahkan pada commit sebelumnya, jadi
ini **regresi**, bukan cacat lama. Berlaku untuk semua toko, bukan hanya CP.

### Perbaikan: jalur PESANAN

Railway tidak bisa menjangkau iPos (CGNAT) dan PC tidak bisa dijangkau dari luar,
jadi arah data **tetap PC → Railway**:

1. Bot butuh rentang yang belum ada → catat **pesanan** (`mintaRentang`).
2. Agen menjemput pesanan tiap 2 dtk: `GET /api/ipos/perlu?toko=cp` (token wajib).
3. Agen mengambil laporan itu dari proxy toko, lalu mengirimnya seperti biasa.
4. Bot menyajikannya; permintaan berikutnya dilayani dari **gudang rentang**.

Tidak ada koneksi masuk ke PC, jadi tidak ada yang perlu dijaga tetap hidup.

### Dua kesalahan yang ditemukan oleh uji (bukan oleh dugaan)

1. **Laporan tanggal lampau menimpa slot laporan hari ini.** Akibatnya `/health`
   melaporkan laporan hari ini "segar" padahal isinya laporan minggu lalu, dan
   permintaan laporan hari ini bisa dilayani isi tanggal lampau. Sekarang slot
   hanya digeser oleh laporan yang `sampai`-nya sama atau lebih baru.
2. **Gudang rentang meloloskan laporan hari ini dari pemeriksaan kesegaran.**
   Laporan yang rentangnya **mencakup hari ini** masih berubah, jadi tetap WAJIB
   segar; hanya rentang yang sudah **lewat** yang boleh dipakai ulang.

### Bukti

| Uji | Hasil |
|---|---|
| `boot/test-laporan-rentang-lampau.js` | **25/25** |
| `boot/bukti-uji-tangkap-bug.js` (uji vs kode lama) | kode lama **10 gagal**, kode baru **25/25** |
| `boot/test-rantai-pesanan-nyata.js` (data ASLI) | **9/9** — marketplace CP 14/11 → 6 nota, Rp 26.583.000 |
| 16 uji dorongan lain | semua lulus |
| `boot/uji-jaminan.js` | 19/19 |
| `boot/pindai-rahasia.js` | nol kebocoran |

Uji rantai penuh membuktikan sambungannya, bukan hanya logikanya: agen sungguhan
menjemput pesanan, mengambil dari proxy toko sungguhan, dan bot menyajikannya —
dan permintaan kedua **tidak** meminta ulang ke PC.

### Rollback

Kembalikan `ipos-bridge.js` (`laporanDorong`), `boot/push-penerima.js`,
`boot/push-gudang.js`, `boot/push-agen.js`, dan endpoint `/api/ipos/perlu` di
`index.js` ke commit `1ad68f2^`. Tanpa endpoint itu, agen hanya gagal menjemput
dan tidak mengganggu jalur dorongan yang sudah berjalan.

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

## Pembandingan data asli iPos vs yang dipakai bot (2026-11-17)

Dijalankan dengan **agen sungguhan + penerima sungguhan + modul bot sungguhan**
(`boot/banding-laporan-ipos.js`), memakai data asli hari itu.

```
pemeriksaan: 819   berbeda: 0   -> SEMUA ANGKA COCOK DENGAN SUMBER iPos

CP    penjualan  nota=18/18  omzet=24.813.000/24.813.000  kasir=3/3   COCOK
      merek      HOMMY=191.000  KIREI=0                              COCOK
      marketplace nota=0/0 omzet=0/0 nomor=12/12                      COCOK
      katalog    11037/11037 item, sampel 250                         COCOK
NK    penjualan  nota=40/40  omzet=4.954.500/4.954.500    kasir=3/3   COCOK
      merek      HOMMY=362.000  KIREI=0                              COCOK
      marketplace nota=0/0 omzet=0/0 nomor=0/0                        COCOK
      katalog    5250/5250 item, sampel 250                           COCOK
KEFA  penjualan  nota=8/8    omzet=1.078.000/1.078.000    kasir=2/2   COCOK
      merek      HOMMY=10.000   KIREI=0                              COCOK
      marketplace nota=0/0 omzet=0/0 nomor=0/0                        COCOK
      katalog    4708/4708 item, sampel 250                           COCOK
```

Yang dibandingkan per toko: seluruh `total` laporan penjualan (nota, item, omzet,
tunai, debit, kredit, jumlah kasir), rincian **per kasir** (userid/nota/item/omzet),
`perTipe`, `dari`/`sampai`; seluruh `data` per merek + `total` + `merek` +
`totalPelanggan` + `notaRentang` + `jangkauan`; seluruh `central` marketplace +
`total` + `nomor` + `jangkauan`; dan jumlah katalog + sampel 250 item
(stok/harga/harga2/hpp/nama/satuan).

### Kesetiaan angka & jam mesin (`boot/banding-update-hidup.js`)

```
CP    jam SEJAJAR (+0)  sumber tidak bergerak  agen=1794877695841  bot SAMA PERSIS
NK    jam SEJAJAR (+0)  sumber bergerak        agen di dalam rentang  bot SAMA PERSIS
KEFA  jam SEJAJAR (+0)  sumber bergerak        agen di dalam rentang  bot SAMA PERSIS
```

Field `update` sengaja **tidak** dibandingkan sama-persis: nilainya naik terus
saat toko melayani penjualan, jadi membandingkannya ketat selalu memberi alarm
palsu. Yang dibuktikan: (a) bot memakai angka yang **sama persis** dengan yang
dikirim agen, dan (b) angka agen sah dari sumber.

### Catatan bentuk data yang berbeda antar build proxy

| Proxy | `lastSync` | Kode error DB |
|---|---|---|
| KEFA | string ISO (`2026-11-17T01:58:07.729Z`) | — |
| CP | angka epoch ms | `ENETUNREACH 192.168.77.250:5444` (hanya jalur laporan) |
| NK | angka epoch ms | — |

Bot **tidak** mem-parse `lastSync` dari proxy (ipos-bridge memakai `Date.now()`
internal), jadi perbedaan bentuk ini tidak berdampak produksi — hanya perlu
ditangani di alat ukur.

`nomor` pada laporan marketplace = jumlah **HARI** di bulan berjalan yang punya
nota marketplace (`hariJual.size`), **bukan** jumlah nota hari itu. Karena itu
`nomor=12` dengan `central.nota=0` adalah wajar, bukan bug.

## Yang TIDAK bisa diperbaiki dari sini

Laporan jual CP **beku di sumbernya**: `err: connect ENETUNREACH
192.168.77.250:5444`. Proxy CP tidak bisa mencapai DB iPos di mesinnya sendiri.
Bot kini menandainya jujur (`laporanBasi=true`, `laporanUmur≈3000 dtk`) alih-alih
menampilkan angka lama seolah segar.

**Bukti penting bahwa DB-nya SEHAT** — hanya rute di mesin CP yang rusak:

```
dari PC ini:  192.168.77.250:5444  TERBUKA (DB hidup, lewat subnet router Tailscale)
dari CP  :    ENETUNREACH           (proxy CP tidak bisa menjangkau DB-nya sendiri)
```

Jadi yang perlu diperbaiki di mesin admin Dimas hanyalah rute/`PGHOST` proxy CP,
bukan database-nya. Katalog CP tetap segar karena memakai jalur lain.

Perbaikan butuh akses ke mesin itu (`100.125.99.99`, port 22 & 3389 terbuka).
Di PC ini **tidak ada** kredensial tersimpan: `credentials rdp.xlsx` tidak
ditemukan, tidak ada kredensial RDP di `cmdkey`, dan SSH menolak publickey.
Menebak kredensial dilarang.

## Rollback

1. Kembalikan `boot/push-agen.env` dari cadangan (`%TEMP%\push-agen.env.bak`).
2. `git revert` commit ini.
3. Matikan rantai (`push-agen.js`, `jaga-push.js`, wrapper `jaga-push.ps1`) lalu
   `Start-ScheduledTask BCODE-JAGA-PUSH`.

Catatan: menambah/mengubah env hanya memengaruhi agen setelah rantai penjaga
dinyalakan ulang, karena env proses menang atas env modul.
