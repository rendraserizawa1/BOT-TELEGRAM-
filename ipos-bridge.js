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
  const IPOS_TIMEOUT = Number(process.env.IPOS_TIMEOUT_MS || 15000); // full katalog ribuan item butuh timeout lebih longgar; item-live tetap cepat
  const LABEL = label || (toko && toko[0] ? toko[0].toUpperCase() : 'iPos');

  // ── JALUR iPos (proxy Tailscale + cadangan) ─────────────────────────
  // Tanpa `IPOS_TAILSCALE_PROXY`, `jalur.ambil()` sama persis dengan `fetch`
  // biasa -> perilaku di PC TIDAK berubah dan rollback cukup mengosongkan
  // satu variabel. Lihat boot/ipos-jalur.js untuk aturan lengkapnya.
  const jalur = require('./boot/ipos-jalur').buatJalurIpos({
    urlUtama: IPOS_URL,
    urlCadangan: process.env['IPOS_' + String(toko || '').toUpperCase() + '_URL_CADANGAN'] || '',
    proxy: process.env.IPOS_TAILSCALE_PROXY || '',
  });

  // ── MODE DORONG ─────────────────────────────────────────────────────
  // Bila PUSH_TOKEN diisi, data iPos TIDAK ditarik lagi dari sini: PC yang
  // mendorongnya lewat HTTPS publik. Ini menggantikan arah tarik yang gagal
  // karena PC tidak bisa dijangkau dari luar (CGNAT) — Cloudflare tunnel mati,
  // Tailscale lewat DERP relay dan intermiten.
  //
  // Bila PUSH_TOKEN kosong, `pushAktif()` selalu false dan SELURUH jalur lama
  // tetap dipakai persis seperti sebelumnya. Rollback = kosongkan satu env.
  const pushGudang = require('./boot/push-gudang');
  const tokoUtama = Array.isArray(toko) && toko.length ? String(toko[0]).toLowerCase() : '';
  function pushAktif() {
    try { return pushGudang.aktif(); } catch (_) { return false; }
  }
  // Berapa lama data dorongan masih dianggap layak dipakai.
  //
  // DUA batas, dan pemisahan ini penting:
  //  - KATALOG: katalog penuh dikirim tiap 15 menit dan delta hanya saat ada
  //    item berubah. Toko sepi yang sehat pun bisa berumur belasan menit. Batas
  //    pendek di sini akan membuat bot membuang katalog yang masih benar.
  //  - LAPORAN: dikirim ulang tiap ~60 detik, jadi batas pendek memang tepat —
  //    laporan yang berumur 10 menit berarti alirannya memang bermasalah.
  const PUSH_BATAS_ITEMS_DETIK = Number(process.env.PUSH_BATAS_PAKAI_DETIK || 1200);
  const PUSH_BATAS_LAPORAN_DETIK = Number(process.env.PUSH_BATAS_LAPORAN_DETIK || 180);
  /**
   * Berapa lama bot MENUNGGU laporan tanggal lampau yang sedang diambil PC.
   *
   * PC menjemput pesanan tiap beberapa detik (PUSH_JEDA_PERMINTAAN_MS), lalu
   * mengambil laporan dari iPos dan mengirimnya. 12 detik cukup untuk satu
   * putaran itu, dan tetap di bawah batas tunggu Telegram sehingga pengguna
   * tidak melihat bot menggantung.
   */
  const PUSH_TUNGGU_RENTANG_MS = Number(process.env.PUSH_TUNGGU_RENTANG_MS || 12000);

  /** Tanggal hari ini (YYYY-MM-DD) menurut jam server. */
  function tanggalLokal() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0')
      + '-' + String(d.getDate()).padStart(2, '0');
  }

  let lastSync = 0;
  let lastSseAt = 0;
  let lastSseFrameAt = 0;
  // KAPAN data ITEM terakhir terbukti segar (frame `items` atau sync penuh).
  // PENTING: dibedakan dari lastSseFrameAt, karena `jual-ping` juga memperbarui
  // lastSseFrameAt. Dulu penjaga kesegaran memakai lastSseFrameAt, sehingga
  // `jual-ping` tiap ~15 dtk membuat penjaga TIDAK PERNAH aktif — kode mati.
  let lastItemAt = 0;
  // Kapan terakhir ada NOTA (event `jual`). Nota PASTI mengubah stok, jadi
  // `jual` tanpa `items` sesudahnya = kanal item SSE rusak (bukti, bukan tebakan).
  let lastJualAt = 0;
  let lastError = null;
  let lastCount = 0;
  let online = false;
  let sseOk = false;

  // Ubah error menjadi teks yang BISA DIDIAGNOSIS.
  // "fetch failed" saja tidak memberi tahu apa pun; penyebab sebenarnya ada di
  // e.cause (mis. UND_ERR_CONNECT_TIMEOUT = host tidak menjawab sama sekali,
  // atau ECONNRESET = koneksi diputus). Dipakai di SEMUA jalur kegagalan agar
  // status yang dilaporkan ke admin selalu memuat sebab yang nyata.
  function formatError(e) {
    const pesan = String((e && e.message) || e || 'error');
    const c = e && e.cause;
    if (!c) return pesan;
    const sub = c.errors && c.errors.length
      ? ' [' + c.errors.map((x) => (x && (x.code || x.message)) || '?').join(', ') + ']'
      : '';
    return `${pesan} (cause: ${c.code || c.message || String(c)}${sub})`;
  }

  // kode → item iPos terakhir diketahui (untuk status & debug)
  let snapshot = new Map();

  const formatterTanggal = new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta', day: '2-digit', month: '2-digit', year: 'numeric',
  });
  // Intl.DateTimeFormat.format() sangat mahal. Dulu dipanggil untuk SETIAP
  // item (11 ribu x 3 toko) sehingga sync memblokir event loop 20-50 detik
  // dan watchdog mengira bot hang. Cache per menit sudah cukup.
  let _tglCache = '';
  let _tglCacheAt = 0;
  const tglHariIni = () => {
    const now = Date.now();
    if (_tglCache && now - _tglCacheAt < 60000) return _tglCache;
    _tglCache = formatterTanggal.format(new Date(now));
    _tglCacheAt = now;
    return _tglCache;
  };

  // ─────────────────────────────────────────────────────────────────────────
  // FETCH
  // ─────────────────────────────────────────────────────────────────────────

  async function ambilItems(attempt = 0) {
    // MODE DORONG: katalog datang dari PC. Tidak ada fetch, tidak ada timeout,
    // tidak ada tunnel yang bisa mati.
    //
    // Bila data dorongan BASI (PC berhenti mengirim), kita JANGAN diam-diam
    // memakai angka beku seolah segar. Kita lempar error supaya status
    // melaporkan OFFLINE — kegagalan harus terlihat, bukan disembunyikan.
    if (pushAktif()) {
      const dariDorong = pushGudang.ambilSegar(tokoUtama, 'items', PUSH_BATAS_ITEMS_DETIK);
      if (Array.isArray(dariDorong) && dariDorong.length) return dariDorong;
      const umur = pushGudang.umurDetik(tokoUtama, 'items');
      throw new Error(umur == null
        ? 'belum ada katalog dorongan dari PC'
        : `katalog dorongan basi (${umur} dtk) — PC berhenti mengirim`);
    }

    if (!IPOS_KEY) throw new Error(`IPOS_KEY untuk ${LABEL} belum diisi di .env`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(process.env.IPOS_CATALOG_TIMEOUT_MS || 60000));
    try {
      const res = await jalur.ambil(`${IPOS_URL}/api/items?key=${encodeURIComponent(IPOS_KEY)}`,
        { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (!Array.isArray(json.data)) throw new Error('bentuk respons tak dikenal');
      return json.data;
    } catch (e) {
      // Kegagalan sementara (fetch failed / ECONNRESET / abort) tidak boleh
      // langsung membuat toko dianggap OFFLINE: satu gangguan jaringan dulu
      // membuat sync penuh dilewati sampai 5 menit berikutnya, sehingga data
      // tampak "tidak update" padahal API sehat. Ulangi 2x dengan jeda.
      const pesan = String((e && e.message) || e);
      const sementara = /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|aborted|socket hang up|network/i.test(pesan);
      if (sementara && attempt < 2) {
        clearTimeout(timer);
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        return ambilItems(attempt + 1);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SATU ITEM REALTIME (SO) — GET /api/item, tanpa cache
  // KEFA /api/item mengembalikan item langsung; CP membungkus {data}.
  // ─────────────────────────────────────────────────────────────────────────

    // SO/realtime 1 item: langsung dari DB iPos via /api/item-live (CP/NK/KEFA).
    // Fallback ke /api/item (cache poll) bila API lama belum punya endpoint.
    async function ambilItem(kode) {
    const live = await ambilItemDari(`${IPOS_URL}/api/item-live?kode=${encodeURIComponent(String(kode || ''))}&key=${encodeURIComponent(IPOS_KEY)}`);
    if (live && live.found) return live.item;
    if (live && live.found === false && live.liveOk) return null; // item-live jawab 404 = memang tidak ada
    return ambilItemDari(`${IPOS_URL}/api/item?kode=${encodeURIComponent(String(kode || ''))}&key=${encodeURIComponent(IPOS_KEY)}`).then((r) => (r && r.found ? r.item : null));
  }

  async function ambilItemDari(url) {
    if (!IPOS_KEY) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), IPOS_TIMEOUT);
    try {
      const res = await jalur.ambil(url, { signal: controller.signal });
      if (res.status === 404) return { found: false, liveOk: url.includes('item-live') };
      if (!res.ok) return null;
      const j = await res.json();
      const it = (j && j.data) || j;
      const k = String((it && it.kode) || (it && it.kodeitem) || '').toUpperCase();
      if (!it || !k || !it.nama) return null;
      return { found: true, item: {
        kode: k,
        nama: it.nama,
        satuan: it.satuan || 'PCS',
        harga: it.harga === null || it.harga === undefined || it.harga === '' ? 0 : Number(it.harga),
        harga2: it.harga2 === null || it.harga2 === undefined || it.harga2 === '' ? 0 : Number(it.harga2),
        stok: Number(it.stok) || 0,
        hpp: Number(it.hpp) || 0,
        statusjual: it.statusjual || '',
        kategori: it.kategori || '',
      } };
    } catch (e) {
      if (String(e.message || '').startsWith('HTTP')) throw e;
      lastError = String(e.message || e);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  // bersihkan helper lama (diganti ambilItemDari di atas)

  // ─────────────────────────────────────────────────────────────────────────
  // TERAPKAN SATU PERUBAHAN iPos (dipakai sync penuh & SSE)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * @returns {'ubah'|'baru'|'hapus'|null} null = tak ada efek / tidak berubah
   */
  function terapkan(dataBarang, ip, opts = {}) {
    const kode = String((ip && ip.kode) || '').toUpperCase();
    if (!kode) return null;
    const map = opts.map || index(dataBarang);
    let barang = map.get(kode);

    // item dihapus dari iPos → buang info toko ipos; kalau murni milik ipos, buang item
    if (ip.deleted) {
      if (!barang) return null;
      // Item baru dari iPos sengaja punya tokoList kosong (tidak ditulis balik
      // ke Excel), jadi kepemilikan toko juga dibaca dari kunci harga.
      const tokoListAsli = Array.isArray(barang.tokoList) ? barang.tokoList : [];
      // PENTING: kalau tokoList terisi, itu sumber kebenaran. Jangan gabung
      // dengan kunci harga, karena loadExcel membuat placeholder harga untuk
      // SEMUA toko. Dulu ini membuat sync NK/KEFA menghapus ribuan item CP.
      const daftar = tokoListAsli.length
        ? new Set(tokoListAsli)
        : new Set(Object.keys(barang.harga || {}));
      if (!toko.some((t) => daftar.has(t))) return null; // bukan item toko ini
      const lain = [...daftar].filter((t) => !toko.includes(t));
      if (!lain.length) {
        if (opts.deferDelete) {
          // Sync penuh menandai dulu, lalu membuang sekali di akhir agar
          // tidak O(n^2) saat iPos menghapus ribuan item sekaligus.
          barang.__hapus = true;
          map.delete(kode);
        } else {
          const i = dataBarang.indexOf(barang);
          if (i >= 0) dataBarang.splice(i, 1);
          map.delete(kode);
        }
      } else {
        // Pertahankan kosong untuk item murni iPos agar tidak ditulis ke Excel.
        barang.tokoList = tokoListAsli.length ? lain : [];
        if (barang.harga) for (const tk of toko) delete barang.harga[tk];
      }
      return 'hapus';
    }

    const ecer = ip.harga === null || ip.harga === undefined || ip.harga === '' ? 0 : Number(ip.harga) || 0;
    const ambil = ip.harga2 === null || ip.harga2 === undefined || ip.harga2 === '' ? 0 : Number(ip.harga2) || 0;
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
    const hargaTokoLain = toko.some((tk) => tk !== toko[0] && barang.harga[tk]);
    const beda = barang.nama !== (ip.nama || barang.nama)
      || barang.satuan !== (ip.satuan || barang.satuan)
      || !h || h.ecer !== ecer || h.ambil !== ambil || h.stok !== stok || h.hpp !== hpp;

    if (hargaTokoLain && !h) {
      barang.tokoList = [...new Set([...(barang.tokoList || []), ...toko])];
      for (const tk of toko) barang.harga[tk] = { ecer, ambil, stok, hpp };
    }
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
    const startedAt = Date.now();
    if (!Array.isArray(dataBarang)) return { ok: false, total: 0, ubah: 0, baru: 0, hapus: 0, err: 'DATA_BARANG bukan array' };

    let items;
    try {
      items = await ambilItems();
    } catch (e) {
      lastError = formatError(e);
      online = false;
      // PENTING: dulu kegagalan hanya dicatat kalau verbose=true, dan sync
      // berkala selalu verbose=false. Akibatnya toko bisa OFFLINE berjam-jam
      // tanpa satu baris pun di log — persis kasus "data terakhir 422 menit".
      // Sekarang kegagalan SELALU dicatat, dan hanya di-throttle supaya tidak
      // membanjiri log tiap 5 menit.
      const sekarang = Date.now();
      const menitSejakLog = (sekarang - (syncStok._gagalLogTerakhir || 0)) / 60000;
      if (verbose || menitSejakLog >= 10) {
        syncStok._gagalLogTerakhir = sekarang;
        console.warn(`⚠️ [iPos ${LABEL}] sync gagal: ${lastError} — pakai data Excel`);
      }
      return { ok: false, total: lastCount, ubah: 0, baru: 0, hapus: 0, err: lastError };
    }

    snapshot = new Map();
    for (const it of items) {
      if (it && it.kode) snapshot.set(String(it.kode).toUpperCase(), it);
    }

    let ubah = 0, baru = 0, hapus = 0;
    const map = index(dataBarang);
    const applyOpts = { map, deferDelete: true };
    for (const ip of snapshot.values()) {
      const r = terapkan(dataBarang, ip, applyOpts);
      if (r === 'ubah') ubah++; else if (r === 'baru') baru++;
    }
    // item yang hilang dari iPos saat bot offline -> bersihkan sekarang.
    // PENTING: hanya item MILIK toko ini. Tanpa cek kepemilikan, sync NK/KEFA
    // akan menghapus ribuan item CP (dan sebaliknya) setiap putaran, membuat
    // DATA_BARANG bolak-balik berubah dan sync jadi lambat.
    const milikTokoIni = (barang) => {
      if (!barang) return false;
      // tokoList terisi = data dari Excel: pakai itu saja (placeholder harga
      // semua toko jangan dianggap kepemilikan). tokoList kosong = item murni
      // iPos: kepemilikan dibaca dari kunci harga.
      if (Array.isArray(barang.tokoList) && barang.tokoList.length) {
        return barang.tokoList.some((t) => toko.includes(t));
      }
      return !!(barang.harga && toko.some((t) => Object.prototype.hasOwnProperty.call(barang.harga, t)));
    };
    for (const barang of [...dataBarang]) {
      if (barang && barang.stokSumber === 'ipos' && milikTokoIni(barang)
        && !snapshot.has(String(barang.kode || '').toUpperCase())) {
        if (terapkan(dataBarang, { kode: barang.kode, deleted: true }, applyOpts) === 'hapus') hapus++;
      }
    }
    // Buang semua item yang ditandai hapus dalam satu pass O(n).
    let tulis = 0;
    for (let baca = 0; baca < dataBarang.length; baca++) {
      const barang = dataBarang[baca];
      if (barang && barang.__hapus) { delete barang.__hapus; continue; }
      dataBarang[tulis++] = barang;
    }
    dataBarang.length = tulis;

    lastSync = Date.now();
    lastCount = snapshot.size;
    lastError = null;
    online = true;
    lastSseAt = Date.now(); // komunikasi dengan iPos terbukti hidup
    lastItemAt = Date.now(); // data ITEM terbukti segar (dasar penjaga kesegaran)

    if (ubah || baru || hapus) {
      console.log(`✅ [iPos ${LABEL}] ${lastCount} item — ubah ${ubah}, baru ${baru}, hapus ${hapus}`);
    }
    const durasi = Date.now() - startedAt;
    if (durasi > 1500) console.log(`[SLOW] iPos ${LABEL} sync ${durasi}ms (ubah ${ubah}, baru ${baru}, hapus ${hapus})`);
    return { ok: true, total: lastCount, ubah, baru, hapus };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LAPORAN PENJUALAN (cache di iPos API; endpoint /api/jual*)
  // Bot cache 1 dtk per (endpoint+dari+sampai+opsi) — API selalu realtime
  // dari memori (<100 ms). SSE `jual` tetap clear cache seketika.
  // ponytail: naikkan ke Redis kalau multi-proses.
  // ─────────────────────────────────────────────────────────────────────────

  const lapCache = new Map(); // kunci → { t, data }
  const LAP_TTL = 1000;
  let lastJualEvent = 0; // timestamp SSE jual terakhir (kasir simpan/edit/void)
  // Kebasian LAPORAN (bukan item). `update` dari API = kapan data penjualan
  // terakhir diperbarui DI SUMBER. Kalau DB sumber mati, item tetap segar
  // (jalur lain) tapi laporan membeku — persis yang terjadi pada CP 2026-11-14:
  // item umur 83 dtk (segar) padahal laporan beku 146 menit. Tanpa penjaga ini
  // bot melaporkan "segar" untuk data yang sudah basi.
  let lapUpdateTerakhir = 0;      // `update` terakhir yang diterima dari API
  let lapDiperiksaPada = 0;       // kapan terakhir ada respons laporan sukses
  let lapErrTerakhir = null;      // pesan gagal laporan terakhir (jika ada)
  // Batas wajar: laporan dianggap basi bila sumber tidak memperbarui data
  // selama ini. 10 menit cukup longgar untuk toko yang sedang sepi (tidak ada
  // nota baru memang TIDAK memperbarui `update`), jadi dipakai 30 menit agar
  // tidak memicu alarm palsu saat toko tutup.
  const LAP_BASI_DETIK = 1800;
  // Backoff kegagalan laporan. Kalau host toko benar-benar mati, TCP connect
  // menghabiskan seluruh batas waktu (terukur UND_ERR_CONNECT_TIMEOUT 35 dtk
  // saat CP mati). Tanpa backoff, penjaga backup tiap 30 dtk akan mencoba
  // terus dan MENAHAN toko lain karena jalannya berurutan. Ini bukan
  // menyembunyikan kegagalan: kegagalan tetap dicatat & dilaporkan, hanya
  // frekuensi percobaan yang dijarangkan.
  let gagalLaporanBerturut = 0;
  let bolehCobaLagiPada = 0;
  /**
   * Laporan DORONGAN untuk SATU jenis.
   *
   * KENAPA JENIS HARUS DIPILIH, BUKAN SELALU 'jual'
   * ----------------------------------------------
   * Dulu cabang dorong di bawah SELALU membaca jenis `jual`, apa pun endpoint
   * yang diminta. Akibatnya laporan MEREK dan MARKETPLACE mengembalikan bentuk
   * laporan KASIR: `data`/`pelanggan`/`central` tidak ada, sehingga bot
   * menampilkan nol TANPA satu pun error — kesalahan yang tampak persis
   * seperti "toko sedang sepi", dan karena itu paling berbahaya.
   *
   * RENTANG TANGGAL: DUA JALUR, BUKAN PENOLAKAN
   * -------------------------------------------
   * Versi pertama fungsi ini MENOLAK semua rentang selain hari ini. Niatnya
   * benar (jangan menyajikan angka hari ini untuk pertanyaan tanggal lain),
   * tetapi akibatnya laporan tanggal lampau — mis. marketplace CP 14/11/2026
   * yang di sumbernya berisi 6 nota / Rp 26.583.000 — dilaporkan KOSONG.
   * Menolak dengan benar tetap saja salah bagi pengguna.
   *
   * Sekarang:
   *   1. Bila rentang yang diminta sudah ada di gudang rentang -> pakai itu.
   *      Laporan tanggal lampau tidak berubah lagi, jadi tidak perlu segar.
   *   2. Bila yang diminta adalah rentang laporan slot utama DAN laporan itu
   *      segar -> pakai jalur cepat (laporan hari ini).
   *   3. Selain itu -> catat PESANAN untuk dijemput PC dan beri tahu pemanggil
   *      bahwa datanya sedang diambil. Tidak pernah menampilkan nol palsu.
   */
  function laporanDorong(jenis, dari, sampai) {
    const minta1 = String(dari || '').slice(0, 10);
    const minta2 = String(sampai || dari || '').slice(0, 10);

    // 1. Rentang yang sudah pernah dikirim.
    //
    //    PENTING: laporan yang rentangnya MENCAKUP HARI INI masih berubah
    //    (nota baru terus masuk), jadi ia tetap WAJIB segar. Tanpa pemeriksaan
    //    ini, laporan hari ini yang beku akan disajikan sebagai "sudah ada di
    //    gudang" dan pengguna melihat angka lama tanpa peringatan — persis
    //    kesalahan yang ingin dicegah.
    //    Sebaliknya laporan yang rentangnya sudah LEWAT tidak berubah lagi,
    //    sehingga boleh dipakai ulang berapa pun umurnya.
    const tersimpan = pushGudang.ambilRentang(tokoUtama, jenis, minta1, minta2);
    if (tersimpan && tersimpan.data) {
      const hariIni = tanggalLokal();
      const mencakupHariIni = minta2 >= hariIni;
      if (!mencakupHariIni) {
        const upd0 = Number(tersimpan.data.update);
        if (Number.isFinite(upd0) && upd0 > 0) lapUpdateTerakhir = upd0 > 1e12 ? upd0 : upd0 * 1000;
        return tersimpan.data;
      }
      // Mencakup hari ini: pakai hanya bila masih segar, kalau tidak jatuh ke
      // jalur di bawah yang melaporkan "basi" dengan jelas.
      const umurR = Math.round((Date.now() - Number(tersimpan.diterimaPada || 0)) / 1000);
      if (Number.isFinite(umurR) && umurR <= PUSH_BATAS_LAPORAN_DETIK) {
        const upd0 = Number(tersimpan.data.update);
        if (Number.isFinite(upd0) && upd0 > 0) lapUpdateTerakhir = upd0 > 1e12 ? upd0 : upd0 * 1000;
        return tersimpan.data;
      }
    }

    // 2. Jalur cepat: laporan slot utama, hanya bila segar.
    const slot = pushGudang.laporanSlot(tokoUtama, jenis);
    const d1 = slot ? String(slot.dari || '').slice(0, 10) : '';
    const d2 = slot ? String(slot.sampai || '').slice(0, 10) : '';
    if (slot && d1 && d2 && d1 === minta1 && d2 === minta2) {
      const segar = pushGudang.ambilSegar(tokoUtama, jenis, PUSH_BATAS_LAPORAN_DETIK);
      if (segar) {
        const upd = Number(segar.update);
        if (Number.isFinite(upd) && upd > 0) lapUpdateTerakhir = upd > 1e12 ? upd : upd * 1000;
        return segar;
      }
      const umur = pushGudang.umurDetik(tokoUtama, jenis);
      throw new Error(`laporan ${jenis} dorongan basi (${umur} dtk)`);
    }

    // 3. Belum ada: pesan ke PC, dan katakan terus terang sedang diambil.
    pushGudang.mintaRentang(tokoUtama, jenis, minta1, minta2);
    const e = new Error(
      `laporan ${jenis} untuk ${minta1} s/d ${minta2} sedang diambil dari iPos di PC`);
    // Ditandai supaya pemanggil bisa menunggu lalu mengulang, bukan menyerah.
    e.kode = 'MENUNGGU_DORONG';
    e.jenis = jenis;
    e.dari = minta1;
    e.sampai = minta2;
    throw e;
  }

  async function ambilLaporan(url, fresh = false, attempt = 0, jenis = 'jual', dari = '', sampai = '') {
    const kini = Date.now();
    const c = lapCache.get(url);
    if (!fresh && c && kini - c.t < LAP_TTL) return c.data;

    // MODE DORONG: laporan penjualan juga datang dari PC.
    // Bentuk objeknya SAMA PERSIS dengan yang dikembalikan endpoint aslinya,
    // asalkan jenisnya dipilih dengan benar (lihat laporanDorong).
    if (pushAktif()) {
      let dariDorong;
      try {
        dariDorong = laporanDorong(jenis, dari, sampai);
      } catch (e) {
        lapErrTerakhir = String((e && e.message) || e);
        // Rentang tanggal lampau: pesanannya sudah dicatat, dan PC menjemputnya
        // tiap beberapa detik. Menunggu sebentar di sini membuat pengguna
        // langsung mendapat laporannya, bukan pesan "coba lagi" yang harus
        // ditekan ulang. Batasnya pendek supaya bot tidak menggantung.
        if (e && e.kode === 'MENUNGGU_DORONG' && attempt === 0) {
          const tungguSampai = Date.now() + PUSH_TUNGGU_RENTANG_MS;
          while (Date.now() < tungguSampai) {
            await new Promise((r) => setTimeout(r, 400));
            const ada = pushGudang.ambilRentang(tokoUtama, jenis, e.dari, e.sampai);
            if (ada && ada.data) {
              lapErrTerakhir = null;
              lapDiperiksaPada = Date.now();
              return ada.data;
            }
          }
        }
        throw e;
      }
      lapErrTerakhir = null;
      lapDiperiksaPada = Date.now();
      // Cache hanya untuk laporan HARI INI. Laporan tanggal lampau ditangani
      // oleh gudang rentang, dan menyimpannya lagi di sini bisa membuat
      // permintaan tanggal lain memakai isi yang salah (kunci cache = URL).
      const d1c = String((dariDorong && dariDorong.dari) || '').slice(0, 10);
      const d2c = String((dariDorong && dariDorong.sampai) || '').slice(0, 10);
      if (d1c === String(dari || '').slice(0, 10) && d2c === String(sampai || dari || '').slice(0, 10)) {
        lapCache.set(url, { t: Date.now(), data: dariDorong, jualE: lastJualEvent });
      }
      return dariDorong;
    }

    if (!IPOS_KEY) throw new Error(`IPOS_KEY untuk ${LABEL} belum diisi di .env`);
    if (kini < bolehCobaLagiPada) {
      const sisa = Math.ceil((bolehCobaLagiPada - kini) / 1000);
      throw new Error(`toko sedang tidak terjangkau (coba lagi ${sisa} dtk)`);
    }
    const jualSaatMulai = lastJualEvent;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let data;
    try {
      const res = await jalur.ambil(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      data = await res.json();
      gagalLaporanBerturut = 0;
      bolehCobaLagiPada = 0;
      lapErrTerakhir = null;
      lapDiperiksaPada = Date.now();
      // `update` = kapan SUMBER terakhir memperbarui data penjualan.
      // Dicatat agar /health bisa menunjukkan kebasian laporan, bukan hanya item.
      const upd = Number(data && data.update);
      if (Number.isFinite(upd) && upd > 0) {
        lapUpdateTerakhir = upd > 1e12 ? upd : upd * 1000; // detik -> ms bila perlu
      }
    } catch (e) {
      gagalLaporanBerturut++;
      lapErrTerakhir = String((e && e.message) || e);
      // 30 dtk, 60, 120, 240, maksimal 300 dtk. Host mati tidak akan sembuh
      // dalam hitungan detik, dan tiap percobaan memakan 15-35 dtk.
      const jeda = Math.min(300, 30 * Math.pow(2, Math.min(4, gagalLaporanBerturut - 1)));
      bolehCobaLagiPada = Date.now() + jeda * 1000;
      throw e;
    } finally {
      clearTimeout(timer);
    }
    if (jualSaatMulai !== lastJualEvent && attempt < 2) return ambilLaporan(url, true, attempt + 1, jenis, dari, sampai);
    if (jualSaatMulai === lastJualEvent) {
      lapCache.set(url, { t: Date.now(), data, jualE: jualSaatMulai });
      if (lapCache.size > 200) lapCache.delete(lapCache.keys().next().value);
    }
    return data;
  }

  /**
   * Ambil laporan penjualan per kasir dari iPos API.
   * @param {string} dari  YYYY-MM-DD
   * @param {string} [sampai=dari]  YYYY-MM-DD
   * @param {{hanyaKasir?:boolean}} [opts] hanyaKasir: hitung HANYA sesi kasir
   *   (kelompok tabel user diawali "KASIR"), buang sesi non-kasir spt admin.
   * @returns {Promise<object>} { siap, kasir[], total, nonaktif[], jangkauan, update }
   */
  async function ambilLaporanKasir(dari, sampai = dari, opts = {}) {
    if (!IPOS_KEY) throw new Error(`IPOS_KEY untuk ${LABEL} belum diisi di .env`);
      let url = `${IPOS_URL}/api/jual?dari=${encodeURIComponent(dari)}&sampai=${encodeURIComponent(sampai || dari)}&key=${encodeURIComponent(IPOS_KEY)}`;
      if (opts && opts.hanyaKasir) url += '&kasir_only=1';
      return ambilLaporan(url, !!(opts && opts.fresh), 0, 'jual', dari, sampai || dari);
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
    const url = `${IPOS_URL}/api/jual-merek?dari=${encodeURIComponent(dari)}&sampai=${encodeURIComponent(sampai || dari)}&key=${encodeURIComponent(IPOS_KEY)}${merek ? `&merek=${encodeURIComponent(merek)}` : ''}`;
    return ambilLaporan(url, true, 0, 'jual-merek', dari, sampai || dari);
  }

  /**
   * Laporan penjualan MARKETPLACE — nota kodesales='MARKETPLACE'.
   * @param {string} dari  YYYY-MM-DD
   * @param {string} [sampai=dari]  YYYY-MM-DD
   * @returns {Promise<object>} { siap, dari, sampai, toko[], central, total, nomor, update }
   */
  async function ambilLaporanMarketplace(dari, sampai = dari) {
    const url = `${IPOS_URL}/api/jual-marketplace?dari=${encodeURIComponent(dari)}&sampai=${encodeURIComponent(sampai || dari)}&key=${encodeURIComponent(IPOS_KEY)}`;
    return ambilLaporan(url, true, 0, 'jual-marketplace', dari, sampai || dari);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SSE — perubahan diterapkan begitu iPos berubah (≤ POLL_MS API + ms)
  // ─────────────────────────────────────────────────────────────────────────

  function mulaiSSE(getDataBarang) {
    // MODE DORONG: tidak ada SSE yang ditarik. Perubahan datang sebagai
    // dorongan dari PC. Yang perlu dilakukan di sini hanyalah MEMANTAU
    // penghitung versi: begitu ada kiriman baru, terapkan isinya.
    //
    // Kenapa tidak langsung memakai data di dalam handler HTTP? Karena
    // penerapan 4593 item memblokir event loop dan akan menahan respons HTTP
    // (PC lalu menganggap kiriman gagal dan mengulang). Jadi HTTP hanya
    // menyimpan, dan pemrosesan terjadi di sini secara terpisah.
    if (pushAktif()) {
      let versiTerakhir = -1;
      let sedangJalan = false;
      const pemantau = setInterval(() => {
        if (sedangJalan) return;
        let v;
        try { v = pushGudang.versiSekarang(tokoUtama); } catch (_) { return; }
        if (v === versiTerakhir) return;
        versiTerakhir = v;
        sedangJalan = true;
        // Pakai ULANG syncStok: ia sudah menangani pembersihan item yang hilang,
        // kepemilikan per toko, dan pembaruan status (online/itemSegar).
        // Menduplikasi logika itu di sini pernah membuat item toko lain ikut
        // terhapus — kegagalan yang jauh lebih mahal daripada satu panggilan.
        syncStok(getDataBarang(), { verbose: false })
          .catch((e) => { lastError = formatError(e); })
          .finally(() => { sedangJalan = false; });
      }, Number(process.env.PUSH_PANTAU_MS || 2000));
      if (pemantau.unref) pemantau.unref();
      return;
    }

    // Batas diam SSE. iPos mengirim `jual-ping` jauh lebih sering dari ini
    // (terukur ~1 frame / 12-18 dtk), jadi diam selama batas ini berarti
    // koneksi sudah mati diam-diam (half-open: TCP hidup, tidak ada data,
    // tidak ada FIN). Dulu tidak ada batas sama sekali sehingga
    // `reader.read()` bisa menggantung SELAMANYA: sseOk tetap true dan status
    // melaporkan "🟢 realtime" padahal data berhenti mengalir — persis gejala
    // "tidak realtime" yang dilaporkan.
    const IDLE_MS = Number(process.env.IPOS_SSE_IDLE_MS || 90000);
    let sudahPernahSambung = false;
    let gagalSambung = 0;

    (async () => {
      for (;;) {
        const ac = new AbortController();
        let idleTimer = null;
        const resetIdle = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            try { ac.abort(new Error('SSE diam terlalu lama')); } catch (e) { try { ac.abort(); } catch (e2) {} }
          }, IDLE_MS);
        };
        try {
          resetIdle();
          const res = await jalur.ambil(`${IPOS_URL}/api/events?key=${encodeURIComponent(IPOS_KEY)}`,
            { headers: { accept: 'text/event-stream' }, signal: ac.signal });
          if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
          sseOk = true;
          gagalSambung = 0; // tersambung lagi -> backoff direset
          lastSseFrameAt = Date.now();
          const reader = res.body.getReader();
          const dec = new TextDecoder();
          let buf = '';
          // Sambungan baru setelah sempat putus: perubahan selama jeda tidak
          // pernah diterima lewat SSE. Ambil ulang katalog sekarang supaya data
          // langsung benar, tanpa menunggu sync berkala berikutnya.
          if (sudahPernahSambung) {
            syncStok(getDataBarang(), { verbose: false })
              .catch(() => {});
          }
          sudahPernahSambung = true;
          for (;;) {
            const { done, value } = await reader.read();
            if (done) throw new Error('koneksi SSE terputus');
            resetIdle();
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
              if ((ev !== 'items' && ev !== 'jual' && ev !== 'jual-ping') || !data) continue;
              // Setiap frame yang sah = bukti koneksi SSE masih hidup.
              lastSseFrameAt = Date.now();
              try {
                if (ev === 'jual' || ev === 'jual-ping') {
                  lastJualEvent = Date.now();
                  // `jual` (bukan jual-ping) = ada nota tersimpan → stok PASTI berubah.
                  if (ev === 'jual') lastJualAt = Date.now();
                  lapCache.clear(); // nota baru/edit/void → laporan berikutnya fetch segar
                  continue;
                }
                let ubah = 0, baru = 0, hapus = 0;
                for (const ip of JSON.parse(data)) {
                  const r = terapkan(getDataBarang(), ip);
                  if (r === 'ubah') ubah++; else if (r === 'baru') baru++; else if (r === 'hapus') hapus++;
                }
                lastSync = Date.now();
                lastSseAt = Date.now();
                lastItemAt = Date.now();
                if (ubah || baru || hapus) {
                  console.log(`🔄 [iPos ${LABEL}] realtime: ubah ${ubah}, baru ${baru}, hapus ${hapus}`);
                }
              } catch { /* payload rusak → abaikan frame */ }
            }
          }
        } catch (e) {
          sseOk = false;
          // JANGAN timpa lastError yang lebih kaya. Catch SSE dulu menulis
          // "fetch failed" polos, sehingga notifikasi ke admin kehilangan
          // penyebab sebenarnya (UND_ERR_CONNECT_TIMEOUT). Sekarang pakai
          // formatError, dan hanya tulis bila memang lebih informatif.
          const baru = formatError(e);
          if (!lastError || baru.length >= String(lastError).length) lastError = baru;
          gagalSambung++;
        } finally {
          if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
        }
        // BACKOFF SAMBUNG ULANG SSE.
        // Dulu selalu 1000 ms TANPA BATAS. Selama host toko benar-benar mati
        // (kasus nyata: CP & NK mati berjam-jam), ini berarti percobaan
        // sambung tiap detik selamanya: tiap percobaan membuka TCP baru yang
        // menunggu connect-timeout puluhan detik, sehingga puluhan socket
        // menggantung dan CPU terbuang. Sekarang jeda naik bertahap sampai
        // 30 dtk, dan langsung kembali cepat begitu ada frame masuk.
        // Catatan: selama host mati, sync berkala + penjaga kesegaran tetap
        // berjalan, jadi data tidak "diam-diam basi".
        const jeda = Math.min(30000, 1000 * Math.pow(2, Math.min(5, gagalSambung - 1)));
        await new Promise((r) => setTimeout(r, jeda));
      }
    })();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STATUS
  // ─────────────────────────────────────────────────────────────────────────

  function status() {
    // DUA angka berbeda, sengaja dipisah agar tidak menyesatkan:
    //  - umurDetik      : jarak ke PERUBAHAN data terakhir (frame SSE / sync penuh).
    //                     Angka besar itu NORMAL kalau memang tidak ada item berubah;
    //                     CP dan KEFA berbagi broadcast yang sama sehingga angkanya
    //                     sering identik.
    //  - umurKoneksiDetik: jarak ke bukti komunikasi terakhir dengan iPos.
    //                     Inilah indikator kesehatan: kalau ini membesar, SSE
    //                     benar-benar putus dan data berhenti mengalir.
    const terakhirUbah = Math.max(lastSseAt, lastSync);
    const terakhirKoneksi = Math.max(lastSseAt, lastSync, lastSseFrameAt);
    // KESEGARAN DATA ITEM — inilah angka yang menentukan apakah harga/stok yang
    // ditampilkan bisa dipercaya. Dibedakan dari umurKoneksiDetik (yang hanya
    // membuktikan "masih bicara", bukan "data item masih mengalir").
    const terakhirItem = Math.max(lastItemAt, lastSync);
    const umurItemDetik = terakhirItem ? Math.round((Date.now() - terakhirItem) / 1000) : null;
    const itemSegar = umurItemDetik !== null && umurItemDetik <= 150;
    return {
      online, sse: pushAktif()
        // Mode dorong: "realtime" berarti PC benar-benar sedang mengirim.
        // Dilaporkan dari umur data, bukan dari ada/tidaknya koneksi SSE —
        // karena memang tidak ada SSE yang dijaga.
        ? (() => {
            const umur = pushGudang.umurDetik(tokoUtama, 'items');
            return umur != null && umur <= PUSH_BATAS_ITEMS_DETIK ? '🟢 realtime (dorong)' : '🔴 putus (dorong)';
          })()
        : (sseOk ? '🟢 realtime' : '🔴 putus'),
      total: lastCount, lastSync, lastSseAt, lastError,
      umurDetik: terakhirUbah ? Math.round((Date.now() - terakhirUbah) / 1000) : null,
      umurKoneksiDetik: terakhirKoneksi ? Math.round((Date.now() - terakhirKoneksi) / 1000) : null,
      umurItemDetik,
      itemSegar,
      // Ada nota tersimpan yang belum diikuti frame `items` → kanal item diduga
      // rusak. Dipakai /health agar masalah ini TERLIHAT, bukan tersembunyi.
      notaTanpaItemDetik: lastJualAt > lastItemAt
        ? Math.round((Date.now() - lastJualAt) / 1000) : 0,
      // Kebasian LAPORAN (terpisah dari item). Sumber bisa mati sementara
      // katalog tetap segar — persis kasus CP 2026-11-14. Tanpa ini /health
      // melaporkan "segar" untuk penjualan yang sudah beku berjam-jam.
      laporanUmurDetik: lapUpdateTerakhir
        ? Math.round((Date.now() - lapUpdateTerakhir) / 1000) : null,
      laporanBasi: lapUpdateTerakhir
        ? (Date.now() - lapUpdateTerakhir) / 1000 > LAP_BASI_DETIK : null,
      laporanUpdate: lapUpdateTerakhir || null,
      laporanErr: lapErrTerakhir,
      laporanDiperiksaDetik: lapDiperiksaPada
        ? Math.round((Date.now() - lapDiperiksaPada) / 1000) : null,
      toko, url: IPOS_URL,
    };
  }

  /**
   * Jalankan: sync penuh awal + langganan SSE + sync penuh berkala (jaring
   * pengaman). Panggil SEKALI saat startup per instans.
   * @param {() => Array} getDataBarang  fungsi yg mengembalikan DATA_BARANG terkini
   */
  function mulaiAutoSync(getDataBarang, intervalMs = Number(process.env.IPOS_SYNC_MS || 300000), startDelayMs = 0) {
    // SSE adalah jalur realtime utama. Full sync hanya jaring pengaman, jadi
    // beri lantai 5 menit: host ini RAM-nya kecil, sync tiap <2 menit membuat
    // pagefile thrash dan event loop macet (watchdog lalu restart berulang).
    const MIN_INTERVAL_MS = 5 * 60 * 1000;
    const requested = Number(intervalMs) || 0;
    intervalMs = Math.max(MIN_INTERVAL_MS, requested);
    if (requested && requested < MIN_INTERVAL_MS) {
      console.log(`[iPos ${LABEL}] interval ${requested}ms terlalu rapat; dinaikkan ke ${intervalMs}ms (SSE tetap realtime)`);
    }
    let syncing = false;
    const jalan = async (verbose) => {
      if (syncing) return;
      syncing = true;
      const started = Date.now();
      try { await syncStok(getDataBarang(), { verbose }); }
      catch (e) { console.warn(`[iPos ${LABEL}] auto-sync:`, e.message); }
      finally {
        syncing = false;
        if (verbose) console.log(`[iPos ${LABEL}] sync awal selesai ${Date.now() - started}ms`);
      }
    };
    // Jangan full-sync 3 toko serentak: respons /api/items besar dan
    // JSON.parse-nya memblokir event loop. SSE tetap langsung aktif.
    const startTimer = setTimeout(() => void jalan(true), Math.max(0, Number(startDelayMs) || 0));
    if (startTimer.unref) startTimer.unref();
    if (IPOS_KEY) mulaiSSE(getDataBarang);
    const t = setInterval(() => void jalan(false), intervalMs);
    if (t.unref) t.unref();

    // PENJAGA KESEGARAN.
    // Interval 5 menit di atas adalah jaring pengaman NORMAL. Kalau SSE diam
    // (putus diam-diam, server berhenti broadcast, atau host membekukan proses
    // sehingga frame terlewat), data bisa tertinggal sampai 5 menit — dan dulu
    // bisa berjam-jam karena kegagalan tidak pernah dilaporkan. Penjaga ini
    // memeriksa tiap 30 detik: begitu tidak ada bukti komunikasi selama
    // STALE_MS, sync penuh dipaksa SEKARANG (dengan jeda minimum agar tidak
    // membanjiri host yang RAM-nya kecil).
    const STALE_MS = Number(process.env.IPOS_STALE_MS || 120000);
    const MIN_GAP_MS = Number(process.env.IPOS_STALE_MIN_GAP_MS || 45000);
    const CEK_MS = Number(process.env.IPOS_STALE_CHECK_MS || 30000);
    // Tenggang setelah nota tersimpan sebelum kita anggap kanal item rusak.
    // Nota nyata diikuti frame `items` dalam hitungan detik (terukur < 1 dtk
    // pada CP). 20 dtk sudah sangat longgar dan tetap aman untuk host kecil.
    const NOTA_GRACE_MS = Number(process.env.IPOS_NOTA_GRACE_MS || 20000);
    let terakhirPaksa = 0;
    const jaga = setInterval(() => {
      const sekarang = Date.now();
      // Dua pemicu, keduanya BUKTI (bukan tebakan):
      //  (a) Tidak ada frame item sama sekali selama STALE_MS, padahal toko
      //      online → kanal item mungkin mati diam-diam.
      //  (b) Ada NOTA (event `jual`) tetapi TIDAK ada frame `items` sesudahnya
      //      selama NOTA_GRACE_MS. Nota selalu mengubah stok, jadi ini bukti
      //      kanal item rusak — tanpa perlu menebak apakah toko sepi.
      //
      // CATATAN PENTING: `jual-ping` SENGAJA TIDAK dipakai sebagai bukti item
      // segar (dulu itu membuat penjaga ini tidak pernah aktif). Tapi
      // `jual-ping` tetap dipakai sebagai bukti KONEKSI di status(), dan
      // sengaja TIDAK memicu sync penuh — kalau tidak, toko yang sepi akan
      // di-sync tiap 45 dtk dan menghabiskan RAM host yang kecil.
      const buktiItem = Math.max(lastItemAt, lastSync);
      if (!buktiItem) return;
      const umurItem = sekarang - buktiItem;
      const umurSetelahJual = lastJualAt > lastItemAt ? sekarang - lastJualAt : 0;
      const alasan = (umurSetelahJual > NOTA_GRACE_MS && sekarang - terakhirPaksa >= MIN_GAP_MS)
        ? `ada nota ${Math.round(umurSetelahJual / 1000)} dtk lalu tapi tak ada frame items`
        : (umurItem >= STALE_MS ? `tidak ada kabar item ${Math.round(umurItem / 1000)} dtk` : null);
      if (!alasan) return;
      if (sekarang - terakhirPaksa < MIN_GAP_MS) return;
      if (syncing) return;
      terakhirPaksa = sekarang;
      console.log(`⏳ [iPos ${LABEL}] ${alasan} — sync penuh dipaksa sekarang`);
      void jalan(false);
    }, CEK_MS);
    if (jaga.unref) jaga.unref();

    return () => { clearTimeout(startTimer); clearInterval(t); clearInterval(jaga); };
  }

  return {
    url: IPOS_URL, toko, label: LABEL, syncStok, terapkan, ambilItem, status, mulaiAutoSync,
    ambilLaporanKasir, ambilLaporanMerek, ambilLaporanMarketplace,
    // Diagnostik jalur: proxy aktif? jalur mana yang dipakai (utama/cadangan)?
    // Dipakai /health supaya tidak ada tebak-tebakan saat Tailscale bermasalah.
    jalurStatus: () => jalur.status(),
    // Diagnostik: mengembalikan JUMLAH item (bukan datanya) dari /api/items.
    // Dipakai /api/diag/ipos untuk membuktikan apakah kegagalan berasal dari
    // proses ini atau dari jaringan. Tidak membocorkan key.
    ujiAmbilItems: async () => {
      const items = await ambilItems();
      return Array.isArray(items) ? items.length : 0;
    },
    // Diagnostik: daftar KODE yang benar-benar ada di iPos toko ini.
    // Dipakai audit kesesuaian agar sampel diambil dari katalog toko itu
    // sendiri — bukan dari DATA_BARANG yang berisi item semua toko.
    ujiAmbilKode: async () => {
      const items = await ambilItems();
      return (Array.isArray(items) ? items : [])
        .map((x) => String((x && x.kode) || '').toUpperCase())
        .filter(Boolean);
    },
  };
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
// Dibuat hanya kalau IPOS_NK_URL diisi (mis. http://<host-privat>:8080/ipos).
const nk = process.env.IPOS_NK_URL
  ? buatBridge({
      url: process.env.IPOS_NK_URL,
      key: process.env.IPOS_NK_KEY || '',
      toko: (process.env.IPOS_NK_TOKO || 'nk')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      label: 'NK',
    })
  : null;

// KEFA — Toko Perabot Mamaku Kefamenanu (API ipos-api KEFA2025 di mesin KEFA).
// Dibuat hanya kalau IPOS_KEFA_URL diisi. Pola persis NK.
const kefa = process.env.IPOS_KEFA_URL
  ? buatBridge({
      url: process.env.IPOS_KEFA_URL,
      key: process.env.IPOS_KEFA_KEY || '',
      toko: (process.env.IPOS_KEFA_TOKO || 'kefa')
        .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean),
      label: 'KEFA',
    })
  : null;

// Ekspor: pemakaian lama (iposBridge.syncStok dst.) = instans CP, persis v2.
module.exports = {
  syncStok: (...a) => cp.syncStok(...a),
  terapkan: (...a) => cp.terapkan(...a),
  ambilItem: (...a) => cp.ambilItem(...a),
  status: () => cp.status(),
  mulaiAutoSync: (...a) => cp.mulaiAutoSync(...a),
  ambilLaporanKasir: (...a) => cp.ambilLaporanKasir(...a),
  ambilLaporanMerek: (...a) => cp.ambilLaporanMerek(...a),
  ambilLaporanMarketplace: (...a) => cp.ambilLaporanMarketplace(...a),
  get IPOS_URL() { return cp.url; },
  get IPOS_TOKO() { return cp.toko; },
  buatBridge, cp, nk, kefa,
};
