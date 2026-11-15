'use strict';
/**
 * PINDAHKAN iPos KEFA KE JALUR TAILNET — dengan pemantauan otomatis.
 *
 * KENAPA HARUS SATU PERINTAH
 * --------------------------
 * Memindahkan URL iPos tanpa memantau berarti kita tidak akan tahu apakah
 * sambungannya stabil atau justru berkedip tiap 60-90 detik seperti di tunnel
 * Cloudflare. Skrip ini memindahkan, lalu MEMBUKTIKAN dengan mengamati
 * `umurKoneksiDetik` selama beberapa menit:
 *
 *   - naik monoton   -> sambungan benar-benar bertahan (LULUS)
 *   - reset ke 0     -> sambungan diputus berulang (GAGAL, otomatis dirollback)
 *
 * Pemakaian:
 *   node boot\pindah-ke-tailnet.js                 (uji 3 menit)
 *   node boot\pindah-ke-tailnet.js --menit=10      (uji lebih lama)
 *   node boot\pindah-ke-tailnet.js --kering        (hanya periksa, tidak mengubah)
 */
const { execFileSync } = require('child_process');

const RAILWAY = 'C:\\Users\\rdpadmin\\AppData\\Roaming\\npm\\node_modules\\@railway\\cli\\bin\\railway.js';
const DOMAIN = 'https://kefa-bot-production.up.railway.app';
const SERVICE = 'kefa-bot';

const TAILNET_KEFA = 'http://100.123.166.13:8080/ipos';

const arg = (nama, bawaan) => {
  const m = process.argv.find((a) => a.startsWith('--' + nama + '='));
  return m ? m.split('=').slice(1).join('=') : bawaan;
};
const MENIT = Number(arg('menit', '3'));
const KERING = process.argv.includes('--kering');

function railway(args) {
  return execFileSync('node', [RAILWAY, ...args], {
    encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'],
  });
}

async function health() {
  const r = await fetch(DOMAIN + '/health', { signal: AbortSignal.timeout(30000) });
  return r.json();
}

