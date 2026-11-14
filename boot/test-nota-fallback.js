'use strict';
/**
 * Tes: simpan nota harus punya fallback lokal bila share SMB gagal.
 *
 * Kenapa: kode lama menulis ke \\100.125.99.99\... dan komentarnya menegaskan
 * "TANPA fallback". Dari Railway (container Linux) path UNC tidak ada, jadi
 * nota pengguna akan hilang tanpa jejak. Harapan wajar: nota tetap tersimpan
 * di penyimpanan bot dan admin diberi tahu.
 *
 * Kontrak (nota-simpan.js):
 *   simpanKeFolder(tujuan, namaFile, buffer) -> {ok, path} | {ok:false, error}
 *   simpanDenganFallback({folderShare, namaFile, buffer, folderFallback})
 *       -> {ok, path, fallback:boolean, alasanShare:string|null}
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { simpanKeFolder, simpanDenganFallback } = require('./nota-simpan.js');

let gagal = 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nota-'));
const buf = Buffer.from('ISI-NOTA-UJI');

// 1) Folder normal: tersimpan, fallback=false
const share = path.join(tmp, 'share', 'Nota bulan November 2026');
let a = simpanDenganFallback({ folderShare: share, namaFile: 'CP 001-141126.jpg', buffer: buf, folderFallback: path.join(tmp, 'fb') });
if (!a.ok || a.fallback !== false) { console.error('GAGAL 1: harus ok tanpa fallback, dapat ' + JSON.stringify(a)); gagal++; }
else if (!fs.existsSync(a.path)) { console.error('GAGAL 1b: file tidak ada di ' + a.path); gagal++; }
else if (fs.readFileSync(a.path).toString() !== 'ISI-NOTA-UJI') { console.error('GAGAL 1c: isi file salah'); gagal++; }

// 2) Share TIDAK BISA DITULIS (path mustahil di Windows & Linux) -> fallback
const mustahil = process.platform === 'win32'
  ? 'Q:\\tidak-ada\\Nota'
  : '/proc/tidak-bisa-ditulis/Nota';
let b = simpanDenganFallback({ folderShare: mustahil, namaFile: 'CP 002-141126.jpg', buffer: buf, folderFallback: path.join(tmp, 'fb') });
if (!b.ok) { console.error('GAGAL 2: harus tetap ok lewat fallback, dapat ' + JSON.stringify(b)); gagal++; }
else if (b.fallback !== true) { console.error('GAGAL 2b: fallback harus true, dapat ' + b.fallback); gagal++; }
else if (!b.alasanShare) { console.error('GAGAL 2c: alasanShare harus diisi'); gagal++; }
else if (!fs.existsSync(b.path)) { console.error('GAGAL 2d: file fallback tidak ada di ' + b.path); gagal++; }
else if (fs.readFileSync(b.path).toString() !== 'ISI-NOTA-UJI') { console.error('GAGAL 2e: isi file fallback salah'); gagal++; }

// 3) simpanKeFolder langsung: lapor gagal, tidak melempar
let c = simpanKeFolder(mustahil, 'x.jpg', buf);
if (c.ok) { console.error('GAGAL 3: folder mustahil harus ok:false'); gagal++; }
else if (!c.error) { console.error('GAGAL 3b: harus ada pesan error'); gagal++; }

// 4) Nama file berbahaya tidak boleh keluar folder fallback
let d = simpanDenganFallback({ folderShare: mustahil, namaFile: '../../keluar.jpg', buffer: buf, folderFallback: path.join(tmp, 'fb') });
if (!d.ok) { console.error('GAGAL 4: harus ok, dapat ' + JSON.stringify(d)); gagal++; }
else {
  const akar = path.resolve(path.join(tmp, 'fb'));
  if (!path.resolve(d.path).startsWith(akar + path.sep)) {
    console.error('GAGAL 4b: path keluar dari folder fallback: ' + d.path); gagal++;
  }
}

fs.rmSync(tmp, { recursive: true, force: true });
if (gagal) process.exit(1);
console.log('OK nota fallback 4/4');
