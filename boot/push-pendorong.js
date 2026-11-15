'use strict';
/**
 * PENDORONG iPos — sisi PC.
 *
 * Tugasnya: ambil data dari proxy iPos lokal, lalu DORONG ke Railway lewat
 * HTTPS publik. Ini menggantikan arah "tarik" yang gagal karena PC tidak bisa
 * dijangkau dari luar (CGNAT) — Cloudflare tunnel mati, Tailscale lewat DERP
 * relay dan intermiten.
 *
 * PRINSIP
 * -------
 * 1. HANYA kirim bila data berubah. Membandingkan hash isi, bukan waktu.
 *    Tanpa ini, katalog 780 KB akan dikirim terus-menerus tanpa guna.
 * 2. Kegagalan jaringan BUKAN alasan berhenti: dicatat, dicoba lagi nanti.
 *    Justru ini yang membuat "tidak pernah putus" mungkin — tidak ada
 *    sambungan yang harus dijaga, hanya kiriman yang diulang.
 * 3. 401/400 = salah konfigurasi. Berhenti dan laporkan; mengulang terus
 *    hanya membebani server dan menyembunyikan masalah.
 * 4. Token tidak pernah dicetak atau disimpan di status.
 */
const crypto = require('crypto');

/** Hash isi supaya perubahan kecil pun terdeteksi. */
function hashIsi(x) {
  return crypto.createHash('sha1').update(JSON.stringify(x)).digest('hex');
}

function buatPendorong({ url, token, toko, _kirim, _ambilSumber, jenisList } = {}) {
  const URL = String(url || '');
  const TOKEN = String(token || '');
  const TOKO = String(toko || '');
  const JENIS = Array.isArray(jenisList) && jenisList.length
    ? jenisList
    : ['items', 'jual'];

  const kirim = _kirim || (async (u, isi) => {
    const r = await fetch(u, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-push-token': TOKEN },
      body: JSON.stringify(isi),
      signal: AbortSignal.timeout(120000),
    });
    let body = null;
    try { body = await r.json(); } catch (_) { /* bukan JSON */ }
    return { status: r.status, body };
  });

  // jenis -> { hash, terkirimPada, jumlahKirim, err }
  const keadaan = new Map();
  let berhenti = false;
  let alasanBerhenti = null;

  function status() {
    const per = {};
    for (const j of JENIS) {
      const s = keadaan.get(j);
      per[j] = s
        ? { terkirimPada: s.terkirimPada, jumlahKirim: s.jumlahKirim, err: s.err || null }
        : { terkirimPada: null, jumlahKirim: 0, err: null };
    }
    return { toko: TOKO, url: URL, berhenti, alasanBerhenti, jenis: per };
  }

  /**
   * Satu siklus: ambil semua jenis, kirim yang berubah.
   * TIDAK PERNAH melempar.
   */
  async function siklus() {
    const hasil = {};
    if (berhenti) {
      for (const j of JENIS) hasil[j] = { dilewati: true, alasan: alasanBerhenti };
      return hasil;
    }

    for (const jenis of JENIS) {
      const sebelum = keadaan.get(jenis) || { hash: null, jumlahKirim: 0, terkirimPada: null, err: null };
      try {
        const data = _ambilSumber ? await _ambilSumber(jenis) : null;

        // Sumber tidak menghasilkan apa pun -> jangan kirim. Mengirim null
        // akan menghapus data bagus di server.
        if (data == null) {
          hasil[jenis] = { dilewati: true, alasan: 'sumber kosong' };
          keadaan.set(jenis, { ...sebelum, err: 'sumber kosong' });
          continue;
        }
        if (Array.isArray(data) && data.length === 0) {
          hasil[jenis] = { dilewati: true, alasan: 'sumber kosong' };
          keadaan.set(jenis, { ...sebelum, err: 'sumber kosong' });
          continue;
        }

        const h = hashIsi(data);
        if (h === sebelum.hash) {
          hasil[jenis] = { dilewati: true, alasan: 'tidak berubah' };
          keadaan.set(jenis, { ...sebelum, err: null });
          continue;
        }

        const isi = { toko: TOKO, jenis, data };
        const r = await kirim(URL, isi);

        if (r.status === 200) {
          keadaan.set(jenis, { hash: h, jumlahKirim: sebelum.jumlahKirim + 1, terkirimPada: Date.now(), err: null });
          hasil[jenis] = { dikirim: true, jumlah: Array.isArray(data) ? data.length : null };
          continue;
        }

        if (r.status === 401 || r.status === 403) {
          berhenti = true;
          alasanBerhenti = 'token ditolak (HTTP ' + r.status + ') - periksa PUSH_TOKEN';
          keadaan.set(jenis, { ...sebelum, err: alasanBerhenti });
          hasil[jenis] = { gagal: true, alasan: alasanBerhenti };
          return hasil;
        }

        if (r.status === 400) {
          // Data ditolak: kemungkinan bentuk salah. Jangan ulangi terus.
          const pesan = (r.body && r.body.err) || 'ditolak server';
          keadaan.set(jenis, { ...sebelum, err: 'HTTP 400: ' + pesan });
          hasil[jenis] = { gagal: true, alasan: 'HTTP 400: ' + pesan };
          continue;
        }

        // 5xx / lainnya: sementara, coba lagi siklus berikut.
        keadaan.set(jenis, { ...sebelum, err: 'HTTP ' + r.status });
        hasil[jenis] = { gagal: true, alasan: 'HTTP ' + r.status };
      } catch (e) {
        // Jaringan putus: catat, jangan lempar, coba lagi nanti.
        const pesan = (e && e.code) || (e && e.message) || String(e);
        keadaan.set(jenis, { ...sebelum, err: String(pesan).slice(0, 120) });
        hasil[jenis] = { gagal: true, alasan: String(pesan).slice(0, 120) };
      }
    }
    return hasil;
  }

  return { siklus, status, jenisList: JENIS };
}

module.exports = { buatPendorong, hashIsi };
