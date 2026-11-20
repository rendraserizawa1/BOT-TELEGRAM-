'use strict';
/**
 * TES: JAGA-RAM hanya boleh mematikan Chrome.
 *
 * Latar — insiden 20/11/2026
 * -------------------------
 * PC BCODE-KEFA punya RAM 3,78 GB terpakai 92%; Chrome memakai ~947 MB.
 * Rencananya Chrome ditutup tiap 23:00 untuk membebaskan memori.
 *
 * RISIKO YANG HARUS DIKUNCI
 * -------------------------
 * Skrip pembersih proses adalah tempat paling berbahaya untuk salah tulis.
 * Satu pola longgar seperti /node|chrome/ akan ikut membunuh proxy iPos dan
 * ketiga agen — mematikan toko tepat saat kita sedang memperbaikinya.
 *
 * Karena itu tes ini memeriksa HAL YANG TIDAK BOLEH ADA, bukan hanya yang
 * boleh: tidak boleh ada pola yang bisa cocok dengan node/9router/defender,
 * dan daftar putih harus persis satu nama.
 *
 * Jalankan: node boot/test-jaga-ram.js
 */
const fs = require('fs');
const path = require('path');

const AKAR = path.join(__dirname, '..');
const pSkrip = path.join(AKAR, 'boot', 'jaga-ram.ps1');
const src = fs.readFileSync(pSkrip, 'utf8');

let lulus = 0, gagal = 0;
function cek(nama, syarat, ket) {
  if (syarat) { lulus++; console.log('  OK   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama + (ket ? '  -> ' + ket : '')); }
}

// ── 1. Daftar putih ───────────────────────────────────────────
console.log('\n[1] Daftar putih proses');
const m = src.match(/\$BOLEH_MATI\s*=\s*@\(([^)]*)\)/);
cek('ada $BOLEH_MATI', !!m);
const isiDaftar = m ? m[1] : '';
const nama = (isiDaftar.match(/'([^']+)'/g) || []).map((s) => s.replace(/'/g, '').trim());
cek('daftar putih berisi tepat 1 nama', nama.length === 1, 'dapat: ' + JSON.stringify(nama));
cek("nama itu 'chrome'", nama.length === 1 && nama[0] === 'chrome', JSON.stringify(nama));

// ── 2. Tidak ada proses terlarang di daftar ───────────────────
console.log('\n[2] Proses yang DILARANG muncul di daftar');
for (const terlarang of ['node', '9router', 'MsMpEng', 'powershell', 'wscript', 'sshd', 'tailscaled']) {
  cek('tidak ada "' + terlarang + '"', !nama.includes(terlarang));
}

// ── 3. Stop-Process hanya dipakai di dalam loop daftar putih ──
console.log('\n[3] Stop-Process hanya menyasar daftar putih');
const semuaStop = (src.match(/Stop-Process/g) || []).length;
cek('Stop-Process dipakai (memang perlu)', semuaStop >= 1);
cek('tidak ada Stop-Process -Name', !/Stop-Process\s+-Name/i.test(src),
  'harus lewat -Id dari daftar putih, bukan -Name bebas');
cek('Stop-Process memakai -Id', /Stop-Process\s+-Id\s+\$p\.Id/.test(src));
cek('loop mengambil proses dari $nama (daftar putih)',
  /foreach\s*\(\s*\$nama\s+in\s+\$BOLEH_MATI\s*\)/.test(src));

