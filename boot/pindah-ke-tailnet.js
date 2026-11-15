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
    console.log('  IPOS_KEFA_URL diset ke jalur tailnet');
  } catch (e) {
    console.log('  GAGAL set variabel: ' + String(e.stderr || e.message).slice(0, 200));
    process.exit(1);
  }

  console.log('  menunggu Railway menerapkan variabel (45 dtk)...');
  await tunggu(45000);

  // ── 4. Pantau ─────────────────────────────────────────────────────────
  console.log('\n--- MEMANTAU (inti pembuktian) ---');
  console.log('  umurKoneksiDetik harus NAIK TERUS. Reset ke 0 = sambungan diputus.\n');

  const jejak = [];
  let reset = 0;
  let sebelumnya = null;
  const sampai = Date.now() + MENIT * 60000;

  while (Date.now() < sampai) {
    let h;
    try {
      h = await health();
    } catch (e) {
      console.log('  (health gagal: ' + e.message + ')');
      await tunggu(30000);
      continue;
    }
    const k = h.ipos && h.ipos.kefa;
    if (!k) { await tunggu(30000); continue; }

    const umur = Number(k.umurKoneksiDetik);
    const naik = sebelumnya === null ? null : umur > sebelumnya;
    if (sebelumnya !== null && umur < sebelumnya) reset++;

    const baris =
      'umur=' + String(umur).padStart(4) + 's' +
      ' online=' + String(k.online).padEnd(5) +
      ' sse=' + String(k.sse).padEnd(5) +
      ' total=' + String(k.total).padEnd(5) +
      ' itemSegar=' + String(k.itemSegar).padEnd(5) +
      ' jalur=' + ((k.jalur && k.jalur.jalurDipakai) || '-') +
      (naik === null ? '' : (naik ? '  naik' : '  TURUN'));
    console.log('  ' + baris);

    jejak.push({ umur, online: k.online, sse: k.sse, total: k.total, dipakai: k.jalur && k.jalur.jalurDipakai });
    sebelumnya = umur;
    await tunggu(30000);
  }

  // ── 5. Putuskan ───────────────────────────────────────────────────────
  const akhir = jejak[jejak.length - 1] || {};
  const hidup = jejak.filter((j) => j.online).length;
  const lulus = hidup === jejak.length && reset === 0 && Number(akhir.umur) > 0;

  console.log('\n=== HASIL ===');
  console.log('  sampel            = ' + jejak.length);
  console.log('  sampel online     = ' + hidup + '/' + jejak.length);
  console.log('  jumlah reset      = ' + reset + '  (0 = tidak pernah putus)');
  console.log('  umur akhir        = ' + akhir.umur + 's');
  console.log('  jalur dipakai     = ' + (akhir.dipakai || '-'));

  if (lulus) {
    console.log('\n  LULUS — iPos KEFA stabil lewat tailnet tanpa putus.');
    console.log('  Langkah berikutnya: node boot\\pensiun-tunnel.js');
    process.exit(0);
  }

  console.log('\n  GAGAL — mengembalikan ke URL tunnel sebelumnya.');
  if (k0 && k0.url) {
    try {
      railway(['variables', '--service', SERVICE, '--set', 'IPOS_KEFA_URL=' + k0.url]);
      console.log('  IPOS_KEFA_URL dikembalikan ke: ' + k0.url);
    } catch (e) {
      console.log('  PERINGATAN: rollback gagal, lakukan manual: ' + String(e.message).slice(0, 150));
    }
  }
  process.exit(1);
})().catch((e) => { console.log('FATAL: ' + e.message); process.exit(1); });
