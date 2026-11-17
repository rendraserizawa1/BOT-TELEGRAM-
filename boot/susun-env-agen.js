'use strict';
/**
 * Menyusun ulang boot/push-agen.env untuk tiga toko.
 *
 * ATURAN: nilai rahasia HANYA ditulis, TIDAK PERNAH dicetak. Yang dicetak
 * hanya nama variabel dan panjang nilainya, supaya log aman dibagikan.
 *
 * Nilai PUSH_URL & PUSH_TOKEN yang SUDAH ADA dipertahankan apa adanya, jadi
 * menjalankan skrip ini tidak pernah memutus sambungan yang sedang bekerja.
 */
const fs = require('fs');
const path = require('path');

const BERKAS = path.join(__dirname, 'push-agen.env');

const IPOS_KEY = String(process.env.SET_IPOS_KEY || '');
const IPOS_NK_KEY = String(process.env.SET_IPOS_NK_KEY || '');
const IPOS_KEFA_KEY = String(process.env.SET_IPOS_KEFA_KEY || '');
const IPOS_URL = String(process.env.SET_IPOS_URL || '');
const IPOS_NK_URL = String(process.env.SET_IPOS_NK_URL || '');
const IPOS_KEFA_URL = String(process.env.SET_IPOS_KEFA_URL || '');
const PUSH_TOKO = String(process.env.SET_PUSH_TOKO || 'cp,nk,kefa');

function bacaLama() {
  const hasil = {};
  let isi = '';
  try { isi = fs.readFileSync(BERKAS, 'utf8'); } catch (_) { return hasil; }
  for (const baris of isi.split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) hasil[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return hasil;
}

const lama = bacaLama();
const pushUrl = lama.PUSH_URL || '';
const pushToken = lama.PUSH_TOKEN || '';
if (!pushUrl || !pushToken) {
  console.error('  GAGAL: PUSH_URL / PUSH_TOKEN lama tidak ditemukan - tidak menimpa apa pun');
  process.exit(1);
}

// Nilai yang wajib ada; kalau salah satu kosong, jangan tulis setengah jadi.
const wajib = {
  IPOS_URL, IPOS_KEY, IPOS_NK_URL, IPOS_NK_KEY,
  IPOS_KEFA_URL: IPOS_KEFA_URL || 'http://127.0.0.1:8080/ipos',
  IPOS_KEFA_KEY,
};
const kosong = Object.entries(wajib).filter(([k, v]) => !v).map(([k]) => k);
if (kosong.length) {
  console.error('  GAGAL: nilai kosong -> ' + kosong.join(', ') + ' (tidak menimpa apa pun)');
  process.exit(1);
}

const baris = [
  '# Konfigurasi agen dorong iPos (JANGAN di-commit; sudah ada di .gitignore).',
  '# Tiga toko didorong dari PC ini: KEFA lokal, CP & NK lewat tailnet.',
  '# Sumber hanya boleh loopback atau tailnet 100.64.0.0/10 (lihat urlSumberSah).',
  '',
  'PUSH_URL=' + pushUrl,
  'PUSH_TOKEN=' + pushToken,
  'PUSH_TOKO=' + PUSH_TOKO,
  '',
  '# KEFA - proxy lokal di PC ini',
  'IPOS_KEFA_URL=' + (IPOS_KEFA_URL || 'http://127.0.0.1:8080/ipos'),
  'IPOS_KEFA_KEY=' + IPOS_KEFA_KEY,
  '',
  '# CP - komputer admin Dimas (tailnet)',
  'IPOS_URL=' + IPOS_URL,
  'IPOS_KEY=' + IPOS_KEY,
  '',
  '# NK - mesin Nasional Kitchen (tailnet)',
  'IPOS_NK_URL=' + IPOS_NK_URL,
  'IPOS_NK_KEY=' + IPOS_NK_KEY,
  '',
];

fs.writeFileSync(BERKAS, baris.join('\n'), 'utf8');

console.log('  ditulis: ' + BERKAS);
const cek = bacaLama();
for (const k of ['PUSH_URL', 'PUSH_TOKEN', 'PUSH_TOKO', 'IPOS_URL', 'IPOS_KEY',
  'IPOS_NK_URL', 'IPOS_NK_KEY', 'IPOS_KEFA_URL', 'IPOS_KEFA_KEY']) {
  const v = cek[k] || '';
  const tampil = /URL|TOKO/.test(k) ? v : ('[rahasia panjang=' + v.length + ']');
  console.log('    ' + k.padEnd(15) + ' = ' + tampil);
}
