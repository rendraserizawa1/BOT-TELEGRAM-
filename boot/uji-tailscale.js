'use strict';
/**
 * UJI JALUR TAILSCALE — dijalankan DI DALAM container Railway.
 *
 *   railway ssh --service kefa-bot "node /app/boot/uji-tailscale.js"
 *
 * Yang dibuktikan:
 *   1. proxy Tailscale dikonfigurasi
 *   2. proxy benar-benar menjawab (bukan ECONNREFUSED)
 *   3. tailscaled BackendState = Running
 *   4. iPos CP terjangkau lewat proxy
 *   5. iPos NK terjangkau lewat proxy (boleh LEWAT bila sumbernya memang mati)
 *   6. iPos KEFA terjangkau lewat proxy
 *   7. SSE menerima >= 3 potongan dalam 60 dtk (inti "realtime")
 *   8. Telegram TIDAK lewat proxy (harus langsung)
 *
 * Keluar 1 bila ada yang GAGAL. `[LEWAT]` tidak dihitung gagal.
 */
const { execFileSync } = require('child_process');

const hasil = [];
const tambah = (nama, status, detail) => {
  hasil.push({ nama, status, detail: detail == null ? '' : String(detail) });
  const label = status === 'LULUS' ? '[LULUS]' : (status === 'LEWAT' ? '[LEWAT]' : '[GAGAL]');
  console.log('  ' + label + ' ' + nama.padEnd(46) + (detail == null ? '' : String(detail)));
};

const PROXY = String(process.env.IPOS_TAILSCALE_PROXY || 'http://127.0.0.1:1056').trim();

/**
 * Alamat iPos di tailnet. Sengaja TIDAK memakai IPOS_*_URL, karena saat uji ini
 * dijalankan URL itu masih menunjuk tunnel publik — mengujinya lewat tailnet
 * hanya menghasilkan kegagalan yang membingungkan.
 *
 * Bisa ditimpa dengan UJI_TARGETS="kefa=http://...,cp=http://...".
 */
const TAILNET = {
  cp: 'http://100.125.99.99:8080/ipos',
  nk: 'http://100.110.152.33:8080/ipos',
  kefa: 'http://100.123.166.13:8080/ipos',
};
if (process.env.UJI_TARGETS) {
  for (const bagian of process.env.UJI_TARGETS.split(',')) {
    const m = bagian.match(/^\s*([a-z]+)\s*=\s*(\S+)\s*$/i);
    if (m) TAILNET[m[1].toLowerCase()] = m[2];
  }
}

const KUNCI = {
  cp: process.env.IPOS_KEY || '',
  nk: process.env.IPOS_NK_KEY || '',
  kefa: process.env.IPOS_KEFA_KEY || '',
};

function dispatcher() {
  if (!PROXY) return null;
  try {
    const { ProxyAgent } = require('undici');
    return new ProxyAgent(PROXY);
  } catch (e) {
    console.log('  (undici tidak tersedia: ' + String(e.message).slice(0, 80) + ')');
    return null;
  }
}

async function ambil(url, opsi, pakaiProxy) {
  const disp = pakaiProxy ? dispatcher() : null;
  const o = disp ? { ...opsi, dispatcher: disp } : (opsi || {});
  return fetch(url, o);
}

