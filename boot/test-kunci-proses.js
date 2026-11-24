'use strict';
/**
 * UJI: kunci proses tunggal — khusus bug PID daur ulang setelah reboot.
 *
 * BUG YANG DIUJI
 * --------------
 * 20/11/2026: setelah SRV KEFA reboot, `.jaga-push.lock` masih berisi
 * pid 6600 dari sebelum reboot. Windows memakai ulang nomor itu untuk proses
 * lain. Penjaga lama hanya memakai `process.kill(pid,0)` -> "hidup" ->
 * menyimpulkan ada penjaga lain -> `process.exit(2)` -> berulang SELAMANYA.
 * Akibatnya push-agen tidak pernah menyala dan ketiga toko jadi basi.
 *
 * Uji ini memakai PROSES NYATA (bukan tiruan) supaya persis menguji kondisi
 * yang dulu gagal.
 *
 * Jalankan: node boot/test-kunci-proses.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const kunci = require('./kunci-proses');

let lulus = 0;
let gagal = 0;
function uji(nama, fn) {
  try {
    fn();
    lulus++;
    console.log('  OK   ' + nama);
  } catch (e) {
    gagal++;
    console.log('  GAGAL ' + nama);
    console.log('        ' + e.message);
  }
}
async function ujiAsync(nama, fn) {
  try {
    await fn();
    lulus++;
    console.log('  OK   ' + nama);
  } catch (e) {
    gagal++;
    console.log('  GAGAL ' + nama);
    console.log('        ' + e.message);
  }
}

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'uji-kunci-'));
const LOCK = path.join(DIR, '.uji.lock');

function tulisKunci(obj) {
  fs.writeFileSync(LOCK, JSON.stringify(obj), 'utf8');
}
function hapusKunci() {
  try { fs.unlinkSync(LOCK); } catch (_) { /* tidak ada */ }
}
function bacaKunci() {
  return JSON.parse(fs.readFileSync(LOCK, 'utf8'));
}

