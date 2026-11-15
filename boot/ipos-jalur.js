'use strict';
/**
 * JALUR iPos — satu-satunya tempat yang tahu soal proxy Tailscale dan jalur
 * cadangan.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Supaya `ipos-bridge.js` tidak menduplikasi logika proxy/cadangan di empat
 * titik `fetch`. Semua keputusan "lewat proxy atau tidak" dan "pakai jalur
 * utama atau cadangan" ada di sini.
 *
 * ATURAN PENTING
 * --------------
 * 1. TANPA `proxy` -> `dispatcher()` = null dan `ambil()` = `fetch` biasa.
 *    Artinya perilaku di PC (dan di Railway sebelum Tailscale dipasang)
 *    TIDAK BERUBAH SAMA SEKALI. Ini yang membuat rollback cukup dengan
 *    mengosongkan satu variabel.
 *
 * 2. Proxy HANYA dipakai bila diminta. Telegram, GitHub, dan API AI tidak
 *    boleh lewat proxy: jalur tailnet menambah latensi dan satu titik gagal.
 *    Karena itu dispatcher diberikan PER-PERMINTAAN, bukan global.
 *
 * 3. Pindah ke jalur cadangan HANYA saat kegagalan JARINGAN. HTTP 404/500
 *    adalah jawaban server yang SAH — memindahkannya ke cadangan akan
 *    menyembunyikan bug dan menggandakan beban.
 *
 * 4. `AbortError` BUKAN alasan pindah jalur. Abort berasal dari timeout kita
 *    sendiri; mencoba jalur lain hanya memperpanjang penderitaan.
 *
 * 5. Setelah cadangan berhasil, jalur DIINGAT supaya tidak mencoba-coba
 *    terus ke jalur utama yang sedang mati (menghemat timeout 15-35 dtk
 *    per percobaan).
 */

/** Kode error yang menandakan masalah jaringan, bukan jawaban server. */
const KODE_JARINGAN = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'ENOTFOUND',
  'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EPROTO',
  'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_SOCKET', 'UND_ERR_CLOSED', 'UND_ERR_ABORTED',
]);

/**
 * Apakah error ini kegagalan jaringan (layak dicoba ke jalur lain)?
 * Sengaja TIDAK memasukkan AbortError.
 */
function errorJaringan(e) {
  if (!e) return false;
  if (e.name === 'AbortError') return false;
  if (e.code && KODE_JARINGAN.has(String(e.code))) return true;
  // `fetch` global membungkus kegagalan jaringan sebagai TypeError('fetch failed')
  // dan menaruh sebab aslinya di e.cause.
  if (e.cause && e.cause.code && KODE_JARINGAN.has(String(e.cause.code))) return true;
  if (e.cause && Array.isArray(e.cause.errors)) {
    for (const x of e.cause.errors) {
      if (x && x.code && KODE_JARINGAN.has(String(x.code))) return true;
    }
  }
  const pesan = String((e && e.message) || '');
  return /fetch failed|socket hang up|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network/i.test(pesan);
}

/** Ganti awalan URL utama dengan awalan cadangan. */
function keCadangan(url, urlUtama, urlCadangan) {
  if (!urlCadangan) return null;
  if (url.startsWith(urlUtama)) return urlCadangan + url.slice(urlUtama.length);
  // URL di luar awalan utama: jangan menebak, pakai cadangan apa adanya.
  return urlCadangan;
}

/**
 * @param {object} o
 * @param {string} o.urlUtama    URL dasar iPos (mis. http://100.1.2.3:8080/ipos)
 * @param {string} [o.urlCadangan] URL dasar cadangan; kosong = tidak ada cadangan
 * @param {string} [o.proxy]     URL proxy HTTP (mis. http://127.0.0.1:1056); kosong = tanpa proxy
 * @param {Function} [o._fetch]  hanya untuk uji
 */
