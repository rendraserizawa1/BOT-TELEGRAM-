# Laporan Penjualan CP Beku 2 Jam — Penyebab & Perbaikan

Tanggal kejadian: **17 November 2026, mulai 09:08** (terdeteksi 11:00)
Mesin: `ADMIN_DIMAS` (`admin_dimas\kassa`, Tailscale `100.125.99.99`, LAN `192.168.77.27`)
Service: `iPosAPI` (NSSM) → `node --env-file=.env server.js`
Folder: `C:\root folder project\ipos-api`

## Keluhan

"LAPORAN PENJUALAN KASIR TIDAK UPDATE MASIH BASI LAPORAN PENJUALAN KASIR BEKU"

## Gejala yang terukur

| Fakta | Nilai |
|---|---|
| `jual.update` berhenti bertambah | 2 jam 15 menit |
| `jual.umurDetik` | 8.119 detik |
| `jual.err` | `connect ENETUNREACH 192.168.77.250:5444` |
| Katalog (`items`) | **segar** — `lastSync` maju terus |
| `/health` proxy `ok` | **true**, `lastError` kosong |
| Nota hari ini saat beku | 18 nota, Rp 24.813.000 |
| Nota hari ini setelah pulih | **108 nota, Rp 56.940.500** |
| Penjualan tersembunyi | **90 nota, Rp 32.127.500** |

Bukti penjualan benar-benar hilang (bukan toko tutup): dalam 90 detik, stok 2 item
**turun** (`NN07014` −8, `NN09601` −1) sementara nota tetap 18 dan `update` tetap beku.

## Penyebab sebenarnya (BUKAN jaringan)

Jaringan **sehat**. Terbukti dari mesin itu sendiri:
- `ping 192.168.77.250` → berhasil (8–48 ms)
- `Test-NetConnection 192.168.77.250 -Port 5444` → **True**
- Rute `192.168.77.0/24` ada di antarmuka `192.168.77.27`

Penyebabnya **bug di `server.js` proxy**, terlihat di `logs/err.log`:

```
[unhandledRejection] Error: connect ENETUNREACH 192.168.77.250:5444
    at async Object.segarkanJendela (server.js:420:19)
    at async file:///.../server.js:1089:11
```

Dua cacat yang saling memperburuk:

1. **`segarkanJendela()` dipanggil tanpa try/catch.** Loop `for (;;)` di baris 1080
   juga tanpa try/catch. Satu kedipan jaringan ke DB melempar galat yang tidak
   tertangkap → async IIFE pemelihara laporan **MATI**. Proses tetap hidup dan
   katalog tetap jalan, jadi `/health` tampak sehat. Hanya restart yang memulihkan.
   Itulah sebabnya log galat berhenti pukul 09:38: tidak ada lagi yang mencoba,
   jadi tidak ada lagi yang error.

2. **"Recovery" memanggil `pool.end()`.** Setelah `end()`, `pg.Pool` menolak SEMUA
   query berikutnya selamanya (`Cannot use a pool after calling end`). Gangguan
   sementara berubah menjadi kerusakan permanen.

## Perbaikan yang diterapkan

Berkas: `C:\root folder project\ipos-api\server.js`
Backup: `server.js.bak-20261117-112527` (51.026 byte)

1. Seluruh isi siklus loop jual dibungkus `try { ... } catch (e) { ... }`.
   Galat dicatat ke `sumber.st.err`, jeda 3 detik, lalu **lanjut** — tidak mati.
2. `pool.end()` dihapus dari jalur recovery, dengan komentar alasannya.

Verifikasi: `node --check server.js` → **SINTAKS_OK**, service direstart
(PID 4700 → 9916), `jual.umurDetik` 0, `jual.err` kosong, nota 139.606 → 139.694.

## Perbaikan sisi bot (repo ini)

Kebekuan tidak lagi ditampilkan seolah data terkini:

- `headerLaporanBasi()` — header peringatan bila `update` > 10 menit, menyebut
  lamanya dan sebabnya.
- `umurLaporanDetik()` — satu tempat menghitung umur `update`, menormalkan
  satuan detik vs milidetik.
- `peringatanBasiLaporan()` — **hanya** untuk rentang yang menyentuh hari ini.
  Laporan tanggal lampau memang tua tetapi lengkap; memperingatkannya hanya
  melatih pengguna mengabaikan peringatan.
- Dipakai di laporan KASIR, MEREK, MARKETPLACE, dan jalur "tidak ada penjualan".
  Jalur itu kini memeriksa kebekuan LEBIH DULU: daftar kasir kosong bukan bukti
  tidak ada penjualan bila datanya tidak terbaca.
- `tempelSebabBilaBeku()` (agen) menempelkan sebab dari `/health` proxy ke
  laporan, **hanya** saat beku — toko sehat tidak dibebani satu request pun.
- `/health` kini menampilkan `nota`/`omzet`/`updateSebab` yang sebenarnya
  (sebelumnya selalu `null` karena membaca `jual.data.nota`, padahal bentuk iPos
  menaruh angka di `total`).

## Uji

| Berkas | Hasil |
|---|---|
| `boot/test-peringatan-laporan-beku.js` | 19/19 |
| `boot/test-sebab-kebekuan-terkirim.js` | 8/8 |
| `boot/test-health-angka-laporan.js` | 6/6 |
| `boot/bukti-uji-peringatan-beku.js` | GAGAL di kode lama, LULUS di kode baru |
| Baterai `boot/test-*.js` | 44/47 (3 butuh jaringan/browser/port) |

## Rollback

- Proxy: salin `server.js.bak-20261117-112527` → `server.js`, lalu
  `Restart-Service iPosAPI`.
- Bot: `git revert` commit `e4c03a9`, `5d17c1d`, `652ac3c`.

## Pelajaran

`/health` yang "ok" dan katalog yang segar **bukan** bukti laporan penjualan
sehat. Yang membuktikan hanyalah `update` di dalam laporan itu sendiri. Karena
itu bot sekarang memeriksa `update`, bukan waktu kiriman.
