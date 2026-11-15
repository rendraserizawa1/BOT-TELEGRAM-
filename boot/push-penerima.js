'use strict';
/**
 * PENERIMA DORONGAN iPos — sisi Railway.
 *
 * KENAPA ARSITEKTUR INI
 * ---------------------
 * Arah "tarik" (Railway menghubungi iPos di PC) sudah dicoba lewat:
 *   - Cloudflare quick tunnel : mati (ENOTFOUND), dan menahan body SSE
 *   - Tailscale userspace     : bisa, tetapi node Railway tidak punya jalur
 *                               langsung ke PC (CGNAT) sehingga semua trafik
 *                               lewat DERP relay -> SOCKS5 connection timeout
 *                               intermiten, koneksi putus-putus
 * Keduanya gagal karena satu hal yang sama: PC tidak bisa dijangkau dari luar.
 *
 * Arah "dorong" tidak punya masalah itu: PC -> Railway lewat HTTPS publik
 * terukur 780 KB dalam 0,81 detik. Jadi PC yang mengirim.
 *
 * MODUL INI TIDAK TAHU SOAL JARINGAN
 * ----------------------------------
 * Semua validasi dan penyimpanan ada di sini supaya bisa diuji tanpa server.
 * Penempelan ke HTTP dilakukan di index.js.
 *
 * ATURAN KESELAMATAN
 * ------------------
 * 1. Token kosong -> endpoint MENOLAK SEMUA (503). Jangan pernah ada keadaan
 *    di mana endpoint terbuka tanpa sengaja.
 * 2. Data kosong DITOLAK. Tanpa ini, satu kiriman kosong bisa menghapus
 *    katalog bagus yang sedang dipakai dan seluruh toko tampak kehilangan
 *    barang.
 * 3. Token tidak pernah disimpan di status dan tidak pernah dicetak.
 */

/** Toko yang dilayani. Menolak nama lain supaya tidak ada data asing masuk. */
const TOKO_SAH = new Set(['cp', 'nk', 'kefa']);

/**
 * Jenis data yang boleh didorong.
 *
 * `items`      = katalog PENUH (menggantikan seluruh isi).
 * `items-ubah` = DELTA: hanya item yang berubah (digabung ke katalog penuh).
 *
 * Kenapa delta ada: katalog 780 KB. Mengirim ulang seluruh katalog setiap ada
 * satu nota berarti membuang bandwidth dan waktu. Delta hanya berisi item yang
 * berubah, biasanya 1-5 baris.
 */
const JENIS_SAH = new Set(['items', 'items-ubah', 'jual', 'jual-merek', 'jual-marketplace', 'kasir', 'denyut']);

