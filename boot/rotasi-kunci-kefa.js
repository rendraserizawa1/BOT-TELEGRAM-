'use strict';
/**
 * ROTASI KUNCI PROXY iPos LOKAL (KEFA)
 *
 * MENGAPA ALAT INI ADA
 * --------------------
 * Kunci iPos bocor dua kali pada 20/11/2026: tercetak di keluaran PowerShell
 * saat investigasi insiden. Kunci yang sudah bocor harus dianggap tidak sah
 * lagi, berapa pun panjangnya.
 *
 * YANG DIROTASI HANYA KEFA
 * ------------------------
 * Hanya proxy LOKAL di PC ini (C:\Users\rdpadmin\ipos-api, port 8080) yang
 * bisa dirotasi dari sini, karena kuncinya ada di berkas lokal. Kunci CP dan
 * NK hidup di komputer lain (ADMIN_DIMAS, BARCODE-NN) dan TIDAK disentuh —
 * merotasi keduanya dari sini akan langsung memutus laporan toko.
 *
 * YANG DILAKUKAN
 * --------------
 *   1. Membuat kunci acak baru (48 byte -> 96 karakter hex, setara kunci lama).
 *   2. Mencadangkan setiap berkas sebelum diubah.
 *   3. Menulis kunci baru ke tiga tempat:
 *        - C:\Users\rdpadmin\ipos-api\.env   (API_KEY      -> dibaca proxy)
 *        - C:\BOT-TELEGRAM-\.env             (IPOS_KEFA_KEY -> dibaca bot)
 *        - C:\BOT-TELEGRAM-\boot\push-agen.env (IPOS_KEFA_KEY -> dibaca agen)
 *   4. Membaca ulang ketiga berkas dan MEMBUKTIKAN ketiganya berisi kunci
 *      yang sama panjangnya dan cocok satu sama lain.
 *
 * YANG TIDAK DILAKUKAN (sengaja)
 * ------------------------------
 *   - Tidak mencetak kunci, tidak menulisnya ke log, tidak ke git.
 *   - Tidak me-restart proxy atau agen. Restart dijalankan terpisah supaya
 *     urutannya terkendali dan bisa diperiksa satu per satu.
 *   - Tidak menyentuh Railway. IPOS_KEFA_KEY di Railway harus diperbarui
 *     lewat `railway variables`, dan itu butuh redeploy.
 *
 * URUTAN PEMAKAIAN (penting — jangan dibalik)
 * -------------------------------------------
 *   node boot/rotasi-kunci-kefa.js --terapkan
 *   lalu: restart proxy  -> restart agen -> perbarui Railway -> verifikasi
 *   Kalau dibalik, akan ada jendela waktu agen mengirim kunci lama ke proxy
 *   yang sudah memakai kunci baru (401 sesaat, pulih sendiri).
 *
 * Jalankan: node boot/rotasi-kunci-kefa.js            (hanya memeriksa)
 *           node boot/rotasi-kunci-kefa.js --terapkan (benar-benar mengubah)
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TERAPKAN = process.argv.includes('--terapkan');

const AKAR_BOT = path.join(__dirname, '..');
const BERKAS = [
  { label: 'proxy  ', path: 'C:\\Users\\rdpadmin\\ipos-api\\.env', nama: 'API_KEY' },
  { label: 'bot    ', path: path.join(AKAR_BOT, '.env'), nama: 'IPOS_KEFA_KEY' },
  { label: 'agen   ', path: path.join(AKAR_BOT, 'boot', 'push-agen.env'), nama: 'IPOS_KEFA_KEY' },
];

function bacaNilai(berkas, nama) {
  if (!fs.existsSync(berkas)) return { ada: false };
  const isi = fs.readFileSync(berkas, 'utf8');
  for (const baris of isi.split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m && m[1] === nama) return { ada: true, nilai: m[2].trim(), isi };
  }
  return { ada: true, nilai: null, isi };
}

// Ganti HANYA baris variabel yang dituju; sisanya disentuh apa adanya.
// Baris komentar, urutan, dan variabel lain harus tetap utuh — berkas ini
// dipakai produksi dan tidak boleh "dirapikan" tanpa diminta.
function gantiNilai(isi, nama, nilaiBaru) {
  const baris = isi.split(/\r?\n/);
  let diganti = 0;
  for (let i = 0; i < baris.length; i++) {
    const m = baris[i].match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (m && m[1] === nama) {
      baris[i] = nama + '=' + nilaiBaru;
      diganti++;
    }
  }
  return { isi: baris.join('\r\n'), diganti };
}

console.log('=== ROTASI KUNCI PROXY iPos LOKAL (KEFA) ===');
console.log('    mode: ' + (TERAPKAN ? 'TERAPKAN (berkas akan diubah)' : 'PERIKSA SAJA (tidak ada yang diubah)'));
console.log('    kunci TIDAK akan dicetak di mana pun.\n');

// ── 1. Keadaan sekarang ──────────────────────────────────────
console.log('[1] Keadaan sebelum rotasi');
const sebelum = [];
for (const b of BERKAS) {
  const r = bacaNilai(b.path, b.nama);
  if (!r.ada) { console.log('    ' + b.label + '  ' + b.path + '  -> BERKAS TIDAK ADA'); sebelum.push(null); continue; }
  if (r.nilai == null) { console.log('    ' + b.label + '  -> variabel ' + b.nama + ' TIDAK ADA'); sebelum.push(null); continue; }
  console.log('    ' + b.label + '  ' + b.nama + '  panjang=' + r.nilai.length);
  sebelum.push(r.nilai);
}
if (sebelum.some((s) => s == null)) {
  console.log('\n  BERHENTI: ada berkas/variabel yang tidak ditemukan.');
  process.exit(1);
}
const semuaSama = sebelum.every((s) => s === sebelum[0]);
console.log('    ketiga nilai cocok satu sama lain: ' + (semuaSama ? 'YA' : 'TIDAK (sudah tidak sinkron sebelum rotasi)'));

// ── 2. Buat kunci baru ───────────────────────────────────────
// 48 byte acak -> 96 karakter hex, panjang sama dengan kunci lama sehingga
// tidak ada kode yang mengasumsikan panjang tertentu yang tiba-tiba rusak.
const kunciBaru = crypto.randomBytes(48).toString('hex');
console.log('\n[2] Kunci baru dibuat: ' + kunciBaru.length + ' karakter hex (48 byte acak dari crypto)');
if (kunciBaru === sebelum[0]) {
  console.log('  BERHENTI: kunci baru identik dengan lama (mustahil, tapi diperiksa).');
  process.exit(1);
}

if (!TERAPKAN) {
  console.log('\n[3] PERIKSA SAJA — tidak ada berkas diubah.');
  console.log('    Jalankan ulang dengan --terapkan untuk benar-benar merotasi.');
  console.log('\n    URUTAN SETELAH ITU (jangan dibalik):');
  console.log('      1. restart proxy iPos lokal  (port 8080)');
  console.log('      2. restart agen pengirim     (jaga-push -> push-agen)');
  console.log('      3. perbarui IPOS_KEFA_KEY di Railway, lalu redeploy');
  console.log('      4. verifikasi /health ketiga toko');
  process.exit(0);
}

// ── 3. Cadangkan, lalu tulis ─────────────────────────────────
console.log('\n[3] Mencadangkan dan menulis');
const cap = Date.now();
const cadangan = [];
for (let i = 0; i < BERKAS.length; i++) {
  const b = BERKAS[i];
  const asli = fs.readFileSync(b.path);
  const bak = b.path + '.bak-rotasi-' + cap;
  fs.writeFileSync(bak, asli);
  cadangan.push(bak);
  console.log('    dicadangkan: ' + bak);
}
console.log('');

let gagalTulis = 0;
for (const b of BERKAS) {
  try {
    const r = bacaNilai(b.path, b.nama);
    const hasil = gantiNilai(r.isi, b.nama, kunciBaru);
    if (hasil.diganti !== 1) {
      console.log('    GAGAL  ' + b.label + '  baris ' + b.nama + ' ditemukan ' + hasil.diganti + 'x (harus 1)');
      gagalTulis++;
      continue;
    }
    // Tulis atomik: tulis ke .tmp lalu rename, supaya berkas tidak pernah
    // setengah jadi kalau PC mati di tengah penulisan (PC ini crash 5x/hari).
    const tmp = b.path + '.tmp-rotasi';
    fs.writeFileSync(tmp, hasil.isi, 'utf8');
    fs.renameSync(tmp, b.path);
    console.log('    OK     ' + b.label + '  ' + b.nama + ' ditulis');
  } catch (e) {
    console.log('    GAGAL  ' + b.label + '  ' + (e && e.message ? e.message : String(e)));
    gagalTulis++;
  }
}

if (gagalTulis > 0) {
  console.log('\n  ADA YANG GAGAL. Mengembalikan semua berkas dari cadangan...');
  for (let i = 0; i < BERKAS.length; i++) {
    try { fs.copyFileSync(cadangan[i], BERKAS[i].path); console.log('    dipulihkan: ' + BERKAS[i].path); }
    catch (e) { console.log('    GAGAL memulihkan ' + BERKAS[i].path + ': ' + e.message); }
  }
  process.exit(1);
}

// ── 4. Buktikan ──────────────────────────────────────────────
console.log('\n[4] Verifikasi (membaca ulang dari disk)');
const sesudah = [];
for (const b of BERKAS) {
  const r = bacaNilai(b.path, b.nama);
  const ok = r.nilai === kunciBaru;
  console.log('    ' + (ok ? 'OK   ' : 'GAGAL') + '  ' + b.label + '  panjang=' + (r.nilai ? r.nilai.length : 0) + '  cocok=' + ok);
  sesudah.push(r.nilai);
}
const semuaCocok = sesudah.every((s) => s === kunciBaru);
const berubah = sesudah.every((s, i) => s !== sebelum[i]);

console.log('\n' + '='.repeat(60));
console.log('  ketiga berkas berisi kunci BARU : ' + (semuaCocok ? 'YA' : 'TIDAK'));
console.log('  kunci benar-benar berubah       : ' + (berubah ? 'YA' : 'TIDAK'));
console.log('='.repeat(60));

if (!semuaCocok) {
  console.log('\n  GAGAL: berkas tidak sinkron. Memulihkan dari cadangan...');
  for (let i = 0; i < BERKAS.length; i++) {
    try { fs.copyFileSync(cadangan[i], BERKAS[i].path); } catch (_) {}
  }
  console.log('  Dipulihkan. Periksa manual.');
  process.exit(1);
}

console.log('\nBERHASIL. Langkah berikutnya HARUS berurutan:');
console.log('  1. restart proxy iPos lokal (port 8080) — proxy masih memakai kunci LAMA');
console.log('     di memori sampai di-restart, jadi KEFA akan menolak sampai itu terjadi');
console.log('  2. restart agen: Stop-Process push-agen, lalu Start-ScheduledTask BCODE-JAGA-PUSH');
console.log('  3. perbarui IPOS_KEFA_KEY di Railway (railway variables), lalu redeploy');
console.log('  4. verifikasi: /health ketiga toko online dan laporan KEFA masih terisi');
console.log('\nCadangan (kunci lama) ada di berkas *.bak-rotasi-' + cap);
console.log('Setelah semua terverifikasi, hapus cadangan itu agar kunci lama tidak tersimpan.');
