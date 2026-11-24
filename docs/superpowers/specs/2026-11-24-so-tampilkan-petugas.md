# Stock Opname — tampilkan petugas + jam pada barang yang sudah dihitung

Tanggal: 2026-11-24
Status: **dikerjakan** (lihat bagian "Hasil pelaksanaan", "Perbaikan lanjutan",
"Perbaikan ketiga", dan "Perbaikan keempat" di bawah)

> Catatan: rancangan awal hanya menampilkan entri milik **petugas lain**, sehingga
> layar tetap kosong bila yang membuka adalah petugas yang sudah menghitung
> barang itu. Bagian **"Perbaikan lanjutan — riwayat SELALU tampil"** di bawah
> memperbaiki hal ini: sekarang semua entri tampil, entri sendiri ditandai
> `(Anda)`.
>
> Bagian **"Perbaikan ketiga — tiap input jadi baris sendiri"** memperbaiki bug
> penyimpanan: input berulang dari petugas yang sama dulu digabung menjadi satu
> baris (`qty += `), sehingga qty 2 lalu 4 tampil sebagai `6` dan jam aslinya
> hilang. Sekarang setiap input adalah entri tersendiri.
>
> Bagian **"Perbaikan keempat — nama petugas disamakan & bisa dipilih"**
> memperbaiki: (a) `dimas` dan `Dimas` disimpan sebagai dua nama berbeda
> sehingga laporan memecah satu orang jadi dua, dan (b) layar "Siapa nama Anda?"
> kini punya tombol pilihan petugas (online maupun offline).
>
> Bagian **"Perbaikan kelima — daftar petugas hanya HARI INI"** menyaring daftar
> itu agar tidak lagi memuat petugas dari hari-hari sebelumnya.

## Masalah

Petugas tidak bisa melihat siapa yang sudah menghitung sebuah barang. Di layar
`Barang ditemukan!` seharusnya ada blok `BARANG INI SUDAH ADA DI:` berisi nama
petugas + jam, tapi blok itu tidak pernah muncul di toko.

## Akar masalah (terbukti dengan data produksi)

Data `storage/so_shared.json.bak` toko KEFA: **114 entri SO, hanya 1 Telegram
userId** (`8997270739`), tetapi memuat **2 nama petugas** berbeda
(`ibu fitri dan intan`, `MAS ANDRI`). HP toko dipakai bergantian dengan satu
akun Telegram.

Kode membandingkan **akun Telegram**, bukan **nama petugas**:

```js
// index.js:2727
if (r.rak !== currentRak || String(e.userId) !== String(currentUserId))
```

Karena akunnya sama, barang yang dihitung orang lain dianggap "milik sendiri"
→ blok disembunyikan. Dibuktikan dengan menyalin fungsi apa adanya dan
menjalankannya pada data asli: hasilnya string kosong.

### Bug kedua — data rusak, bukan sekadar tampilan

```js
// index.js:2602-2604
const existIdx = entries.findIndex(e =>
  String(e.userId) === String(userId) && e.jenis === jenis
);
```

Qty dicocokkan hanya lewat `userId + jenis`, **tanpa** `namaPetugas`. Qty
petugas baru digabungkan ke entri petugas lama, dan namanya tetap nama lama.
Jejaknya nyata: **6 entri** bertanda `(updated)`/`(edited)` di data produksi,
mis. `NN02099` qty 33 dan `NN02162` qty 50, keduanya tercatat atas nama
`ibu fitri dan intan`.

Karena itu memperbaiki tampilan saja tidak cukup — data barunya sendiri salah.

## Keputusan yang sudah disepakati

1. Perbaiki **penyimpanan + tampilan** (bukan tampilan saja).
2. Entri lama yang sudah tercampur **diberi tanda jujur** di layar, tidak
   dihapus.

## Rancangan

### 1. Kunci identitas petugas

Tambah satu fungsi normalisasi sebagai satu-satunya sumber kebenaran:

```js
// "Ibu fitri dan intan" dan "ibu fitri dan intan" -> orang yang sama
function kunciPetugas(nama) {
  return String(nama == null ? '' : nama)
    .trim().replace(/\s+/g, ' ').toLowerCase();
}
```