function statusTailscale() {
  try {
    const out = execFileSync('tailscale', ['status', '--json'], {
      encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const j = JSON.parse(out);
    return { ok: true, backend: j.BackendState, diri: j.Self && j.Self.HostName, jumlahPeer: Object.keys(j.Peer || {}).length };
  } catch (e) {
    return { ok: false, err: String((e.stderr || e.message)).slice(0, 160) };
  }
}

(async () => {
  console.log('=== UJI JALUR TAILSCALE (di dalam container) ===');
  console.log('  proxy   = ' + (PROXY || '(kosong)'));
  console.log('  CP      = ' + (TAILNET.cp || '(kosong)'));
  console.log('  NK      = ' + (TAILNET.nk || '(kosong)'));
  console.log('  KEFA    = ' + (TAILNET.kefa || '(kosong)'));
  console.log('  (nilai kunci tidak ditampilkan)\n');

  // 1. proxy dikonfigurasi
  tambah('proxy tailscale dipakai', PROXY ? 'LULUS' : 'GAGAL', PROXY || 'tidak ada proxy');

  // 2. proxy menjawab (bukan ECONNREFUSED ke proxy itu sendiri)
  if (PROXY) {
    try {
      await ambil('http://10.255.255.1/health', { signal: AbortSignal.timeout(6000) }, true);
      tambah('proxy menjawab', 'LULUS', 'permintaan diteruskan');
    } catch (e) {
      const kode = (e.cause && e.cause.code) || '';
      if (kode === 'ECONNREFUSED' || /ECONNREFUSED/.test(String(e.message))) {
        tambah('proxy menjawab', 'GAGAL', 'ECONNREFUSED ke ' + PROXY + ' — tailscaled tidak jalan?');
      } else {
        tambah('proxy menjawab', 'LULUS', 'proxy hidup, target tak terjangkau (' + (kode || 'timeout') + ')');
      }
    }
  } else {
    tambah('proxy menjawab', 'GAGAL', 'dilewati: proxy kosong');
  }

  // 3. tailscaled Running
  const ts = statusTailscale();
  if (!ts.ok) {
    tambah('tailscaled BackendState=Running', 'GAGAL', ts.err);
  } else {
    tambah('tailscaled BackendState=Running', ts.backend === 'Running' ? 'LULUS' : 'GAGAL',
      'backend=' + ts.backend + ' host=' + (ts.diri || '?') + ' peer=' + ts.jumlahPeer);
  }

  // 4-6. tiap iPos
  for (const tk of ['cp', 'nk', 'kefa']) {
    const u = TAILNET[tk];
    if (!u) { tambah('iPos ' + tk.toUpperCase() + ' terjangkau', 'LEWAT', 'URL kosong'); continue; }
    try {
      const r = await ambil(u + '/health', { signal: AbortSignal.timeout(15000) }, true);
      const j = await r.json().catch(() => null);
      if (r.status === 200 && j && j.ok) {
        tambah('iPos ' + tk.toUpperCase() + ' terjangkau', 'LULUS', 'items=' + j.items);
      } else {
        tambah('iPos ' + tk.toUpperCase() + ' terjangkau', 'GAGAL', 'HTTP ' + r.status);
      }
    } catch (e) {
      const kode = (e.cause && e.cause.code) || e.name || '';
      // Sumber mati (listrik padam) BUKAN kegagalan proxy. Bedakan dengan jelas.
      const sumberMati = /ETIMEDOUT|EHOSTUNREACH|ENETUNREACH|ENOTFOUND|ECONNREFUSED/i.test(String(kode) + String(e.message));
      tambah('iPos ' + tk.toUpperCase() + ' terjangkau', sumberMati ? 'LEWAT' : 'GAGAL',
        sumberMati ? 'sumber mati (' + kode + ') — bukan cacat proxy' : (kode + ' ' + String(e.message).slice(0, 80)));
    }
  }

  // 7. SSE menerima byte bertahap
  const uKefa = TAILNET.kefa || TAILNET.cp;
  if (!uKefa) {
    tambah('SSE menerima >=3 potongan / 60 dtk', 'LEWAT', 'tidak ada URL');
  } else {
    let potongan = 0, byte = 0, ping = 0;
    const ac = new AbortController();
    const batas = setTimeout(() => ac.abort(), 60000);
    try {
      const r = await ambil(uKefa + '/api/events?key=' + encodeURIComponent(KUNCI.kefa || KUNCI.cp || ''),
        { headers: { accept: 'text/event-stream' }, signal: ac.signal }, true);
      if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      const sampai = Date.now() + 20000; // 20 dtk cukup untuk >=3 ping (ping tiap 15 dtk -> longgarkan)
      while (Date.now() < sampai) {
        const { done, value } = await reader.read();
        if (done) break;
        byte += value.length;
        potongan++;
        ping += (dec.decode(value, { stream: true }).match(/: ping/g) || []).length;
      }
      try { reader.cancel(); } catch (_) { /* abaikan */ }
      tambah('SSE menerima >=3 potongan / 60 dtk', potongan >= 3 ? 'LULUS' : 'GAGAL',
        'potongan=' + potongan + ' byte=' + byte + ' ping=' + ping);
    } catch (e) {
      if (e.name === 'AbortError') tambah('SSE menerima >=3 potongan / 60 dtk', potongan >= 3 ? 'LULUS' : 'GAGAL', 'batas waktu, potongan=' + potongan);
      else tambah('SSE menerima >=3 potongan / 60 dtk', 'GAGAL', (e.cause && e.cause.code) || String(e.message).slice(0, 100));
    } finally {
      clearTimeout(batas);
    }
  }

  // 8. Telegram TIDAK lewat proxy
  try {
    const r = await ambil('https://api.telegram.org/', { signal: AbortSignal.timeout(15000) }, false);
    tambah('Telegram TIDAK lewat proxy', r.status > 0 ? 'LULUS' : 'GAGAL', 'HTTP ' + r.status + ' (langsung)');
  } catch (e) {
    tambah('Telegram TIDAK lewat proxy', 'GAGAL', (e.cause && e.cause.code) || String(e.message).slice(0, 100));
  }

  const gagal = hasil.filter((h) => h.status === 'GAGAL');
  const lulus = hasil.filter((h) => h.status === 'LULUS');
  const lewat = hasil.filter((h) => h.status === 'LEWAT');
  console.log('\n=== RINGKASAN ===');
  console.log('  lulus ' + lulus.length + ' | lewat ' + lewat.length + ' | gagal ' + gagal.length);
  if (gagal.length) {
    console.log('  GAGAL:');
    gagal.forEach((g) => console.log('    - ' + g.nama + ' (' + g.detail + ')'));
    process.exit(1);
  }
  console.log('  SEMUA TERPENUHI');
})();
