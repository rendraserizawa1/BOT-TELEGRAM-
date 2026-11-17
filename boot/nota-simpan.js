'use strict';
/**
 * Penyimpanan nota: tujuan utama share SMB, dengan fallback lokal + antrean.
 *
 * Kode lama menulis HANYA ke \\100.125.99.99\... dan komentarnya menegaskan
 * "TANPA fallback". Di container Railway path UNC tidak ada, sehingga nota
 * pengguna akan hilang tanpa jejak.
 *
 * ── Kenapa ada bisaJadiShare() ───────────────────────────────────────────
 * Di Linux, `\\100.125.99.99\E\TOKO...` BUKAN path absolut: `path.posix`
 * memperlakukan backslash sebagai karakter nama file yang sah. Akibatnya
 * `mkdirSync` BERHASIL membuat folder bernama `\\100.125.99.99\E\...` di
 * dalam /app, uji tulis berhasil, `writeFileSync` berhasil, dan fungsi ini
 * dulu melaporkan `{ok:true, fallback:false}`. Pengguna melihat
 * "NOTA TERSIMPAN!", admin tidak diberi tahu, dan file lenyap saat redeploy.
 *
 * Jadi: tanyakan dulu "apakah tujuan ini bisa jadi share di platform ini?"
 * sebelum menyentuh filesystem. Kalau tidak, langsung ke fallback.
 *
 * ── Kenapa tulis atomik ─────────────────────────────────────────────────
 * `writeFileSync` tidak atomik. Bila sesi SMB putus di tengah tulis, file
 * 0 byte / terpotong tertinggal di folder share dengan NAMA NOTA YANG BENAR,
 * sehingga tidak ada yang sadar. Kita tulis ke `.part` lalu rename; target
 * tidak pernah tersentuh sampai rename berhasil.
 *
 * ── Kenapa ada antrean ──────────────────────────────────────────────────
 * Pesan ke pengguna menjanjikan nota "akan disalin saat share tersedia".
 * Janji itu hanya jujur kalau benar-benar ada yang menyalin. `sapuAntrean()`
 * dipanggil saat startup dan berkala oleh index.js.
 *
 * Dipisah dari index.js supaya bisa diuji tanpa Telegram.
 */

const fsAsli = require('fs');
const path = require('path');

