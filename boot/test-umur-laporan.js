'use strict';
/**
 * TEST: kalimat umur laporan tidak boleh menyesatkan.
 *
 * Kasus nyata (CP, 2026-11-14): DB sumber mati, laporan beku 146 menit.
 * Pesan lama berbunyi "kasir baru saja jual, tunggu ±1 mnt lalu ketik ulang" —
 * menyesatkan, karena data TIDAK akan datang sampai sumbernya hidup.
 */

const { kalimatUmurLaporan, AMBANG_BASI_MNT } = require('./umur-laporan');

let lulus = 0, gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log('  ✅ ' + nama); }
  else { gagal++; console.log('  ❌ ' + nama + (detail ? '  -> ' + detail : '')); }
}

const KINI = Date.UTC(2026, 10, 14, 10, 0, 0); // 2026-11-14T10:00Z
const mntLalu = (m) => KINI - m * 60000;

console.log('=== 1. Data baru saja ===');
{
  const s = kalimatUmurLaporan(mntLalu(0), KINI);
  cek('mengandung "baru saja"', /baru saja/.test(s), s);
  cek('TIDAK memuat peringatan', !/TIDAK diperbarui/.test(s), s);
}

console.log('');
console.log('=== 2. 3 menit lalu (masih wajar) ===');
{
  const s = kalimatUmurLaporan(mntLalu(3), KINI);
  cek('mengandung "3 mnt lalu"', /3 mnt lalu/.test(s), s);
  cek('TIDAK memuat peringatan', !/TIDAK diperbarui/.test(s), s);
}

console.log('');
console.log('=== 3. 10 menit lalu (kasir baru jual) ===');
{
  const s = kalimatUmurLaporan(mntLalu(10), KINI);
  cek('menyebut kasir baru saja jual', /kasir baru saja jual/.test(s), s);
  cek('TIDAK memuat peringatan sumber mati', !/TIDAK diperbarui/.test(s), s);
}

console.log('');
console.log('=== 4. 146 menit lalu (kasus CP nyata) — HARUS jujur ===');
{
  const s = kalimatUmurLaporan(mntLalu(146), KINI);
  cek('memuat "TIDAK diperbarui"', /TIDAK diperbarui/.test(s), s);
  cek('menyebut lama "2 jam 26 mnt"', /2 jam 26 mnt/.test(s), s);
  cek('TIDAK menyuruh menunggu 1 menit', !/tunggu .1 mnt/.test(s), s);
  cek('menyebut server sumber iPos', /server sumber iPos/.test(s), s);
}

console.log('');
console.log('=== 5. Tepat di ambang ===');
{
  const bawah = kalimatUmurLaporan(mntLalu(AMBANG_BASI_MNT), KINI);
  cek(`${AMBANG_BASI_MNT} mnt belum peringatan`, !/TIDAK diperbarui/.test(bawah), bawah);
  const atas = kalimatUmurLaporan(mntLalu(AMBANG_BASI_MNT + 1), KINI);
  cek(`${AMBANG_BASI_MNT + 1} mnt sudah peringatan`, /TIDAK diperbarui/.test(atas), atas);
}

console.log('');
console.log('=== 6. Masukan tidak sah tidak melempar ===');
{
  for (const v of [null, undefined, 0, '', NaN, 'x', -5]) {
    let ok = true, s = '';
    try { s = kalimatUmurLaporan(v, KINI); } catch (e) { ok = false; }
    cek(`masukan ${JSON.stringify(v)} aman`, ok && s === '', 'dapat ' + JSON.stringify(s));
  }
}

console.log('');
console.log('=== 7. Tanpa sekarangMs memakai waktu nyata ===');
{
  const s = kalimatUmurLaporan(Date.now() - 1000);
  cek('tidak melempar & masuk akal', typeof s === 'string' && /baru saja|mnt lalu/.test(s), s);
}

console.log('');
console.log('══════════════════════════════════');
console.log(`LULUS ${lulus}, GAGAL ${gagal}`);
process.exit(gagal ? 1 : 0);
