'use strict';
/**
 * MENYALAKAN ULANG RANTAI AGEN DORONG DENGAN BERSIH
 *
 * MENGAPA SKRIP INI ADA
 * ---------------------
 * `jaga-push.ps1` adalah WRAPPER: ia membaca boot\push-agen.env ke dalam
 * environment PROSES-nya sendiri, lalu mewariskannya ke `node jaga-push.js`,
 * yang meneruskannya lagi ke `node push-agen.js`.
 *
 * Akibatnya: mengubah push-agen.env TIDAK CUKUP. Selama wrapper lama masih
 * hidup, ia terus mewariskan nilai LAMA. Ini persis yang terjadi saat rotasi
 * kunci: berkas sudah berisi kunci baru, tapi agen tetap mengirim kunci lama
 * karena wrapper-nya hidup sejak sebelum rotasi.
 *
 * Terbukti pada 20/11/2026: setelah kunci dirotasi, KEFA menjadi
 * online=false walau proxy lokal menjawab HTTP 200 dengan kunci baru.
 *
 * Karena itu restart harus mematikan SELURUH rantai:
 *     wscript.exe (run-hidden.vbs)  -> powershell (wrapper)
 *       -> node jaga-push.js        -> node push-agen.js
 *
 * KESALAHAN YANG PERNAH TERJADI: hanya `push-agen.js` yang dimatikan. Penjaga
 * menyalakannya ulang dalam hitungan detik memakai env lama, sehingga
 * perubahan tidak pernah berlaku dan gejalanya terlihat seperti "kunci salah".
 *
 * Jalankan: node boot/nyalakan-ulang-agen.js
 */
const { execSync } = require('child_process');

const JEDA_MS = (n) => new Promise((r) => setTimeout(r, n));

function ps(perintah) {
  try {
    return String(execSync(
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "' + perintah.replace(/"/g, '\\"') + '"',
      { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }
    )).trim();
  } catch (e) {
    return String((e.stdout || '') + (e.stderr || '')).trim();
  }
}

// Ambil seluruh rantai sebagai JSON supaya tidak ada teks yang perlu diurai.
//
// JEBAKAN YANG PERNAH TERJADI: filter longgar `-match 'jaga-push'` ikut
// mencocokkan proses PERINTAH PEMERIKSA INI SENDIRI, karena teks perintahnya
// memuat kata "jaga-push". Akibatnya skrip membunuh shell-nya sendiri
// (terlihat sebagai "kill ESRCH" dan PID yang berubah-ubah).
//
// Karena itu setiap proses harus cocok dengan POLA POSITIF yang ketat, dan
// proses pemeriksa sendiri dikecualikan lewat penanda khusus.
const PENANDA_SENDIRI = 'PEMERIKSA-RANTAI-AGEN';
function rantai() {
  const skrip = [
    'Get-CimInstance Win32_Process | Where-Object {',
    '  $c = [string]$_.CommandLine;',
    '  $n = $_.Name;',
    '  $cocok = $false;',
    // wscript yang menjalankan run-hidden.vbs untuk jaga-push.ps1
    "  if ($n -eq 'wscript.exe' -and $c -match 'run-hidden\\.vbs' -and $c -match 'jaga-push\\.ps1') { $cocok = $true }",
    // wrapper powershell yang menjalankan jaga-push.ps1
    "  if ($n -eq 'powershell.exe' -and $c -match '-File\\s+.*jaga-push\\.ps1') { $cocok = $true }",
    // node penjaga dan node agen
    "  if ($n -eq 'node.exe' -and ($c -match 'jaga-push\\.js' -or $c -match 'push-agen\\.js')) { $cocok = $true }",
    // jangan pernah menyasar proses pemeriksa ini sendiri
    '  if ($c -match ' + PENANDA_SENDIRI + ') { $cocok = $false }',
    '  $cocok',
    '} | Select-Object ProcessId,Name,CommandLine | ConvertTo-Json -Compress',
  ].join(' ');
  const keluaran = ps(skrip + ' # ' + PENANDA_SENDIRI);
  if (!keluaran || keluaran === 'null') return [];
  try {
    const j = JSON.parse(keluaran);
    return Array.isArray(j) ? j : [j];
  } catch (_) {
    return [];
  }
}

