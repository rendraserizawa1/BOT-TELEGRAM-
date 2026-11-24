# Stock Opname — tampilkan petugas + jam pada barang yang sudah dihitung

Tanggal: 2026-11-24
Status: **dikerjakan** (lihat bagian "Hasil pelaksanaan" di bawah)

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