Alasan: data asli memuat `ibu fitri dan intan` **dan** `Ibu fitri dan intan`.
Perbandingan persis akan memecah satu orang menjadi dua.

### 2. Perbaiki `tambahQtyItemSO` (index.js:2602-2604)

Cocokkan entri lama dengan **userId + namaPetugas ternormalisasi + jenis**:

```js
const existIdx = entries.findIndex(e =>
  String(e.userId) === String(userId) &&
  kunciPetugas(e.namaPetugas) === kunciPetugas(namaPetugas) &&
  e.jenis === jenis
);
```

Efek: tiap petugas mendapat entri sendiri. Menambah qty tetap menggabung ke
entri petugas yang sama (perilaku lama untuk orang yang sama dipertahankan).

### 3. Perbaiki filter tampilan `formatInfoBarangDiRakLain` (index.js:2727)

Tampilkan entri bila **rak berbeda ATAU petugas berbeda**:

```js
const bedaRak   = r.rak !== currentRak;
const bedaOrang = kunciPetugas(e.namaPetugas) !== kunciPetugas(namaPetugasSaya);
if (bedaRak || bedaOrang) info.push({ ...e, rak: r.rak });
```

`tampilkanBarangPilihan` dan `tampilkanBarangPilihanLive` perlu menerima
`namaPetugas` (sekarang hanya menerima `userId`). Nilainya sudah tersedia di
pemanggil: `soInfo.petugas[0]` (index.js:8493, 8251, 8050).

### 4. Tanda jujur untuk entri lama

Entri dianggap "data lama" bila `jamInput` memuat `(updated)` atau `(edited)` —
penanda itu hanya ditulis oleh penggabungan lama. Di layar:

```
1. *ibu fitri dan intan* di *rak kaca lantai 1 toko*
   ⏰ 13:30 (updated) | 📦 FISIK: 33
   ⚠️ data lama — petugas bisa tercampur, hitung ulang bila ragu
```

Tidak ada data yang diubah atau dihapus.

### 5. Kompatibilitas

- Entri lama tanpa `namaPetugas` → `kunciPetugas` menghasilkan `''`; tidak
  crash, hanya tidak bisa dibedakan.
- Data lama tetap terbaca; tidak ada migrasi yang merusak.
- Perilaku untuk toko yang memakai akun berbeda per petugas tetap sama
  seperti sebelumnya.

## Berkas yang disentuh

- `index.js` — 1 fungsi baru, 3 fungsi diubah, 3 pemanggil disesuaikan.
- `boot/test-so-petugas.js` — tes baru (nama `test-*` agar ikut ter-commit,
  `uji-*` di-gitignore).

## Cara membuktikan

Tes harus memakai **data produksi asli** (salinan `so_shared.json.bak`), bukan
data karangan, dan membuktikan:

1. Petugas berbeda, akun Telegram sama, rak sama → blok **muncul** dengan nama
   + jam (sekarang: kosong).
2. Petugas sama, rak sama → blok **tidak** muncul.
3. Rak berbeda → blok **muncul**.
4. Nama beda huruf besar/kecil → dianggap orang yang sama (tidak terpecah).
5. Qty petugas A lalu petugas B → **dua entri terpisah** dengan nama masing-masing
   (sekarang: tergabung jadi satu).
6. Entri bertanda `(updated)` → muncul peringatan data lama.
7. Regresi: `formatInfoBarangDiRakLain` mengembalikan `''` bila tidak ada data lain.

## Yang TIDAK dikerjakan

- Tidak memperbaiki 6 entri lama yang sudah tercampur (qty tidak bisa dipisah
  lagi tanpa menebak).
- Tidak menyentuh layar Review / Laporan / Excel (sudah menampilkan petugas,
  dan tidak diminta).
- Tidak mengubah `editQtyItemSO` — sudah bekerja per-index entri.

## Risiko