async function main() {
  console.log('');
  console.log('=== UJI KUNCI PROSES ===');
  console.log('  platform: ' + process.platform + '   pid uji: ' + process.pid);
  console.log('');

  // ── Kasus dasar ─────────────────────────────────────────
  console.log('-- Kasus dasar --');

  uji('kunci belum ada -> berhasil diambil', () => {
    hapusKunci();
    const h = kunci.ambilKunci(LOCK);
    assert.strictEqual(h.ok, true);
    assert.strictEqual(h.diambilAlih, false);
    assert.strictEqual(bacaKunci().pid, process.pid);
  });

  uji('kunci berisi pid sendiri -> berhasil', () => {
    tulisKunci({ pid: process.pid, mulai: new Date().toISOString(), boot: kunci.waktuBoot() });
    const h = kunci.ambilKunci(LOCK);
    assert.strictEqual(h.ok, true);
    assert.strictEqual(h.diambilAlih, false);
  });

  uji('kunci rusak (bukan JSON) -> diambil alih', () => {
    fs.writeFileSync(LOCK, 'ini bukan json {{{', 'utf8');
    const h = kunci.ambilKunci(LOCK);
    assert.strictEqual(h.ok, true);
    assert.strictEqual(bacaKunci().pid, process.pid);
  });

  uji('kunci tanpa pid -> diambil alih', () => {
    tulisKunci({ mulai: '2026-01-01T00:00:00.000Z' });
    const h = kunci.ambilKunci(LOCK);
    assert.strictEqual(h.ok, true);
    assert.strictEqual(bacaKunci().pid, process.pid);
  });

  // ── BUG UTAMA: PID daur ulang oleh proses NON-node ──────
  console.log('');
  console.log('-- BUG UTAMA: PID daur ulang (dulu mengunci selamanya) --');

  uji('pid milik proses NON-node -> kunci diambil alih (BUKAN diblokir)', () => {
    // PID 4 = proses System di Windows; di POSIX dipakai pid 1 (init).
    const pidAsing = process.platform === 'win32' ? 4 : 1;
    const id = kunci.identitasProses(pidAsing);
    if (id.ada !== true) {
      console.log('        (dilewati: pid ' + pidAsing + ' tidak terbaca di mesin ini)');
      return;
    }
    tulisKunci({ pid: pidAsing, mulai: '2026-11-20T10:08:52.944Z', boot: kunci.waktuBoot() });
    const h = kunci.ambilKunci(LOCK);
    assert.strictEqual(h.ok, true, 'harus mengambil alih, bukan memblokir');
    assert.strictEqual(h.diambilAlih, true);
    assert.strictEqual(bacaKunci().pid, process.pid);
    assert.ok(/proses lain|dipakai ulang|tidak cocok/i.test(h.alasan), 'alasan: ' + h.alasan);
  });

  uji('pid yang tidak ada -> kunci diambil alih', () => {
    tulisKunci({ pid: 999999, mulai: '2026-11-20T10:08:52.944Z', boot: kunci.waktuBoot() });
    const h = kunci.ambilKunci(LOCK);
    assert.strictEqual(h.ok, true);
    assert.strictEqual(h.diambilAlih, true);
    assert.ok(/tidak ada|tidak bisa dipastikan/i.test(h.alasan), 'alasan: ' + h.alasan);
  });

  // ── BUG UTAMA: kunci dari sebelum reboot ────────────────
  console.log('');
  console.log('-- BUG UTAMA: kunci dari sebelum reboot --');

  uji('kunci dibuat sebelum komputer reboot -> diambil alih', () => {
    // PID sengaja BUKAN pid proses ini, supaya jalur pemeriksaan benar-benar
    // dijalankan (kalau pid = pid sendiri, kunci memang milik kita).
    const pidAsing = process.platform === 'win32' ? 4 : 1;
    // boot dicatat 1 hari lalu = komputer jelas sudah reboot sejak itu.
    tulisKunci({
      pid: pidAsing,
      mulai: new Date().toISOString(),
      boot: Date.now() - 24 * 60 * 60 * 1000,
    });
    const h = kunci.ambilKunci(LOCK);
    assert.strictEqual(h.ok, true);
    assert.strictEqual(h.diambilAlih, true);
    assert.ok(/reboot/i.test(h.alasan), 'alasan harus menyebut reboot: ' + h.alasan);
  });

  uji('kunci tanpa catatan boot tetap bisa diambil alih bila pid mati', () => {
    tulisKunci({ pid: 999999, mulai: '2026-11-20T10:08:52.944Z' });
    const h = kunci.ambilKunci(LOCK);
    assert.strictEqual(h.ok, true);
    assert.strictEqual(h.diambilAlih, true);
  });

  // ── Kasus yang HARUS diblokir: penjaga kedua sungguhan ──
  console.log('');
  console.log('-- Penjaga kedua sungguhan HARUS diblokir --');

  // Jalankan proses node sungguhan sebagai "pemegang kunci".
  const anak = spawn(process.execPath, ['-e', 'setTimeout(function(){}, 120000)'], {
    stdio: 'ignore', windowsHide: true,
  });
  await new Promise((r) => setTimeout(r, 1200));

  await ujiAsync('pid node yang HIDUP dan cocok -> DIBLOKIR (mencegah penjaga ganda)', () => {
    const id = kunci.identitasProses(anak.pid);
    assert.strictEqual(id.ada, true, 'proses anak harus terbaca');
    tulisKunci({
      pid: anak.pid,
      mulai: id.mulai ? new Date(id.mulai).toISOString() : new Date().toISOString(),
      boot: kunci.waktuBoot(),
    });
    const h = kunci.ambilKunci(LOCK);
    assert.strictEqual(h.ok, false, 'penjaga kedua harus ditolak');
    assert.strictEqual(h.diambilAlih, false);
    assert.strictEqual(h.pidLama, anak.pid);
  });

  await ujiAsync('pid node HIDUP tetapi waktu mulai BEDA -> diambil alih', () => {
    // Simulasi: PID sama, tetapi prosesnya beda (daur ulang).
    tulisKunci({
      pid: anak.pid,
      mulai: '2020-01-01T00:00:00.000Z',
      boot: kunci.waktuBoot(),
    });
    const h = kunci.ambilKunci(LOCK);
    assert.strictEqual(h.ok, true);
    assert.strictEqual(h.diambilAlih, true);
    assert.ok(/dipakai ulang|tidak cocok/i.test(h.alasan), 'alasan: ' + h.alasan);
  });

  await ujiAsync('setelah pemegang mati, kunci bisa diambil alih', async () => {
    const id = kunci.identitasProses(anak.pid);
    tulisKunci({
      pid: anak.pid,
      mulai: id.mulai ? new Date(id.mulai).toISOString() : new Date().toISOString(),
      boot: kunci.waktuBoot(),
    });
    anak.kill();
    await new Promise((r) => setTimeout(r, 1500));
    const h = kunci.ambilKunci(LOCK);
    assert.strictEqual(h.ok, true);
    assert.strictEqual(h.diambilAlih, true);
  });

  // ── Lepas kunci ─────────────────────────────────────────
  console.log('');
  console.log('-- Lepas kunci --');

  uji('lepas kunci milik sendiri -> berkas hilang', () => {
    tulisKunci({ pid: process.pid, mulai: new Date().toISOString(), boot: kunci.waktuBoot() });
    kunci.lepasKunci(LOCK);
    assert.strictEqual(fs.existsSync(LOCK), false);
  });

  uji('lepas kunci milik proses lain -> berkas TETAP ada', () => {
    tulisKunci({ pid: 999999, mulai: new Date().toISOString(), boot: kunci.waktuBoot() });
    kunci.lepasKunci(LOCK);
    assert.strictEqual(fs.existsSync(LOCK), true, 'tidak boleh menghapus kunci orang lain');
  });

  uji('lepas kunci yang tidak ada -> tidak melempar', () => {
    hapusKunci();
    kunci.lepasKunci(LOCK);
    assert.strictEqual(fs.existsSync(LOCK), false);
  });

  // ── Bentuk kunci baru ───────────────────────────────────
  console.log('');
  console.log('-- Bentuk kunci yang ditulis --');

  uji('kunci baru memuat pid, mulai, dan boot', () => {
    hapusKunci();
    kunci.ambilKunci(LOCK);
    const isi = bacaKunci();
    assert.strictEqual(typeof isi.pid, 'number');
    assert.ok(isi.mulai, 'harus ada mulai');
    assert.ok(isi.boot != null, 'harus ada boot (kunci versi lama tidak punya ini)');
  });

  uji('boot yang dicatat mendekati waktu boot sebenarnya', () => {
    const b = kunci.waktuBoot();
    assert.ok(b != null, 'waktuBoot harus mengembalikan nilai');
    const selisihMenit = Math.abs(Date.now() - b) / 60000;
    assert.ok(selisihMenit >= 0 && selisihMenit < 60 * 24 * 400, 'boot tidak masuk akal: ' + selisihMenit + ' menit');
  });

  // Bersihkan
  try { anak.kill(); } catch (_) { /* sudah mati */ }
  hapusKunci();
  try { fs.rmdirSync(DIR); } catch (_) { /* biarkan */ }

  console.log('');
  console.log('============================================');
  console.log('  lulus: ' + lulus + '   gagal: ' + gagal);
  console.log('============================================');
  console.log('');
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('GALAT UJI: ' + (e && e.stack ? e.stack : e));
  process.exit(1);
});
