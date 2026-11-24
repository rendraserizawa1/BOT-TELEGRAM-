# Stock Opname berjalan 1 minggu penuh (tidak reset tiap hari)

Tanggal: 2026-11-24
Status: **rancangan — menunggu persetujuan**

## Keluhan

> "buat so ini berlaku selama 1 minggu penuh dan tidak akan file atau mode so di
> toko yang sedang aktif jadi mau so hari ini dan lanjut lusa atau beberapa hari
> kedepan data so masih berlanjut terus dan bisa langsung sambung meneruskan
> jangan sampai coba untuk besok lanjut SO tidak bisa berlanjut bertahan 1 minggu
> full jangan cuman 1 hari langsung mulai awal dari baru, bisa menghapus atau
> reset data bersihkan mulai dari awal jika admin memencet memilih tombol reset
> untuk hapus dan mulai baru"

Dua hal yang diminta:

1. SO **bertahan 1 minggu penuh**. Hari ini mulai, besok/lusa/beberapa hari ke
   depan **lanjut**, bukan mulai dari nol.
2. Admin bisa **reset manual** kapan saja (hapus semua, mulai baru).

## Akar masalah

`getSOShared()` (`index.js:2439`) mereset seluruh data SO **setiap kali tanggal
berganti**:

```js
function getSOShared(tokoKode) {
  const tanggalHariIni = getTanggalSlash(false);
  ...
  if (SO_SHARED[tokoKode].tanggal !== tanggalHariIni) {
    backupSOShared(tokoKode);                      // arsipkan
    SO_SHARED[tokoKode] = {                        // HAPUS SEMUA
      tanggal: tanggalHariIni,
      sesiAktif: false,
      racks: {},                                   // semua rak + entri hilang
      usersAktif: {},
      barangBaru: [],
    };
    saveJSON(CONFIG.paths.soShared, SO_SHARED);
  }
  ...
}
```

Karena `getSOShared` dipanggil oleh **28 fungsi** (semua pembaca SO), reset ini
terjadi otomatis pada request pertama setelah tengah malam. Itulah sebabnya
"besok lanjut SO tidak bisa, mulai dari awal lagi".

Reset manual (`so:reset_confirm` → `so:reset_yes`, `index.js:14088`) **sudah
benar** dan sudah mem-backup lebih dulu. Yang perlu diperbaiki hanya reset
otomatisnya.

## Keputusan yang sudah dipilih pemilik

| Pertanyaan | Pilihan |
|---|---|
| Hitungan ulang barang sama di hari berbeda | **C** — tampilkan semua, total pakai hitungan terakhir |
| Patokan 1 minggu | **A** — 7×24 jam sejak mulai/reset |
| Saat 1 minggu habis | **A** — reset otomatis dengan backup |

## Rancangan

### 1. Sesi punya masa berlaku (bukan tanggal harian)

Field baru di data SO per toko:

```js
{
  tanggal: '24/11/2026',      // dipertahankan: tanggal MULAI sesi
  sesiMulai: 1795000000000,   // ms epoch saat mulai/reset
  sesiBerakhir: 1795604800000,// sesiMulai + 7*24*60*60*1000
  sesiAktif: true,
  racks: {}, usersAktif: {}, barangBaru: [],
}
```

`getSOShared()` berubah:

- Data belum ada → buat baru, `sesiMulai = sekarang`, `sesiBerakhir = +7 hari`.
- Ada data **tanpa** `sesiMulai` (data lama) → anggap mulai hari ini, isi
  `sesiMulai`/`sesiBerakhir`. **Tidak ada data yang dihapus.**
- `sekarang > sesiBerakhir` → `backupSOShared()` lalu mulai sesi baru (7 hari).
- Selain itu → **kembalikan data apa adanya**, walau sudah beda hari.

`sesiBerakhir` disimpan (bukan dihitung ulang tiap panggilan) supaya batasnya
tidak bergeser bila konstanta berubah di kemudian hari.

### 2. Entri menyimpan tanggal

Sekarang entri hanya punya `jamInput: "10:25"` + `timestamp`. Kalau sesi
berjalan seminggu, dua entri beda hari bisa tampak berjam sama.