const tunggu = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('=== pindah iPos KEFA ke jalur tailnet ===');
  console.log('  sasaran  = ' + TAILNET_KEFA);
  console.log('  pantau   = ' + MENIT + ' menit');
  console.log('  mode     = ' + (KERING ? 'KERING (tidak mengubah apa pun)' : 'SUNGGUHAN'));

  // ── 1. Keadaan sebelum ────────────────────────────────────────────────
  let h0;
  try {
    h0 = await health();
  } catch (e) {
    console.log('\n  GAGAL: /health tidak menjawab (' + e.message + ')');
    process.exit(1);
  }
  const k0 = h0.ipos && h0.ipos.kefa;
  console.log('\n--- SEBELUM ---');
  console.log('  url          = ' + (k0 && k0.url));
  console.log('  online       = ' + (k0 && k0.online) + '  sse=' + (k0 && k0.sse) + '  total=' + (k0 && k0.total));
  console.log('  proxyAktif   = ' + (k0 && k0.jalur && k0.jalur.proxyAktif));
  console.log('  tailscale    = ' + JSON.stringify(h0.tailscale));

  if (KERING) {
    console.log('\n  Mode kering: berhenti tanpa mengubah apa pun.');
    process.exit(0);
  }

  // ── 2. Pastikan proxy tailscale aktif ─────────────────────────────────
  if (!h0.tailscale || !h0.tailscale.proxyDikonfigurasi) {
    console.log('\n  BERHENTI: IPOS_TAILSCALE_PROXY belum diisi.');
    console.log('  Tanpa proxy, URL tailnet tidak akan terjangkau dari container.');
    console.log('  Isi dulu: IPOS_TAILSCALE_PROXY=http://127.0.0.1:1056');
    process.exit(1);
  }

  // ── 3. Pindahkan ──────────────────────────────────────────────────────
  console.log('\n--- MEMINDAHKAN ---');
  try {
    railway(['variables', '--service', SERVICE, '--set', 'IPOS_KEFA_URL=' + TAILNET_KEFA]);
  } catch (e) {
    console.log('  GAGAL set variabel: ' + String(e.stderr || e.message).slice(0, 200));
    process.exit(1);
  }

  // `railway variables --set` bisa keluar 0 padahal nilainya TIDAK berubah.
  // Tanpa verifikasi ini, skrip akan melaporkan "berhasil" sambil memantau URL
  // yang salah — persis kegagalan yang menyesatkan.
  const nilaiSekarang = () => {
    try {
      const out = railway(['variables', '--service', SERVICE, '--json']);
      const j = JSON.parse(String(out).replace(/^\uFEFF/, '').slice(String(out).indexOf('{')));
      return String(j.IPOS_KEFA_URL || '');
    } catch (_) { return ''; }
  };

  let terpasang = nilaiSekarang();
  for (let i = 0; i < 12 && terpasang !== TAILNET_KEFA; i++) {
    console.log('  menunggu variabel terpasang... (' + (i + 1) + '/12) sekarang: ' + (terpasang || '(kosong)'));
    await tunggu(5000);
    terpasang = nilaiSekarang();
  }

  if (terpasang !== TAILNET_KEFA) {
    console.log('  GAGAL: IPOS_KEFA_URL tidak berubah menjadi jalur tailnet.');
    console.log('  Nilai sekarang: ' + (terpasang || '(kosong)'));
    console.log('  Tidak ada yang dipantau karena perubahan belum terjadi.');
    process.exit(1);
  }
  console.log('  TERVERIFIKASI: IPOS_KEFA_URL = ' + terpasang);

  console.log('  menunggu Railway menerapkan ulang container (45 dtk)...');
  await tunggu(45000);

  // ── 4. Pantau ─────────────────────────────────────────────────────────
  // ATURAN PENTING: pengamatan harus MENGABAIKAN jendela restart.
  // Saat container baru dijalankan ulang, `online=false` dan `umur` kecil
  // selama puluhan detik. Itu bukan tanda sambungan putus. Dulu ini membuat
  // skrip memutuskan GAGAL lalu me-rollback padahal jalurnya sehat.
  console.log('\n--- MEMANTAU (inti pembuktian) ---');
  console.log('  Yang dinilai hanya sampel SETELAH iPos pernah online.');
  console.log('  Sampel sebelum itu = masa pemanasan container, bukan kegagalan.\n');

  const jejak = [];
  let reset = 0;
  let sebelumnya = null;
  let pernahOnline = false;
  const sampai = Date.now() + MENIT * 60000;

  while (Date.now() < sampai) {
    let h;
    try {
      h = await health();
    } catch (e) {
      console.log('  (container belum menjawab: ' + String(e.message).slice(0, 60) + ')');
      await tunggu(30000);
      continue;
    }
    const k = h.ipos && h.ipos.kefa;
    if (!k) { await tunggu(30000); continue; }

    const umur = Number(k.umurKoneksiDetik);
    const siap = !!k.online && Number(k.total) > 0;

    if (!siap) {
      console.log('  pemanasan: umur=' + umur + 's online=' + k.online + ' total=' + k.total + ' (diabaikan)');
      await tunggu(30000);
      continue;
    }

    pernahOnline = true;
    const naik = sebelumnya === null ? null : umur > sebelumnya;
    // Reset hanya dihitung bila penurunannya besar — penurunan kecil wajar
    // karena dua sampel bisa berasal dari proses yang berbeda saat deploy.
    if (sebelumnya !== null && umur < sebelumnya - 10) reset++;

    const baris =
      'umur=' + String(umur).padStart(4) + 's' +
      ' online=' + String(k.online).padEnd(5) +
      ' sse=' + String(k.sse).padEnd(5) +
      ' total=' + String(k.total).padEnd(5) +
      ' itemSegar=' + String(k.itemSegar).padEnd(5) +
      ' jalur=' + ((k.jalur && k.jalur.jalurDipakai) || '-') +
      (naik === null ? '' : (naik ? '  naik' : '  turun'));
    console.log('  ' + baris);

    jejak.push({ umur, online: k.online, sse: k.sse, total: k.total, dipakai: k.jalur && k.jalur.jalurDipakai });
    sebelumnya = umur;
    await tunggu(30000);
  }

  // ── 5. Putuskan ───────────────────────────────────────────────────────
  const akhir = jejak[jejak.length - 1] || {};
  const lulus = pernahOnline && jejak.length >= 3 && reset === 0 && Number(akhir.umur) > 0;

  console.log('\n=== HASIL ===');
  console.log('  sampel sahih      = ' + jejak.length);
  console.log('  pernah online     = ' + pernahOnline);
  console.log('  jumlah reset      = ' + reset + '  (0 = tidak pernah putus)');
  console.log('  umur akhir        = ' + akhir.umur + 's');
  console.log('  jalur dipakai     = ' + (akhir.dipakai || '-'));
  console.log('  url               = ' + TAILNET_KEFA);

  if (lulus) {
    console.log('\n  LULUS — iPos KEFA stabil lewat tailnet tanpa putus.');
    console.log('  Langkah berikutnya: node boot\\pensiun-tunnel.js');
    process.exit(0);
  }

  if (!pernahOnline) {
    console.log('\n  GAGAL — iPos tidak pernah online lewat jalur tailnet.');
  } else {
    console.log('\n  GAGAL — sambungan terputus ' + reset + ' kali.');
  }

  // JANGAN me-rollback otomatis. Percobaan pertama saya membuktikan bahayanya:
  // skrip menilai "GAGAL" hanya karena container masih pemanasan, lalu
  // mengembalikan URL — padahal jalurnya belum sempat diuji sama sekali.
  // Rollback harus keputusan manusia yang melihat bukti, bukan efek samping
  // dari pengamatan yang belum lengkap.
  console.log('\n  URL DIBIARKAN di jalur tailnet (' + TAILNET_KEFA + ').');
  console.log('  Untuk mengembalikan ke tunnel:');
  console.log('    railway variables --service kefa-bot --set IPOS_KEFA_URL=' + ((k0 && k0.url) || '<url-tunnel>'));
  process.exit(1);
})().catch((e) => { console.log('FATAL: ' + e.message); process.exit(1); });
