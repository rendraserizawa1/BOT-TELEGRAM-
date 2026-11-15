'use strict';
/**
 * PROBE JALUR TAILNET — diagnosis presisi di dalam container.
 *
 * KENAPA BERKAS INI ADA
 * ---------------------
 * Pesan "This operation was aborted" tidak bisa membedakan dua masalah yang
 * SANGAT berbeda:
 *   (a) header respons tidak pernah datang  -> koneksi/routing macet
 *   (b) header datang tetapi body ditahan   -> buffering (gejala Cloudflare)
 * Keduanya butuh tindakan berbeda, jadi probe ini mengukur waktunya terpisah.
 *
 * Pemakaian:
 *   node boot/probe-tailnet.js                 (target dari env, lihat di bawah)
 *   node boot/probe-tailnet.js --detik=45
 *
 * Env yang dipakai (semua opsional):
 *   IPOS_TAILSCALE_PROXY  http://127.0.0.1:1056 dan/atau socks5://...
 *   IPOS_KEFA_URL         dipakai bila UJI_TARGET kosong
 *   IPOS_KEFA_KEY
 *   UJI_TARGET            URL dasar iPos (menimpa IPOS_KEFA_URL)
 *   UJI_KEY               kunci iPos (menimpa IPOS_KEFA_KEY)
 */
const DETIK = (() => {
  const m = process.argv.find((a) => a.startsWith('--detik='));
  return m ? Number(m.split('=')[1]) : 25;
})();
const MS = DETIK * 1000;

const PROXY_HTTP = process.env.IPOS_TAILSCALE_PROXY || 'http://127.0.0.1:1056';
const PROXY_SOCKS = (process.env.UJI_PROXY_SOCKS || 'socks5://127.0.0.1:1056');
const TARGET = process.env.UJI_TARGET || process.env.IPOS_KEFA_URL || '';
const KUNCI = process.env.UJI_KEY || process.env.IPOS_KEFA_KEY || '';

function agen(alamat) {
  const undici = require('undici');
  return /^socks5h?:\/\//i.test(alamat)
    ? new undici.Socks5ProxyAgent(alamat)
    : new undici.ProxyAgent(alamat);
}

/**
 * Ukur satu permintaan secara rinci.
 * Mengembalikan: { tahap, msHeader, msByte, byte, potongan, err }
 *   tahap: 'header-gagal' | 'body-gagal' | 'selesai'
 */
async function ukur(url, alamatProxy, streaming) {
  const hasil = { tahap: null, msHeader: null, msByte: null, byte: 0, potongan: 0, status: null, err: null };
  const ac = new AbortController();
  const batas = setTimeout(() => ac.abort(), MS);
  const t0 = Date.now();

  try {
    const d = alamatProxy ? agen(alamatProxy) : null;
    const opsi = { signal: ac.signal };
    if (d) opsi.dispatcher = d;
    if (streaming) opsi.headers = { accept: 'text/event-stream' };

    let r;
    try {
      r = await fetch(url, opsi);
    } catch (e) {
      hasil.tahap = 'header-gagal';
      hasil.err = (e.cause && e.cause.code) || e.name || e.message;
      hasil.msHeader = Date.now() - t0;
      return hasil;
    }

    hasil.msHeader = Date.now() - t0;
    hasil.status = r.status;

    if (!r.body) { hasil.tahap = 'selesai'; return hasil; }

    const reader = r.body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (hasil.msByte === null) hasil.msByte = Date.now() - t0;
        hasil.byte += value.length;
        hasil.potongan++;
        // Untuk permintaan biasa, baca SAMPAI HABIS supaya ukuran sebenarnya terlihat.
        // Untuk streaming, berhenti setelah 3 potongan (bukti mengalir).
        if (!streaming) { continue; }
        if (hasil.potongan >= 3) break;
      }
      hasil.tahap = 'selesai';
    } catch (e) {
      hasil.tahap = 'body-gagal';
      hasil.err = (e.cause && e.cause.code) || e.name || e.message;
    } finally {
      try { reader.cancel(); } catch (_) { /* abaikan */ }
    }
  } finally {
    clearTimeout(batas);
  }
  return hasil;
}

