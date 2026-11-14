'use strict';
/**
 * TEST: penjaga kebasian LAPORAN (bukan hanya item).
 *
 * Latar belakang nyata (2026-11-14, CP):
 *   DB sentral 192.168.77.250 mati -> laporan penjualan membeku 146 menit,
 *   TETAPI katalog item tetap segar (umur 83 dtk) karena jalurnya berbeda.
 *   Akibatnya /health melaporkan "segar" untuk data penjualan yang basi.
 *
 * Test ini memastikan status() MELAPORKAN kebasian laporan secara jujur:
 *   - laporanUmurDetik terisi dari field `update` API
 *   - laporanBasi = true bila melewati batas
 *   - laporanErr terlihat saat sumber gagal
 *   - tanpa data, nilainya null (tidak menipu dengan 0)
 */

const path = require('path');
const http = require('http');

const BRIDGE = path.join(__dirname, '..', 'ipos-bridge.js');
const bridge = require(BRIDGE);

let lulus = 0, gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log('  ✅ ' + nama); }
  else { gagal++; console.log('  ❌ ' + nama + (detail ? '  -> ' + detail : '')); }
}

// ------------------------------------------------------------------ server uji
function buatServer(mode) {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');

    if (url.pathname.endsWith('/api/items')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ count: 1, data: [{
        kode: 'UJI1', nama: 'BARANG UJI', satuan: 'PCS', kategori: 'UJI',
        harga: 1000, harga2: 900, hpp: 500, statusjual: 'Y', stok: 5,
      }] }));
    }

    if (url.pathname.endsWith('/api/jual')) {
      // mode 'basi' -> `update` = 2 jam lalu
      const upd = mode === 'basi' ? Date.now() - 2 * 3600 * 1000 : Date.now();
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        siap: true, dari: '2026-11-14', sampai: '2026-11-14',
        jangkauan: { dari: '2025-01-06', sampai: '2026-11-14' },
        total: { kasir: 1, nota: 5, item: 10, omzet: 50000, tunai: 50000, debit: 0, kredit: 0 },
        perTipe: { KSR: { nota: 5, item: 10, omzet: 50000 } },
        promo: { nota: 0, item: 0, omzet: 0, tunai: 0, debit: 0, kredit: 0 },
        promoSiap: true,
        kasir: [{ userid: 'K1', nama: 'kasir1', kelompok: 'KASIR', user: 'K1',
          nota: 5, item: 10, omzet: 50000, mesin: 'PC1', jam: '08:00-09:00', toko: 'CP' }],
        nonaktif: [],
        update: upd,
      }));
    }

    if (url.pathname.endsWith('/api/events')) {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      res.write(`event: hello\ndata: ${JSON.stringify({ seri: 'CP', items: 1 })}\n\n`);
      return; // biarkan terbuka
    }

    res.writeHead(404); res.end('{}');
  });
}

function dengar(server) {
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
}

(async () => {
  console.log('=== 1. Laporan BASI harus terlihat di status() ===');
  {
    const srv = buatServer('basi');
    const port = await dengar(srv);
    const ipos = bridge.buatBridge({
      toko: 'cp', label: 'UJI', url: `http://127.0.0.1:${port}/ipos`, key: 'k',
    });
    await ipos.ambilLaporanKasir('2026-11-14', '2026-11-14').catch((e) => {
      console.log('  (info) ambilLaporanKasir: ' + e.message);
    });
    const s = ipos.status();
    cek('laporanUmurDetik terisi', typeof s.laporanUmurDetik === 'number',
      'dapat ' + s.laporanUmurDetik);
    cek('laporanUmurDetik > 7000 dtk (2 jam)', s.laporanUmurDetik > 7000,
      'dapat ' + s.laporanUmurDetik);
    cek('laporanBasi = true', s.laporanBasi === true, 'dapat ' + s.laporanBasi);
    cek('laporanUpdate terisi', typeof s.laporanUpdate === 'number' && s.laporanUpdate > 0);
    cek('laporanErr null (sukses)', s.laporanErr === null, 'dapat ' + s.laporanErr);
    srv.close();
  }

  console.log('');
  console.log('=== 2. Laporan SEGAR tidak boleh memicu alarm palsu ===');
  {
    const srv = buatServer('segar');
    const port = await dengar(srv);
    const ipos = bridge.buatBridge({
      toko: 'cp', label: 'UJI2', url: `http://127.0.0.1:${port}/ipos`, key: 'k',
    });
    await ipos.ambilLaporanKasir('2026-11-14', '2026-11-14').catch(() => {});
    const s = ipos.status();
    cek('laporanUmurDetik kecil (< 60 dtk)',
      s.laporanUmurDetik !== null && s.laporanUmurDetik < 60, 'dapat ' + s.laporanUmurDetik);
    cek('laporanBasi = false', s.laporanBasi === false, 'dapat ' + s.laporanBasi);
    srv.close();
  }

  console.log('');
  console.log('=== 3. Tanpa data laporan, status TIDAK menipu dengan 0 ===');
  {
    const srv = buatServer('segar');
    const port = await dengar(srv);
    const ipos = bridge.buatBridge({
      toko: 'cp', label: 'UJI3', url: `http://127.0.0.1:${port}/ipos`, key: 'k',
    });
    const s = ipos.status(); // belum pernah ambil laporan
    cek('laporanUmurDetik = null', s.laporanUmurDetik === null, 'dapat ' + s.laporanUmurDetik);
    cek('laporanBasi = null', s.laporanBasi === null, 'dapat ' + s.laporanBasi);
    cek('laporanUpdate = null', s.laporanUpdate === null, 'dapat ' + s.laporanUpdate);
    srv.close();
  }

  console.log('');
  console.log('=== 4. Gagal laporan tercatat jujur di laporanErr ===');
  {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (u.pathname.endsWith('/api/items')) {
        res.writeHead(200, { 'content-type': 'application/json' });
        return res.end(JSON.stringify({ count: 0, data: [] }));
      }
      if (u.pathname.endsWith('/api/events')) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return;
      }
      res.writeHead(503); res.end('{}');
    });
    const port = await dengar(srv);
    const ipos = bridge.buatBridge({
      toko: 'cp', label: 'UJI4', url: `http://127.0.0.1:${port}/ipos`, key: 'k',
    });
    await ipos.ambilLaporanKasir('2026-11-14', '2026-11-14').catch(() => {});
    const s = ipos.status();
    cek('laporanErr terisi', typeof s.laporanErr === 'string' && s.laporanErr.length > 0,
      'dapat ' + JSON.stringify(s.laporanErr));
    srv.close();
  }

  console.log('');
  console.log('══════════════════════════════════');
  console.log(`LULUS ${lulus}, GAGAL ${gagal}`);
  process.exit(gagal ? 1 : 0);
})();
