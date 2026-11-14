'use strict';
/**
 * Tes: penjaga replika HARUS benar-benar menolak replika kedua.
 *
 * TEMUAN REVIEW (Important I1): versi pertama hanya membaca
 * `RAILWAY_REPLICA_COUNT`, dan variabel itu TIDAK ADA di daftar variabel
 * sistem Railway (yang ada hanya RAILWAY_REPLICA_ID dan RAILWAY_REPLICA_REGION).
 * Jadi `process.exit(3)` tidak pernah tercapai dan penjaganya INERT.
 *
 * Padahal di Linux `pemilikLockSah()` mengembalikan null sehingga
 * bot-instance-lock.js sengaja tidak pernah memblokir. Artinya satu-satunya
 * yang mencegah dua poller getUpdates hanyalah setelan `numReplicas: 1` di
 * railway.json. Kalau ada yang menaikkan replika dari dashboard, dua poller
 * bertabrakan -> Telegram 409 -> pesan & tombol pengguna hilang.
 *
 * Perbaikan: kunci file eksklusif di dalam VOLUME. Di POSIX, `open(...,'wx')`
 * benar-benar atomik, jadi ini penjagaan nyata, bukan sekadar konfigurasi.
 *
 * Kontrak pastikanSatuReplika(opts):
 *   - win32 -> selalu ok (kunci Windows yang lama tetap berlaku)
 *   - POSIX, belum ada kunci      -> ok, kunci dibuat berisi PID
 *   - POSIX, kunci dipegang proses hidup -> TOLAK dengan alasan jelas
 *   - POSIX, kunci milik PID mati (stale) -> ambil alih, ok
 *   - POSIX, kunci berisi PID kita sendiri -> ok (require ulang di proses sama)
 *   - RAILWAY_REPLICA_COUNT > 1 (bila operator set manual) -> tetap TOLAK
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { pastikanSatuReplika, lepasKunciReplika } = require('./replika-guard.js');

let gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) console.log('  PASS  ' + nama);
  else { console.error('  GAGAL ' + nama + (detail !== undefined ? ' -> ' + detail : '')); gagal++; }
}

const akar = fs.mkdtempSync(path.join(os.tmpdir(), 'rep-'));
const kunci = path.join(akar, '.bot-single-instance');

// ── 1. Windows: tidak berubah sama sekali (kunci lama tetap dipakai)
cek('win32 selalu ok', pastikanSatuReplika({ platform: 'win32', fileKunci: kunci }).ok === true);

// ── 2. POSIX: pertama kali -> boleh, kunci tercipta berisi PID
const a = pastikanSatuReplika({ platform: 'linux', fileKunci: kunci });
cek('linux pertama -> ok', a.ok === true, JSON.stringify(a));
cek('linux pertama -> file kunci ada', fs.existsSync(kunci));
cek('kunci berisi PID proses ini', fs.readFileSync(kunci, 'utf8').trim() === String(process.pid),
  fs.readFileSync(kunci, 'utf8'));

// ── 3. POSIX: proses LAIN yang hidup memegang kunci -> TOLAK
const anak = spawn(process.execPath, ['-e', 'setTimeout(()=>{},60000)'], { stdio: 'ignore' });
fs.writeFileSync(kunci, String(anak.pid));
const b = pastikanSatuReplika({ platform: 'linux', fileKunci: kunci });
cek('linux kunci dipegang proses hidup -> TOLAK', b.ok === false, JSON.stringify(b));
cek('alasan menyebut replika ganda / 409',
  /replika|409|Conflict/i.test(b.alasan || ''), b.alasan);
anak.kill();

// ── 4. POSIX: kunci milik PID yang sudah mati (stale) -> ambil alih
const mati = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' });
mati.kill();
const pidMati = mati.pid;
fs.writeFileSync(kunci, String(pidMati));
const c = pastikanSatuReplika({ platform: 'linux', fileKunci: kunci });
cek('kunci stale diambil alih -> ok', c.ok === true, JSON.stringify(c));
cek('kunci stale diganti PID kita', fs.readFileSync(kunci, 'utf8').trim() === String(process.pid));

// ── 5. Kunci rusak / kosong -> jangan crash, ambil alih
fs.writeFileSync(kunci, 'bukan-angka');
const d = pastikanSatuReplika({ platform: 'linux', fileKunci: kunci });
cek('kunci rusak diambil alih -> ok', d.ok === true, JSON.stringify(d));

// ── 6. Folder kunci tidak bisa dibuat -> jangan crash, jangan blokir
const e = pastikanSatuReplika({ platform: 'linux', fileKunci: path.join(akar, 'x', 'y', 'z.lock') });
cek('folder dibuat otomatis -> ok', e.ok === true, JSON.stringify(e));

// ── 7. Operator set manual RAILWAY_REPLICA_COUNT>1 -> tetap TOLAK (sabuk ganda)
process.env.RAILWAY_REPLICA_COUNT = '3';
const f = pastikanSatuReplika({ platform: 'linux', fileKunci: kunci });
cek('env replika >1 tetap DITOLAK', f.ok === false, JSON.stringify(f));
delete process.env.RAILWAY_REPLICA_COUNT;

// ── 8. lepasKunciReplika membersihkan kunci milik sendiri
lepasKunciReplika({ fileKunci: kunci });
cek('lepas kunci menghapus file', !fs.existsSync(kunci));

// ── 9. lepasKunciReplika TIDAK menghapus kunci milik proses lain
fs.writeFileSync(kunci, String(anak.pid));
lepasKunciReplika({ fileKunci: kunci });
cek('kunci proses lain tidak dihapus', fs.existsSync(kunci));

fs.rmSync(akar, { recursive: true, force: true });
if (gagal) { console.error('\n' + gagal + ' GAGAL'); process.exit(1); }
console.log('\nOK replika-guard: kunci file POSIX nyata + sabuk env');