Field baru `tanggal` (`'24/11/2026'`) di setiap entri baru. Entri lama tanpa
`tanggal` **diturunkan** dari `timestamp` saat dibaca (tidak ditulis ulang),
sehingga tidak ada data yang berubah.

Tampilan riwayat:

```
1. *Dimas* _(Anda)_ di *rak lantai 1 hommy*
   📅 24/11 ⏰ 10:25 | 🏪 FISIK: 12
```

### 3. Total: hari terakhir menang, dijumlah di dalam hari

Aturan yang dipakai (cakupan **antar hari** saja, sesuai pertanyaan yang
dijawab pemilik):

- Entri dikelompokkan per **rak** dan per **jenis** (fisik/gudang).
- Untuk tiap kelompok, dipakai **hari terakhir** yang punya entri.
- Di dalam hari itu, qty **dijumlahkan** (perilaku sekarang dipertahankan).

Contoh:

| Kejadian | Hasil |
|---|---|
| Tri input 2 lalu 4, **hari yang sama** | 6 (tidak berubah) |
| Rak A dihitung 10 **Senin**, dihitung 8 **Kamis** | 8 |
| Rak A 10 Senin, rak B 4 Kamis (barang sama, rak beda) | 12 |

Entri dari hari yang sudah tidak dipakai tetap **ditampilkan** di riwayat dengan
tanda `↩️ dihitung ulang`, supaya petugas tahu angkanya diganti, bukan hilang.

Helper baru:

```js
// Mengembalikan { fisik, gudang, total, adaHitungUlang }
function hitungTotalSO(entries)
```

`getBarangDiSemuaRak`, `getTotalBarangSemuaRak`, `getSOGabunganData`,
`getAllItemsSO`, laporan, dan export Excel memakai helper ini agar angkanya
tidak pernah berbeda antar layar.

### 3B. Detail lengkap per entri — SEMUA tempat

Permintaan pemilik (penjelasan atas pertanyaan persetujuan):

> "tampilkan detail semua nama petugas di hari tanggal berapa jam berapa di rak
> mana di gudang mana beserta jumlah per entrynya dan tanggal serta jam dan menit
> lengkap"

Artinya setiap entri harus terbaca **lengkap tanpa perlu menebak**:

| Yang harus ada | Sumber |
|---|---|
| Nama petugas | `e.namaPetugas` |
| Tanggal | `e.tanggal` (baru) / turunan `e.timestamp` |
| Jam dan menit | `e.timestamp` (otoritatif) / `e.jamInput` |
| Rak mana | nama rak dari `shared.racks` |
| Gudang mana | `e.jenis` → `FISIK (TOKO)` / `GUDANG` |
| Jumlah per entri | `e.qty` (bukan hasil penjumlahan) |

**Format layar "Barang ditemukan!"** (`formatInfoBarangDiRakLain`):

```
📋 *RIWAYAT HITUNG BARANG INI:*
──────────────────
1. *Dimas* _(Anda)_
   📅 24/11/2026 ⏰ 10:25
   📍 Rak: *rak lantai 1 hommy*
   🏪 FISIK (TOKO): *12*

2. *Tri*
   📅 25/11/2026 ⏰ 14:07
   📍 Rak: *rak lantai 1 hommy*
   🏪 FISIK (TOKO): *4*

📦 *Total dihitung:* 16 dari 2 input
```

**Format laporan** (`generateLaporanSOGabungan`) — bagian baru
`📋 DETAIL PER ENTRI` sebelum ringkasan, memuat **semua** entri:

```
📋 *DETAIL PER ENTRI (semua petugas):*
──────────────────
*24/11/2026*
  1. NN03673 — GELAS KACA
     👤 Dimas | 🏪 FISIK | 📍 rak lantai 1 hommy
     ⏰ 10:25 | qty *12*
```

**Batas 4096 karakter Telegram.** Sesi seminggu bisa punya ratusan entri
(114 barang saja sudah ±10 KB). **Tidak perlu helper baru**: `kirim()` sudah
memecah pesan panjang lewat `splitMessage()` (`index.js:7083`) yang memotong
**di batas baris** (baris yang lebih panjang dari batas dipotong paksa, tetapi
baris normal tidak pernah terpotong). Jadi laporan detail cukup dikirim dengan
`kirim()` yang sudah teruji, bukan menambah jalur pengiriman baru.

