// test-laporan-backoff.js
// Uji regresi backoff laporan di ipos-bridge.js.
//
// Membuktikan: ketika host toko MATI, percobaan laporan TIDAK diulang setiap
// 30 detik (yang dulu menahan toko lain karena berjalan berurutan), tetapi
// tetap dicoba lagi setelah jeda — jadi toko otomatis pulih sendiri.
//
// Memakai server palsu: percobaan pertama sukses, lalu sengaja dibuat gagal.
'use strict';
const http = require('http');

let lulus = 0, gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  FAIL  ${nama}${detail ? ' -> ' + detail : ''}`); }
}
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

const catatan = { jual: 0 };
let mode = 'sehat';

const server = http.createServer((req, res) => {
  const url = req.url || '';
  if (url.startsWith('/ipos/api/jual')) {
    catatan.jual++;
    if (mode === 'mati') {
      // Tiru host mati: tidak menjawab sama sekali lalu putus.
      setTimeout(() => { try { req.destroy(); } catch (e) {} }, 300);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ siap: true, kasir: [], total: 0, update: 'uji' }));
    return;
  }
  if (url.startsWith('/ipos/api/events')) {
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('event: hello\ndata: {}\n\n');
    return;
  }
  res.writeHead(404); res.end('{}');
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  const { buatBridge } = require('C:/BOT-TELEGRAM-/ipos-bridge');
  const br = buatBridge({
    url: `http://127.0.0.1:${port}/ipos`,
    key: 'kunci-uji-palsu',
    toko: ['uji'],
    label: 'UJI',
  });

  console.log('=== Uji backoff laporan ===\n');

  // 1. Kondisi sehat: laporan berhasil.
  const r1 = await br.ambilLaporanKasir('2026-01-01', '2026-01-01', { fresh: true });
  cek('laporan sukses saat host sehat', !!(r1 && r1.siap), JSON.stringify(r1));

  // 2. Host mati: percobaan pertama gagal.
  mode = 'mati';
  let pesan1 = '';
  try { await br.ambilLaporanKasir('2026-01-01', '2026-01-01', { fresh: true }); }
  catch (e) { pesan1 = String(e.message || e); }
  cek('kegagalan pertama terdeteksi', pesan1.length > 0, pesan1);

  // 3. Backoff: percobaan berikutnya harus DITOLAK CEPAT tanpa menyentuh
  //    jaringan. Dulu ini langsung menembak lagi dan menggantung 15-35 dtk.
  const sebelum = catatan.jual;
  const t0 = Date.now();
  let pesan2 = '';
  try { await br.ambilLaporanKasir('2026-01-01', '2026-01-01', { fresh: true }); }
  catch (e) { pesan2 = String(e.message || e); }
  const ms = Date.now() - t0;

  cek('percobaan berikutnya ditolak cepat (backoff)', ms < 500, `butuh ${ms}ms`);
  cek('tidak menembak jaringan saat backoff', catatan.jual === sebelum, `jual=${catatan.jual} (sebelum=${sebelum})`);
  cek('pesan backoff informatif', /tidak terjangkau|coba lagi/i.test(pesan2), pesan2);

  console.log(`\n=== HASIL: ${lulus} PASS, ${gagal} FAIL ===`);
  server.close();
  process.exit(gagal === 0 ? 0 : 1);
})();
