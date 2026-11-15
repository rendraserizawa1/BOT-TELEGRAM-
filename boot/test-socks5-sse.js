'use strict';
/**
 * Bukti bahwa jalur SOCKS5 benar-benar MENGALIRKAN SSE.
 *
 * KENAPA PERLU
 * ------------
 * Proxy HTTP Tailscale terbukti bisa menjangkau iPos (/health -> HTTP 200)
 * tetapi permintaan streaming tidak pernah mengirim header (terabort tanpa
 * byte). Karena itu rencana cadangannya SOCKS5. Rencana cadangan tidak boleh
 * dipakai tanpa bukti — uji ini membuktikannya dengan SOCKS5 server SUNGGUHAN
 * (handshake RFC 1928, tanpa autentikasi), bukan tiruan.
 *
 * Yang diuji: `buatJalurIpos({ proxy: 'socks5://...' })` memilih
 * `Socks5ProxyAgent` dan byte mengalir bertahap, tidak dibuffer.
 */
const net = require('net');
const http = require('http');
const { buatJalurIpos } = require('./ipos-jalur');

const PORT_ASAL = 19210;
const PORT_SOCKS = 19211;

/** SOCKS5 server minimal: hanya CONNECT tanpa autentikasi (RFC 1928). */
function buatSocks5() {
  return net.createServer((klien) => {
    let tahap = 'salam';
    let buf = Buffer.alloc(0);

    klien.on('data', (d) => {
      buf = Buffer.concat([buf, d]);

      if (tahap === 'salam') {
        if (buf.length < 2) return;
        const n = buf[1];
        if (buf.length < 2 + n) return;
        buf = buf.slice(2 + n);
        // 0x05 = versi, 0x00 = tanpa autentikasi
        klien.write(Buffer.from([0x05, 0x00]));
        tahap = 'permintaan';
      }

      if (tahap === 'permintaan') {
        if (buf.length < 5) return;
        const atyp = buf[3];
        let panjangAlamat;
        let alamat;
        let offset;

        if (atyp === 0x01) {            // IPv4
          panjangAlamat = 4;
          if (buf.length < 4 + 4 + 2) return;
          alamat = Array.from(buf.slice(4, 8)).join('.');
          offset = 8;
        } else if (atyp === 0x03) {     // nama domain
          panjangAlamat = buf[4];
          if (buf.length < 5 + panjangAlamat + 2) return;
          alamat = buf.slice(5, 5 + panjangAlamat).toString('utf8');
          offset = 5 + panjangAlamat;
        } else {
          klien.destroy();
          return;
        }

        const port = buf.readUInt16BE(offset);
        buf = buf.slice(offset + 2);
        tahap = 'tersambung';

        const tujuan = net.connect(port, alamat, () => {
          // 0x05 0x00 0x00 0x01 0.0.0.0:0 = berhasil
          klien.write(Buffer.from([0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0]));
          if (buf.length) tujuan.write(buf);
          buf = Buffer.alloc(0);
          tujuan.pipe(klien);
          klien.pipe(tujuan);
        });
        tujuan.on('error', () => { try { klien.destroy(); } catch (_) { /* sudah */ } });
        klien.on('error', () => { try { tujuan.destroy(); } catch (_) { /* sudah */ } });
      }
    });

    klien.on('error', () => { /* abaikan */ });
  });
}

(async () => {
  console.log('=== uji SOCKS5 -> SSE ===');

  // Server asal: kirim `: ping` tiap 300 ms, tutup setelah 10.
  const asal = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(': hello\n\n');
    let n = 0;
    const t = setInterval(() => {
      n++;
      try { res.write(': ping ' + n + '\n\n'); } catch (_) { /* tutup */ }
      if (n >= 10) { clearInterval(t); try { res.end(); } catch (_) { /* sudah */ } }
    }, 300);
    req.on('close', () => clearInterval(t));
  });
  await new Promise((r) => asal.listen(PORT_ASAL, '127.0.0.1', r));

  const socks = buatSocks5();
  await new Promise((r) => socks.listen(PORT_SOCKS, '127.0.0.1', r));

  const jalur = buatJalurIpos({
    urlUtama: 'http://127.0.0.1:' + PORT_ASAL,
    urlCadangan: '',
    proxy: 'socks5://127.0.0.1:' + PORT_SOCKS,
  });

  const disp = jalur.dispatcher();
  console.log('  agen dipilih  = ' + (disp ? disp.constructor.name : 'null'));
  console.log('  proxyAktif    = ' + jalur.status().proxyAktif);

  const t0 = Date.now();
  let byte = 0, potongan = 0, ping = 0, pertama = null, terakhir = null, status = 0;
  const ac = new AbortController();

  try {
    const r = await jalur.ambil('http://127.0.0.1:' + PORT_ASAL + '/events', {
      headers: { accept: 'text/event-stream' }, signal: ac.signal,
    });
    status = r.status;
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const ms = Date.now() - t0;
      if (pertama === null) pertama = ms;
      terakhir = ms;
      byte += value.length;
      potongan++;
      ping += (dec.decode(value, { stream: true }).match(/: ping/g) || []).length;
    }
  } catch (e) {
    console.log('  error: ' + ((e.cause && e.cause.code) || e.message));
  }

  const rentang = (pertama !== null && terakhir !== null) ? terakhir - pertama : 0;

  console.log('\n=== HASIL ===');
  console.log('  status HTTP   = ' + status);
  console.log('  byte          = ' + byte);
  console.log('  potongan      = ' + potongan);
  console.log('  ping          = ' + ping);
  console.log('  rentang       = ' + rentang + ' ms');

  const cek = [
    ['agen = Socks5ProxyAgent', disp && disp.constructor.name === 'Socks5ProxyAgent'],
    ['status 200', status === 200],
    ['potongan > 1 (tidak dibuffer)', potongan > 1],
    ['ping >= 3', ping >= 3],
    ['rentang > 500 ms (bertahap)', rentang > 500],
  ];
  let gagal = 0;
  console.log('\n=== PEMERIKSAAN ===');
  for (const [nama, lulus] of cek) {
    console.log('  ' + (lulus ? 'OK    ' : 'GAGAL ') + nama);
    if (!lulus) gagal++;
  }

  socks.close();
  asal.close();
  setTimeout(() => {
    console.log(gagal ? '\n  ADA YANG GAGAL' : '\n  SEMUA LULUS — SOCKS5 mengalirkan SSE');
    process.exit(gagal ? 1 : 0);
  }, 200);
})();