**Excel** — dua perubahan:

1. Sheet per rak: kolom `Jam` (yang sekarang cuma `10:25`) diganti
   `Tanggal` + `Jam` (`24/11/2026` dan `10:25`), sehingga satu baris = satu entri
   dengan tanggal & jam lengkap.
2. Sheet baru `Detail Semua Entri`: `Tanggal | Jam | Petugas | Rak | Jenis |
   Kode | Nama Barang | Qty`, semua entri dari semua rak dalam satu tabel —
   inilah yang diminta "di rak mana di gudang mana beserta jumlah per entrynya".

**Jam otoritatif = `timestamp`.** `jamInput` hanya `HH:MM` dan bisa berakhiran
`(updated)`/`(edited)`. Format memakai `timestamp` (sudah ada di setiap entri,
termasuk entri lama), dan `jamInput` hanya dipakai sebagai cadangan bila
`timestamp` tidak ada. Sufiks `(updated)`/`(edited)` dibersihkan sebelum tampil.

### 4. Daftar petugas mengikuti sesi, bukan "hari ini"

`getDaftarPetugasSO` sekarang menyaring riwayat dengan tanggal **hari ini**
(perbaikan sesi kelima). Karena sesi kini seminggu, patokannya berubah menjadi
**rentang sesi**: `sesiMulai` s/d `sesiBerakhir`. Petugas hari ke-3 tetap muncul.

### 5. Layar menu SO menampilkan sisa waktu

```
📊 *STOCK OPNAME*
🏦 Perabot Mamaku Kefamenanu
📅 24/11/2026 – 30/11/2026
────────────────────
⏳ Hari ke-2 dari 7 — sisa 5 hari 18 jam
```

Bila sesi lewat batas, pesan menyebut sesi baru sudah dimulai dan data lama
sudah diarsipkan.

### 6. Reset manual (sudah ada, dirapikan)

`so:reset_confirm` / `so:reset_yes` tetap seperti sekarang: backup → kosongkan →
mulai STEP 1/3. Ditambah: `sesiMulai`/`sesiBerakhir` baru diisi, dan konfirmasi
menyebut tanggal berakhirnya sesi baru.

### 7. Data lama aman

- Data tanpa `sesiMulai` → diisi otomatis, tidak dihapus.
- Entri tanpa `tanggal` → diturunkan dari `timestamp` saat dibaca.
- Entri tanpa `timestamp` → dianggap milik hari mulai sesi.
- Penanda lama `(updated)`/`(edited)` tetap ditampilkan.

## Risiko dan cara menutupnya

| Risiko | Penanganan |
|---|---|
| Total berubah tanpa disadari | Helper tunggal `hitungTotalSO`; tes membandingkan angka lama vs baru pada data produksi asli |
| Sesi lama "hidup lagi" saat deploy | Data lama diberi `sesiMulai = sekarang`, jadi tidak pernah kedaluwarsa mendadak |
| Reset otomatis menghapus data yang belum dibaca | `backupSOShared()` dipanggil **sebelum** reset, sama seperti sekarang |
| Zona waktu | Memakai `getJakartaDate()` (Asia/Makassar) yang sudah dipakai seluruh bot |
| Sesi menumpuk di riwayat | Satu entri `STOCKOPNAME` per reset (sudah begitu), bukan per hari |

## Rencana pengujian

Tes baru `boot/test-so-sesi-minggu.js` (63 pemeriksaan):

1. Sesi bertahan lintas hari (tidak reset saat tanggal berganti).
2. Reset otomatis tepat setelah 7×24 jam, dengan backup lebih dulu.
3. Reset manual mengosongkan dan memulai sesi baru 7 hari.
4. Data lama tanpa `sesiMulai` tidak hilang.
5. Total: hari terakhir menang antar hari; dijumlah di dalam hari.
6. Riwayat menampilkan tanggal + jam tiap entri.
7. Tanda `dihitung ulang` muncul untuk entri hari yang digantikan.
8. Daftar petugas mengikuti rentang sesi.
9. Laporan & Excel memakai angka yang sama dengan layar.
10. Regresi: `test-so-petugas` (103), `test-so-data-nyata` (15), suite penuh.

