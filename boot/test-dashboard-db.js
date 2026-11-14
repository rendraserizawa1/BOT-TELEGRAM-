// Verifikasi dashboard database end-to-end (login + API + download file).
// Tidak mencetak kredensial.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BASE = process.env.TEST_BASE || 'http://127.0.0.1:3001';

function readEnv() {
  const map = {};
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    map[m[1]] = v;
  }
  return map;
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -> ' + detail : ''}`);
}

(async () => {
  const env = readEnv();
  const body = new URLSearchParams({ username: env.DASHBOARD_USER || 'admin', password: env.DASHBOARD_PASS || '' });
  const lr = await fetch(`${BASE}/login`, { method: 'POST', body, redirect: 'manual', signal: AbortSignal.timeout(30000) });
  const cookie = (lr.headers.getSetCookie ? lr.headers.getSetCookie() : []).map((c) => c.split(';')[0]).join('; ');
  check('login dashboard', lr.status === 302 && !!cookie, `status=${lr.status}`);

  // Tanpa cookie harus ditolak
  const anon = await fetch(`${BASE}/database`, { redirect: 'manual', signal: AbortSignal.timeout(30000) });
  check('halaman /database menolak tanpa login', anon.status === 302, `status=${anon.status}`);

  const dbPage = await fetch(`${BASE}/database`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(60000) });
  const dbHtml = await dbPage.text();
  check('halaman /database terbuka', dbPage.status === 200 && dbHtml.length > 500, `status=${dbPage.status} bytes=${dbHtml.length}`);

  const stats = await fetch(`${BASE}/api/db/stats`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
  const statsJson = await stats.json();
  check('API /api/db/stats', stats.status === 200 && statsJson.ready === true,
    `messages=${statsJson.messages} files=${statsJson.files} events=${statsJson.events} backups=${statsJson.backups}`);

  for (const table of ['messages', 'events', 'files', 'sessions', 'backups', 'outbox', 'tasks', 'credentials']) {
    const r = await fetch(`${BASE}/api/db/${table}?limit=5`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    check(`API tabel ${table}`, r.status === 200 && Array.isArray(j.data), `rows=${j.data ? j.data.length : 'n/a'}`);
  }

  // Unduh file arsip pertama yang punya local_path
  const filesRes = await fetch(`${BASE}/api/db/files?limit=50`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(30000) });
  const filesJson = await filesRes.json();
  const withPath = (filesJson.data || []).find((f) => f.local_path);
  if (!withPath) {
    check('unduh file arsip', false, 'tidak ada file dengan local_path');
  } else {
    const dl = await fetch(`${BASE}/database/file/${withPath.id}`, { headers: { Cookie: cookie }, signal: AbortSignal.timeout(60000) });
    const buf = Buffer.from(await dl.arrayBuffer());
    const onDisk = fs.existsSync(withPath.local_path) ? fs.statSync(withPath.local_path).size : -1;
    check('unduh file arsip', dl.status === 200 && buf.length === onDisk,
      `id=${withPath.id} bytes=${buf.length} onDisk=${onDisk} cd=${dl.headers.get('content-disposition') ? 'yes' : 'no'}`);
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nRINGKASAN: ${results.length - failed.length}/${results.length} PASS`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.log('ERR', e.name, e.message); process.exit(1); });
