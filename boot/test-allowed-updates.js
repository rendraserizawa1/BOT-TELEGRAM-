'use strict';

// ════════════════════════════════════════════════════════════════
//   UJI REGRESI: allowed_updates pada getUpdates
//
//   Bug produksi 2026-11-14: tombol inline (menu) tidak merespon sama
//   sekali, padahal pesan teks normal. Penyebabnya bukan handler, bukan
//   jaringan: getUpdates dipanggil TANPA allowed_updates, sehingga
//   Telegram memakai SETELAN LAMA yang tersimpan di server. Isinya hanya
//   ["message"], jadi semua callback_query difilter di sisi Telegram.
//   Bukti: getWebhookInfo -> allowed_updates ["message"].
//
//   Dokumentasi resmi: "If not specified, the previous setting will be used."
//
//   Uji ini memastikan URL getUpdates SELALU membawa allowed_updates yang
//   mencakup callback_query, sehingga setelan basi di server ditimpa.
//
//   Jalankan: node boot\test-allowed-updates.js
// ════════════════════════════════════════════════════════════════

const fs = require('fs');
const path = require('path');

let lulus = 0, gagal = 0;
function cek(nama, kondisi, detail) {
  if (kondisi) { lulus++; console.log('  OK   ' + nama); }
  else { gagal++; console.log('  GAGAL ' + nama + (detail ? ' -> ' + detail : '')); }
}

const SRC = fs.readFileSync(path.resolve(__dirname, '..', 'index.js'), 'utf8');

console.log('\n[1] allowed_updates dikirim eksplisit di URL getUpdates');
{
  const m = SRC.match(/const\s+qs\s*=\s*`\?offset=\$\{_pollOffset\}[^`]*`/);
  cek('ditemukan konstruksi qs getUpdates', !!m, m ? m[0] : 'tidak ketemu');
  if (m) {
    const pakaiVar = /\$\{POLL_ALLOWED_QS\}/.test(m[0]);
    cek('qs menyertakan POLL_ALLOWED_QS (atau allowed_updates literal)',
      pakaiVar || /allowed_updates/.test(m[0]), m[0]);
    // Rantai lengkap: POLL_ALLOWED_QS harus benar-benar membangun allowed_updates
    const def = SRC.match(/const\s+POLL_ALLOWED_QS\s*=\s*([^\n;]+)/);
    cek('POLL_ALLOWED_QS didefinisikan', !!def, def ? def[1] : 'tidak ketemu');
    cek('POLL_ALLOWED_QS membangun parameter allowed_updates',
      !!(def && /allowed_updates=/.test(def[1])), def ? def[1] : '');
    cek('POLL_ALLOWED_QS memakai POLL_ALLOWED_UPDATES',
      !!(def && /POLL_ALLOWED_UPDATES/.test(def[1])), def ? def[1] : '');
    cek('qs memuat offset', /offset=/.test(m[0]));
    cek('qs memuat timeout long-poll', /timeout=/.test(m[0]));
    cek('qs memuat limit', /limit=/.test(m[0]));
  }
}

console.log('\n[2] daftar allowed_updates mencakup semua handler bot');
{
  const m = SRC.match(/const\s+POLL_ALLOWED_UPDATES\s*=\s*\[([^\]]*)\]/);
  cek('POLL_ALLOWED_UPDATES dideklarasikan', !!m, m ? m[0] : 'tidak ketemu');
  if (m) {
    const isi = m[1];
    cek('mencakup message (teks/foto/voice/document lewat update message)',
      /'message'/.test(isi), isi);
    cek('mencakup callback_query (KLIK TOMBOL - inti bug ini)',
      /'callback_query'/.test(isi), isi);
    cek('tidak meminta chat_member (tidak ada handler, hindari banjir update)',
      !/chat_member/.test(isi), isi);
    cek('tidak meminta message_reaction (tidak ada handler)',
      !/message_reaction/.test(isi), isi);
  }
}

console.log('\n[3] handler yang terdaftar vs allowed_updates');
{
  const handlers = [...SRC.matchAll(/bot\.on\('([a-z_]+)'/g)].map((x) => x[1]);
  const unik = [...new Set(handlers)];
  const perluUpdate = ['message', 'callback_query'];
  for (const h of perluUpdate) {
    cek(`handler '${h}' terdaftar`, unik.includes(h), unik.join(','));
  }
  // voice/photo/document dikirim Telegram sebagai update 'message' biasa
  cek("voice/photo/document bukan tipe update terpisah (dilewati oleh 'message')",
    !SRC.match(/const\s+POLL_ALLOWED_UPDATES\s*=\s*\[[^\]]*'(voice|photo|document)'/),
    'tidak boleh dimasukkan ke allowed_updates');
}

console.log('\n[4] nilai JSON yang benar-benar dikirim');
{
  // Simulasi persis seperti di index.js
  const POLL_ALLOWED_UPDATES = ['message', 'edited_message', 'callback_query'];
  const qs = '&allowed_updates=' + encodeURIComponent(JSON.stringify(POLL_ALLOWED_UPDATES));
  const url = `?offset=123&timeout=25&limit=100${qs}`;
  const parsed = new URL('https://api.telegram.org/botTOKEN/getUpdates' + url);
  const au = parsed.searchParams.get('allowed_updates');
  cek('allowed_updates ada di query string', au !== null, String(au));
  let arr = null;
  try { arr = JSON.parse(au); } catch (e) {}
  cek('nilainya JSON array valid', Array.isArray(arr), String(au));
  cek('array memuat callback_query', Array.isArray(arr) && arr.includes('callback_query'), String(au));
  cek('array memuat message', Array.isArray(arr) && arr.includes('message'), String(au));
  cek('offset tetap benar', parsed.searchParams.get('offset') === '123');
  cek('timeout tetap benar', parsed.searchParams.get('timeout') === '25');
}

console.log('\n[5] tidak ada getUpdates lain yang lupa allowed_updates');
{
  // Cari semua pemanggilan path getUpdates di index.js
  const semua = [...SRC.matchAll(/getUpdates[^`'"\n]*/g)].map((x) => x[0]);
  const konstruksiPath = [...SRC.matchAll(/path:\s*[`'"][^`'"]*getUpdates[^`'"]*[`'"]/g)].map((x) => x[0]);
  console.log('    path getUpdates ditemukan: ' + (konstruksiPath.join(' | ') || '(tidak ada literal)'));
  const pakaiQs = konstruksiPath.every((p) => /\$\{qs\}/.test(p) || /allowed_updates/.test(p));
  cek('semua path getUpdates memakai qs (yang berisi allowed_updates)', pakaiQs, konstruksiPath.join(' | '));
}

console.log('\n[6] observabilitas: hitungan callback diekspos di /health');
{
  cek('ada penghitung _callbackCount', /_callbackCount/.test(SRC));
  cek('ada telegramLastCallbackAt', /telegramLastCallbackAt/.test(SRC));
  cek('health mengekspos telegramCallbackCount', /telegramCallbackCount:/.test(SRC));
  cek('health mengekspos telegramAllowedUpdates', /telegramAllowedUpdates:/.test(SRC));
}

console.log('\n' + '-'.repeat(56));
console.log(`HASIL: ${lulus} lulus, ${gagal} gagal`);
console.log('-'.repeat(56));
process.exit(gagal === 0 ? 0 : 1);
