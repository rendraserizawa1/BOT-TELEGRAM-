// excel-worker.js
// Worker thread: menjalankan parsing Excel (sinkron & berat) DI LUAR event
// loop utama, sehingga poller Telegram tidak pernah macet saat parse.
'use strict';
const { parentPort, workerData } = require('worker_threads');
const { parseExcelFile } = require('./excel-parse');

try {
  const hasil = parseExcelFile(workerData.filePath, workerData.tokoKode);
  parentPort.postMessage(hasil);
} catch (e) {
  parentPort.postMessage({ ok: false, items: [], error: e && e.message ? e.message : String(e), messages: [] });
}
