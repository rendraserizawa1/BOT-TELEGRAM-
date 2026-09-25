# 🤖 Bot Telegram Toko Perabot

Bot Telegram dengan fitur:
- 🔍 Cari Barang & Cek Harga (5 toko)
- 📦 Cek Stok
- 💬 AI Chat (coming soon)
- 📊 Laporan & Stock Opname (coming soon)

## Setup di Railway

Set Environment Variables:
- `BOT_TOKEN` - Token dari @BotFather
- `ADMIN_ID` - Chat ID admin
- `GEMINI_KEY` - (opsional)
- `GROQ_API_KEY` - (opsional)

## Test Bot

Buka Telegram, cari @Aivirtual_Robot

---

## 🔌 Data Realtime dari iPos 5.0 (toko CP / Central Perabot)

**iPos = sumber kebenaran untuk toko cp.** Nama, satuan, harga ecer, harga
ambil, HPP, dan stok semua diambil langsung dari database iPos 5.0
(`i5_CP2026`) lewat service lokal `ipos-api` — realtime, tanpa upload Excel.

### Pemetaan harga

| Bot | iPos | Sumber DB |
|---|---|---|
| Ecer (1–5 pcs) | tier jumlah **terkecil** | `tbl_itemhj` `tipehj='J'` (`jmlsampai` min; fallback `tbl_item.hargajual1`) |
| Ambil/grosir (6+ pcs) | tier jumlah **terbesar** | `tbl_itemhj` `tipehj='J'` (`jmlsampai` max; fallback ecer kalau kosong) |
| HPP | harga pokok | `tbl_item.hargapokok` |
| Nama / satuan | `namaitem` / `satuan` | `tbl_item` |
| Stok | total semua kantor | `tbl_itemstok` |

> **Kenapa baris J, bukan baris L?** Baris `tipehj='L'` (level 1–6) tidak ikut
> ter-update saat harga diganti lewat iPos (sering basi). Yang benar-benar
> ditagih kasir adalah baris `tipehj='J'` — terverifikasi dengan mencocokkan
> harga di nota (`tbl_ikdt`). Contoh: `NN14588` diganti 25/09 → J = 16.000
> (langsung terbaca bot), sementara L1 masih 13.000.

### Realtime

- Bot **berlangganan SSE** `/api/events` → perubahan harga/stok/nama
  diterapkan **≤ ~3 dtk** setelah kasir/admin mengubah data di iPos.
- Sync penuh tiap `IPOS_SYNC_MS` (default 60 dtk) = jaring pengaman
  (item terhapus, SSE sempat putus).
- `harga_toko/cp.xlsx` hanya fallback darurat saat API mati. Upload cp.xlsx
  tetap boleh, tapi nilainya langsung ditimpa data iPos lagi.
- Item baru dari iPos otomatis masuk katalog (tak ditulis balik ke Excel,
  `tokoList` kosong → tak ikut ter-export ke `cp.xlsx`).
- Item yang dihapus di iPos dibersihkan dari katalog (kalau item itu juga
  dijual di toko lain, hanya info cp-nya yang dibuang).

### Laporan penjualan per kasir (CP)

Ketik langsung di chat (khusus admin & staff laporan):

| Ketik | Hasil |
|---|---|
| `laporan penjualan 24/09` | Penjualan semua kasir tanggal 24/09 |
| `laporan penjualan kemarin` | Idem, kemarin |
| `laporan kasir` / `/kasir` | Penjualan kasir **hari ini** |
| `/kasir kemarin` / `/kasir 24/09/2026` | Per tanggal tertentu |
| `omzet tgl 23` | Tanggal 23 bulan ini |

Tanggal yang dikenali: `hari ini`, `kemarin`, `24/09`, `24/09/2026`,
`24-9-26`, `2026-09-24`, `24 september [2026]`, `tgl 24`, `laporan penjualan 24`.
Tombol **🧾 Penjualan Kasir CP** di menu utama juga langsung membuka laporan
hari ini (ada tombol Hari Ini / Kemarin).

Isi laporan per kasir: nama user iPos + (userid), kelompok (`KASIR` /
`KASIR-GROSIR` dari `tbl_user`), mesin kasir (`compname`, mis. KASIR2), jumlah
nota, item, omzet, dan jam kerja (nota pertama–terakhir). **Urutan baris tetap**
sesuai kassa iPos: Astrid-Windi → Salsa → Marselina-Ririn → Tirsa-Tika
(kasir lain menyusul, diurut omzet terbesar). Di bawah: **TOTAL CP**
+ rincian bayar **💵 Tunai / 💳 Debit / 💳 Kredit**, subtotal **🏷️ KASIR** (=
nota kasir/`KSR`) **dan 🏷️ KASIR-GROSIR** (= nota grosir/`JL`, di cetakan iPos
baris "Ecer"/"Grosir"), lalu seksi
**🎁 KONTER PROMO** (kasir `PROMO` + TOTAL PROMO + rincian bayar Tunai/Debit/
Kredit saja) — **total CP dan PROMO terpisah, tidak digabung**. Daftar akun
"belum berjualan" **tidak ditampilkan** (disembunyikan sejak 25-09-2026).

