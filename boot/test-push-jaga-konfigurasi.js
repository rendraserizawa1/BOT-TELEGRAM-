'use strict';
/**
 * UJI PENJAGA KONFIGURASI AGEN.
 *
 * Tiga kesalahan senyap yang pernah/mudah terjadi, semuanya TIDAK menghasilkan
 * error apa pun dan membuat /health tampak sehat:
 *
 *  1. Dua toko menunjuk alamat yang sama -> katalog satu toko dikirim sebagai
 *     toko lain. Ini BENAR TERJADI: IPOS_URL kosong membuat `cp` memakai
 *     default loopback yang sama dengan `kefa`, sehingga 4.708 item KEFA
 *     tercatat sebagai katalog CP.
 *  2. Tunnel publik dipakai sebagai sumber -> agen menarik lewat internet
 *     publik padahal sumbernya ada di jaringan sendiri (dan tunnel itulah yang
 *     dulu mati berulang kali).
 *  3. Agen dijalankan tanpa wrapper -> dulu push-agen.env tidak terbaca sama
 *     sekali. Sekarang agen membacanya sendiri.
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

let lulus = 0, gagal = 0;
const uji = (nama, fn) => {
  try { fn(); lulus++; console.log('  OK    ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
};

const ROOT = path.join(__dirname, '..');
const AGEN = path.join(__dirname, 'push-agen.js');

/** Jalankan agen dengan env tertentu; kembalikan keluaran gabungan. */
function jalankan(env, tungguMs) {
  const hasil = spawnSync(process.execPath, [AGEN], {
    cwd: ROOT,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: tungguMs || 12000,
    windowsHide: true,
  });
  return { kode: hasil.status, out: String(hasil.stdout || '') + String(hasil.stderr || '') };
}

console.log('=== uji penjaga konfigurasi agen ===');

// ── 1. Dua toko satu alamat -> harus MENOLAK jalan ──────────────────────
uji('cp & kefa ke alamat sama -> berhenti dengan pesan jelas', () => {
  const r = jalankan({
    PUSH_URL: 'http://127.0.0.1:9',
    PUSH_TOKEN: 'token-uji',
    PUSH_TOKO: 'cp,kefa',
    IPOS_URL: 'http://127.0.0.1:8080/ipos',
    IPOS_KEY: 'kunci-palsu-cp',
    IPOS_KEFA_URL: 'http://127.0.0.1:8080/ipos',
    IPOS_KEFA_KEY: 'kunci-palsu-kefa',
    IPOS_NK_URL: '',
    IPOS_NK_KEY: '',
    PUSH_LOCK_FILE: path.join(os.tmpdir(), 'uji-jaga-ganda.lock'),
    PUSH_STATUS_FILE: path.join(os.tmpdir(), 'uji-jaga-ganda.json'),
  });
  assert.notStrictEqual(r.kode, 0, 'harus keluar dengan kode bukan 0');
  assert.ok(/alamat yang SAMA/i.test(r.out),
    'pesan harus menyebut alamat sama. dapat: ' + r.out.slice(-400));
});

// ── 2. Tunnel publik ditolak sebagai sumber ────────────────────────────
uji('sumber tunnel publik ditolak (tidak ada toko yang didorong)', () => {
  const r = jalankan({
    PUSH_URL: 'http://127.0.0.1:9',
    PUSH_TOKEN: 'token-uji',
    PUSH_TOKO: 'cp',
    IPOS_URL: 'https://contoh-acak.trycloudflare.com/ipos',
    IPOS_KEY: 'kunci-palsu',
    IPOS_NK_URL: '',
    IPOS_NK_KEY: '',
    IPOS_KEFA_URL: '',
    IPOS_KEFA_KEY: '',
    PUSH_LOCK_FILE: path.join(os.tmpdir(), 'uji-jaga-tunnel.lock'),
    PUSH_STATUS_FILE: path.join(os.tmpdir(), 'uji-jaga-tunnel.json'),
  });
  assert.notStrictEqual(r.kode, 0, 'harus keluar karena tidak ada sumber sah');
  assert.ok(/tidak ada toko/i.test(r.out),
    'pesan harus menyebut tidak ada toko. dapat: ' + r.out.slice(-400));
});

// ── 3. Agen membaca push-agen.env SENDIRI (tanpa wrapper) ──────────────
uji('agen membaca boot/push-agen.env sendiri (tanpa wrapper PowerShell)', () => {
  const isi = fs.readFileSync(AGEN, 'utf8');
  assert.ok(/function muatEnvBerkas/.test(isi), 'harus ada pemuat env sendiri');
  assert.ok(/muatEnvBerkas\(\)/.test(isi), 'pemuat env harus dipanggil');
  // Bukti perilaku: dengan env proses KOSONG, alamat CP harus berasal dari file,
  // bukan default loopback (yang akan bentrok dengan KEFA).
  const r = jalankan({
    PUSH_URL: 'http://127.0.0.1:9',
    PUSH_TOKEN: 'token-uji',
    PUSH_TOKO: 'cp,nk,kefa',
    IPOS_URL: '',
    IPOS_KEY: '',
    IPOS_NK_URL: '',
    IPOS_NK_KEY: '',
    IPOS_KEFA_URL: '',
    IPOS_KEFA_KEY: '',
    PUSH_LOCK_FILE: path.join(os.tmpdir(), 'uji-jaga-env.lock'),
    PUSH_STATUS_FILE: path.join(os.tmpdir(), 'uji-jaga-env.json'),
  }, 15000);
  // Dengan file terbaca, tiga toko punya alamat BERBEDA -> tidak kena penolakan
  // "alamat yang SAMA". (Pengiriman ke :9 gagal, tapi itu bukan yang diuji.)
  assert.ok(!/alamat yang SAMA/i.test(r.out),
    'tiga toko harus punya alamat berbeda dari file. dapat: ' + r.out.slice(-400));
  assert.ok(/mendorong cp, nk, kefa|mendorong cp, kefa, nk|mendorong .*cp.*nk.*kefa/i.test(r.out),
    'harus melaporkan tiga toko. dapat: ' + r.out.slice(-400));
});

console.log('');
console.log('  lulus ' + lulus + '/' + (lulus + gagal));
if (gagal) { console.log('  ADA YANG GAGAL'); process.exit(1); }
console.log('  SEMUA LULUS');
