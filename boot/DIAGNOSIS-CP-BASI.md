# DIAGNOSIS: Data Penjualan CP Basi

**Tanggal:** 2026-11-14
**Metode:** systematic-debugging (investigasi akar masalah, bukan tebak-menebak)

---

## 1. Gejala yang dilaporkan

> "data ipos api cp selalu basi data terakhir penjualan semuanya data dari 98 menit lalu"

---

## 2. Bukti terukur

### Lapisan 1 — proxy CP langsung (via Tailscale, tanpa tunnel)

```
GET http://100.125.99.99:8080/ipos/health
  ok=true  items=11026  lastError=null
  jual.siap=true  jual.nota=138829
  jual.umurDetik=7079   (≈118 menit)
  jual.err="connect ETIMEDOUT 192.168.77.250:5444"

GET /ipos/api/jual?dari=2026-11-14&sampai=2026-11-14
  update = 2026-11-14T08:13:41Z  → 113 menit lalu
  total.nota=464  total.omzet=196426000
```

### Lapisan 2 — proxy CP lewat tunnel Cloudflare (yang dipakai Railway)

```
ok=true  items=11026  lastSync=1794650550676
jual.err="connect ETIMEDOUT 192.168.77.250:5444"
```

**Hasil lapisan 1 dan lapisan 2 IDENTIK** → tunnel Cloudflare dan bot Railway
**tidak bersalah**. Masalah ada di sumbernya.

### Bukan masalah cache

`/api/jual` dipanggil 2x dengan jeda 8 detik → `update` identik
(`1794644021609`). Cache menyajikan data yang memang sudah basi sejak
`08:13:41Z`.

---

## 3. Akar masalah: DB sentral CP MATI

Proxy CP melayani **dua jalur DB berbeda**:

| Jalur | Status | Bukti |
|---|---|---|
| `items` (katalog) | **HIDUP** | `items=11026`, `lastSync` selalu baru |
| `jual` + `jualPromo` (laporan) | **MATI** | `ETIMEDOUT 192.168.77.250:5444` |

`192.168.77.250:5444` adalah **DB sentral** tempat laporan penjualan CP berada
(database `i5_CP2026`, `i5_CP2025`, `i5_PROMO2025`).

### Kronologi terukur (bukti paling kuat)

| Waktu | Dari PC ini | Keterangan |
|---|---|---|
| ~17:20 | **5444 TERBUKA**, 445 TERBUKA, ping OK | DB hidup; terbaca 139.036 nota, nota terbaru umur 4 menit |
| ~18:50 | **ping GAGAL**, 5444 TERTUTUP, 445 TERTUTUP | 0/15 percobaan gagal |
| ~18:55 | proxy CP asli `umur=8760s` (146 menit) | konsisten: mati sejak ~16:30 |

Jadi **bukan** masalah rute, **bukan** tunnel, **bukan** bot, **bukan** kode.
Mesin `192.168.77.250` (DB sentral CP) sedang **offline / mati**.

Ping juga gagal → bukan hanya port yang tertutup, tapi host-nya tidak merespons.
Kalau hanya rute Tailscale yang rusak, ping akan tetap gagal **tapi** host
lainnya di subnet itu (mis. `.1`) akan tetap terjangkau. Yang terjadi:
`192.168.77.250` sendiri tidak menjawab.

---

## 4. Yang SUDAH dibangun dan terbukti (siap pakai saat DB hidup lagi)

`boot/proxy-cp.js` — proxy iPos CP mandiri yang membaca DB sentral langsung.

### Validasi terhadap proxy CP asli

**Laporan kemarin (2026-11-13) — IDENTIK SEMPURNA:**

| Metrik | Proxy asli | Proxy lokal |
|---|---|---|
| `total.nota` | 474 | 474 |
| `total.item` | 6197 | 6197 |
| `total.omzet` | 183.904.000 | 183.904.000 |
| `total.tunai` | 110.578.000 | 110.578.000 |
| `total.debit` | 73.326.000 | 73.326.000 |
| `promo.nota` | 34 | 34 |
| `promo.omzet` | 738.000 | 738.000 |
| `jangkauan.dari` | 2025-01-06 | 2025-01-06 |
| `kasir.length` | 5 | 5 |

**`/api/items` — identik karakter-per-karakter** (11.026 barang, field
`kode`/`nama`/`harga`/`harga2`/`hpp`/`stok`/`stok_kantor`).

**Laporan hari ini — proxy lokal LEBIH SEGAR** saat DB masih hidup:
`nota=671 omzet=343.327.000` vs proxy asli `nota=464 omzet=196.426.000`
(proxy asli kehilangan 207 nota / Rp 146,9 juta).

### Rancangan penting: kenapa arsip 2025 dipisah

- `i5_CP2026` = 2026-01-06 .. sekarang (139.036 nota) → **di-cache di memori**
- `i5_CP2025` = 2025-01-06 .. 2026-01-05 (158.670 nota) → **on-demand dari DB**

Alasan (dua-duanya nyata, sudah diukur):

1. **RAM PC ini hanya 3,8 GB, bebas ~0,2 GB.** Memuat 158.670 baris lagi
   berisiko OOM.
2. **696 `notransaksi` BERTABRAKAN** antar kedua DB dengan isi **BERBEDA**
   (penomoran nota direset Jan 2026: `000001/CPK/01/26` ada di 2026-01-05
   **dan** 2026-01-06). Menggabung dengan kunci `notransaksi` akan
   **MENGHILANGKAN Rp 298.211.500** data 2025.