function jenis(p) {
  const cl = String(p.CommandLine || '');
  if (p.Name === 'wscript.exe') return 'wscript (vbs)';
  if (p.Name === 'powershell.exe') return 'powershell (wrapper)';
  if (/push-agen\.js/.test(cl)) return 'node push-agen';
  if (/jaga-push\.js/.test(cl)) return 'node jaga-push';
  return p.Name + ' (?)';
}(async () => {
  console.log('=== NYALAKAN ULANG RANTAI AGEN DORONG ===\n');

  console.log('[1] Rantai sebelum dibersihkan');
  const sebelum = rantai();
  if (!sebelum.length) {
    console.log('    (tidak ada proses jaga-push/push-agen)');
  } else {
    for (const p of sebelum) {
      console.log('    pid=' + String(p.ProcessId).padStart(6) + '  ' + jenis(p));
    }
  }
  const jumlahWrapper = sebelum.filter((p) => p.Name === 'powershell.exe').length;
  if (jumlahWrapper > 1) {
    console.log('\n    PERHATIAN: ada ' + jumlahWrapper + ' wrapper powershell menumpuk.');
    console.log('    Ini sisa dari pemanggilan berulang; hanya satu yang benar-benar');
    console.log('    menjalankan node (jaga-push.js punya kunci .jaga-push.lock),');
    console.log('    tetapi semuanya memegang salinan env sendiri-sendiri.');
  }

  // ── 2. Hentikan seluruh rantai ─────────────────────────────
  console.log('\n[2] Menghentikan seluruh rantai');
  const urutan = ['wscript.exe', 'powershell.exe', 'node.exe'];
  let dihentikan = 0;
  for (const namaProses of urutan) {
    const sasaran = rantai().filter((p) => p.Name === namaProses);
    for (const p of sasaran) {
      try {
        process.kill(p.ProcessId, 'SIGKILL');
        console.log('    dihentikan pid=' + p.ProcessId + '  ' + jenis(p));
        dihentikan++;
      } catch (e) {
        console.log('    gagal pid=' + p.ProcessId + ': ' + e.message);
      }
    }
    await JEDA_MS(1500);
  }
  console.log('    total dihentikan: ' + dihentikan);

  await JEDA_MS(3000);
  const sisa = rantai();
  if (sisa.length) {
    console.log('\n    MASIH ADA SISA — proses mungkin menyalakannya ulang:');
    for (const p of sisa) console.log('      pid=' + p.ProcessId + '  ' + jenis(p));
    console.log('\n    BERHENTI: jangan menyalakan ulang di atas rantai yang belum bersih.');
    process.exit(1);
  }
  console.log('    rantai bersih: tidak ada sisa');

  // ── 3. Nyalakan ulang lewat tugas resmi ────────────────────
  console.log('\n[3] Menjalankan Start-ScheduledTask BCODE-JAGA-PUSH');
  const hasil = ps('Start-ScheduledTask -TaskName "BCODE-JAGA-PUSH"; Start-Sleep -Seconds 3; "ok"');
  if (!hasil.includes('ok')) console.log('    keluaran: ' + hasil);

  // Tunggu penjaga menyalakan agen (jeda internal ~10-20 detik).
  let akhir = [];
  for (let i = 0; i < 12; i++) {
    await JEDA_MS(5000);
    akhir = rantai();
    const adaAgen = akhir.some((p) => /push-agen\.js/.test(String(p.CommandLine || '')));
    const adaPenjaga = akhir.some((p) => /jaga-push\.js/.test(String(p.CommandLine || '')));
    if (adaAgen && adaPenjaga) break;
  }

  // ── 4. Verifikasi ──────────────────────────────────────────
  console.log('\n[4] Rantai sesudah dinyalakan');
  for (const p of akhir) {
    console.log('    pid=' + String(p.ProcessId).padStart(6) + '  ' + jenis(p));
  }

  const nAgen = akhir.filter((p) => /push-agen\.js/.test(String(p.CommandLine || ''))).length;
  const nPenjaga = akhir.filter((p) => /jaga-push\.js/.test(String(p.CommandLine || ''))).length;
  const nWrapper = akhir.filter((p) => p.Name === 'powershell.exe').length;

  console.log('');
  console.log('    push-agen  : ' + nAgen + (nAgen === 1 ? '  OK' : '  MASALAH (harus tepat 1)'));
  console.log('    jaga-push  : ' + nPenjaga + (nPenjaga === 1 ? '  OK' : '  MASALAH (harus tepat 1)'));
  console.log('    wrapper    : ' + nWrapper + (nWrapper >= 1 ? '  OK' : '  MASALAH (tidak ada yang menjalankan penjaga)'));

  if (nAgen !== 1 || nPenjaga !== 1) {
    console.log('\n  GAGAL: jumlah proses tidak sesuai. Periksa logs\\jaga-push.log');
    process.exit(1);
  }
  console.log('\nBERHASIL: rantai bersih, tepat satu penjaga dan satu agen.');
  console.log('Agen sekarang memakai isi boot\\push-agen.env yang TERBARU.');
})().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
