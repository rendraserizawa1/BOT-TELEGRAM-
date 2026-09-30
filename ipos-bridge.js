'use strict';

/* ═══════════════════════════════════════════════════════════════════════
   IPOS BRIDGE v3 — nama + harga + stok REALTIME dari iPos 5.0
   ───────────────────────────────────────────────────────────────────────
   Satu INSTANS per database iPos / toko:
     • CP (Central Perabot / ALAK, DB i5_CP2026)  — env lama, kompatibel:
         IPOS_URL / IPOS_KEY / IPOS_TOKO (default 'cp')
     • NK (Nasional Kitchen / INPRES, DB i5_INPRES2025, API di mesin NK) — baru:
         IPOS_NK_URL / IPOS_NK_KEY / IPOS_NK_TOKO (default 'nk')
       Kalau IPOS_NK_URL kosong → instans NK tidak dibuat (fitur NK mati,
       perilaku bot persis seperti v2).

   Sumber kebenaran tiap toko = iPos:
     nama    ← tbl_item.namaitem
     satuan  ← tbl_item.satuan
     ecer    ← tier J TERKECIL (tbl_itemhj tipehj='J', jmlsampai terkecil, fallback hargajual1)
     ambil   ← tier J TERBESAR (tbl_itemhj tipehj='J', jmlsampai terbesar, fallback ecer)
     hpp     ← tbl_item.hargapokok
     stok    ← tbl_itemstok (total semua kantor)

   Baris harga tipehj='L' (level) TIDAK dipakai: tidak ikut ter-update
   saat harga diganti lewat iPos, jadi sering basi (terverifikasi dari
   harga aktual yg ditagih kasir di tbl_ikdt).

   Realtime: langganan SSE /api/events — perubahan diterapkan ≤ ~3 dtk
   setelah iPos berubah. Sync penuh berkala (default 60 dtk) = jaring
   pengaman (item terhapus, SSE sempat putus, dsb).

   Excel harga_toko/<toko>.xlsx hanya fallback darurat saat API mati.
   Item baru dari iPos TIDAK ditulis balik ke Excel (tokoList kosong).
   ═══════════════════════════════════════════════════════════════════════ */