| Risiko | Penanganan |
|---|---|
| Data baru terpecah per petugas → jumlah entri bertambah | Memang tujuannya; rekap tetap benar karena dijumlahkan |
| Nama petugas kosong di entri lama | `kunciPetugas` aman untuk null/undefined |
| Salah orang bila dua petugas bernama sama | Tidak bisa dibedakan tanpa akun terpisah — dicatat sebagai batasan |

## Hasil pelaksanaan

Dikerjakan 2026-11-24. Semua nomor baris di atas adalah posisi **sebelum**
perubahan.

### Tambahan di luar rancangan (ditemukan saat mengerjakan)

1. **Escape Markdown.** `kirim()` mengirim dengan `parse_mode: 'Markdown'`
   (`index.js:7156`), dan aturan resmi Telegram mewajibkan `_` `*` `` ` `` `[`
   di-escape. Blok ini memasukkan `namaPetugas` dan `rak` (keduanya input
   pengguna) **mentah** ke dalam `*...*`. Nama seperti `Budi_Santoso` membuat
   Telegram menolak seluruh pesan; `telegram-send-error.js:71-75` lalu mengirim
   ulang tanpa `parse_mode`, sehingga format hilang dan teks mentah berserakan.
   Sekarang ketiganya memakai `escapeMd()` — sama seperti 100+ tempat lain di
   berkas ini (`index.js:1898` adalah preseden persis untuk nama orang).
   Data produksi sekarang tidak memuat karakter itu, jadi **tampilan tidak
   berubah**; ini jaring pengaman.
2. **`jenis` kosong tidak lagi melempar.** `inp.jenis.toUpperCase()` akan
   crash bila `jenis` tidak ada. Diganti `String(inp.jenis || '').toUpperCase()`
   dengan label `TIDAK DISEBUT`. Data produksi selalu berisi `jenis`, jadi ini
   juga jaring pengaman. Ikon dipertahankan persis: `fisik` → 🏪, selain itu → 🏭.

### Berkas yang benar-benar berubah

- `index.js` — `kunciPetugas()` baru; `tambahQtyItemSO`,
  `formatInfoBarangDiRakLain`, `tampilkanBarangPilihan`,
  `tampilkanBarangPilihanLive` diubah; 3 pemanggil disesuaikan.
- `boot/test-so-petugas.js` — 31 pemeriksaan. **Tidak menyalin fungsi**: tes
  membaca `index.js`, mengambil badan fungsi yang sebenarnya lewat pencocokan
  kurung kurawal (dengan pengenal literal regex, karena `escapeMd` memuat
  `/[...`...]/`), lalu menjalankannya dengan dependensi tiruan.
- `boot/test-so-data-nyata.js` — 12 pemeriksaan terhadap salinan data produksi.
  Berkas data **tidak** ikut repo (memuat nama petugas asli); bila tidak ada,
  tes **lewat dengan exit 0**, bukan gagal.

### Bukti bug lama nyata (bukan asumsi)

Fungsi versi `git HEAD` dan versi baru dijalankan pada data berbentuk produksi:

```
KODE LAMA (userId sebagai pembanding):  hasil = (KOSONG - blok tidak muncul)
KODE BARU (namaPetugas sebagai pembanding): blok muncul
  1. *ibu fitri dan intan* di *rak kaca lantai 1 toko*
     ⏰ 11:22 | 🏪 FISIK: 7

KODE LAMA: 1 entri -> ibu fitri dan intan qty=12   (7 + 5 tercampur)
KODE BARU: 2 entri -> ibu fitri dan intan qty=7 | MAS ANDRI qty=5
```

### Regresi

Seluruh `boot/test-*.js` dijalankan pada clone bersih GitHub (57 tes) dan pada
kode baru (59 tes), dalam satu sesi supaya pembandingnya sah:

- **Regresi: 0** — tidak ada tes yang tadinya lulus menjadi gagal.
- 22 tes gagal di **kedua** versi karena butuh jaringan/DB produksi — sudah
  gagal sebelum perubahan.
- 2 tes baru lulus.

### Batasan yang tetap berlaku

- 6 entri lama yang sudah tercampur **tidak** diperbaiki qty-nya (tidak bisa
  dipisah tanpa menebak); hanya ditandai di layar.
- Dua petugas dengan nama sama persis tetap tidak bisa dibedakan.

## Perbaikan lanjutan — riwayat SELALU tampil (2026-11-24, sesi kedua)

### Keluhan

Setelah perbaikan di atas dipasang, layar `Barang ditemukan!` di toko masih
hanya menampilkan angka:

```
💻 Stok Sistem: 18
📊 *Total semua rak:*
   🏪 Fisik: 2
   📦 Total: 2
   ➖ Selisih: -16
```

Tanpa nama petugas, tanpa jam input.

### Akar masalah kedua — kesalahan desain, bukan bug teknis

Rancangan pertama hanya menampilkan entri **milik orang lain**:

```js
const bedaRak  = r.rak !== currentRak;
const bedaOrang = kunciPetugas(e.namaPetugas) !== kunciSaya;
if (bedaRak || bedaOrang) info.push(...);   // entri sendiri dibuang
```

Kalau yang membuka layar adalah petugas yang **sudah** menghitung barang itu,
`bedaRak` dan `bedaOrang` dua-duanya `false` → blok kosong sama sekali.

Dibuktikan dengan menjalankan fungsi apa adanya pada bentuk data live
(`NN03673`, `namaPetugas="dimas"`, `qty=16`, `jamInput="09:47 (updated)"`):

```
pemakai = "dimas"  (orang yang SAMA)   -> KOSONG  <- inilah yang dilihat user
pemakai = "IRWAN"  (orang lain)        -> ADA blok
pemakai = ""       (nama kosong)       -> KOSONG  (fallback userId, akun sama)
```

Padahal yang diminta adalah **riwayat lengkap per item** — siapa input berapa,
jam berapa — termasuk entri sendiri.

### Perubahan

`formatInfoBarangDiRakLain` sekarang:

1. Mengumpulkan **semua** entri dari semua rak, tanpa menyaring.
2. Menandai entri milik sendiri dengan `_(Anda)_` (pembanding tetap
   `kunciPetugas(namaPetugas)`, dengan fallback `userId` bila nama tidak
   diketahui — perilaku lama dipertahankan sebagai jaring pengaman).
3. Mengurutkan **kronologis** berdasarkan `timestamp`, supaya urutan input jelas.
4. Judul blok diganti `⚠️ BARANG INI SUDAH ADA DI:` → `📋 RIWAYAT HITUNG
   BARANG INI:`, karena isinya sekarang bukan lagi "barang ada di tempat lain"
   melainkan riwayat hitung.
5. Ringkasan bawah: `📦 Total dihitung: N dari M input`, ditambah
   `👥 Dihitung petugas lain: N` bila ada entri petugas lain.
6. Penanda `⚠️ data lama — petugas bisa tercampur` tetap dipertahankan untuk
   entri ber-`(updated)`/`(edited)`.

### Hasil di layar

Satu item dihitung tiga petugas, dibuka oleh `dimas`:

```
📋 *RIWAYAT HITUNG BARANG INI:*
──────────────────
1. *IRWAN* di *RAK LANTAI 1 HOMMY*
   ⏰ 08:39 | 🏪 FISIK: 12
2. *ibu fitri dan intan* di *RAK LANTAI 1 HOMMY*
   ⏰ 09:10 | 🏪 FISIK: 5
3. *dimas* _(Anda)_ di *RAK LANTAI 1 HOMMY*
   ⏰ 10:05 | 🏭 GUDANG: 3

📦 *Total dihitung:* 20 dari 3 input
👥 *Dihitung petugas lain:* 17
```

### Berkas yang berubah pada sesi kedua

- `index.js` — `formatInfoBarangDiRakLain` saja (+24 / −12 baris).
- `boot/test-so-petugas.js` — 31 → **52 pemeriksaan**. Tes 2/4 yang dulu
  mengunci "blok kosong bila petugas sama" dibalik menjadi "blok tetap muncul +
  ditandai (Anda)". Ditambah tes 14 (kasus nyata NN03673/dimas/09:47) dan tes 15
  (tiga petugas, semua nama + jam + qty tampil, hanya satu `(Anda)`).
- `boot/test-so-data-nyata.js` — 12 → **15 pemeriksaan** pada 114 entri
  produksi; asersi "petugas sendiri tidak melihat entrinya" dibalik menjadi
  "petugas sendiri TETAP melihat nama + jam + tanda (Anda)".

### Regresi sesi kedua

Seluruh `boot/test-*.js` dijalankan pada clone baseline `e2f2cd7` dan pada kode
baru, satu sesi:

| | Baseline | Baru |
|---|---|---|
| Total lulus | 304 | 371 |
| Total gagal | 2 | 2 |

- **Regresi: 0** — tidak ada berkas tes yang turun jumlah lulusnya.
- 2 kegagalan sama persis di kedua versi (butuh jaringan/DB produksi).
- 57 berkas tes tidak berubah hasil; 3 berkas baru seluruhnya lulus
  (`test-so-petugas` 52, `test-so-data-nyata` 15, `test-kunci-proses` 16).
- 22 berkas keluar dengan exit ≠ 0 di **kedua** versi karena butuh jaringan —
  sudah begitu sebelum perubahan ini.

## Perbaikan ketiga — tiap input jadi baris sendiri (2026-11-24, sesi ketiga)

### Keluhan

Petugas `Tri` menginput `TOKO 2` lalu `TOKO 4`. Yang tampil di layar:

```
3. *Tri* _(Anda)_ di *RAK LANTAI 1 HOMMY*
   ⏰ 10:27 \(updated\) | 🏪 FISIK: 6
   ⚠️ data lama — petugas bisa tercampur, hitung ulang bila ragu
```

Dua input berbeda waktu digabung menjadi satu baris `6`, dan jam input aslinya
hilang. Yang diminta: **dipisah per entry per qty, lengkap dengan jam:menit
masing-masing**.

### Akar masalah — di penyimpanan, bukan tampilan

```js
// index.js:2620-2629 (SEBELUM perbaikan ini)
const existIdx = entries.findIndex(e =>
  String(e.userId) === String(userId) &&
  kunciPetugas(e.namaPetugas) === kunciPetugas(namaPetugas) &&
  e.jenis === jenis
);
if (existIdx >= 0) {
  entries[existIdx].qty += tambahQty;                    // qty DIGABUNG
  entries[existIdx].jamInput = getJamSekarang() + ' (updated)';  // jam lama HILANG
  entries[existIdx].timestamp = Date.now();
}
```

Perbaikan sesi pertama hanya menambahkan `namaPetugas` ke pencocokan. Itu
memisahkan qty antar **petugas berbeda**, tetapi petugas yang sama masih
digabung. Reproduksi dengan data bentuk produksi membuktikan:

```
Tri input 2 lalu 4  ->  entri tersimpan: [[6, "10:30 (updated)"]]   (salah)
```

### Perubahan

`tambahQtyItemSO` sekarang **selalu menambahkan entri baru** — tidak pernah
mencari entri lama untuk digabung, tidak pernah menimpa `jamInput` dengan
`(updated)`. Setiap input = satu entri dengan `qty`, `jamInput`, dan
`timestamp` sendiri.

Rekap tidak terpengaruh: semua pembaca (`getBarangDiSemuaRak`,
`getTotalBarangSemuaRak`, `getSOGabunganData`, export Excel, layar rekap)
menjumlahkan `e.qty`, sehingga total tetap sama. Diverifikasi:

```
5 input -> 5 entri
  Dimas  fisik  qty=12
  Irwan  fisik  qty=4
  Tri    fisik  qty=2
  Tri    fisik  qty=4
  Tri    gudang qty=3
rekap: totalFisik=22  totalGudang=3  total=25  (benar)
```

### Layar setelah perbaikan

```
📋 *RIWAYAT HITUNG BARANG INI:*
1. *Dimas* di *RAK LANTAI 1 HOMMY*
   ⏰ 10:25 | 🏪 FISIK: 12
2. *Irwan* di *RAK LANTAI 1 HOMMY*
   ⏰ 10:27 | 🏪 FISIK: 4
3. *Tri* _(Anda)_ di *RAK LANTAI 1 HOMMY*
   ⏰ 10:28 | 🏪 FISIK: 2
4. *Tri* _(Anda)_ di *RAK LANTAI 1 HOMMY*
   ⏰ 10:29 | 🏪 FISIK: 4

📦 *Total dihitung:* 22 dari 4 input
```

### Ikut diperbaiki (kelas bug yang sama)

- Layar **EDIT RAK** menampilkan rincian per entri tetapi **tanpa jam**. Sekarang
  tiap baris menyertakan `⏰ jamInput`.
- Layar **EDIT RAK** dan **EDIT ITEM** memasukkan `namaPetugas`/`jenis`/`jamInput`
  mentah ke pesan ber-`parse_mode: 'Markdown'`. Nama ber-`_` akan membuat
  Telegram menolak seluruh pesan. Sekarang memakai `escapeMd()`.

### Berkas yang berubah pada sesi ketiga

- `index.js` — `tambahQtyItemSO` (selalu entri baru), layar EDIT RAK, layar
  EDIT ITEM.
- `boot/test-so-petugas.js` — 58 → **78 pemeriksaan**. Tes 6/6b/6c/6d yang dulu
  mengunci perilaku "digabung" dibalik menjadi "entri baru". Ditambah tes 6f–6h
  (kapitalisasi & jenis berbeda), tes 17 (kasus nyata Tri TOKO 2 lalu TOKO 4),
  dan tes 18 (layar EDIT RAK/EDIT ITEM merinci jam + escape, serta tidak ada lagi
  penggabungan qty di sumber).

### Regresi sesi ketiga

| | Baseline `e2f2cd7` | Sekarang |
|---|---|---|
| Total lulus | 304 | **397** |
| Total gagal | 2 | 2 (sama, butuh jaringan) |
| Regresi | — | **0** |

### Catatan data lama

Entri yang sudah terlanjur digabung sebelum perbaikan ini **tidak** diubah
(tidak bisa dipisah tanpa menebak qty dan jam aslinya). Entri itu tetap dikenali
dari penanda `(updated)`/`(edited)` dan tetap diberi peringatan
`⚠️ data lama — petugas bisa tercampur` di layar. Input berikutnya sudah benar.

## Perbaikan keempat — nama petugas disamakan & bisa dipilih (2026-11-24, sesi keempat)

### Keluhan

1. Petugas mengetik `dimas` (huruf d kecil) padahal sudah ada `Dimas`. Dianggap
   orang lain, dan nama petugas tidak otomatis disamakan dengan `Dimas` yang
   sudah ada. Laporan Excel menampilkan dua baris:
   `Petugas 1: dimas`, `Petugas 2: Dimas`, `Petugas 3: Tri`.
2. Layar `Siapa nama Anda?` tidak menampilkan daftar petugas yang bisa dipilih;
   petugas harus mengetik manual. Yang tampil hanya petugas yang sedang online.

### Akar masalah 1 — pencocokan sudah benar, PENYIMPANAN yang salah

`kunciPetugas()` **sudah** menganggap `Dimas` dan `dimas` orang yang sama
(dibuktikan: keduanya ditandai `(Anda)` di layar). Masalahnya nama **disimpan
apa adanya** (`namaPetugas: namaPetugas`), sehingga:

- rekap per petugas mengelompokkan berdasarkan nama mentah → dua baris;
- export Excel membuat satu sheet per nama mentah → dua sheet;
- daftar `allPetugas` di laporan berisi dua nama.

Dibuktikan pada data produksi asli (`so_shared.bak.json`, toko kefa):

```
nama mentah : ["MAS ANDRI", "ibu fitri dan intan", "Ibu fitri dan intan"]   (3)
petugas unik: ["Ibu fitri dan intan", "MAS ANDRI"]                          (2)
```

### Akar masalah 2 — daftar petugas hanya dari yang online

`so:join` hanya membaca `getAllUsersAktif()` (`shared.usersAktif`), yaitu
petugas yang **sedang** bergabung. Petugas yang sudah pernah input lalu offline
tidak muncul, dan tidak ada tombol pilihan sama sekali.

### Perubahan

1. **`samakanNamaPetugas(nama, daftar)`** — fungsi baru. Mengembalikan ejaan
   nama yang **sudah ada** (dicocokkan lewat `kunciPetugas`), memilih ejaan yang
   paling akhir dipakai. Nama yang belum pernah ada dipakai apa adanya setelah
   spasi dirapikan. Dipanggil di **setiap** titik input nama petugas
   (`soSetupStep === 'petugas'`), sehingga `dimas` tersimpan sebagai `Dimas`.
2. **`getDaftarPetugasSO(tokoKode)`** — fungsi baru. Menggabungkan nama dari
   tiga sumber: `usersAktif` (online), seluruh `entries` di `racks` (pernah
   input), dan riwayat `STOCKOPNAME` (sesi hari-hari sebelumnya). Nama disatukan
   lewat `kunciPetugas`, ditandai `online`/`offline`, diurutkan online dulu lalu
   yang paling akhir dipakai.
3. **Layar `Siapa nama Anda?`** sekarang menampilkan daftar petugas
   (`🟢 online` / `⚪ offline`, plus rak bila online) **dan** tombol pilihan
   langsung, ditambah tombol `⌨️ Ketik Nama Manual` untuk petugas baru.
4. **Handler `so:joinnama`** — memilih dari daftar langsung lanjut ke STEP 2/3
   (pilih rak), tanpa mengetik. `callback_data` memakai **nama** (bukan indeks)
   supaya tidak salah orang bila daftar berubah; bila nama terlalu panjang untuk
   batas 64 byte Telegram, jatuh ke `so:joinnamaindex:<i>`.

### Layar baru

```
➕ *BERGABUNG KE SO*
🏦 Perabot Mamaku Kefamenanu
────────────────────

👥 *Petugas sudah ada:*
   1. Dimas (🟢 online) — rak lantai 1 hommy
   2. Tri (⚪ offline)
   3. Irwan (⚪ offline)

────────────────────

👤 *Siapa nama Anda?*

👉 *Pilih dari tombol di bawah* — atau ketik manual.

*Contoh manual:* `Joko` atau `Joko, Andi`

Ketik *batal* untuk keluar.

[ 🟢 1. Dimas ]  -> so:joinnama:Dimas
[ ⚪ 2. Tri ]    -> so:joinnama:Tri
[ ⚪ 3. Irwan ]  -> so:joinnama:Irwan
[ ⌨️ Ketik Nama Manual ]
[ 🔙 Kembali ]
```

### Bukti perbaikan

```
Dimas (kapital) sudah input lebih dulu.
user ketik "dimas" -> disimpan sebagai "Dimas"
entri tersimpan: ["Dimas", "Dimas"]   -> nama unik: ["Dimas"]  (bukan 2)
```

### Berkas yang berubah pada sesi keempat

- `index.js` — `samakanNamaPetugas`, `getDaftarPetugasSO` (baru); handler
  `soSetupStep === 'petugas'`; handler callback `so:join`, `so:joinnama`,
  `so:joinnamaindex`, `so:joinmanual`.
- `boot/test-so-petugas.js` — 78 → **95 pemeriksaan**. Tes 19 mengunci
  penyamaan ejaan (kapitalisasi, spasi, nama baru, daftar kosong, pilih ejaan
  terakhir). Tes 20 mengunci daftar petugas (online + offline, tanpa duplikat,
  status online/offline, rak terbawa, urutan, tanpa nama kosong).

### Regresi sesi keempat

| | Baseline `e2f2cd7` | Sekarang |
|---|---|---|
| Total lulus | 304 | **414** |
| Total gagal | 2 | 2 (sama, butuh jaringan) |
| Regresi | — | **0** |

### Batasan

- Data lama yang sudah tersimpan dengan ejaan berbeda (`dimas` dan `Dimas`
  sebagai entri terpisah) **tidak** digabung otomatis — qty dan jamnya sudah
  tercatat dan tidak boleh diubah tanpa persetujuan. Perbaikan berlaku untuk
  input berikutnya; laporan tetap menampilkan keduanya seperti apa adanya.
- Bila dua petugas **berbeda** kebetulan bernama sama persis, keduanya tetap
  tidak bisa dibedakan tanpa akun terpisah.

## Perbaikan kelima — daftar petugas hanya HARI INI (2026-11-24, sesi kelima)

### Keluhan

Daftar petugas pada layar `Siapa nama Anda?` menampilkan **semua** petugas yang
pernah tercatat, termasuk dari hari-hari sebelumnya. Hasilnya 10 nama, sebagian
sudah tidak bertugas:

```
4. Domas (⚪ offline)
5. Astrid oka (⚪ offline)
6. Ibu fitri dan intan (⚪ offline)
7. Mas andri (⚪ offline)
8. dimas dan tri (⚪ offline)
9. Nezha (⚪ offline)
10. Tri kusworo (⚪ offline)
```

Permintaan: **hanya petugas dalam rentang hari ini saja**.

### Akar masalah

`getDaftarPetugasSO` mengambil riwayat `STOCKOPNAME[tokoKode]` **tanpa menyaring
tanggal**, sehingga sesi SO hari-hari sebelumnya ikut masuk:

```js
// SEBELUM perbaikan
const riwayat = Array.isArray(STOCKOPNAME[tokoKode]) ? STOCKOPNAME[tokoKode] : [];
riwayat.forEach((sesi) => { /* semua sesi, tanpa cek tanggal */ });
```

### Perubahan

1. Tanggal acuan diambil dari `shared.tanggal` (sudah dinormalkan
   `getSOShared`, yang otomatis me-reset data saat tanggal berganti).
2. Setiap sesi riwayat disaring: hanya dipakai bila
   `sesi.tanggal`/`sharedData.tanggal` **sama** dengan tanggal hari ini.
3. `getSOShared` bisa mengembalikan `undefined` untuk toko tak dikenal —
   sekarang dijaga (`|| {}`) supaya tidak melempar.

Sumber daftar sekarang:
- `usersAktif` → petugas yang **sedang online hari ini**
- `racks` → nama pada entri hitungan **hari ini** (offline, sudah input)
- `STOCKOPNAME` → **hanya** sesi bertanggal hari ini (mis. sesi yang di-reset
  lalu dimulai lagi hari ini)

### Bukti

Data uji berisi riwayat kemarin dengan `Domas`, `Astrid oka`, `Mas andri`,
`dimas dan tri`, `Nezha`, `Tri kusworo`, `IRWAN`, dan SO hari ini hanya `Dimas`
+ `Tri`:

```
=== DAFTAR PETUGAS HARI INI (24/11/2026) ===
  1. Dimas   🟢 online
  2. Tri     ⚪ offline

  jumlah: 2
  nama kemarin yang masih muncul: TIDAK ADA (benar)
```

### Berkas yang berubah pada sesi kelima

- `index.js` — `getDaftarPetugasSO` (saring riwayat per tanggal + penjagaan
  `getSOShared` undefined).
- `boot/test-so-petugas.js` — 95 → **103 pemeriksaan**. Tes 21 mengunci
  "petugas kemarin tidak muncul" (dari `usersAktif` maupun dari `entries`),
  tes 22 mengunci "riwayat bertanggal sama tetap dipakai", tes 23 mengunci
  "tanpa riwayat / toko tidak dikenal tidak crash".

### Regresi sesi kelima

| | Baseline `e2f2cd7` | Sekarang |
|---|---|---|
| Total lulus | 304 | **422** |
| Total gagal | 2 | 2 (sama, butuh jaringan) |
| Regresi | — | **0** |

### Catatan

Petugas yang sudah tercatat hari ini tetap muncul walau sudah offline, supaya
bisa dipilih kembali tanpa mengetik. Yang **tidak** muncul hanya petugas dari
hari lain. Bila petugas baru bergabung, gunakan tombol
`⌨️ Ketik Nama Manual`.
