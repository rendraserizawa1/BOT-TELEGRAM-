'use strict';
/**
 * Tes: deteksi volume tidak persisten.
 *
 * Kenapa: di Railway, bila volume /data lupa dipasang, bot tetap start dan
 * menulis ke disk container. Semua data hilang saat redeploy TANPA satu pun
 * error. Harapan wajar: bot berteriak keras.
 *
 * Kontrak: periksaVolume(dir) -> { ok: boolean, alasan: string }
 *  - EXPECT_VOLUME != '1'          -> ok:true  (mode lokal, PC tidak berubah)
 *  - EXPECT_VOLUME == '1' + penanda -> ok:true
 *  - EXPECT_VOLUME == '1' tanpa     -> ok:false, alasan menyebut penanda
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { periksaVolume } = require('./volume-check.js');

let gagal = 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'volcek-'));

// 1) Mode lokal: tidak mengharapkan volume
delete process.env.EXPECT_VOLUME;
let a = periksaVolume(tmp);
if (!a.ok) { console.error('GAGAL 1: mode lokal harus ok, dapat: ' + a.alasan); gagal++; }

// 2) Mengharapkan volume tetapi penanda tidak ada -> HARUS gagal
process.env.EXPECT_VOLUME = '1';
let b = periksaVolume(tmp);
if (b.ok) { console.error('GAGAL 2: EXPECT_VOLUME=1 tanpa penanda harus ok:false'); gagal++; }
else if (!/volume-ok/.test(b.alasan)) { console.error('GAGAL 2b: alasan harus menyebut penanda, dapat: ' + b.alasan); gagal++; }

// 3) Mengharapkan volume dan penanda ada -> ok
fs.writeFileSync(path.join(tmp, '.volume-ok'), '1');
let c = periksaVolume(tmp);
if (!c.ok) { console.error('GAGAL 3: dengan penanda harus ok, dapat: ' + c.alasan); gagal++; }

// 4) Folder tidak ada sama sekali -> harus gagal (bukan crash)
process.env.EXPECT_VOLUME = '1';
let d = periksaVolume(path.join(tmp, 'tidak-ada'));
if (d.ok) { console.error('GAGAL 4: folder tidak ada harus ok:false'); gagal++; }

fs.rmSync(tmp, { recursive: true, force: true });
delete process.env.EXPECT_VOLUME;

if (gagal) process.exit(1);
console.log('OK volume-check 4/4');
