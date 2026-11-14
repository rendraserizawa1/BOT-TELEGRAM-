'use strict';
/**
 * Tes: simpan nota — fallback lokal, tulis atomik, dan antrean kirim-ulang.
 *
 * TEMUAN REVIEW yang diuji di sini:
 *
 *  C2 (Critical) Di Linux, folder share UNC (\\100.125.99.99\E\...) BUKAN
 *     path absolut. `path.posix.join` mempertahankan backslash karena `\`
 *     adalah karakter nama file yang sah di POSIX. Akibatnya
 *     mkdirSync berhasil membuat folder bernama
 *     `\\100.125.99.99\E\TOKO NASIONAL KITCHEN\...` di dalam /app, uji tulis
 *     berhasil, writeFileSync berhasil, dan fungsi melaporkan
 *     {ok:true, fallback:false}. Pengguna melihat "NOTA TERSIMPAN!", admin
 *     TIDAK diberi tahu, dan file hilang saat redeploy.
 *     -> Tujuan share yang mustahil di platform ini harus langsung
 *        dianggap gagal, tanpa mencoba menulis.
 *
 *  I4 (Important) `writeFileSync` tidak atomik. Bila sesi SMB putus di
 *     tengah tulis, file 0 byte / terpotong tertinggal di folder share
 *     dengan nama nota yang benar, sehingga tidak ada yang sadar.
 *     -> Tulis ke `.part` lalu rename; target tidak pernah tersentuh
 *        sampai rename berhasil.
 *
 *  I3 (Important) Pesan ke pengguna menjanjikan "akan disalin ke sana saat
 *     tersedia", tetapi tidak ada mekanisme apa pun yang menyalin.
 *     -> Harus ada antrean yang benar-benar disapu dan dikirim ulang.
 *
 *  M7 (Minor) Nama uji tulis `.tulis-uji` tetap; dua proses (PC + Railway)
 *     bisa saling menghapus dan membuat nota sah dialihkan ke fallback.
 *     -> Nama uji harus unik per proses.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  simpanKeFolder,
  simpanDenganFallback,
  bisaJadiShare,
  tulisAtomik,
  simpanKeAntrean,
  sapuAntrean,
  namaAman,
} = require('./nota-simpan.js');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + detail : '')); gagal++; }
}

const akar = fs.mkdtempSync(path.join(os.tmpdir(), 'nota2-'));
const buf = Buffer.from('GAMBAR-NOTA-PALSU');

// ══ C2: tujuan share mustahil di platform ini harus ditolak SEBELUM menulis
const UNC = '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN\\Nota Toko Nasional Kitchen';

cek('bisaJadiShare: UNC di linux ditolak', bisaJadiShare(UNC, 'linux').ok === false,
  JSON.stringify(bisaJadiShare(UNC, 'linux')));
cek('bisaJadiShare: alasan menyebut UNC / platform',
  /UNC|platform/i.test(bisaJadiShare(UNC, 'linux').alasan || ''),
  bisaJadiShare(UNC, 'linux').alasan);
cek('bisaJadiShare: UNC di win32 diterima', bisaJadiShare(UNC, 'win32').ok === true,
  JSON.stringify(bisaJadiShare(UNC, 'win32')));
cek('bisaJadiShare: path POSIX absolut diterima', bisaJadiShare('/mnt/nota', 'linux').ok === true);
cek('bisaJadiShare: path relatif ditolak', bisaJadiShare('nota', 'linux').ok === false);

// Inti C2: pada platform linux, UNC TIDAK boleh menghasilkan ok:true
const fbDir = path.join(akar, 'fallback');
const rC2 = simpanDenganFallback({
  folderShare: UNC,
  namaFile: 'CP 001-141126.jpg',
  buffer: buf,
  folderFallback: fbDir,
  platform: 'linux',
});
cek('C2: UNC di linux -> fallback:true', rC2.fallback === true, JSON.stringify(rC2));
cek('C2: nota tetap tersimpan di fallback', rC2.ok === true && fs.existsSync(rC2.path), rC2.path);
cek('C2: alasanShare diisi', !!rC2.alasanShare, rC2.alasanShare);
cek('C2: TIDAK ada folder UNC tercipta di cwd',
  !fs.existsSync(path.join(process.cwd(), '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN\\Nota Toko Nasional Kitchen')));

// ══ Jalur sukses lama harus tetap sama (share lokal yang benar-benar ada)
const shareAsli = path.join(akar, 'share');
const rOk = simpanDenganFallback({
  folderShare: shareAsli,
  namaFile: 'CP 001-141126.jpg',
  buffer: buf,
  folderFallback: fbDir,
  platform: process.platform,
});
cek('jalur sukses: fallback:false', rOk.fallback === false, JSON.stringify(rOk));
cek('jalur sukses: nama file persis', path.basename(rOk.path) === 'CP 001-141126.jpg', rOk.path);
cek('jalur sukses: isi file utuh', fs.readFileSync(rOk.path).equals(buf));
cek('jalur sukses: tidak ada sisa .part',
  fs.readdirSync(shareAsli).every((f) => !f.endsWith('.part')), fs.readdirSync(shareAsli).join(','));

// ══ I4: tulis atomik — kegagalan TIDAK boleh meninggalkan target rusak
const atomDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atom-'));
const target = path.join(atomDir, 'NOTA.jpg');
fs.writeFileSync(target, 'ISI-LAMA-YANG-SAH');

const fsPalsu = Object.assign({}, fs, {
  renameSync() { throw new Error('sesi SMB putus saat rename'); },
});
const rAtom = tulisAtomik(atomDir, 'NOTA.jpg', Buffer.from('ISI-BARU'), { fs: fsPalsu });
cek('I4: rename gagal -> ok:false', rAtom.ok === false, JSON.stringify(rAtom));
cek('I4: file lama yang sah TIDAK rusak', fs.readFileSync(target, 'utf8') === 'ISI-LAMA-YANG-SAH');
cek('I4: tidak ada sisa .part', fs.readdirSync(atomDir).every((f) => !f.endsWith('.part')),
  fs.readdirSync(atomDir).join(','));

const rAtomOk = tulisAtomik(atomDir, 'NOTA.jpg', Buffer.from('ISI-BARU'));
cek('I4: tulis normal berhasil', rAtomOk.ok === true);
cek('I4: isi terganti utuh', fs.readFileSync(target, 'utf8') === 'ISI-BARU');

// ══ M7: nama uji tulis unik per proses -> tidak saling hapus
const duaDir = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-'));
simpanKeFolder(duaDir, 'a.jpg', buf);
const sisaUji = fs.readdirSync(duaDir).filter((f) => f.startsWith('.tulis-uji'));
cek('M7: tidak ada sisa file uji', sisaUji.length === 0, sisaUji.join(','));

// ══ I3: antrean benar-benar dikirim ulang
const antreDir = path.join(akar, 'nota-gagal');
const tujuanBaru = path.join(akar, 'share-baru');
const rAntre = simpanKeAntrean(antreDir, 'KEF 000123-011126.jpg', buf, 'share mati');
cek('I3: antrean menulis file', rAntre.ok === true && fs.existsSync(rAntre.path), JSON.stringify(rAntre));
cek('I3: antrean menulis catatan alasan', !!rAntre.metaPath && fs.existsSync(rAntre.metaPath));

const rSapu1 = sapuAntrean({ folderAntrean: antreDir, folderShare: tujuanBaru, platform: process.platform });
cek('I3: sapuan memindahkan 1 nota', rSapu1.dipindah === 1, JSON.stringify(rSapu1));
cek('I3: nota ada di tujuan', fs.existsSync(path.join(tujuanBaru, 'KEF 000123-011126.jpg')));
cek('I3: antrean jadi kosong', fs.readdirSync(antreDir).filter((f) => !f.endsWith('.json')).length === 0,
  fs.readdirSync(antreDir).join(','));

// Sapuan saat share masih mati -> nota TETAP di antrean, jangan hilang
simpanKeAntrean(antreDir, 'ELT 000162-120926.jpg', buf, 'share mati');
const rSapu2 = sapuAntrean({ folderAntrean: antreDir, folderShare: UNC, platform: 'linux' });
cek('I3: share mati -> tidak ada yang dipindah', rSapu2.dipindah === 0, JSON.stringify(rSapu2));
cek('I3: nota tetap aman di antrean', rSapu2.tersisa >= 1, JSON.stringify(rSapu2));

// ══ Regresi: namaAman tetap ramah nama nota Indonesia
cek('namaAman: nama nota utuh', namaAman('CP 001-141126.jpg') === 'CP 001-141126.jpg');
cek('namaAman: traversal dibuang', namaAman('../../etc/passwd') === 'passwd', namaAman('../../etc/passwd'));

fs.rmSync(akar, { recursive: true, force: true });
fs.rmSync(atomDir, { recursive: true, force: true });
fs.rmSync(duaDir, { recursive: true, force: true });

if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
console.log('\nOK nota-simpan: C2 + I4 + I3 + M7');
