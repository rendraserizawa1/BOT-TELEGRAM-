// test-sse-idle.js
// Uji regresi untuk perbaikan SSE di ipos-bridge.js.
//
// Membuktikan DUA hal yang dulu rusak:
//   1. Koneksi SSE yang DIAM (half-open: TCP hidup, tidak ada data, tidak ada
//      FIN) harus diputus oleh watchdog idle lalu disambung ulang.
//      Dulu `reader.read()` menggantung selamanya dan status tetap
//      "🟢 realtime" padahal data berhenti mengalir.
//   2. Setelah putus dan tersambung lagi, katalog diambil ulang (resync)
//      sehingga perubahan selama jeda tidak hilang.
//
// Uji ini memakai server SSE PALSU di localhost, jadi tidak menyentuh iPos
// sungguhan dan tidak butuh key.
'use strict';
const http = require('http');
const path = require('path');

let lulus = 0, gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log(`  PASS  ${nama}`); }
  else { gagal++; console.log(`  FAIL  ${nama}${detail ? ' -> ' + detail : ''}`); }
}
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Server palsu: /api/items + /api/events ─────────────────────────────────
const catatan = { items: 0, sseBuka: 0, kirimFrame: 0 };
let modeSSE = 'diam'; // 'diam' = kirim hello lalu tidak apa-apa (half-open)

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
    // Kirim satu frame "hello" (bukan items/jual) lalu DIAM.
    res.write('event: hello\ndata: {}\n\n');
    if (modeSSE === 'alir') {
      // Mode sehat: kirim jual-ping berkala
      const t = setInterval(() => {
        try { res.write('event: jual-ping\ndata: {}\n\n'); catatan.kirimFrame++; } catch (e) { clearInterval(t); }
      }, 500);
      res.on('close', () => clearInterval(t));
    }
    // mode 'diam': tidak menutup koneksi, tidak mengirim apa pun -> half-open
    res.on('close', () => {});
    return;
  }
  res.writeHead(404); res.end('{}');
});

(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  process.env.IPOS_URL = `http://127.0.0.1:${port}/ipos`;
  process.env.IPOS_KEY = 'kunci-uji-palsu';
  process.env.IPOS_SSE_IDLE_MS = '1500';   // percepat: diam 1,5 dtk = mati
  process.env.IPOS_STALE_MS = '100000000'; // matikan penjaga kesegaran agar murni uji SSE

  console.log('=== Uji SSE idle-timeout + resync ===\n');

  const { buatBridge } = require('C:/BOT-TELEGRAM-/ipos-bridge');
  const br = buatBridge({
    url: `http://127.0.0.1:${port}/ipos`,
    key: 'kunci-uji-palsu',
    toko: ['uji'],
    label: 'UJI',
  });

  const DATA = [];
  br.mulaiAutoSync(() => DATA, 300000, 0);

  // Fase 1: mode 'diam' -> watchdog idle harus memutus dan menyambung ulang.
  await tidur(6000);
  cek('SSE membuka koneksi', catatan.sseBuka >= 1, `sseBuka=${catatan.sseBuka}`);
  cek('SSE diam memicu sambung ulang (bukan menggantung selamanya)',
    catatan.sseBuka >= 3, `sseBuka=${catatan.sseBuka} (harus >=3 karena putus tiap ~1,5 dtk)`);
  cek('sync penuh awal berjalan', catatan.items >= 1, `items=${catatan.items}`);

  // Fase 2: mode 'alir' -> frame jual-ping mengalir, tidak boleh putus terus.
  modeSSE = 'alir';
  const sebelum = catatan.sseBuka;
  await tidur(5000);
  cek('mode alir: frame diterima', catatan.kirimFrame >= 3, `frame=${catatan.kirimFrame}`);
  cek('mode alir: tidak sambung ulang berlebihan',
    catatan.sseBuka - sebelum <= 2, `buka tambahan=${catatan.sseBuka - sebelum}`);

  // Fase 3: resync setelah putus — jumlah panggilan /api/items harus naik
  // melebihi sync awal saja.
  cek('resync otomatis setelah SSE putus', catatan.items >= 2, `items=${catatan.items}`);

  const st = br.status();
  cek('status punya umurKoneksiDetik', typeof st.umurKoneksiDetik === 'number', JSON.stringify(st));

  console.log(`\n=== HASIL: ${lulus} PASS, ${gagal} FAIL ===`);
  server.close();
  process.exit(gagal === 0 ? 0 : 1);
})();
