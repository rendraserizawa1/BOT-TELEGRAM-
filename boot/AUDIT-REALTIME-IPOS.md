# AUDIT REALTIME iPos — 3 TOKO (14 Nov 2026)

Semua temuan di bawah **dibuktikan dengan angka dari API produksi**, bukan asumsi.

---

## BUG 1 — Penjaga kesegaran data item adalah KODE MATI

**File:** `ipos-bridge.js` → `mulaiAutoSync()`

**Kode lama:**
```js
const bukti = Math.max(lastSseFrameAt, lastSync);
```

**Sebab:** `lastSseFrameAt` diperbarui oleh **SEMUA** frame sah, termasuk `jual-ping`.
CP mengirim `jual-ping` tiap ~15 dtk → `sekarang - bukti` tidak pernah mencapai
`STALE_MS` (120 dtk) → penjaga **tidak pernah aktif**.

Akibat: kalau SSE melewatkan frame `items`, harga/stok bisa tertinggal sampai
sync berkala 5 menit.

**Perbaikan:**
- Tambah `lastItemAt` — hanya diperbarui oleh frame `items` + sync penuh.
- Tambah `lastJualAt` — hanya diperbarui oleh event `jual` (BUKAN `jual-ping`).
- Dua pemicu, keduanya berbasis bukti:
  1. Tidak ada frame item > `STALE_MS` (120 dtk).
  2. Ada nota (`jual`) tetapi tidak ada frame `items` sesudahnya > `NOTA_GRACE_MS`
     (20 dtk). Nota **pasti** mengubah stok → ini bukti kanal item rusak.

**PENTING — jangan pakai `jual-ping` sebagai pemicu sync:**
toko yang sepi tidak mengirim `items`, sehingga sync penuh akan dipaksa tiap
45 dtk dan menghabiskan RAM host yang kecil (3.874 MB).

**Bukti log produksi:**
```
⏳ [iPos CP]   tidak ada kabar item 131 dtk — sync penuh dipaksa sekarang
⏳ [iPos NK]   tidak ada kabar item 130 dtk — sync penuh dipaksa sekarang
⏳ [iPos KEFA] tidak ada kabar item 140 dtk — sync penuh dipaksa sekarang
```
Sebelum perbaikan, baris ini **tidak akan pernah muncul**.

**Bukti pengamatan 150 dtk:** umurItem maks CP 127s / NK 67s / KEFA 135s,
lalu turun (CP 127 → 4 dtk). **0 pelanggaran** ambang 150 dtk.

---

## BUG 2 — Laporan marketplace NK melaporkan Rp 0 padahal ada penjualan

**File:** `index.js` → `tampilkanLaporanMarketplace()`

**Bentuk respons iPos BERBEDA antar toko** (dibuktikan dari respons mentah):

| Toko | `central.omzet` | `toko[].omzet` | `r.total` |
|------|-----------------|----------------|-----------|
| CP   | 168.467.000     | 0 (toko pasangan) | 168.467.000 |
| NK   | **0 (selalu kosong)** | **45.911.500** | **0** |
| KEFA | 0               | 0              | 0 |

Kode lama memakai `r.total` / `central.omzet` untuk **semua** toko →
NK menampilkan **Rp 0** padahal ada penjualan Rp 45.911.500.

**Perbaikan:**
```js
const totalOmzetMp = (isNk || isKefa)
  ? (totalResmi || centralOmzet || sumTokoMp)
  : (totalResmi || centralOmzet);
```
Rincian tunai/debit hanya ditampilkan bila `central` memang ada. Kalau tidak,
ditulis terus terang `(rincian tidak dikirim iPos untuk toko ini)` —
**bukan** "Rp 0" yang menyesatkan.

**Bukti:** NK Rp 0 → **Rp 45.911.500**. CP tidak berubah (168.467.000).

---

## BUG 3 — Backup laporan merek & marketplace hanya untuk CP

**File:** `index.js` → `jagaBackupSatuToko()`

Kode lama: `if (tk === 'cp' && ...)`. Saat API NK/KEFA mati, laporan merek &
marketplace mereka tidak punya salinan lokal.

**Perbaikan:** hapus batasan toko. Ketiga toko terbukti membalas `siap=true`
untuk kedua endpoint.

---

## TELEMETRI BARU

`status()` dan `/health` sekarang melaporkan:
- `umurItemDetik` — umur data **item** (harga/stok), dari `lastItemAt`.
- `itemSegar` — `true` bila ≤ 150 dtk.
- `notaTanpaItemDetik` — ada nota tapi belum ada frame `items` (indikasi kanal rusak).

Beda dengan `umurKoneksiDetik` yang hanya membuktikan "masih bicara",
bukan "data item masih mengalir".

`stempelKesegaran()` di detail barang: bila `itemSegar=false`, tampilkan
`⚠️ Angka di atas data terakhir N lalu — sedang disegarkan dari iPos.`
→ user **tidak pernah dikelabui**.

---

## AUDIT YANG DIPERBAIKI

`/api/diag/kesesuaian`:
- Sampel diambil dari **katalog iPos toko itu sendiri** (`ujiAmbilKode` baru
  di bridge), bukan sembarang `DATA_BARANG`.
- `tak-ada-di-toko` dipisah dari `gagal`.
- Audit lama menyesatkan: NK "8/15 gagal" padahal item itu memang **tidak
  dijual** di toko tsb (HTTP 404 — terbukti).

---

## HASIL AKHIR

| Pemeriksaan | Hasil |
|---|---|
| Audit kesesuaian 20 item × 3 toko | **60/60 IDENTIK**, 0 beda, 0 gagal, `lulus=true` |
| HANTU (harga ada, item tak ada di iPos) | **0** — CP 10816/10816, NK 5235/5235, KEFA 4593/4593 |
| Laporan kasir konsisten | `total.omzet == perTipe KSR+JL == sum(kasir non-PROMO)` di 3 toko |
| Laporan merek konsisten | `sum(data.omzet) == total.omzet` (CP 367.979.000, NK 88.806.000, KEFA 35.652.000) |
| Semua laporan | `siap=true`, respons 8–212 ms |
| Penjaga kesegaran | aktif, 0 pelanggaran |

**Selisih CP yang tampak tadi bukan bug:** `sum(kasir.omzet)` lebih besar
Rp 31.487.000 dari `total.omzet` karena itu omzet **konter PROMO**, yang
memang **terpisah** dari TOTAL CP. Kode sudah memisahkannya dengan benar
(`kasirCp` vs `kasirPromo`).

**Catatan:** item `statusjual='N'` **sengaja** dikecualikan dari katalog
(`ipos-bridge.js` ~baris 220) — itu desain, bukan bug (203 item CP, 12 NK).

---

## UJI REGRESI

| Suite | Hasil |
|---|---|
| `boot\test-penjaga-kesegaran.js` (baru) | **17/17** |
| `boot\test-marketplace-total.js` (baru) | **7/7** |
| `boot\verify-all.js` | **25/25** |
| `boot\test-instance-lock.js` | **28/28** |
| `boot\test-allowed-updates.js` | **27/27** |
