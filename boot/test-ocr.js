// Uji OCR end-to-end lewat dashboard.
// - Login memakai kredensial dari .env (tidak pernah dicetak).
// - Memanggil /api/selftest/ocr yang merender gambar sintetis lalu membacanya
//   dengan provider vision yang sama seperti fitur scan foto.
// Jalankan: node boot/test-ocr.js
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3001';

function readEnv() {
  const map = {};
  const txt = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    map[m[1]] = v;
  }
  return map;
}

(async () => {
  const env = readEnv();
  const user = env.DASHBOARD_USER || 'admin';
  const pass = env.DASHBOARD_PASS;
  if (!pass) { console.log('DASHBOARD_PASS tidak ada di .env'); process.exit(1); }
  console.log(`credential loaded: user_len=${user.length} pass_len=${pass.length}`);

  // 1) login
  const body = new URLSearchParams({ username: user, password: pass });
  const lr = await fetch(`${BASE}/login`, {
    method: 'POST',
    body,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    signal: AbortSignal.timeout(30000),
  });
  const setCookie = lr.headers.getSetCookie ? lr.headers.getSetCookie() : [];
  const cookie = setCookie.map((c) => c.split(';')[0]).join('; ');
  console.log(`login status=${lr.status} location=${lr.headers.get('location')} cookie=${cookie ? 'yes' : 'no'}`);
  if (!cookie) { console.log('LOGIN GAGAL: tidak ada cookie sesi'); process.exit(1); }

  // 2) self-test OCR
  const t0 = Date.now();
  const r = await fetch(`${BASE}/api/selftest/ocr`, {
    headers: { Cookie: cookie },
    signal: AbortSignal.timeout(240000),
  });
  const txt = await r.text();
  console.log(`ocr status=${r.status} elapsed=${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log('--- BODY ---');
  console.log(txt);
  let ok = false;
  try { ok = JSON.parse(txt).ok === true; } catch (e) {}
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.log('ERR', e.name, e.message); process.exit(1); });
