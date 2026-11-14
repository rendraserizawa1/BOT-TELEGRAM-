// Uji kesetaraan: hasil parse lewat worker thread harus IDENTIK dengan
// hasil parse langsung (jalur lama), untuk semua toko.
'use strict';
const path = require('path');
const fs = require('fs');
const { Worker } = require('worker_threads');
const { parseExcelFile } = require('C:/BOT-TELEGRAM-/excel-parse');

const ROOT = 'C:/BOT-TELEGRAM-';
const TOKO = ['nk', 'tdm', 'oesapa', 'kefa', 'cp'];

function runWorker(filePath, tokoKode) {
  return new Promise((resolve, reject) => {
    const w = new Worker(path.join(ROOT, 'excel-worker.js'), {
      workerData: { filePath, tokoKode },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    w.once('message', (m) => resolve(m));
    w.once('error', reject);
  });
}

(async () => {
  let semuaSama = true;
  for (const tk of TOKO) {
    const filePath = path.join(ROOT, 'harga_toko', tk + '.xlsx');
    if (!fs.existsSync(filePath)) { console.log(`SKIP ${tk} (tidak ada)`); continue; }

    let t = Date.now();
    const direct = parseExcelFile(filePath, tk);
    const tDirect = Date.now() - t;

    t = Date.now();
    const viaWorker = await runWorker(filePath, tk);
    const tWorker = Date.now() - t;

    const a = JSON.stringify(direct.items);
    const b = JSON.stringify(viaWorker.items);
    const sama = a === b && direct.ok === viaWorker.ok;
    if (!sama) semuaSama = false;
    console.log(`${sama ? 'SAMA ' : 'BEDA '} ${tk}: items=${direct.items.length}/${viaWorker.items.length} ` +
      `direct=${tDirect}ms worker=${tWorker}ms ok=${direct.ok}/${viaWorker.ok}`);
  }
  console.log(semuaSama ? '\nHASIL: semua toko IDENTIK' : '\nHASIL: ADA PERBEDAAN');
  process.exit(semuaSama ? 0 : 1);
})();