Dengan memisahkannya, tidak ada penggabungan kunci sama sekali.

---

## 5. Catatan penting untuk permintaan "pindahkan proxy ke server KEFA"

**Terblokir fisik.** Pemindaian `192.168.1.199`:

```
5444  TERBUKA      <- HANYA ini
8080 / 80 / 443 / 445 / 3389 / 22 / 5985 / 5986 / 5432  -> semua TERTUTUP
```

Tidak ada satu pun jalur untuk memasang atau menjalankan service di sana dari
jarak jauh. Butuh akses fisik/RDP langsung ke mesin itu.

Sebagai perbandingan, mesin lain yang **bisa** diakses:

| Mesin | Port terbuka | Bisa dipasang service? |
|---|---|---|
| CP `100.125.99.99` | 8080, 22, 3389, 445, 443, **135, 139** | ya (perlu kredensial) |
| NK `100.110.152.33` | 8080, 3389, 445 | ya (perlu kredensial) |
| KEFA `192.168.1.199` | **5444 saja** | **tidak** |
| DB sentral `192.168.77.250` | 445, 5444 (saat hidup) | tidak |

---

## 6. Tindakan yang dibutuhkan

1. **Nyalakan / periksa mesin `192.168.77.250`.** Ini penyebab tunggal data CP
   basi. Tidak ada perbaikan perangkat lunak yang bisa menggantikannya.
2. Setelah DB hidup, jalankan `boot/proxy-cp.js` di PC ini (atau pindahkan ke
   mesin yang selalu menyala) dan arahkan `IPOS_URL` bot ke sana.

---

## 7. Pemadaman menyeluruh di lokasi CP (terukur 19:0x)

Bukan hanya DB sentral. **Seluruh titik di lokasi CP mati bersamaan:**

| Titik | Status |
|---|---|
| `100.125.99.99` (server proxy CP) — ping, 8080, 445 | **MATI** |
| `192.168.77.250` (DB sentral CP) — ping, 5444, 445 | **MATI** |
| `100.125.88.74`, `100.117.86.101`, `100.112.42.113`, `100.64.216.53` | **MATI** |
| `100.110.152.33` (NK) | HIDUP |
| `100.123.166.13` (PC ini) | HIDUP |
| `192.168.1.199` (DB KEFA) | HIDUP |

Lima node tailnet lokasi CP padam bersamaan sementara NK dan PC ini tetap hidup.
Pola ini menunjukkan **gangguan listrik / ISP di lokasi CP**, bukan kegagalan
perangkat lunak dan bukan akibat perubahan kode apa pun.

**Tidak ada yang bisa diperbaiki dari sisi kode.** Bot Railway tetap
`status=OK polling=true streak=0`; NK dan KEFA tetap segar.

---

## 8. Perbaikan yang sudah dipasang & ter-deploy (commit `d29cb99`)

Masalah sesungguhnya yang **bisa** diperbaiki: bot **tidak pernah melaporkan**
kebasian data penjualan. Yang dijaga hanya kesegaran `items`. Karena katalog
item memakai jalur DB lain, `/health` lama berbunyi `segar=true` padahal
penjualan sudah beku berjam-jam — **menyesatkan**.

1. `ipos-bridge.js` — mencatat `update` dari API; `status()` kini melaporkan
   `laporanUmurDetik`, `laporanBasi`, `laporanUpdate`, `laporanErr`,
   `laporanDiperiksaDetik`. Tanpa data → `null` (tidak menipu dengan `0`).
2. `index.js` `/health` — menampilkan field kebasian laporan per toko.
3. `boot/umur-laporan.js` — kalimat umur data tidak lagi menyesatkan:
   - dulu `>5 mnt` → *"kasir baru saja jual, tunggu ±1 mnt lalu ketik ulang"*
     (salah total saat sumber mati)
   - kini `>=30 mnt` → peringatan **server sumber iPos tidak terjangkau**
4. `boot/env-backup.js` — mematikan `[ERROR] [SECURE] File .env tidak
   ditemukan!` palsu di Railway.

### Bukti penjaga bekerja (Railway, langsung dari /health)

```
CP   : online=false itemSegar=false laporanErr="HTTP 502"   <- jujur
NK   : online=true  itemSegar=true  laporanUmur=20s laporanBasi=false
KEFA : online=true  itemSegar=true  laporanUmur=22s laporanBasi=false
```

Sebelum perbaikan, CP akan tampil `itemSegar=true` tanpa satu pun tanda bahwa
penjualannya basi.

### Test

| Suite | Hasil |
|---|---|
| `test-penjaga-laporan.js` | 11/11 |
| `test-umur-laporan.js` | 20/20 |
| `test-penjaga-kesegaran.js` (regresi) | 17/17 |
| `test-laporan-backoff.js` (regresi) | 5/5 |
| `uji-railway.js` (end-to-end produksi) | 25/25 |
| `pindai-rahasia.js` | nol kebocoran |

Kegagalan pada `test-marketplace-total`, `test-dashboard-db`, `test-nota-nyata`,
`test-ocr`, `test-poll-keepalive` **bukan regresi** — semuanya memerlukan
server CP yang saat ini mati, atau bot lokal di port 3001 yang sengaja
dimatikan (Railway satu-satunya poller).

