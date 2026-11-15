'use strict';
/**
 * Bukti jalur SOCKS5 terhadap DATA iPos NYATA.
 *
 * Uji ini memakai SOCKS5 server lokal yang meneruskan koneksi ke target
 * sungguhan, lalu memanggil iPos KEFA lewat `Socks5ProxyAgent`:
 *   - /health        -> ok, items
 *   - /api/items     -> 4593 item (bentuk json.data)
 *   - /api/events    -> byte mengalir (realtime)
 *
 * Kenapa perlu: `boot/test-socks5-sse.js` membuktikan mekanismenya dengan
 * server tiruan. Uji ini membuktikan mekanisme yang SAMA bekerja pada API
 * iPos yang sebenarnya, termasuk bentuk respons dan kunci.
 */
const net = require('net');
const fs = require('fs');
const { buatJalurIpos } = require('./ipos-jalur');

const PORT_SOCKS = 19311;
const TARGET = process.env.UJI_URL || 'http://100.123.166.13:8080/ipos';

function ambilKunci() {
  if (process.env.UJI_KEY) return String(process.env.UJI_KEY);
  try {
    const isi = fs.readFileSync('C:\\Users\\rdpadmin\\ipos-api\\.env', 'utf8');
    for (const baris of isi.split(/\r?\n/)) {
      const m = baris.match(/^\s*API_KEY\s*=\s*(.+)\s*$/);
      if (m) return m[1].replace(/^["']|["']$/g, '').trim();
    }
  } catch (_) { /* tidak ada */ }
  return '';
}

/** SOCKS5 minimal (RFC 1928), hanya CONNECT tanpa autentikasi. */
function buatSocks5() {
  return net.createServer((klien) => {
    let tahap = 'salam';
    let buf = Buffer.alloc(0);
    klien.on('error', () => { /* abaikan */ });
    klien.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      if (tahap === 'salam') {
        if (buf.length < 2) return;
        const n = buf[1];
        if (buf.length < 2 + n) return;
        buf = buf.slice(2 + n);
        klien.write(Buffer.from([0x05, 0x00]));
        tahap = 'permintaan';
      }
      if (tahap === 'permintaan') {
        if (buf.length < 5) return;
        const atyp = buf[3];
        let alamat, offset;
        if (atyp === 0x01) {
          if (buf.length < 10) return;
          alamat = Array.from(buf.slice(4, 8)).join('.');
          offset = 8;
        } else if (atyp === 0x03) {
          const p = buf[4];
          if (buf.length < 7 + p) return;
          alamat = buf.slice(5, 5 + p).toString('utf8');
          offset = 5 + p;
        } else { klien.destroy(); return; }
        const port = buf.readUInt16BE(offset);
        buf = buf.slice(offset + 2);
        tahap = 'tersambung';
        const tujuan = net.connect(port, alamat, () => {
          klien.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          if (buf.length) tujuan.write(buf);
          buf = Buffer.alloc(0);
          tujuan.pipe(klien);
          klien.pipe(tujuan);
        });
        tujuan.on('error', () => { try { klien.destroy(); } catch (_) { /* sudah */ } });
      }
    });
  });
}

(async () => {
  const KUNCI = ambilKunci();
  console.log('=== uji SOCKS5 terhadap iPos NYATA ===');
  console.log('  target = ' + TARGET);
  console.log('  kunci  = ' + (KUNCI ? 'ada (len ' + KUNCI.length + ')' : 'TIDAK ADA'));

  const socks = buatSocks5();
  await new Promise((r) => socks.listen(PORT_SOCKS, '127.0.0.1', r));

  const jalur = buatJalurIpos({
    urlUtama: TARGET, urlCadangan: '', proxy: 'socks5://127.0.0.1:' + PORT_SOCKS,
  });
  console.log('  agen   = ' + (jalur.dispatcher() ? jalur.dispatcher().constructor.name : 'null'));

  let gagal = 0;
  const cek = (nama, lulus, detail) => {
    console.log('  ' + (lulus ? 'OK    ' : 'GAGAL ') + nama + (detail ? '  (' + detail + ')' : ''));
    if (!lulus) gagal++;
  };

  // /health
  try {
    const r = await jalur.ambil(TARGET + '/health', { signal: AbortSignal.timeout(20000) });
    const j = await r.json();
    cek('/health HTTP 200', r.status === 200, 'HTTP ' + r.status);
    cek('/health ok + items', !!(j && j.ok && j.items > 0), 'items=' + (j && j.items));
  } catch (e) { cek('/health', false, (e.cause && e.cause.code) || e.message); }

  // /api/items (bentuk json.data)
  try {
    const r = await jalur.ambil(TARGET + '/api/items?key=' + encodeURIComponent(KUNCI),
      { signal: AbortSignal.timeout(60000) });
    const j = await r.json();
    const n = Array.isArray(j && j.data) ? j.data.length : 0;
    cek('/api/items daftar', r.status === 200 && n > 0, 'HTTP ' + r.status + ' jumlah=' + n);
  } catch (e) { cek('/api/items', false, (e.cause && e.cause.code) || e.message); }

  // /api/events (streaming)
  try {
    const ac = new AbortController();
    const batas = setTimeout(() => ac.abort(), 25000);
    const r = await jalur.ambil(TARGET + '/api/events?key=' + encodeURIComponent(KUNCI),
      { headers: { accept: 'text/event-stream' }, signal: ac.signal });
    cek('/api/events HTTP 200', r.status === 200, 'HTTP ' + r.status);
    const reader = r.body.getReader();
    const { value } = await reader.read();
    clearTimeout(batas);
    try { reader.cancel(); } catch (_) { /* abaikan */ }
    cek('/api/events mengirim byte', !!(value && value.length), 'byte=' + (value ? value.length : 0));
  } catch (e) { cek('/api/events', false, (e.cause && e.cause.code) || e.message); }

  socks.close();
  console.log('\n' + (gagal ? '  ADA ' + gagal + ' YANG GAGAL' : '  SEMUA LULUS — SOCKS5 bekerja pada data iPos nyata'));
  setTimeout(() => process.exit(gagal ? 1 : 0), 200);
})();
