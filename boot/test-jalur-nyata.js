'use strict';
/**
 * Uji integrasi modul jalur terhadap DATA NYATA lewat IP tailnet.
 *
 * Ini bukan pengganti uji di dalam container, tetapi membuktikan dua hal
 * yang sering salah tanpa terlihat:
 *   1. modul `ipos-jalur.js` benar-benar menghasilkan Response yang bisa
 *      dipakai (bukan hanya lulus uji tiruan)
 *   2. IP tailnet + path `/ipos` memang menghasilkan data iPos yang sah
 *
 * Yang TIDAK dibuktikan di sini: hop proxy Tailscale (butuh container).
 * Hop itu dibuktikan oleh boot/uji-tailscale.js di dalam Railway.
 */
const { buatJalurIpos } = require('./ipos-jalur');
const fs = require('fs');

const URL_KEFA = process.env.UJI_URL || 'http://100.123.166.13:8080/ipos';

/**
 * Ambil kunci TANPA pernah mencetaknya.
 * Urutan: UJI_KEY (env) -> API_KEY di .env proxy lokal.
 * Yang dilaporkan hanya panjangnya.
 */
function ambilKunci() {
  if (process.env.UJI_KEY) return String(process.env.UJI_KEY);
  try {
    const isi = fs.readFileSync('C:\\Users\\rdpadmin\\ipos-api\\.env', 'utf8');
    for (const baris of isi.split(/\r?\n/)) {
      const m = baris.match(/^\s*API_KEY\s*=\s*(.+)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  } catch (_) { /* tidak ada berkas */ }
  return '';
}

(async () => {
  const KUNCI = ambilKunci();
  console.log('=== uji jalur terhadap data nyata ===');
  console.log('  URL   = ' + URL_KEFA);
  console.log('  kunci = ' + (KUNCI ? 'ada (len ' + KUNCI.length + ')' : 'TIDAK ADA'));

  const jalur = buatJalurIpos({ urlUtama: URL_KEFA, urlCadangan: '', proxy: '' });
  console.log('  status = ' + JSON.stringify(jalur.status()));

  let gagal = 0;
  const cek = (nama, lulus, detail) => {
    console.log('  ' + (lulus ? 'OK    ' : 'GAGAL ') + nama + (detail ? '  (' + detail + ')' : ''));
    if (!lulus) gagal++;
  };

  // 1. /health
  try {
    const t0 = Date.now();
    const r = await jalur.ambil(URL_KEFA + '/health', { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    const ms = Date.now() - t0;
    cek('/health HTTP 200', r.status === 200, 'HTTP ' + r.status + ' ' + ms + 'ms');
    cek('/health ok=true', j && j.ok === true, 'ok=' + (j && j.ok));
    cek('/health items > 0', j && j.items > 0, 'items=' + (j && j.items));
    cek('/health jual.siap', !!(j && j.jual && j.jual.siap), 'siap=' + (j && j.jual && j.jual.siap));
  } catch (e) {
    cek('/health', false, (e.cause && e.cause.code) || e.message);
  }

  // 2. /api/items — jalur yang dipakai sinkronisasi katalog
  try {
    const r = await jalur.ambil(URL_KEFA + '/api/items?key=' + encodeURIComponent(KUNCI), { signal: AbortSignal.timeout(45000) });
    const j = await r.json();
    const n = Array.isArray(j && j.data) ? j.data.length : 0;
    cek('/api/items mengembalikan daftar', r.status === 200 && n > 0, 'HTTP ' + r.status + ' jumlah=' + n);
  } catch (e) {
    cek('/api/items', false, (e.cause && e.cause.code) || e.message);
  }

  // 3. /api/events — harus mulai mengalir (bukan menggantung tanpa byte)
  try {
    const ac = new AbortController();
    const batas = setTimeout(() => ac.abort(), 25000);
    const r = await jalur.ambil(URL_KEFA + '/api/events?key=' + encodeURIComponent(KUNCI), {
      headers: { accept: 'text/event-stream' }, signal: ac.signal,
    });
    cek('/api/events HTTP 200', r.status === 200, 'HTTP ' + r.status);
    const reader = r.body.getReader();
    const { value } = await reader.read();
    clearTimeout(batas);
    try { reader.cancel(); } catch (_) { /* abaikan */ }
    cek('/api/events mengirim byte', !!(value && value.length), 'byte pertama=' + (value ? value.length : 0));
  } catch (e) {
    cek('/api/events', false, (e.cause && e.cause.code) || e.message);
  }

  // 4. status jalur mencatat 'utama' setelah berhasil
  cek('status mencatat jalur utama', jalur.status().jalurDipakai === 'utama',
    'jalurDipakai=' + jalur.status().jalurDipakai);

  console.log('\n' + (gagal ? '  ADA ' + gagal + ' YANG GAGAL' : '  SEMUA LULUS — modul jalur bekerja pada data nyata'));
  process.exit(gagal ? 1 : 0);
})();