Tes baru `boot/test-so-detail-entri.js` (41 pemeriksaan):

1. Setiap entri menampilkan nama petugas, tanggal, jam:menit, rak, jenis, qty.
2. Tiga petugas di tiga tanggal berbeda → tiga blok lengkap, tidak tergabung.
3. Entri tanpa `tanggal` → tanggal diturunkan dari `timestamp`.
4. Entri tanpa `timestamp` → jatuh ke `jamInput`.
5. `jamInput` berakhiran `(updated)`/`(edited)` → sufiks dibersihkan.
6. Qty yang ditampilkan adalah qty entri itu sendiri, bukan total.
7. Penanda `dihitung ulang` hanya untuk entri yang benar-benar digantikan.
8. Excel per rak memuat kolom Tanggal + Jam.
9. Excel `Detail Semua Entri` memuat seluruh entri.

Tes baru `boot/test-so-laporan-nyata.js` (21) dan `boot/test-so-excel-nyata.js` (21)
menjalankan `generateLaporanSOGabungan()` dan `generateExcelSOGabungan()` SUNGGUHAN
(dengan ExcelJS tiruan) lalu memeriksa isi keluarannya.

## Hasil

- Suite penuh: **568 lulus / 2 gagal**, 0 regresi. Dua kegagalan itu sudah ada di
  baseline (`test-escape-markdown`, `test-format-error`); baseline 304 → 568.
- Tes SO seluruhnya: **264 lulus / 0 gagal** (63 + 103 + 41 + 21 + 21 + 15).
- Data produksi asli (114 entri, 3 nama petugas) diproses tanpa crash dan blok
  riwayatnya menampilkan `📅 14/11/2026 ⏰ 11:22` walau entri lama itu tidak
  punya field `tanggal` (diturunkan dari `timestamp`).

### Dua bug nyata yang ditemukan saat pengujian

1. `generateLaporanSOGabungan` memakai `petaBarangBaru`, padahal peta itu hanya
   dibuat di `generateExcelSOGabungan`. Begitu ada barang baru, laporan langsung
   gagal dengan `ReferenceError` — dan tes berbasis regex TIDAK menangkapnya.
   Karena itu `test-so-laporan-nyata.js` menjalankan fungsinya sungguhan.
2. Tiga tempat masih menjumlah `e.qty` mentah (layar daftar rak, layar pilih item
   untuk edit, dan layar EDIT ITEM), sehingga angkanya berbeda dari rekap setelah
   ada hitung ulang antar hari. Semuanya kini memakai `hitungTotalSO`.

### `kirimPanjang` tidak jadi dibuat

Rencana awal menambah helper `kirimPanjang`. Setelah diperiksa, `kirim()` sudah
memecah pesan panjang lewat `splitMessage()` di batas baris, jadi helper baru
hanya akan menduplikasi logika yang sudah teruji.

## Berkas yang berubah

- `index.js` — `getSOShared` (sesi 7×24 jam), `buatSharedKosong`, `tanggalKeMs`,
  `SEMINGGU_MS`, `msMasukAkal`, `formatTanggalDariMs`, `formatJamDariMs`,
  `tanggalEntri`, `jamEntri`, `hitungTotalSO`, `tandaiHitungUlangSO`,
  `tambahInputSO`, `tambahQtyItemSO`, `getBarangDiSemuaRak`,
  `getSOGabunganData`, `formatInfoBarangDiRakLain`, `getDaftarPetugasSO`,
  menu SO, layar rak & EDIT ITEM, `generateLaporanSOGabungan`,
  `generateExcelSOGabungan`, `so:reset_yes`.
- `boot/test-so-sesi-minggu.js` — baru (63).
- `boot/test-so-detail-entri.js` — baru (41).
- `boot/test-so-laporan-nyata.js` — baru (21).
- `boot/test-so-excel-nyata.js` — baru (21).
- `boot/test-so-petugas.js` — daftar fungsi disesuaikan.
- `boot/test-so-data-nyata.js` — daftar fungsi disesuaikan.
- `docs/superpowers/specs/2026-11-24-so-sesi-seminggu.md` — dokumen ini.