/** Buang komponen path berbahaya: jangan pernah biarkan nama file keluar folder. */
function namaAman(nama) {
  const dasar = path.basename(String(nama || 'nota.jpg'));
  const bersih = dasar.replace(/[\x00-\x1f<>:"/\\|?*]/g, '_').slice(0, 200) || 'nota.jpg';
  // '..' dan '.' lolos regex di atas tetapi bukan nama file yang sah.
  if (bersih === '.' || bersih === '..') return 'nota.jpg';
  return bersih;
}

/**
 * Apakah `folder` bisa dipakai sebagai tujuan share di `platform`?
 *
 * Aturannya sederhana dan sengaja ketat:
 *  - win32: harus path absolut Windows (UNC \\server\share atau C:\...).
 *  - POSIX: harus path absolut POSIX dan TIDAK mengandung backslash.
 *    Backslash berarti path itu UNC Windows yang tidak akan pernah berarti
 *    apa pun di Linux; menulis ke sana hanya membuat folder aneh di /app.
 *
 * Mengembalikan { ok, alasan }.
 */
function bisaJadiShare(folder, platform) {
  const plat = platform || process.platform;
  const f = String(folder == null ? '' : folder);
  if (!f.trim()) return { ok: false, alasan: 'folder share kosong' };

  if (plat === 'win32') {
    if (path.win32.isAbsolute(f)) return { ok: true, alasan: null };
    return { ok: false, alasan: 'bukan path absolut Windows: ' + f };
  }

  if (f.includes('\\')) {
    return {
      ok: false,
      alasan: 'tujuan adalah path UNC Windows (' + f + ') yang tidak tersedia di platform '
        + plat + '; nota dialihkan ke penyimpanan lokal',
    };
  }
  if (!path.posix.isAbsolute(f)) {
    return { ok: false, alasan: 'bukan path absolut POSIX: ' + f };
  }
  return { ok: true, alasan: null };
}

/**
 * Tulis buffer ke folder secara ATOMIK.
 * Menulis ke `<folder>/.<nama>.part` lalu rename ke nama akhir. Bila apa pun
 * gagal, file .part dibersihkan dan target lama (bila ada) tidak tersentuh.
 * `opts.fs` hanya dipakai untuk pengujian.
 */
function tulisAtomik(folder, namaFile, buffer, opts) {
  const fs = (opts && opts.fs) || fsAsli;
  const nama = namaAman(namaFile);
  const tujuan = path.join(folder, nama);
  const sementara = path.join(folder, '.' + nama + '.part');
  try {
    fs.writeFileSync(sementara, buffer);
    fs.renameSync(sementara, tujuan);
    return { ok: true, path: tujuan };
  } catch (err) {
    try { fs.unlinkSync(sementara); } catch (_) { /* sudah tidak ada */ }
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

/**
 * Tulis buffer ke folder. Membuat folder bila belum ada, lalu MEMBUKTIKAN
 * folder benar-benar bisa ditulis (uji tulis + hapus) sebelum menulis nota.
 * Tidak pernah melempar: selalu mengembalikan {ok, path} atau {ok:false, error}.
 */
function simpanKeFolder(folder, namaFile, buffer, opts) {
  const fs = (opts && opts.fs) || fsAsli;
  const platform = (opts && opts.platform) || process.platform;
  try {
    if (!folder) return { ok: false, error: 'folder tujuan kosong' };
    if (!Buffer.isBuffer(buffer)) return { ok: false, error: 'buffer nota tidak valid' };

    const layak = bisaJadiShare(folder, platform);
    if (!layak.ok) return { ok: false, error: layak.alasan };

    fs.mkdirSync(folder, { recursive: true });
    if (!fs.existsSync(folder)) {
      return { ok: false, error: 'folder tidak terbentuk: ' + folder };
    }

    // Nama uji unik per proses: dua proses (PC + Railway) bisa menulis ke
    // folder bulan yang sama; nama tetap akan saling hapus dan membuat nota
    // yang sah dialihkan ke fallback.
    const uji = path.join(folder, '.tulis-uji-' + process.pid + '-' + Date.now());
    fs.writeFileSync(uji, 'ok');
    fs.unlinkSync(uji);

    return tulisAtomik(folder, namaFile, buffer, { fs });
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

/**
 * Simpan ke share; bila gagal simpan ke folderFallback.
 * Mengembalikan { ok, path, fallback, alasanShare }.
 * `fallback:true` berarti nota SELAMAT tetapi belum ada di share.
 */
function simpanDenganFallback({ folderShare, namaFile, buffer, folderFallback, platform }) {
  const plat = platform || process.platform;

  // Tujuan share yang mustahil di platform ini jangan pernah dicoba: menulis
  // ke sana akan "berhasil" palsu dan menipu pengguna.
  const layak = bisaJadiShare(folderShare, plat);
  const share = layak.ok
    ? simpanKeFolder(folderShare, namaFile, buffer, { platform: plat })
    : { ok: false, error: layak.alasan };

  if (share.ok) {
    return { ok: true, path: share.path, fallback: false, alasanShare: null };
  }

  const alasanShare = share.error || 'tidak diketahui';
  // Fallback SELALU lokal, jadi divalidasi terhadap platform nyata — bukan
  // terhadap `platform` yang hanya mensimulasikan mesin pemilik share.
  const fb = simpanKeFolder(folderFallback, namaFile, buffer, { platform: process.platform });
  if (fb.ok) {
    return { ok: true, path: fb.path, fallback: true, alasanShare };
  }

  return {
    ok: false,
    path: null,
    fallback: true,
    alasanShare,
    error: 'share gagal (' + alasanShare + ') dan fallback gagal (' + (fb.error || 'tidak diketahui') + ')',
  };
}

/** Nama file catatan samping untuk satu nota di antrean. */
function namaMeta(namaNota) {
  return namaNota + '.json';
}

/**
 * Simpan nota ke folder antrean (belum bisa dikirim ke share).
 * Menulis nota + catatan samping berisi alasan, waktu, dan FOLDER TUJUAN,
 * supaya sapuan berikutnya tahu ke mana harus mengirim tanpa menebak.
 * Mengembalikan { ok, path, metaPath } atau { ok:false, error }.
 */
function simpanKeAntrean(folderAntrean, namaFile, buffer, alasan, tujuan) {
  try {
    if (!Buffer.isBuffer(buffer)) return { ok: false, error: 'buffer nota tidak valid' };
    const tulis = simpanKeFolder(folderAntrean, namaFile, buffer);
    if (!tulis.ok) return tulis;

    const nama = path.basename(tulis.path);
    const metaPath = path.join(folderAntrean, namaMeta(nama));
    const meta = {
      nama,
      alasan: String(alasan || 'tidak diketahui'),
      tujuan: tujuan ? String(tujuan) : null,
      waktu: new Date().toISOString(),
      pid: process.pid,
    };
    fsAsli.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    return { ok: true, path: tulis.path, metaPath };
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
}

/** Baca catatan samping satu nota; null bila tidak ada / rusak. */
function bacaMeta(metaPath) {
  try {
    return JSON.parse(fsAsli.readFileSync(metaPath, 'utf8'));
  } catch (_) {
    return null;
  }
}

/**
 * Daftar isi antrean beserta catatan sampingnya, yang paling lama menunggu
 * lebih dulu.
 *
 * KENAPA PERLU — BUKAN KERAPIAN
 * ----------------------------
 * `sapuAntrean()` hanya bisa berhasil kalau PROSES YANG MEMANGGILNYA bisa
 * melihat folder share. Bot berjalan di container Linux, sedangkan tujuan nota
 * adalah share Windows `\\100.125.99.99\E\...`. Di Linux path itu bukan path
 * absolut sama sekali, jadi sapuan di sisi bot TIDAK AKAN PERNAH berhasil:
 * pesan "akan dipindahkan otomatis ke folder share" menjadi janji kosong dan
 * nota menumpuk selamanya di volume.
 *
 * Karena itu antrean harus bisa DIBACA PIHAK LAIN — PC yang punya jalur ke
 * share. Fungsi ini dan `hapusDariAntrean()` adalah sisi baca/hapus untuk
 * jalur jemput itu.
 */
function daftarAntrean(folderAntrean) {
  const hasil = [];
  let isi;
  try {
    if (!folderAntrean || !fsAsli.existsSync(folderAntrean)) return hasil;
    isi = fsAsli.readdirSync(folderAntrean);
  } catch (_) {
    return hasil;
  }

  for (const nama of isi) {
    if (nama.endsWith('.json') || nama.startsWith('.')) continue;
    const jalur = path.join(folderAntrean, nama);
    let ukuran = null;
    try { ukuran = fsAsli.statSync(jalur).size; } catch (_) { /* biarkan null */ }
    const meta = bacaMeta(path.join(folderAntrean, namaMeta(nama))) || {};
    hasil.push({
      nama,
      tujuan: meta.tujuan || null,
      alasan: meta.alasan || null,
      waktu: meta.waktu || null,
      ukuran,
    });
  }

  hasil.sort((a, b) => String(a.waktu || '').localeCompare(String(b.waktu || '')));
  return hasil;
}

/**
 * Buang satu nota dari antrean setelah benar-benar tersimpan di share.
 *
 * Nama divalidasi dengan `namaAman` dan harus KEMBALI PERSIS SAMA. Tanpa
 * syarat itu, nama seperti `../../app/index.js` akan lolos `path.join` dan
 * menghapus berkas di luar antrean. Nama nota yang sah tidak pernah berubah
 * oleh `namaAman`, jadi penolakan ini tidak pernah mengenai nota sungguhan.
 */
function hapusDariAntrean(folderAntrean, nama) {
  const asli = String(nama == null ? '' : nama);
  if (!asli || namaAman(asli) !== asli) {
    return { ok: false, error: 'nama tidak sah: ' + asli };
  }
  try {
    fsAsli.unlinkSync(path.join(folderAntrean, asli));
  } catch (err) {
    return { ok: false, error: (err && err.message) ? err.message : String(err) };
  }
  // Catatan samping boleh sudah tidak ada; itu bukan kegagalan.
  try { fsAsli.unlinkSync(path.join(folderAntrean, namaMeta(asli))); } catch (_) { /* lanjut */ }
  return { ok: true };
}

/**
 * Akar folder yang boleh ditulisi oleh jalur jemput.
 *
 * BATAS KEAMANAN, BUKAN KERAPIAN: server mengirim `tujuan` berupa path, dan PC
 * menulis ke sana. Kalau daftar ini tidak ada, server yang disusupi (atau
 * catatan antrean yang rusak) bisa menyuruh PC menulis ke mana saja — mis.
 * menaruh berkas di folder startup. Karena itu tujuannya dibatasi ke akar nota
 * yang memang dikenal.
 */
const AKAR_NOTA_DEFAULT = [
  '\\\\100.125.99.99\\E\\TOKO NASIONAL KITCHEN',
  '\\\\100.125.99.99\\E\\Nota Toko Perabot Mamaku Kefamenanu',
];

/** Akar sah: dari env (dipisah ';') bila diisi, kalau tidak pakai bawaan. */
function akarNotaSah(dariEnv) {
  const daftar = String(dariEnv == null ? '' : dariEnv)
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
  return daftar.length ? daftar : AKAR_NOTA_DEFAULT.slice();
}

/**
 * Apakah `tujuan` path Windows absolut DI DALAM salah satu akar sah?
 * `path.win32` dipakai karena tujuannya path Windows, walaupun kode ini bisa
 * saja dijalankan di mesin lain.
 *
 * WAJIB dinormalkan dulu. Pemeriksaan berbasis teks saja LOLOS untuk
 * `\\server\E\TOKO NASIONAL KITCHEN\..\..\Windows`, yang teksnya berawalan akar
 * sah tetapi sebenarnya menunjuk `\\server\E\Windows`. Tes menemukan ini.
 */
function tujuanNotaSah(tujuan, akar) {
  const t = String(tujuan == null ? '' : tujuan);
  if (!t.trim()) return false;
  if (!path.win32.isAbsolute(t)) return false;
  // `..` dibuang SEBELUM dibandingkan. Tanpa ini, batas keamanan ini bisa
  // ditembus dengan awalan yang tampak sah.
  const bawah = path.win32.normalize(t).toLowerCase().replace(/\\+$/, '');
  return akarNotaSah(akar).some((a) => {
    const ak = path.win32.normalize(String(a)).toLowerCase().replace(/\\+$/, '');
    return bawah === ak || bawah.startsWith(ak + '\\');
  });
}

/**
 * Sapu folder antrean: coba kirim setiap nota ke share. Yang berhasil
 * dihapus dari antrean (nota + catatan), yang gagal DIBIARKAN utuh.
 *
 * Tujuan tiap nota diambil dari catatan samping (`tujuan`); `folderShare`
 * hanya dipakai bila catatan tidak menyebutkannya (mis. catatan rusak).
 *
 * Mengembalikan { dipindah, tersisa, gagal, alasanShare }.
 * Tidak pernah melempar.
 */
function sapuAntrean({ folderAntrean, folderShare, platform }) {
  const plat = platform || process.platform;
  const hasil = { dipindah: 0, tersisa: 0, gagal: 0, alasanShare: null };

  let isi;
  try {
    if (!folderAntrean || !fsAsli.existsSync(folderAntrean)) return hasil;
    isi = fsAsli.readdirSync(folderAntrean);
  } catch (err) {
    hasil.alasanShare = 'tidak bisa membaca antrean: ' + err.message;
    return hasil;
  }

  const nota = isi.filter((f) => !f.endsWith('.json') && !f.startsWith('.'));
  if (!nota.length) return hasil;

  for (const nama of nota) {
    const sumber = path.join(folderAntrean, nama);
    const metaPath = path.join(folderAntrean, namaMeta(nama));
    const meta = bacaMeta(metaPath);
    const tujuan = (meta && meta.tujuan) || folderShare;

    // Tanpa tujuan yang sah, jangan buang nota: biarkan di antrean.
    const layak = bisaJadiShare(tujuan, plat);
    if (!layak.ok) {
      hasil.tersisa++;
      hasil.alasanShare = layak.alasan;
      continue;
    }

    try {
      const buffer = fsAsli.readFileSync(sumber);
      const tulis = simpanKeFolder(tujuan, nama, buffer, { platform: plat });
      if (tulis.ok) {
        try { fsAsli.unlinkSync(sumber); } catch (_) { /* lanjut */ }
        try { fsAsli.unlinkSync(metaPath); } catch (_) { /* catatan mungkin tidak ada */ }
        hasil.dipindah++;
      } else {
        hasil.gagal++;
        hasil.tersisa++;
        hasil.alasanShare = tulis.error || hasil.alasanShare;
      }
    } catch (err) {
      hasil.gagal++;
      hasil.tersisa++;
      hasil.alasanShare = err.message;
    }
  }
  return hasil;
}

module.exports = {
  simpanKeFolder,
  simpanDenganFallback,
  bisaJadiShare,
  tulisAtomik,
  simpanKeAntrean,
  sapuAntrean,
  bacaMeta,
  namaAman,
  daftarAntrean,
  hapusDariAntrean,
  tujuanNotaSah,
  akarNotaSah,
  AKAR_NOTA_DEFAULT,
};