function buatPenerima({ token, batasSegarDetik, batasSegarLaporanDetik, batasSegarItemsDetik } = {}) {
  const TOKEN = String(token || '');
  // Batas "segar" LAPORAN. Laporan dikirim ulang tiap ~60 dtk, jadi 180 dtk
  // berarti tiga kali kiriman terlewat — baru pantas dicurigai.
  //
  // `batasSegarDetik` diterima sebagai nama LAMA (dipakai uji & pemanggil
  // sebelumnya) tetapi kini HANYA mengatur laporan. Nama generik itu dulu
  // mengatur katalog juga, dan itulah sumber alarm palsu.
  const BATAS_SEGAR = Number(batasSegarLaporanDetik || batasSegarDetik || 180);
  // Batas "segar" KATALOG — HARUS jauh lebih longgar, dan ini pernah salah.
  //
  // Katalog penuh dikirim tiap 15 menit; delta hanya terkirim kalau ADA item
  // berubah. Jadi saat toko tutup atau sedang sepi, katalog yang benar-benar
  // sehat bisa berumur 10-15 menit. Dengan batas 180 dtk, /health akan
  // melaporkan "katalog basi" setiap kali toko sepi — alarm palsu yang membuat
  // orang berhenti mempercayai alarm itu, dan justru itu yang berbahaya.
  //
  // Default 1200 dtk = 20 menit: sedikit di atas jeda katalog penuh (900 dtk)
  // sehingga satu kiriman penuh yang terlewat pun masih tertutup.
  const BATAS_SEGAR_ITEMS = Number(batasSegarItemsDetik || 1200);

  // toko -> jenis -> { data, jumlah, diterimaPada, jumlahPush }
  const simpanan = new Map();

  function slot(toko, jenis) {
    if (!simpanan.has(toko)) simpanan.set(toko, new Map());
    const perToko = simpanan.get(toko);
    if (!perToko.has(jenis)) perToko.set(jenis, null);
    return perToko;
  }

  /**
   * Terima satu dorongan.
   * @returns {{status:number, body:object}}
   */
  function terima(paket, tokenDikirim) {
    // 1. Token kosong di sisi server = endpoint tidak boleh melayani apa pun.
    if (!TOKEN) {
      return { status: 503, body: { ok: false, err: 'PUSH_TOKEN belum diisi di server' } };
    }
    if (String(tokenDikirim || '') !== TOKEN) {
      return { status: 401, body: { ok: false, err: 'token salah' } };
    }

    const p = paket && typeof paket === 'object' ? paket : {};
    const toko = String(p.toko || '').toLowerCase();
    const jenis = String(p.jenis || '').toLowerCase();

    if (!TOKO_SAH.has(toko)) {
      return { status: 400, body: { ok: false, err: 'toko tidak dikenal' } };
    }
    if (!JENIS_SAH.has(jenis)) {
      return { status: 400, body: { ok: false, err: 'jenis tidak dikenal' } };
    }

    // 2. Bentuk data.
    const data = p.data;
    // Slot per toko dideklarasikan SEBELUM cabang denyut, karena denyut perlu
    // memeriksa apakah katalog sudah ada (untuk meminta kiriman ulang setelah
    // redeploy). Mendeklarasikannya di bawah membuat cabang denyut memakai
    // variabel yang belum ada -> "Cannot access before initialization".
    const perToko = slot(toko, jenis);
    if (jenis === 'denyut') {
      // DENYUT: bukti PC masih hidup, TANPA membawa data.
      //
      // Kenapa perlu: tanpa ini, satu-satunya bukti PC hidup adalah umur data.
      // Padahal toko sepi wajar tidak mengubah item selama berjam-jam, sehingga
      // "data lama" TIDAK sama dengan "PC mati". Dua hal itu harus dibedakan,
      // kalau tidak alarmnya jadi palsu dan orang berhenti mempercayainya.
      //
      // Denyut tidak menyentuh katalog sama sekali, jadi tidak ada risiko
      // menghapus atau menimpa data.
      const perTokoD = slot(toko, 'denyut');
      const sebelumD = perTokoD.get('denyut');
      perTokoD.set('denyut', {
        data: null,
        jumlah: null,
        diterimaPada: Date.now(),
        jumlahPush: (sebelumD && sebelumD.jumlahPush ? sebelumD.jumlahPush : 0) + 1,
      });
      // PENTING: beri tahu PC kalau server BELUM punya katalog.
      //
      // Penyimpanan ini hanya di memori, jadi setiap redeploy/restart Railway
      // mengosongkannya. Tanpa pemberitahuan ini, PC akan menunggu sampai jeda
      // katalog penuh berikutnya (15 menit) sebelum mengirim ulang — dan selama
      // itu bot melayani toko tanpa data, persis keluhan "data tidak update".
      //
      // Denyut datang tiap 30 dtk, jadi jalur ini memulihkan katalog dalam
      // hitungan detik setelah deploy, bukan belasan menit.
      const katalogAda = !!perToko.get('items');
      return {
        status: 200,
        body: {
          ok: true, toko, jenis, denyut: true,
          perluPenuh: !katalogAda,
          diterimaPada: perTokoD.get('denyut').diterimaPada,
        },
      };
    }

    if (jenis === 'items' || jenis === 'items-ubah') {
      if (!Array.isArray(data) || data.length === 0) {
        return { status: 400, body: { ok: false, err: 'items harus array tidak kosong' } };
      }
    } else if (data == null || typeof data !== 'object') {
      return { status: 400, body: { ok: false, err: 'data harus objek' } };
    }

    const sebelum = perToko.get(jenis);

    // DELTA: gabungkan ke katalog penuh yang sudah ada, jangan menimpanya.
    // Tanpa penggabungan ini, satu delta berisi 3 item akan membuat katalog
    // tampak hanya berisi 3 item — seluruh toko seolah kehilangan barang.
    if (jenis === 'items-ubah') {
      const penuh = perToko.get('items');
      if (!penuh || !Array.isArray(penuh.data)) {
        // Belum ada katalog penuh: delta tidak bisa diterapkan. Tolak dengan
        // 409 supaya PC tahu harus mengirim katalog penuh lebih dulu.
        return { status: 409, body: { ok: false, err: 'belum ada katalog penuh; kirim items dulu' } };
      }
      const peta = new Map();
      for (const it of penuh.data) {
        if (it && it.kode) peta.set(String(it.kode).toUpperCase(), it);
      }
      let ditambah = 0, diubah = 0;
      for (const it of data) {
        if (!it || !it.kode) continue;
        const k = String(it.kode).toUpperCase();
        if (peta.has(k)) diubah++; else ditambah++;
        peta.set(k, it);
      }
      const gabungan = [...peta.values()];
      perToko.set('items', {
        data: gabungan,
        jumlah: gabungan.length,
        diterimaPada: Date.now(),
        jumlahPush: (penuh.jumlahPush || 0) + 1,
      });
      return {
        status: 200,
        body: {
          ok: true, toko, jenis, delta: true,
          jumlahDelta: data.length, diubah, ditambah, total: gabungan.length,
          diterimaPada: perToko.get('items').diterimaPada,
        },
      };
    }

    // `jumlah` = banyaknya item untuk 'items', dan null untuk laporan (objek).
    // Ini yang dibaca /health sebagai `total`, jadi harus benar sejak di sini.
    const jumlah = Array.isArray(data) ? data.length : null;
    perToko.set(jenis, {
      data,
      jumlah,
      diterimaPada: Date.now(),
      jumlahPush: (sebelum && sebelum.jumlahPush ? sebelum.jumlahPush : 0) + 1,
    });

    return {
      status: 200,
      body: {
        ok: true,
        toko,
        jenis,
        jumlah,
        // Waktu server supaya PC bisa mendeteksi jam yang tidak sinkron.
        diterimaPada: perToko.get(jenis).diterimaPada,
      },
    };
  }

  /** Data mentah terakhir untuk satu toko+jenis (dipakai bot). */
  function ambil(toko, jenis) {
    if (!simpanan.has(toko)) return null;
    const s = simpanan.get(toko).get(jenis);
    return s ? s.data : null;
  }

  /**
   * Ringkasan untuk /health.
   * TIDAK memuat token, tidak memuat isi data (hanya jumlah).
   */
  function status(toko) {
    const hasil = { items: null, jual: null, jualMerek: null, jualMarketplace: null, kasir: null, denyut: null };
    if (!simpanan.has(toko)) return hasil;

    const perToko = simpanan.get(toko);
    const sekarang = Date.now();
    const ringkas = (jenis, namaKunci, batas) => {
      const s = perToko.get(jenis);
      if (!s) return;
      const umurDetik = Math.max(0, Math.round((sekarang - s.diterimaPada) / 1000));
      hasil[namaKunci] = {
        // `total` (bukan `jumlah`) supaya sama dengan nama yang dipakai
        // /health dan iposRingkas — satu nama untuk satu hal.
        total: s.jumlah,
        umurDetik,
        segar: umurDetik <= batas,
        jumlahPush: s.jumlahPush,
      };
    };

    // Katalog memakai batas JAUH lebih longgar: katalog penuh hanya dikirim
    // tiap 15 menit, dan delta hanya saat ada item berubah. Toko sepi yang
    // sehat pun akan berumur belasan menit. Batas 180 dtk di sini pernah
    // membuat /health melaporkan "basi" padahal aliran sehat — alarm palsu.
    ringkas('items', 'items', BATAS_SEGAR_ITEMS);
    ringkas('jual', 'jual', BATAS_SEGAR);
    ringkas('jual-merek', 'jualMerek', BATAS_SEGAR);
    ringkas('jual-marketplace', 'jualMarketplace', BATAS_SEGAR);
    ringkas('kasir', 'kasir', BATAS_SEGAR);
    // Denyut: bukti PC hidup, terpisah dari isi data.
    ringkas('denyut', 'denyut', BATAS_SEGAR);

    // Laporan penjualan: sertakan angka utamanya supaya /health bisa
    // membuktikan isinya masuk, bukan hanya "ada data".
    const jual = perToko.get('jual');
    if (jual && hasil.jual && jual.data && typeof jual.data === 'object') {
      hasil.jual.nota = jual.data.nota == null ? null : jual.data.nota;
      hasil.jual.omzet = jual.data.omzet == null ? null : jual.data.omzet;
      hasil.jual.update = jual.data.update == null ? null : jual.data.update;
    }
    return hasil;
  }

  /** Hanya untuk uji: mundurkan waktu terima. */
  function _mundurkanWaktu(toko, jenis, ms) {
    if (!simpanan.has(toko)) return;
    const s = simpanan.get(toko).get(jenis);
    if (s) s.diterimaPada -= ms;
  }

  return { terima, ambil, status, _mundurkanWaktu, TOKO_SAH, JENIS_SAH };
}

module.exports = { buatPenerima, TOKO_SAH, JENIS_SAH };