function buatJalurIpos({ urlUtama, urlCadangan, proxy, _fetch } = {}) {
  const utama = String(urlUtama || '').replace(/\/+$/, '');
  const cadangan = String(urlCadangan || '').replace(/\/+$/, '');
  const proxyUrl = String(proxy || '').trim();
  const doFetch = _fetch || ((...a) => globalThis.fetch(...a));

  let _dispatcher = null;
  let _dispatcherDiperiksa = false;
  let jalurDipakai = null; // null | 'utama' | 'cadangan'

  /**
   * Buat agen proxy sekali saja. Gagal -> null (jangan pernah crash).
   *
   * KENAPA DUA JENIS AGEN
   * ---------------------
   * Proxy HTTP Tailscale (`--outbound-http-proxy-listen`) terbukti bisa
   * menjangkau iPos lewat tailnet untuk permintaan BIASA (/health -> HTTP 200),
   * tetapi permintaan STREAMING tidak pernah mengirim header sama sekali
   * (terabort 25 dtk tanpa byte). Itu pola buffering, bukan pola putus.
   *
   * SOCKS5 tidak punya konsep header HTTP untuk di-buffer — ia hanya
   * menyalurkan TCP — jadi streaming lewat SOCKS5 mengalir apa adanya.
   *
   * Pemilihan cukup dari SKEMA URL, sehingga tidak perlu ubah kode lagi:
   *   proxy = socks5://127.0.0.1:1056  -> Socks5ProxyAgent
   *   proxy = http://127.0.0.1:1056    -> ProxyAgent
   */
  function dispatcher() {
    if (_dispatcherDiperiksa) return _dispatcher;
    _dispatcherDiperiksa = true;
    if (!proxyUrl) return null;
    try {
      const undici = require('undici');
      if (/^socks5h?:\/\//i.test(proxyUrl)) {
        if (typeof undici.Socks5ProxyAgent !== 'function') {
          console.warn('[ipos-jalur] Socks5ProxyAgent tidak ada di undici ini; proxy socks5 diabaikan');
          return null;
        }
        _dispatcher = new undici.Socks5ProxyAgent(proxyUrl);
      } else {
        _dispatcher = new undici.ProxyAgent(proxyUrl);
      }
    } catch (e) {
      // `undici` tidak terpasang atau agen tidak ada. Ini TIDAK boleh
      // menghentikan bot: tanpa proxy, iPos tetap dicoba lewat jalur langsung.
      console.warn('[ipos-jalur] proxy diminta tetapi agen gagal dibuat: ' + String((e && e.message) || e).slice(0, 120));
      _dispatcher = null;
    }
    return _dispatcher;
  }

  /**
   * Ambil URL. Mencoba jalur utama, lalu cadangan bila kegagalan jaringan.
   * @param {string} url URL lengkap
   * @param {object} [opsi] diteruskan ke fetch (signal, headers, ...)
   */
  async function ambil(url, opsi = {}) {
    const disp = dispatcher();
    const opsiUtama = disp ? { ...opsi, dispatcher: disp } : opsi;

    // Sudah terbukti cadangan yang hidup: langsung ke sana.
    if (jalurDipakai === 'cadangan' && cadangan) {
      const urlCad = keCadangan(url, utama, cadangan);
      try {
        return await doFetch(urlCad, opsiUtama);
      } catch (e) {
        // Cadangan pun mati -> coba utama sekali lagi (mungkin sudah pulih).
        jalurDipakai = null;
        if (!errorJaringan(e)) throw e;
      }
    }

    try {
      const r = await doFetch(url, opsiUtama);
      jalurDipakai = 'utama';
      return r;
    } catch (e) {
      if (!cadangan || !errorJaringan(e)) throw e;
      const urlCad = keCadangan(url, utama, cadangan);
      const r = await doFetch(urlCad, opsiUtama);
      jalurDipakai = 'cadangan';
      return r;
    }
  }

  function status() {
    return {
      proxyAktif: !!proxyUrl,
      urlUtama: utama,
      urlCadangan: cadangan || null,
      jalurDipakai,
    };
  }

  return { ambil, dispatcher, status };
}

module.exports = { buatJalurIpos, errorJaringan };
