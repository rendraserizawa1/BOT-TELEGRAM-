'use strict';
/**
 * Periksa KESEGARAN data iPos KEFA lokal, tulis hasil ke JSON (ASCII murni)
 * supaya tidak terpotong oleh PowerShell/terminal.
 */
const fs = require('fs');
const ENV = 'C:\\Users\\rdpadmin\\ipos-api\\.env';
const BASE = 'http://127.0.0.1:8080';
const OUT = 'C:\\BOT-TELEGRAM-\\boot\\_segar-kefa.json';

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
const hasil = { waktu: new Date().toISOString(), langkah: [] };
const catat = (k, v) => { hasil.langkah.push({ k, v }); };

const get = async (u) => {
  const r = await fetch(BASE + u, { headers: { 'x-api-key': KEY }, signal: AbortSignal.timeout(90000) });
  return { status: r.status, j: await r.json().catch(() => null) };
};
const umur = (iso) => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 1000) : null;
};

(async () => {
  try {
    const h = await get('/ipos/health');
    catat('health', {
      status: h.status, ok: h.j && h.j.ok, items: h.j && h.j.items,
      lastSync: h.j && h.j.lastSync, umurItemDetik: umur(h.j && h.j.lastSync),
      lastError: h.j && h.j.lastError,
      jual: h.j && h.j.jual,
    });

    const hariIni = new Date().toISOString().slice(0, 10);
    const kemarin = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    for (const tgl of [hariIni, kemarin]) {
      const r = await get('/ipos/api/jual?dari=' + tgl + '&sampai=' + tgl);
      const j = r.j || {};
      catat('jual_' + tgl, {
        status: r.status, siap: j.siap, error: j.error || null,
        total: j.total || null,
        update: j.update || null, umurUpdateDetik: umur(j.update),
        jangkauan: j.jangkauan || null,
        promoSiap: j.promoSiap, promoTotal: j.promo ? j.promo.total : null,
        kasir: Array.isArray(j.kasir) ? j.kasir.slice(0, 6) : null,
        jumlahKasir: Array.isArray(j.kasir) ? j.kasir.length : null,
      });
    }

    const a = await get('/ipos/api/jual?dari=' + hariIni + '&sampai=' + hariIni);
    await new Promise((r) => setTimeout(r, 6000));
    const b = await get('/ipos/api/jual?dari=' + hariIni + '&sampai=' + hariIni);
    catat('bukti_cache', {
      update1: a.j && a.j.update, update2: b.j && b.j.update,
      sama: (a.j && a.j.update) === (b.j && b.j.update),
      nota1: a.j && a.j.total && a.j.total.nota, nota2: b.j && b.j.total && b.j.total.nota,
    });
  } catch (e) {
    catat('FATAL', { message: String(e && e.message), stack: String(e && e.stack).slice(0, 500) });
  }
  fs.writeFileSync(OUT, JSON.stringify(hasil, null, 2), 'utf8');
  console.log('SELESAI -> ' + OUT + ' langkah=' + hasil.langkah.length);
})();