const baris = (nama, h) => {
  const bagian = [
    'tahap=' + String(h.tahap),
    'status=' + String(h.status),
    'header=' + (h.msHeader === null ? '-' : h.msHeader + 'ms'),
    'byte1=' + (h.msByte === null ? '-' : h.msByte + 'ms'),
    'byte=' + h.byte,
    'potongan=' + h.potongan,
  ];
  if (h.err) bagian.push('err=' + h.err);
  console.log('  ' + nama.padEnd(30) + bagian.join('  '));
};

(async () => {
  console.log('=== probe jalur tailnet ===');
  console.log('  target = ' + (TARGET || '(kosong)'));
  console.log('  kunci  = ' + (KUNCI ? 'ada (len ' + KUNCI.length + ')' : 'TIDAK ADA'));
  console.log('  batas  = ' + DETIK + ' dtk per percobaan\n');

  if (!TARGET) { console.log('  TIDAK ADA TARGET'); process.exit(1); }

  const urlHealth = TARGET + '/health';
  const urlItems = TARGET + '/api/items?key=' + encodeURIComponent(KUNCI);
  const urlEvents = TARGET + '/api/events?key=' + encodeURIComponent(KUNCI);

  const hasil = [];

  // Baseline: TANPA proxy. Kalau ini berhasil, berarti target memang terjangkau
  // langsung (mis. URL tunnel) dan uji proxy menjadi tidak relevan.
  console.log('--- tanpa proxy (baseline) ---');
  {
    const h = await ukur(urlHealth, null, false);
    baris('/health langsung', h);
    hasil.push(['/health langsung', h]);
  }

  for (const alamat of [PROXY_HTTP, PROXY_SOCKS]) {
    const label = /^socks5/i.test(alamat) ? 'socks5' : 'http';
    console.log('\n--- lewat ' + label + ' ' + alamat + ' ---');

    const h1 = await ukur(urlHealth, alamat, false);
    baris('/health', h1);
    hasil.push(['/health ' + label, h1]);

    for (let ulang = 1; ulang <= 3; ulang++) {
      const h2 = await ukur(urlItems, alamat, false);
      baris('/api/items #' + ulang, h2);
      hasil.push(['/api/items ' + label + ' #' + ulang, h2]);
    }

    const h3 = await ukur(urlEvents, alamat, true);
    baris('/api/events (SSE)', h3);
    hasil.push(['/api/events ' + label, h3]);
  }

  // ── Tafsir ────────────────────────────────────────────────────────────
  console.log('\n=== TAFSIR ===');
  const ss = hasil.filter(([n]) => n.startsWith('/api/events'));
  if (!ss.length) {
    console.log('  tidak ada data SSE');
    process.exit(1);
  }
  for (const [nama, h] of ss) {
    let arti;
    if (h.tahap === 'selesai' && h.potongan >= 3) arti = 'MENGALIR — realtime bekerja';
    else if (h.tahap === 'selesai' && h.potongan >= 1) arti = 'byte masuk tetapi < 3 potongan (uji terlalu singkat?)';
    else if (h.tahap === 'body-gagal' && h.msHeader !== null) arti = 'HEADER DATANG, BODY DITAHAN -> BUFFERING';
    else if (h.tahap === 'header-gagal') arti = 'HEADER TIDAK DATANG -> koneksi/routing macet';
    else arti = 'tidak jelas';
    console.log('  ' + nama.padEnd(24) + ' -> ' + arti);
  }

  const lulus = ss.some(([, h]) => h.tahap === 'selesai' && h.potongan >= 3);
  console.log('\n  ' + (lulus ? 'ADA jalur yang mengalirkan SSE.' : 'TIDAK ADA jalur yang mengalirkan SSE.'));
  process.exit(lulus ? 0 : 1);
})().catch((e) => { console.log('FATAL: ' + ((e && e.stack) || e)); process.exit(1); });
