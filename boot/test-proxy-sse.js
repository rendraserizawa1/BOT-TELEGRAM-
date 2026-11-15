'use strict';
/**
 * Bukti bahwa proxy HTTP (jalur Tailscale) TIDAK menahan body SSE.
 *
 * KENAPA PENTING
 * --------------
 * Tunnel Cloudflare sudah terbukti membekukan body SSE: HTTP 200,
 * content-type benar, tapi 0 byte dalam 150 detik. Kalau proxy Tailscale
 * berperilaku sama, memindahkan jalur tidak memperbaiki realtime sama sekali.
 *
 * Uji ini menyalakan dua server lokal:
 *   - "server asal": mengirim `: ping` tiap 300 ms (meniru keepalive iPos)
 *   - "proxy": menyalurkan body apa adanya (tanpa buffer)
 * lalu memanggil jalur.ambil() dengan proxy aktif.
 *
 * LULUS bila: status 200, potongan > 1, ping >= 3, dan rentang waktu antar
 * potongan > 500 ms (bukti mengalir bertahap, bukan sekali kirim).
 */
const http = require('http');
const { buatJalurIpos } = require('./ipos-jalur');

const PORT_ASAL = 19110;
const PORT_PROXY = 19111;

(async () => {
  const asal = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
    res.write(': hello\n\n');
    let n = 0;
    const t = setInterval(() => {
      n++;
      try { res.write(': ping ' + n + '\n\n'); } catch (_) { /* klien tutup */ }
      if (n >= 10) { clearInterval(t); try { res.end(); } catch (_) { /* sudah */ } }
    }, 300);
    req.on('close', () => clearInterval(t));
  });
  await new Promise((r) => asal.listen(PORT_ASAL, '127.0.0.1', r));

  // Proxy penerus: teruskan body apa adanya, jangan buffer.
  // PENTING: undici `ProxyAgent` memakai CONNECT bahkan untuk target http://
  // (terbukti di uji: {"connect":"host:80"}). Jadi proxy uji WAJIB menangani
  // event 'connect', kalau tidak permintaan akan menggantung.
  const proxy = http.createServer((req, res) => {
    let u;
    try { u = new URL(req.url); } catch (_) { res.writeHead(400); return res.end(); }
    const fwd = http.request(
      { host: u.hostname, port: u.port, path: u.pathname + u.search, method: req.method, headers: req.headers },
      (rr) => { res.writeHead(rr.statusCode, rr.headers); rr.pipe(res); }
    );
    fwd.on('error', () => { try { res.writeHead(502); res.end(); } catch (_) { /* sudah */ } });
    req.pipe(fwd);
  });

  proxy.on('connect', (req, klien, head) => {
    const [host, port] = String(req.url).split(':');
    const tujuan = require('net').connect(Number(port) || 80, host, () => {
      klien.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) tujuan.write(head);
      tujuan.pipe(klien);
      klien.pipe(tujuan);
    });
    tujuan.on('error', () => { try { klien.end('HTTP/1.1 502 Bad Gateway\r\n\r\n'); } catch (_) { /* sudah */ } });
    klien.on('error', () => { try { tujuan.destroy(); } catch (_) { /* sudah */ } });
  });
  await new Promise((r) => proxy.listen(PORT_PROXY, '127.0.0.1', r));

  const jalur = buatJalurIpos({
    urlUtama: 'http://127.0.0.1:' + PORT_ASAL,
    urlCadangan: '',
    proxy: 'http://127.0.0.1:' + PORT_PROXY,
  });

  console.log('proxyAktif = ' + jalur.status().proxyAktif);

  const t0 = Date.now();
  let byte = 0, potongan = 0, ping = 0, pertama = null, terakhir = null;
  const ac = new AbortController();
  let status = 0;

  try {
    const r = await jalur.ambil('http://127.0.0.1:' + PORT_ASAL + '/events', {
      headers: { accept: 'text/event-stream' },
      signal: ac.signal,
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
    console.log('  error: ' + String(e.message).slice(0, 120));
  }

  const rentang = (pertama !== null && terakhir !== null) ? terakhir - pertama : 0;

  console.log('\n=== HASIL ===');
  console.log('  status HTTP     = ' + status);
  console.log('  byte diterima   = ' + byte);
  console.log('  potongan        = ' + potongan);
  console.log('  ping diterima   = ' + ping);
  console.log('  rentang waktu   = ' + rentang + ' ms');

  const cek = [
    ['status 200', status === 200],
    ['potongan > 1 (tidak dibuffer)', potongan > 1],
    ['ping >= 3', ping >= 3],
    ['rentang > 500 ms (mengalir bertahap)', rentang > 500],
  ];
  let gagal = 0;
  console.log('\n=== PEMERIKSAAN ===');
  for (const [nama, lulus] of cek) {
    console.log('  ' + (lulus ? 'OK    ' : 'GAGAL ') + nama);
    if (!lulus) gagal++;
  }

  proxy.close();
  asal.close();
  setTimeout(() => {
    console.log(gagal ? '\n  ADA YANG GAGAL' : '\n  SEMUA LULUS — proxy meneruskan SSE');
    process.exit(gagal ? 1 : 0);
  }, 200);
})();
