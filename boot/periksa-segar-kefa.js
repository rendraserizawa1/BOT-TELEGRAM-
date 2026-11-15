'use strict';
/**
 * Periksa KESEGARAN data iPos KEFA lokal — bukan hanya "HTTP 200".
 * Mengukur: umur refresh jual, umur item, dan apakah tanggal hari ini
 * benar-benar terisi di laporan.
 */
const fs = require('fs');
const ENV = 'C:\\Users\\rdpadmin\\ipos-api\\.env';
const BASE = 'http://127.0.0.1:8080';

function bacaEnv(p) {
  const out = {};
  for (const baris of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}
const KEY = bacaEnv(ENV).API_KEY || '';

const get = async (u) => {
  const r = await fetch(BASE + u, { headers: { 'x-api-key': KEY }, signal: AbortSignal.timeout(90000) });
  return { status: r.status, j: await r.json().catch(() => null) };
};

const umur = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.round((Date.now() - t) / 1000);
};

(async () => {
  const h = await get('/ipos/health');
  console.log('=== HEALTH KEFA ===');
  console.log('  ok=' + h.j.ok + ' items=' + h.j.items + ' lastSync=' + h.j.lastSync +
              ' umurItem=' + umur(h.j.lastSync) + 's');
  console.log('  jual.siap=' + h.j.jual.siap + ' nota=' + h.j.jual.nota +
              ' dari=' + h.j.jual.dari + ' sampai=' + h.j.jual.sampai);
  console.log('  jual.err=' + (h.j.jual.err || '(kosong)'));

  const hariIni = new Date().toISOString().slice(0, 10);
  const kemarin = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  for (const tgl of [hariIni, kemarin]) {
    const r = await get('/ipos/api/jual?dari=' + tgl + '&sampai=' + tgl);
    const j = r.j || {};
    console.log('\n=== /api/jual ' + tgl + ' ===');
    console.log('  HTTP ' + r.status + ' siap=' + j.siap);
    if (j.total) console.log('  nota=' + j.total.nota + ' omzet=' + j.total.omzet + ' kasir=' + j.total.kasir + ' item=' + j.total.item);
    if (j.update) console.log('  update=' + j.update + '  umurUpdate=' + umur(j.update) + 's');
    if (j.jangkauan) console.log('  jangkauan=' + j.jangkauan.dari + ' .. ' + j.jangkauan.sampai);
    if (j.error) console.log('  error=' + j.error);
    if (Array.isArray(j.kasir) && j.kasir.length) {
      j.kasir.slice(0, 5).forEach((k) => console.log('    kasir ' + k.nama + ' nota=' + k.nota + ' omzet=' + k.omzet + ' jam=' + k.jam));
    }
    if (j.promo) console.log('  promo.nota=' + (j.promo.total ? j.promo.total.nota : '?') + ' promoSiap=' + j.promoSiap);
  }

  // dua panggilan berjarak untuk membuktikan cache bergerak / tidak
  const a = await get('/ipos/api/jual?dari=' + hariIni + '&sampai=' + hariIni);
  await new Promise((r) => setTimeout(r, 6000));
  const b = await get('/ipos/api/jual?dari=' + hariIni + '&sampai=' + hariIni);
  console.log('\n=== BUKTI CACHE BERGERAK (2 panggilan, 6s) ===');
  console.log('  update-1=' + (a.j && a.j.update));
  console.log('  update-2=' + (b.j && b.j.update));
  console.log('  sama=' + ((a.j && a.j.update) === (b.j && b.j.update)));
})();