Omzet TOTAL CP = nota kasir (`KSR`) **+ nota grosir/pelanggan (`JL`)** dari DB
CP — sama dengan laporan harian iPos (24-09-2026: 142.224.000 + 36.313.000 =
178.537.000, cocok persis). Rincian bayar memakai definisi laporan iPos:
**Tunai = omzet − debit − kredit** (kolom `jmltunai` di DB = uang diserahkan
kasir termasuk kembalian, jadi tidak dipakai langsung) — terverifikasi laporan
iPos 05-09-2026: CP 355.903.000 = Tunai 170.940.500 + Debit 184.962.500; PROMO
4.515.500 = Tunai 3.630.500 + Debit 885.000. Seksi PROMO = penjualan konter
promo dari DB iPos terpisah `i5_PROMO2025` (24-09-2026 = 2.227.500),
ditampilkan sebagai total sendiri.

**Laporan Parkir (isian manual).** Data parkir tidak ada di DB iPos, jadi bot
meminta isian manual sebelum generate: permintaan laporan → bot balas
"LAPORAN PARKIR — ISI MANUAL" → user ketik 2 angka → laporan lengkap
(penjualan + promo + parkir) digenerate 1x. Format isian:
`parkir [di komputer] [stor luar]` — contoh `parkir 0 778000`; boleh tanpa
kata "parkir" (`0 778000`), titik = ribuan, `parkir 0 0` = tidak ada parkir,
`parkir batal` = generate tanpa bagian parkir. Ketik hal lain = isian
dibatalkan, alur normal jalan. Bagian parkir tampil di bawah laporan:
Parkir di Komputer, Parkir Stor Luar, Total Parkir.

Sumber: endpoint `/api/jual` di `ipos-api` (cache memori; `tbl_ikhd` tidak
punya indeks tanggal). Bila API baru di-restart, bot membalas "data masih
dimuat" ± 2–5 menit sampai cache siap. Chat seperti "laporan penjualan"
(tanpa tanggal) tetap membuka alur lama (konfirmasi menu → per toko).

### Laporan penjualan HOMMY & KIREI (per merek)

Penjualan per **merek** (HOMMY & KIREI) untuk rentang tanggal pilihan user —
padanan tabel iPos "penjualan per item per merek". Sumber: endpoint
`/api/jual-merek` di `ipos-api` (query `tbl_ikdt` per nota rentang; ±0,3 dtk).

| Cara | Hasil |
|---|---|
| `laporan homy kirei` / `/homy` | Bot minta **tanggal awal** lalu **tanggal akhir** |
| `laporan homy 1-20 september 2026` | Langsung generate (rentang 1–20 Sep 2026) |
| `1/9 - 20/9`, `01/09/2026 s/d 20/09/2026` | Bentuk rentang lain yang dikenali |
| `homy kirei` (polos, tanpa kata lain) | Buka alur tanggal |

Di isian: `20` polos = tanggal 20 di bulan yang sama dengan tanggal awal;
`batal` = keluar. Validasi: tanggal awal tidak boleh di masa depan, akhir ≥
awal (kalau kebalik → minta ulang). Tombol cepat: 📅 Bulan Ini / 📅 Bulan
Lalu / 🔁 Ganti Tanggal / 🔙 Menu Utama (juga ada di Menu Utama: tombol
**🛋️ HOMMY & KIREI**).

Format laporan: per merek (🧾 nota | 📦 item | 💰 omzet), lalu
**📊 TOTAL HOMMY + KIREI** (total = penjumlahan baris merek — nota yang
memuat kedua merek dihitung di kedua baris), footer umur data iPos.
Tidak ada penjualan → baris "Tidak ada penjualan HOMMY/KIREI".
Terverifikasi cocok iPos 01–20 Sep 2026: HOMMY 2.134 nota / 9.086 item /
Rp 250.665.000 · KIREI 484 / 2.222 / Rp 18.094.000 · total 2.618 / 11.308 /
Rp 268.759.000.

Catatan: kata kunci `laporan homy/kirei` tidak merebut fitur lain — `cari
homy`, `harga homy`, `homy` sendirian, `laporan harga homy` tetap ke alur
semula (cari/harga). PROMO tidak dihitung (tidak ada item merek ini di DB
PROMO).

### Konfigurasi (`.env`)

```ini
IPOS_URL=http://127.0.0.1:8080/ipos   # service lokal, mesin yang sama
IPOS_KEY=ipos_...                      # API key (sama dgn ipos-api/.env)
IPOS_SYNC_MS=60000                     # jaring pengaman (ms), default 60 dtk
IPOS_TOKO=cp                           # toko bot yg datanya dari iPos
```

`IPOS_URL`/`IPOS_KEY` **wajib** di `.env` (gitignored). Kalau API mati / key
salah, bot tetap jalan normal memakai data Excel terakhir (fail-safe).

### Modul

- `ipos-bridge.js` — semua logika: fetch, langganan SSE (klien SSE manual,
  tanpa dependensi), overlay nama/harga/stok, tambah item baru, bersihkan
  item terhapus.
- `index.js` — 4 titik sisip minimal:
  1. `require('./ipos-bridge')`
  2. akhir `loadExcel()` → sync ulang tiap Excel di-rebuild
  3. startup → `iposBridge.mulaiAutoSync(() => DATA_BARANG, IPOS_SYNC_MS)`
  4. command admin `/ipos` (status + realtime) & `/reload`

### Command admin

- `/ipos` — status koneksi, SSE realtime, jumlah item, update terakhir.
- `/reload` — paksa muat ulang Excel + sync iPos sekarang.
- `/kasir [tanggal]` — laporan penjualan per kasir CP (staff laporan + admin).
- `/homy [rentang]` — laporan penjualan HOMMY & KIREI per merek, mis. `/homy 1-20 september 2026` (staff laporan + admin).

### Prasyarat

Service `ipos-api` (Windows service `iPosAPI`, autostart) harus jalan di
`127.0.0.1:8080`. Lihat `../ipos-api/README.md`.
