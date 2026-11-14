'use strict';
/**
 * Uji NYATA jalur nota: menulis ke share SMB sungguhan yang dipakai produksi.
 *
 * Tujuan: membuktikan perbaikan (tulis atomik, bisaJadiShare, antrean) TIDAK
 * merusak jalur sukses lama di PC ini. Kalau share terjangkau, hasilnya harus
 * `fallback:false` dan file harus benar-benar ada di folder bulan.
 *
 * File uji diberi awalan yang jelas dan DIHAPUS di akhir. Tidak menyentuh
 * nota asli.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const {
  simpanDenganFallback,
  simpanKeAntrean,
  sapuAntrean,
  bisaJadiShare,
} = require('./nota-simpan.js');

const BULAN = ['januari', 'februari', 'maret', 'april', 'mei', 'juni', 'juli',
  'agustus', 'september', 'oktober', 'november', 'desember'];

function namaBulan(n, besar) {
  const b = BULAN[n - 1] || 'november';
  return besar ? b.toUpperCase() : b;
}

// Path share nyata (sama seperti CONFIG.notaTokoFolder di index.js).
const SHARE = {
  ELT: {
    base: '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN\\Nota Toko Nasional Kitchen',
    format: (bln, thn) => 'Nota bulan ' + namaBulan(bln, false) + ' ' + thn,
  },
  KEF: {
    base: '\\\\100.125.99.99\\E\\Nota Toko Perabot Mamaku Kefamenanu',
    format: (bln, thn) => namaBulan(bln, true) + ' ' + thn,
  },
};

const akar = fs.mkdtempSync(path.join(os.tmpdir(), 'notanyata-'));
const buffer = Buffer.from('UJI-NOTA-' + Date.now());

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + detail : '')); gagal++; }
}

const dibuat = [];
for (const kode of ['ELT', 'KEF']) {
  const cfg = SHARE[kode];
  const namaFolder = cfg.format(11, 2026);
  const folderShare = path.join(cfg.base, namaFolder);

  console.log('\n── ' + kode + ' ──');
  console.log('  folder : ' + folderShare);
  const layak = bisaJadiShare(folderShare, process.platform);
  cek(kode + ': path share sah di Windows', layak.ok === true, layak.alasan);

  if (!layak.ok) continue;

  const namaFile = 'UJI-HAPUS ' + kode + '-' + Date.now() + '.jpg';
  const hasil = simpanDenganFallback({
    folderShare,
    namaFile,
    buffer,
    folderFallback: path.join(akar, 'fb'),
  });

  cek(kode + ': tersimpan ke share (bukan fallback)', hasil.fallback === false,
    'fallback=' + hasil.fallback + ' alasan=' + hasil.alasanShare);

  if (hasil.ok && !hasil.fallback) {
    dibuat.push(hasil.path);
    cek(kode + ': file benar-benar ada', fs.existsSync(hasil.path), hasil.path);
    cek(kode + ': isi utuh', fs.readFileSync(hasil.path).equals(buffer));
    cek(kode + ': tidak ada .part tertinggal',
      !fs.existsSync(path.join(path.dirname(hasil.path), '.' + path.basename(hasil.path) + '.part')));
  }
}

// ── Antrean nyata: simpan ke antrean, lalu sapu ke share sungguhan
console.log('\n── antrean → share nyata ──');
const folderAntrean = path.join(akar, 'nota-gagal');
const namaAntre = 'UJI-HAPUS-ANTRE-' + Date.now() + '.jpg';
const tujuanNyata = path.join(SHARE.KEF.base, SHARE.KEF.format(11, 2026));
const rAntre = simpanKeAntrean(folderAntrean, namaAntre, buffer, 'uji', tujuanNyata);
cek('antrean menulis nota + catatan', rAntre.ok === true && fs.existsSync(rAntre.metaPath));

const rSapu = sapuAntrean({ folderAntrean });
cek('sapuan memindahkan ke share nyata', rSapu.dipindah === 1, JSON.stringify(rSapu));
const pathTujuan = path.join(tujuanNyata, namaAntre);
cek('nota antrean ada di share', fs.existsSync(pathTujuan), pathTujuan);
if (fs.existsSync(pathTujuan)) dibuat.push(pathTujuan);
cek('antrean bersih setelah sukses',
  fs.readdirSync(folderAntrean).length === 0, fs.readdirSync(folderAntrean).join(','));

// ── Bersihkan SEMUA file uji
console.log('\n── bersih-bersih ──');
let terhapus = 0;
for (const p of dibuat) {
  try { fs.unlinkSync(p); terhapus++; } catch (e) { console.error('  gagal hapus ' + p + ': ' + e.message); }
}
console.log('  file uji dihapus: ' + terhapus + '/' + dibuat.length);
cek('semua file uji terhapus', terhapus === dibuat.length);

fs.rmSync(akar, { recursive: true, force: true });

if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
console.log('\nOK jalur nota nyata: share tetap berfungsi, antrean benar-benar memindahkan');
