'use strict';

// ════════════════════════════════════════════════════════════════
//   UJI REGRESI: kunci single-instance bot
//
//   Bug produksi 2026-11-14: bot TIDAK MERESPON CHAT SAMA SEKALI.
//   storage\bot.lock berisi {"pid":8928,...} milik bot yang sudah mati.
//   Windows mendaur ulang PID 8928 untuk SecurityHealthService.exe.
//   process.kill(8928,0) -> EPERM -> _pidAlive() menganggapnya HIDUP ->
//   SETIAP instance baru exit(2) -> wrapper berhenti -> watchdog restart
//   sia-sia -> nol poller getUpdates, port 3001 tidak listen.
//
//   Uji ini mengunci perilaku benar agar bug itu tidak kembali.
//   Jalankan: node boot\test-instance-lock.js
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const lock = require('../bot-instance-lock');

let lulus = 0, gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log('  OK   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama + (detail ? ' -> ' + detail : '')); }
}

function tmpLock() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'lockuji-'));
  return path.join(d, 'bot.lock');
}
function tulis(file, obj) { fs.writeFileSync(file, JSON.stringify(obj), 'utf8'); }
function diam() {}

function formatWmic(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.000000+480`;
}

const PORT = 3001;

async function ujiNetstatNyata() {
  console.log('\n[10] Netstat nyata: portDipegang presisi per-PID');
  const srv = net.createServer(() => {});
  await new Promise((res) => srv.listen(0, '127.0.0.1', res));
  const port = srv.address().port;
  await new Promise((r) => setTimeout(r, 400));

  const ya = lock.portDipegang(process.pid, port);
  cek('PID ini terdeteksi memegang port ' + port, ya === true, 'hasil=' + ya);
  const bukan = lock.portDipegang(process.pid, port + 1);
  cek('port lain -> false', bukan === false, 'hasil=' + bukan);
  const pidSalah = lock.portDipegang(process.pid + 100000, port);
  cek('PID lain -> false', pidSalah === false, 'hasil=' + pidSalah);
  await new Promise((res) => srv.close(res));
}

async function main() {
  // ───────────────────────────────────────────────────────────
  console.log('\n[1] BUG PRODUKSI: PID didaur ulang oleh proses NON-node');
  {
    const f = tmpLock();
    const pidLama = 8928;
    tulis(f, { pid: pidLama, at: Date.now() - 3600000, port: PORT });
    const deps = {
      pidAlive: () => true, // EPERM -> "hidup"
      infoProses: () => ({ Name: 'SecurityHealthService.exe', CommandLine: 'svchost', CreationDate: '20261114082842.037794+480' }),
      portDipegang: () => false
    };
    const hasil = lock.pemilikLockSah(pidLama, Date.now() - 3600000, PORT, deps);
    cek('pemilikLockSah -> false (bukan node.exe)', hasil === false, 'hasil=' + hasil);
    const ambil = lock.acquire({ lockFile: f, port: PORT, log: diam, deps });
    cek('acquire -> true (lock basi diambil alih, bot BOLEH start)', ambil === true, 'hasil=' + ambil);
    const isi = JSON.parse(fs.readFileSync(f, 'utf8'));
    cek('lock kini berisi PID proses ini', isi.pid === process.pid, 'pid=' + isi.pid);
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n[2] PID didaur ulang walau namanya node.exe (cek waktu buat)');
  {
    const at = Date.now() - 7200000; // lock 2 jam lalu
    const deps = {
      pidAlive: () => true,
      infoProses: () => ({
        Name: 'node.exe',
        CommandLine: '"C:\\Program Files\\nodejs\\node.exe" index.js',
        CreationDate: formatWmic(new Date(at + 1800000)) // dibuat SETELAH lock
      }),
      portDipegang: () => true
    };
    const hasil = lock.pemilikLockSah(1234, at, PORT, deps);
    cek('proses lebih muda dari lock -> false', hasil === false, 'hasil=' + hasil);
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n[3] Instance bot SUNGGUHAN hidup -> harus tetap menolak start');
  {
    const f = tmpLock();
    const at = Date.now() - 60000;
    tulis(f, { pid: 4321, at, port: PORT });
    const deps = {
      pidAlive: () => true,
      infoProses: () => ({
        Name: 'node.exe',
        CommandLine: '"C:\\Program Files\\nodejs\\node.exe" --max-old-space-size=640 C:\\BOT-TELEGRAM-\\index.js',
        CreationDate: formatWmic(new Date(at - 5000))
      }),
      portDipegang: () => true
    };
    const hasil = lock.pemilikLockSah(4321, at, PORT, deps);
    cek('pemilikLockSah -> true', hasil === true, 'hasil=' + hasil);
    const ambil = lock.acquire({ lockFile: f, port: PORT, log: diam, deps });
    cek('acquire -> false (proses ini harus exit 2, cegah 409)', ambil === false, 'hasil=' + ambil);
    const isi = JSON.parse(fs.readFileSync(f, 'utf8'));
    cek('lock tidak diambil alih (masih PID 4321)', isi.pid === 4321, 'pid=' + isi.pid);
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n[4] node.exe kita hidup tapi TIDAK memegang port 3001');
  {
    // Lock LAMA (> masa tenggang) -> pasti mati suri, boleh diambil alih.
    const atLama = Date.now() - 30 * 60000;
    const deps = {
      pidAlive: () => true,
      infoProses: () => ({
        Name: 'node.exe',
        CommandLine: 'node C:\\BOT-TELEGRAM-\\index.js',
        CreationDate: formatWmic(new Date(atLama - 3000))
      }),
      portDipegang: () => false
    };
    const hasil = lock.pemilikLockSah(5555, atLama, PORT, deps);
    cek('mati suri (lock lama, tak pegang port) -> false', hasil === false, 'hasil=' + hasil);

    // Lock BARU + belum listen -> sedang boot, jangan direbut.
    const atBaru = Date.now() - 5000;
    const depsBoot = {
      pidAlive: () => true,
      infoProses: () => ({
        Name: 'node.exe',
        CommandLine: 'node C:\\BOT-TELEGRAM-\\index.js',
        CreationDate: formatWmic(new Date(atBaru - 3000))
      }),
      portDipegang: () => false
    };
    const boot = lock.pemilikLockSah(5556, atBaru, PORT, depsBoot);
    cek('masih boot (lock baru, belum listen) -> true (masa tenggang)', boot === true, 'hasil=' + boot);
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n[5] Bot dijalankan PM2 (command line ProcessContainerFork.js)');
  {
    const at = Date.now() - 60000;
    const deps = {
      pidAlive: () => true,
      infoProses: () => ({
        Name: 'node.exe',
        CommandLine: 'node --max-old-space-size=640 --dns-result-order=ipv4first C:\\Users\\rdpadmin\\AppData\\Roaming\\npm\\node_modules\\pm2\\lib\\ProcessContainerFork.js',
        CreationDate: formatWmic(new Date(at - 3000))
      }),
      portDipegang: () => true
    };
    const hasil = lock.pemilikLockSah(2812, at, PORT, deps);
    cek('node.exe memegang port 3001 -> SAH walau command line PM2', hasil === true, 'hasil=' + hasil);
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n[5b] node.exe lain (PM2 daemon) yang TIDAK memegang port 3001');
  {
    const at = Date.now() - 30 * 60000; // di luar masa tenggang startup
    const deps = {
      pidAlive: () => true,
      infoProses: () => ({
        Name: 'node.exe',
        CommandLine: 'node C:\\Users\\rdpadmin\\AppData\\Roaming\\npm\\node_modules\\pm2\\lib\\Daemon.js',
        CreationDate: formatWmic(new Date(at - 3000))
      }),
      portDipegang: () => false
    };
    const hasil = lock.pemilikLockSah(14864, at, PORT, deps);
    cek('tak pegang port & lock lama -> false', hasil === false, 'hasil=' + hasil);
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n[6] PID sudah mati');
  {
    const deps = { pidAlive: () => false, infoProses: () => ({ Name: 'node.exe' }), portDipegang: () => true };
    const hasil = lock.pemilikLockSah(7777, Date.now(), PORT, deps);
    cek('PID mati -> false', hasil === false, 'hasil=' + hasil);
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n[7] Alat identitas gagal (wmic/netstat tidak ada) -> JANGAN blokir');
  {
    const f = tmpLock();
    tulis(f, { pid: 8888, at: Date.now() - 1000, port: PORT });
    const deps = { pidAlive: () => true, infoProses: () => null, portDipegang: () => false };
    const hasil = lock.pemilikLockSah(8888, Date.now() - 1000, PORT, deps);
    cek('pemilikLockSah -> null (tidak pasti)', hasil === null, 'hasil=' + hasil);
    const ambil = lock.acquire({ lockFile: f, port: PORT, log: diam, deps });
    cek('acquire -> true (jangan pernah mengunci diri sendiri)', ambil === true, 'hasil=' + ambil);
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n[8] Lock rusak / bukan JSON');
  {
    const f = tmpLock();
    fs.writeFileSync(f, 'bukan json {{{', 'utf8');
    const ambil = lock.acquire({ lockFile: f, port: PORT, log: diam, deps: {} });
    cek('JSON rusak -> acquire true', ambil === true, 'hasil=' + ambil);
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n[9] release hanya menghapus lock milik sendiri');
  {
    const f = tmpLock();
    tulis(f, { pid: process.pid, at: Date.now(), port: PORT });
    lock.release({ lockFile: f });
    cek('lock milik sendiri terhapus', !fs.existsSync(f));

    const f2 = tmpLock();
    tulis(f2, { pid: 9999, at: Date.now(), port: PORT });
    lock.release({ lockFile: f2 });
    cek('lock milik proses lain TIDAK dihapus', fs.existsSync(f2));
  }

  await ujiNetstatNyata();

  // ───────────────────────────────────────────────────────────
  console.log('\n[11] Netstat nyata: PID 8928 vs 89281 tidak tertukar');
  {
    const out = '  TCP    0.0.0.0:3001    0.0.0.0:0    LISTENING    89281\n';
    const re = new RegExp(':3001\\s+\\S+\\s+LISTENING\\s+8928(?![0-9])');
    cek('pid 8928 tidak cocok dengan baris pid 89281', re.test(out) === false);
    const re2 = new RegExp(':3001\\s+\\S+\\s+LISTENING\\s+89281(?![0-9])');
    cek('pid 89281 cocok dengan barisnya sendiri', re2.test(out) === true);
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n[12] Proses nyata: infoProses membaca PID hidup & mati');
  {
    const info = lock.infoProses(process.pid);
    cek('infoProses(self) -> node.exe', !!(info && /^node\.exe$/i.test(info.Name)), JSON.stringify(info));
    cek('infoProses(self) punya CreationDate', !!(info && info.CreationDate), JSON.stringify(info));

    const mati = lock.infoProses(999999);
    cek('infoProses(PID tak ada) -> null', mati === null, JSON.stringify(mati));
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n[13] waktuBuatProses');
  {
    const ms = lock.waktuBuatProses('20261114082842.037794+480');
    const d = new Date(ms);
    cek('parse CreationDate wmic', d.getFullYear() === 2026 && d.getMonth() === 10 && d.getDate() === 14, String(d));
    cek('input aneh -> null', lock.waktuBuatProses('xx') === null);
    cek('input kosong -> null', lock.waktuBuatProses('') === null);
  }

  // ───────────────────────────────────────────────────────────
  console.log('\n' + '-'.repeat(56));
  console.log(`HASIL: ${lulus} lulus, ${gagal} gagal`);
  console.log('-'.repeat(56));
  process.exit(gagal === 0 ? 0 : 1);
}

main().catch((e) => { console.error('FATAL: ' + (e && e.stack || e)); process.exit(1); });
