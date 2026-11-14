'use strict';
/**
 * Bandingkan proxy CP LOKAL (8081) vs proxy CP ASLI (100.125.99.99:8080).
 * Tujuan: buktikan penggantinya setara, dan data lokal lebih SEGAR.
 */

const fs = require('fs');
const path = require('path');

function bacaEnv(file) {
  const out = {};
  for (const baris of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = baris.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

const env = bacaEnv('C:\\BOT-TELEGRAM-\\.env');
const KEY = env.IPOS_KEY;
const out = [];

const hari = new Date().toISOString().slice(0, 10);

async function ambil(base, label, ep) {
  const url = base + ep + (ep.includes('?') ? '&' : '?') + 'key=' + encodeURIComponent(KEY);
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(45000) });
    const t = await r.text();
    if (!r.ok) { out.push(`  ${label} ${ep} -> HTTP ${r.status} ${t.slice(0, 120)}`); return null; }
    return JSON.parse(t);
  } catch (e) {
    out.push(`  ${label} ${ep} -> GAGAL ${e.message}`);
    return null;
  }
}

function ringkasJual(o) {
  if (!o) return 'null';
  return `siap=${o.siap} nota=${o.total && o.total.nota} omzet=${o.total && o.total.omzet} ` +
    `kasir=${o.total && o.total.kasir} promoNota=${o.promo && o.promo.nota} ` +
    `promoOmzet=${o.promo && o.promo.omzet} update=${o.update} (${new Date(o.update).toISOString()})`;
}

(async () => {
  out.push('HARI = ' + hari);
  out.push('');

  const ASLI = 'http://100.125.99.99:8080/ipos';
  const LOKAL = 'http://127.0.0.1:8081/ipos';

  out.push('=== /api/jual (laporan kasir) ===');
  const a = await ambil(ASLI, 'ASLI ', `/api/jual?dari=${hari}&sampai=${hari}`);
  out.push('  ASLI : ' + ringkasJual(a));
  const b = await ambil(LOKAL, 'LOKAL', `/api/jual?dari=${hari}&sampai=${hari}`);
  out.push('  LOKAL: ' + ringkasJual(b));

  if (a && b) {
    out.push('');
    out.push('  PERBANDINGAN:');
    const banding = [
      ['total.nota', a.total && a.total.nota, b.total && b.total.nota],
      ['total.item', a.total && a.total.item, b.total && b.total.item],
      ['total.omzet', a.total && a.total.omzet, b.total && b.total.omzet],
      ['total.tunai', a.total && a.total.tunai, b.total && b.total.tunai],
      ['total.debit', a.total && a.total.debit, b.total && b.total.debit],
      ['promo.nota', a.promo && a.promo.nota, b.promo && b.promo.nota],
      ['promo.omzet', a.promo && a.promo.omzet, b.promo && b.promo.omzet],
      ['kasir[0].userid', a.kasir && a.kasir[0] && a.kasir[0].userid, b.kasir && b.kasir[0] && b.kasir[0].userid],
      ['jangkauan.dari', a.jangkauan && a.jangkauan.dari, b.jangkauan && b.jangkauan.dari],
    ];
    for (const [n, x, y] of banding) {
      out.push(`    ${n.padEnd(18)} ASLI=${String(x).padEnd(16)} LOKAL=${String(y)}`);
    }
  }

  out.push('');
  out.push('=== /api/jual kemarin (uji rentang) ===');
  const kem = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const a2 = await ambil(ASLI, 'ASLI ', `/api/jual?dari=${kem}&sampai=${kem}`);
  out.push('  ASLI : ' + ringkasJual(a2));
  const b2 = await ambil(LOKAL, 'LOKAL', `/api/jual?dari=${kem}&sampai=${kem}`);
  out.push('  LOKAL: ' + ringkasJual(b2));

  out.push('');
  out.push('=== /health lokal ===');
  try {
    const r = await fetch(LOKAL + '/health', { signal: AbortSignal.timeout(20000) });
    const h = await r.json();
    out.push('  items=' + h.items + ' jual.nota=' + h.jual.nota + ' jual.umur=' + h.jual.umurDetik + 's err=' + h.jual.err);
    out.push('  promo.nota=' + h.jualPromo.nota + ' promo.umur=' + h.jualPromo.umurDetik + 's err=' + h.jualPromo.err);
  } catch (e) { out.push('  GAGAL: ' + e.message); }

  fs.writeFileSync('C:\\BOT-TELEGRAM-\\boot\\out-banding.json', JSON.stringify(out, null, 1), 'utf8');
  console.log('OK');
})();