// ── Pabrik instans bridge ─────────────────────────────────────────────────
// Semua state (snapshot, SSE, status) milik SATU instans = satu API iPos.
// Dua instans (CP + NK) berjalan berdampingan tanpa saling ganggu; item
// yang sama di kedua DB mendapat harga per toko masing-masing
// (barang.harga.cp + barang.harga.nk) — sesuai desain tokoList bot.
function buatBridge({ url, key, toko, label }) {
  const IPOS_URL = String(url || '').replace(/\/+$/, '');
  const IPOS_KEY = String(key || '');
  const IPOS_TIMEOUT = Number(process.env.IPOS_TIMEOUT_MS || 8000);
  const LABEL = label || (toko && toko[0] ? toko[0].toUpperCase() : 'iPos');

  let lastSync = 0;
  let lastError = null;
  let lastCount = 0;
  let online = false;
  let sseOk = false;

  // kode → item iPos terakhir diketahui (untuk status & debug)
  let snapshot = new Map();

  const tglHariIni = () => new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric',
  }).format(new Date());

  // ─────────────────────────────────────────────────────────────────────────
  // FETCH
  // ─────────────────────────────────────────────────────────────────────────

  async function ambilItems() {
    if (!IPOS_KEY) throw new Error(`IPOS_KEY untuk ${LABEL} belum diisi di .env`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IPOS_TIMEOUT);
    try {
      const res = await fetch(`${IPOS_URL}/api/items?key=${encodeURIComponent(IPOS_KEY)}`,
        { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.data)) throw new Error('bentuk respons tak dikenal');
      return json.data;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TERAPKAN SATU PERUBAHAN iPos (dipakai sync penuh & SSE)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @returns {'ubah'|'baru'|'hapus'|null} null = tak ada efek / tidak berubah
   */
  function terapkan(dataBarang, ip) {
    const kode = String((ip && ip.kode) || '').toUpperCase();
    if (!kode) return null;
    const map = index(dataBarang);
    let barang = map.get(kode);

    // item dihapus dari iPos → buang info toko ipos; kalau murni milik ipos, buang item
    if (ip.deleted) {
      if (!barang) return null;
      const lain = (barang.tokoList || []).filter((t) => !toko.includes(t));
      if (!lain.length) {
        const i = dataBarang.indexOf(barang);
        if (i >= 0) dataBarang.splice(i, 1);
        map.delete(kode);
      } else {
        barang.tokoList = lain;
        if (barang.harga) for (const tk of toko) delete barang.harga[tk];
      }
      return 'hapus';
    }

    const ecer = Number(ip.harga) || 0;
    const ambil = Number(ip.harga2) > 0 ? Number(ip.harga2) : ecer; // harga2 kosong → ecer
    const hpp = Number(ip.hpp) || 0;
    const stok = Number(ip.stok) || 0;

    if (!barang) {
      if (String(ip.statusjual || '').toUpperCase() === 'N') return null; // tak dijual → jangan masuk katalog
      barang = {
        kode,
        nama: ip.nama || kode,
        jenis: ip.kategori || '',
        merek: '',
        satuan: ip.satuan || 'PCS',
        satuanPerToko: {},
        namaPerToko: {},
        tokoList: [],
        lastUpdated: '',
        lastUpdatedPerToko: {},
        harga: {},
        stokSumber: 'ipos',
        baruDariIpos: true,
      };
      for (const tk of toko) barang.harga[tk] = { ecer, ambil, stok, hpp };
      barang.lastUpdatedPerToko[toko[0]] = tglHariIni();
      dataBarang.push(barang);
      map.set(kode, barang);
      return 'baru';
    }

    // hitung dulu apa yang benar-benar berubah (buat log akurat)
    const h = barang.harga[toko[0]];
    const beda = barang.nama !== (ip.nama || barang.nama)
      || barang.satuan !== (ip.satuan || barang.satuan)
      || !h || h.ecer !== ecer || h.ambil !== ambil || h.stok !== stok || h.hpp !== hpp;

    barang.nama = ip.nama || barang.nama;
    barang.satuan = ip.satuan || barang.satuan;
    barang.lastUpdatedPerToko = barang.lastUpdatedPerToko || {};
    for (const tk of toko) {
      if (!barang.harga[tk]) barang.harga[tk] = { ecer: 0, ambil: 0, stok: 0, hpp: 0 };
      barang.harga[tk].ecer = ecer;
      barang.harga[tk].ambil = ambil;
      barang.harga[tk].stok = stok;
      barang.harga[tk].hpp = hpp;
      barang.lastUpdatedPerToko[tk] = tglHariIni();
    }
    barang.stokSumber = 'ipos';
    return beda ? 'ubah' : null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SYNC PENUH
  // ─────────────────────────────────────────────────────────────────────────

  async function syncStok(dataBarang, opts = {}) {
    const { verbose = false } = opts;
    if (!Array.isArray(dataBarang)) return { ok: false, total: 0, ubah: 0, baru: 0, hapus: 0, err: 'DATA_BARANG bukan array' };

    let items;
    try {
      items = await ambilItems();
    } catch (e) {
      lastError = String(e.message || e);
      online = false;
      if (verbose) console.warn(`⚠️ [iPos ${LABEL}] sync gagal: ${lastError} — pakai data Excel`);
      return { ok: false, total: lastCount, ubah: 0, baru: 0, hapus: 0, err: lastError };
    }

    snapshot = new Map();
    for (const it of items) {
      if (it && it.kode) snapshot.set(String(it.kode).toUpperCase(), it);
    }

    let ubah = 0, baru = 0, hapus = 0;
    for (const ip of snapshot.values()) {
      const r = terapkan(dataBarang, ip);
      if (r === 'ubah') ubah++; else if (r === 'baru') baru++;
    }
    // item yang hilang dari iPos saat bot offline → bersihkan sekarang
    for (const barang of [...dataBarang]) {
      if (barang && barang.stokSumber === 'ipos'
        && !snapshot.has(String(barang.kode || '').toUpperCase())) {
        if (terapkan(dataBarang, { kode: barang.kode, deleted: true }) === 'hapus') hapus++;
      }
    }

    lastSync = Date.now();
    lastCount = snapshot.size;
    lastError = null;
    online = true;

    if (verbose || ubah || baru || hapus) {
      console.log(`✅ [iPos ${LABEL}] ${lastCount} item — ubah ${ubah}, baru ${baru}, hapus ${hapus}${verbose ? '' : ' (realtime)'}`);
    }
    return { ok: true, total: lastCount, ubah, baru, hapus };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LAPORAN PENJUALAN (cache di iPos API; endpoint /api/jual*)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Ambil laporan penjualan per kasir dari iPos API.
   * @param {string} dari  YYYY-MM-DD
   * @param {string} [sampai=dari]  YYYY-MM-DD
   * @returns {Promise<object>} { siap, kasir[], total, nonaktif[], jangkauan, update }
   */
  async function ambilLaporanKasir(dari, sampai = dari) {
    if (!IPOS_KEY) throw new Error(`IPOS_KEY untuk ${LABEL} belum diisi di .env`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await fetch(
        `${IPOS_URL}/api/jual?dari=${encodeURIComponent(dari)}&sampai=${encodeURIComponent(sampai || dari)}&key=${encodeURIComponent(IPOS_KEY)}`,
        { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Laporan penjualan per MEREK (HOMMY & KIREI) untuk rentang tanggal —
   * sesuai tabel iPos "penjualan per item per merek".
   * @param {string} dari  YYYY-MM-DD
   * @param {string} [sampai=dari]  YYYY-MM-DD
   * @param {string} [merek]  daftar merek dipisah koma (default HOMMY,KIREI)
   * @returns {Promise<object>} { siap, dari, sampai, merek[], data[], total, update }
   */
  async function ambilLaporanMerek(dari, sampai = dari, merek = '') {
    if (!IPOS_KEY) throw new Error(`IPOS_KEY untuk ${LABEL} belum diisi di .env`);
    const controller = new AbortController();
    // 120 dtk: query tbl_ikdt bisa lambat saat cache PG dingin (jarang dipakai)
    const timer = setTimeout(() => controller.abort(), 120000);
    try {
      let url = `${IPOS_URL}/api/jual-merek?dari=${encodeURIComponent(dari)}&sampai=${encodeURIComponent(sampai || dari)}&key=${encodeURIComponent(IPOS_KEY)}`;
      if (merek) url += `&merek=${encodeURIComponent(merek)}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Laporan penjualan MARKETPLACE — nota kodesales='MARKETPLACE'.
   * @param {string} dari  YYYY-MM-DD
   * @param {string} [sampai=dari]  YYYY-MM-DD
   * @returns {Promise<object>} { siap, dari, sampai, toko[], central, total, nomor, update }
   */
  async function ambilLaporanMarketplace(dari, sampai = dari) {
    if (!IPOS_KEY) throw new Error(`IPOS_KEY untuk ${LABEL} belum diisi di .env`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 60000);
    try {
      const url = `${IPOS_URL}/api/jual-marketplace?dari=${encodeURIComponent(dari)}&sampai=${encodeURIComponent(sampai || dari)}&key=${encodeURIComponent(IPOS_KEY)}`;
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SSE — perubahan diterapkan begitu iPos berubah (≤ POLL_MS API + ms)
  // ─────────────────────────────────────────────────────────────────────────

  function mulaiSSE(getDataBarang) {
    (async () => {
      for (;;) {
        try {
          const res = await fetch(`${IPOS_URL}/api/events?key=${encodeURIComponent(IPOS_KEY)}`,
            { headers: { accept: 'text/event-stream' } });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          sseOk = true;
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          for (;;) {
            const { done, value } = await reader.read();
            if (done) throw new Error('koneksi SSE terputus');
            buf += dec.decode(value, { stream: true });
            let i;
            while ((i = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, i);
              buf = buf.slice(i + 2);
              let ev = '', data = '';
              for (const line of frame.split('\n')) {
                if (line.startsWith('event:')) ev = line.slice(6).trim();
                else if (line.startsWith('data:')) data += line.slice(5).trim();
              }
              if (ev !== 'items' || !data) continue;
              try {
                let ubah = 0, baru = 0, hapus = 0;
                for (const ip of JSON.parse(data)) {
                  const r = terapkan(getDataBarang(), ip);
                  if (r === 'ubah') ubah++; else if (r === 'baru') baru++; else if (r === 'hapus') hapus++;
                }
                lastSync = Date.now();
                if (ubah || baru || hapus) {
                  console.log(`🔄 [iPos ${LABEL}] realtime: ubah ${ubah}, baru ${baru}, hapus ${hapus}`);
                }
              } catch { /* payload rusak → abaikan frame */ }
            }
          }
        } catch (e) {
          sseOk = false;
          lastError = String(e.message || e);
        }
        await new Promise((r) => setTimeout(r, 3000)); // sambung ulang (SSE retry 3s)
      }
    })();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATUS
  // ─────────────────────────────────────────────────────────────────────────

  function status() {
    return {
      online, sse: sseOk ? '🟢 realtime' : '🔴 putus',
      total: lastCount, lastSync, lastError,
      umurDetik: lastSync ? Math.round((Date.now() - lastSync) / 1000) : null,
      toko, url: IPOS_URL,
    };
  }

  /**
   * Jalankan: sync penuh awal + langganan SSE + sync penuh berkala (jaring
   * pengaman). Panggil SEKALI saat startup per instans.
   * @param {() => Array} getDataBarang  fungsi yg mengembalikan DATA_BARANG terkini
   */
  function mulaiAutoSync(getDataBarang, intervalMs = Number(process.env.IPOS_SYNC_MS || 60000)) {
    const jalan = async (verbose) => {
      try { await syncStok(getDataBarang(), { verbose }); }
      catch (e) { console.warn(`⚠️ [iPos ${LABEL}] auto-sync:`, e.message); }
    };
    jalan(true);
    if (IPOS_KEY) mulaiSSE(getDataBarang);
    const t = setInterval(() => jalan(false), intervalMs);
    if (t.unref) t.unref();
    return () => clearInterval(t);
  }

  return { url: IPOS_URL, toko, label: LABEL, syncStok, terapkan, status, mulaiAutoSync, ambilLaporanKasir, ambilLaporanMerek, ambilLaporanMarketplace };
}

// ── INDEX DATA_BARANG (bangun ulang otomatis kalau array diganti loadExcel) ──
// (dibagi semua instans — array DATA_BARANG bot memang satu untuk semua toko)

let idxArr = null;
let idxMap = new Map();

function index(arr) {
  if (arr !== idxArr) {
    idxMap = new Map();
    for (const d of arr) if (d && d.kode) idxMap.set(String(d.kode).toUpperCase(), d);
    idxArr = arr;
  }
  return idxMap;
}

// ── INSTANS ────────────────────────────────────────────────────────────────

// CP — Central Perabot (env lama, kompatibel penuh dengan v2)
const cp = buatBridge({
  url: process.env.IPOS_URL || 'http://127.0.0.1:8080/ipos',
  key: process.env.IPOS_KEY || '',
  toko: (process.env.IPOS_TOKO || 'cp')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
  label: 'CP',
});

// NK — Toko Nasional Kitchen / INPRES (API ipos-api i5_INPRES2025 di mesin NK).
// Dibuat hanya kalau IPOS_NK_URL diisi (mis. http://100.110.152.33:8080/ipos).
const nk = process.env.IPOS_NK_URL
  ? buatBridge({
      url: process.env.IPOS_NK_URL,
      key: process.env.IPOS_NK_KEY || '',
      toko: (process.env.IPOS_NK_TOKO || 'nk')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      label: 'NK',
    })
  : null;

// Ekspor: pemakaian lama (iposBridge.syncStok dst.) = instans CP, persis v2.
module.exports = {
  syncStok: (...a) => cp.syncStok(...a),
  terapkan: (...a) => cp.terapkan(...a),
  status: () => cp.status(),
  mulaiAutoSync: (...a) => cp.mulaiAutoSync(...a),
  ambilLaporanKasir: (...a) => cp.ambilLaporanKasir(...a),
  ambilLaporanMerek: (...a) => cp.ambilLaporanMerek(...a),
  ambilLaporanMarketplace: (...a) => cp.ambilLaporanMarketplace(...a),
  get IPOS_URL() { return cp.url; },
  get IPOS_TOKO() { return cp.toko; },
  buatBridge, cp, nk,
};
