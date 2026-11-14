// test-stale-guard.js
// Uji regresi penjaga kesegaran di ipos-bridge.js.
//
// Membuktikan: ketika SSE diam (tidak ada frame) MELEBIHI batas, sync penuh
// dipaksa SEGERA tanpa menunggu interval 5 menit. Inilah yang membuat data
// tidak lagi bisa tertinggal berjam-jam.
//
// Memakai server palsu di localhost, tanpa key sungguhan.
'use strict';
const http = require('http');

let lulus = 0, gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  FAIL  ${nama}${detail ? ' -> ' + detail : ''}`); }
}
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

const catatan = { items: 0, sseBuka: 0 };

const server = http.createServer((req, res) => {
  const url = req.url || '';
  if (url.startsWith('/ipos/api/items')) {
    catatan.items++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ kode: 'UJI1', nama: 'Barang Uji', harga: { uji: 1000 } }] }));
    return;
  }
  if (url.startsWith('/ipos/api/events')) {
    catatan.sseBuka++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    res.write('event: hello\ndata: {}\n\n');
    // Diam total: tidak menutup, tidak mengirim -> SSE tidak memberi bukti hidup.
    return;
  }
  res.writeHead(404); res.end('{}');
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;

  // SSE dibiarkan tetap terbuka (idle sangat besar) supaya yang diuji murni
  // penjaga kesegaran, bukan idle-timeout SSE.
  process.env.IPOS_SSE_IDLE_MS = '100000000';
  process.env.IPOS_STALE_MS = '3000';        // anggap basi setelah 3 dtk
  process.env.IPOS_STALE_MIN_GAP_MS = '2000'; // jarak minimum antar paksa
  process.env.IPOS_STALE_CHECK_MS = '500';    // percepat pemeriksaan (uji saja)

  console.log('=== Uji penjaga kesegaran (stale guard) ===\n');

  const { buatBridge } = require('C:/BOT-TELEGRAM-/ipos-bridge');
  const br = buatBridge({
    url: `http://127.0.0.1:${port}/ipos`,
    key: 'kunci-uji-palsu',
    toko: ['uji'],
    label: 'UJI',
  });

  const DATA = [];
  // Interval berkala 5 menit: kalau penjaga TIDAK bekerja, items hanya 1x.
  br.mulaiAutoSync(() => DATA, 300000, 0);

  await tidur(2000);
  const awal = catatan.items;
  cek('sync awal berjalan', awal >= 1, `items=${awal}`);

  // Tunggu melewati batas basi + beberapa siklus penjaga (tiap 30 dtk terlalu
  // lambat untuk uji, jadi kita percepat lewat env di bawah).
  await tidur(7000);

  cek('penjaga memaksa sync tambahan tanpa menunggu 5 menit',
    catatan.items > awal, `items awal=${awal}, sekarang=${catatan.items}`);
  cek('tidak membanjiri (maks wajar dalam 9 dtk)',
    catatan.items - awal <= 6, `tambahan=${catatan.items - awal}`);

  console.log(`\n=== HASIL: ${lulus} PASS, ${gagal} FAIL ===`);
  server.close();
  process.exit(gagal === 0 ? 0 : 1);
})();
