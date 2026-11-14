// Bukti bahwa parsing Excel tidak lagi memblokir event loop.
// Mengukur jeda timer 50ms selama parse berjalan:
//  - jalur lama (sinkron)  -> jeda melonjak ribuan ms (event loop macet)
//  - jalur worker          -> jeda tetap puluhan ms (event loop hidup)
'use strict';
const path = require('path');
const { Worker } = require('worker_threads');
const { parseExcelFile } = require('C:/BOT-TELEGRAM-/excel-parse');

const ROOT = 'C:/BOT-TELEGRAM-';
const FILE = path.join(ROOT, 'harga_toko', 'cp.xlsx'); // file terberat (5,2 dtk sinkron)

function ukurJeda(selamaMs) {
  return new Promise((resolve) => {
    const jeda = [];
    let last = Date.now();
    const t0 = Date.now();
    const iv = setInterval(() => {
      const now = Date.now();
      jeda.push(now - last);
      last = now;
      if (now - t0 >= selamaMs) {
        clearInterval(iv);
        jeda.sort((a, b) => b - a);
        resolve({ max: jeda[0], p50: jeda[Math.floor(jeda.length / 2)], n: jeda.length });
      }
    }, 50);
  });
}

(async () => {
  // 1) Jalur lama: parse sinkron di thread utama
  let ukur = ukurJeda(7000);
  const t1 = Date.now();
  parseExcelFile(FILE, 'cp');
  const d1 = Date.now() - t1;
  const r1 = await ukur;
  console.log(`SINKRON : parse ${d1}ms | jeda timer max=${r1.max}ms p50=${r1.p50}ms -> ${r1.max > 1000 ? 'EVENT LOOP MACET' : 'event loop hidup'}`);

  // 2) Jalur baru: parse di worker thread
  ukur = ukurJeda(7000);
  const t2 = Date.now();
  const hasil = await new Promise((resolve, reject) => {
    const w = new Worker(path.join(ROOT, 'excel-worker.js'), {
      workerData: { filePath: FILE, tokoKode: 'cp' },
      resourceLimits: { maxOldGenerationSizeMb: 256 },
    });
    w.once('message', resolve);
    w.once('error', reject);
  });
  const d2 = Date.now() - t2;
  const r2 = await ukur;
  console.log(`WORKER  : parse ${d2}ms | jeda timer max=${r2.max}ms p50=${r2.p50}ms -> ${r2.max > 1000 ? 'EVENT LOOP MACET' : 'event loop hidup'}`);
  console.log(`items=${hasil.items.length}`);

  const lulus = r2.max < 1000 && r1.max > 1000;
  console.log(lulus ? '\nLULUS: worker membebaskan event loop' : '\nGAGAL: tidak terbukti');
  process.exit(lulus ? 0 : 1);
})();