// ── 4. Tidak ada pola pencocokan longgar ──────────────────────
console.log('\n[4] Tidak ada pola longgar yang berbahaya');
cek('tidak ada regex yang menyebut node', !/-\s*match\s+['"][^'"]*node/i.test(src),
  'agen dijalankan lewat node.exe');
cek('tidak ada Get-Process tanpa -Name daftar putih',
  !/Get-Process\s*\|/.test(src),
  'Get-Process tanpa -Name = semua proses = berbahaya');
cek('setiap Get-Process -Name memakai variabel daftar putih',
  (src.match(/Get-Process\s+-Name\s+\$nama/g) || []).length >= 1);

// ── 5. Ada pemeriksaan agen sebelum & sesudah ─────────────────
console.log('\n[5] Agen diperiksa sebelum dan sesudah pembersihan');
cek('ada fungsi HitungAgen', /function HitungAgen/.test(src));
cek('menghitung push-agen', /push-agen/.test(src));
cek('menghitung jaga-push', /jaga-push/.test(src));
cek('menghitung jaga-poller', /jaga-poller/.test(src));
cek('ada $agenSebelum', /\$agenSebelum\s*=/.test(src));
cek('ada $agenSesudah', /\$agenSesudah\s*=/.test(src));
cek('ada deteksi agen hilang', /\$agenRusak/.test(src));
cek('keluar dengan kode 2 bila agen hilang', /exit 2/.test(src));

// ── 6. Ada log ────────────────────────────────────────────────
console.log('\n[6] Jejak log');
cek('menulis logs\\jaga-ram.log', /jaga-ram\.log/.test(src));
cek('mencatat RAM bebas sebelum', /RAM bebas=/.test(src));
cek('mencatat RAM bebas sesudah', /RAM bebas.*->/.test(src));
cek('memutar log bila besar', /\.1/.test(src));

// ── 7. Simulasi: proses mana yang akan dimatikan ──────────────
console.log('\n[7] Simulasi pemilihan proses');
{
  // Tiruan proses nyata di mesin ini.
  const proses = [
    { pid: 10788, nama: 'node', ket: 'proxy iPos (server.js)' },
    { pid: 14420, nama: 'node', ket: 'push-agen' },
    { pid: 14156, nama: 'node', ket: 'jaga-push' },
    { pid: 14164, nama: 'node', ket: 'jaga-poller' },
    { pid: 9164,  nama: 'node', ket: '9router' },
    { pid: 4328,  nama: 'chrome', ket: 'chrome' },
    { pid: 1228,  nama: 'chrome', ket: 'chrome' },
    { pid: 3864,  nama: 'MsMpEng', ket: 'Defender' },
    { pid: 4604,  nama: 'tailscaled', ket: 'Tailscale' },
  ];
  const akanMati = proses.filter((p) => nama.includes(p.nama));
  const terlarangMati = akanMati.filter((p) => p.nama !== 'chrome');

  cek('hanya chrome yang akan dimatikan', terlarangMati.length === 0,
    'ikut mati: ' + terlarangMati.map((p) => p.nama + ' (' + p.ket + ')').join(', '));
  cek('jumlah chrome yang dimatikan = 2', akanMati.length === 2, 'dapat ' + akanMati.length);

  for (const p of proses.filter((x) => x.nama !== 'chrome')) {
    cek('AMAN: ' + p.ket + ' (pid ' + p.pid + ') tidak tersentuh', !nama.includes(p.nama));
  }
}

// ── 8. Berkas pendamping ada ──────────────────────────────────
console.log('\n[8] Berkas pendamping');
cek('boot/pasang-jaga-ram.ps1 ada', fs.existsSync(path.join(AKAR, 'boot', 'pasang-jaga-ram.ps1')));
const pasang = fs.readFileSync(path.join(AKAR, 'boot', 'pasang-jaga-ram.ps1'), 'utf8');
cek('pemasang memakai nama tugas BCODE-JAGA-RAM', /BCODE-JAGA-RAM/.test(pasang));
cek('pemasang menjadwalkan 23:00', /-Daily\s+-At\s+'23:00'/.test(pasang));
cek('pemasang TIDAK memakai RunLevel Highest', !/RunLevel\s+Highest/.test(pasang),
  'tidak perlu admin dan tidak boleh minta');
// Periksa PEMAKAIAN SYSTEM, bukan penyebutan katanya. Komentar di berkas ini
// memang menyebut SYSTEM untuk menjelaskan mengapa ia tidak dipakai — tes
// yang mencari kata "SYSTEM" begitu saja akan gagal pada kode yang benar.
cek('pemasang TIDAK memakai akun SYSTEM',
  !/-UserId\s+["']?SYSTEM/i.test(pasang) && !/ServiceAccount/.test(pasang),
  'SYSTEM tidak bisa memakai kredensial SMB untuk menulis nota');
cek('pemasang mendaftarkan tugas sebagai user sendiri',
  /-UserId\s+"\$env:USERDOMAIN\\\$env:USERNAME"/.test(pasang),
  'harus rdpadmin agar kredensial share nota tetap bekerja');

// ── Ringkasan ─────────────────────────────────────────────────
console.log('\n' + '='.repeat(56));
console.log('  LULUS: ' + lulus + '   GAGAL: ' + gagal);
console.log('='.repeat(56));
if (gagal > 0) { console.log('\nADA YANG GAGAL.'); process.exit(1); }
console.log('\nSEMUA LULUS.');
