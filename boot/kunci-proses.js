'use strict';
/**
 * KUNCI PROSES TUNGGAL — satu aturan untuk semua penjaga.
 *
 * ════════════════════════════════════════════════════════════════════════
 * BUG YANG DIPERBAIKI MODUL INI (nyata, terjadi 20/11/2026)
 * ════════════════════════════════════════════════════════════════════════
 * Versi lama memakai `process.kill(pid, 0)` untuk menguji "apakah pemegang
 * kunci masih hidup". Uji itu HANYA memeriksa keberadaan PID, bukan
 * identitas proses. Setelah komputer reboot, Windows MEMAKAI ULANG nomor
 * PID. Berkas kunci masih menyimpan PID lama, dan PID itu sekarang milik
 * proses lain yang sama sekali tidak berhubungan.
 *
 * Akibatnya: penjaga membaca kunci lama, melihat "PID 6600 masih hidup",
 * menyimpulkan "penjaga lain sudah berjalan", lalu `process.exit(2)`.
 * Berulang setiap 20 detik, SELAMANYA. Agen tidak pernah menyala.
 *
 * Gejala yang terlihat: `push-agen = 0`, ketiga toko jadi basi, dan log
 * hanya berisi "penjaga lain sudah berjalan" tanpa petunjuk apa pun.
 * Satu-satunya "obat" sebelumnya adalah menghapus berkas kunci manual —
 * tidak bisa dilakukan saat server dinyalakan tanpa operator.
 *
 * ════════════════════════════════════════════════════════════════════════
 * PERBAIKAN
 * ════════════════════════════════════════════════════════════════════════
 * Kunci menyimpan TIGA hal, bukan hanya PID:
 *     { pid, mulai, boot }
 *   - `mulai` = waktu proses pemegang kunci dimulai
 *   - `boot`  = waktu komputer menyala (boot id)
 *
 * Kunci hanya dianggap HIDUP bila ketiganya cocok dengan kenyataan:
 *   1. PID itu ada, DAN
 *   2. proses itu benar-benar proses node (bukan PID daur ulang), DAN
 *   3. waktu mulai proses cocok dengan yang tercatat (toleransi 3 detik), DAN
 *   4. komputer BELUM reboot sejak kunci dibuat.
 *
 * Kalau salah satu tidak cocok -> kunci BASI -> diambil alih. Tidak pernah
 * lagi ada penjaga yang terkunci selamanya karena PID daur ulang.
 *
 * CATATAN: perilaku PC tidak berubah — kunci basi tetap diambil alih, sama
 * seperti sebelumnya. Yang berubah hanya kasus yang dulu SALAH dianggap hidup.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

// Toleransi perbedaan waktu mulai proses (ms). Nilai WMI CreationDate
// dibulatkan ke detik, dan jam bisa sedikit bergeser.
const TOLERANSI_MS = 3000;

/** Waktu boot komputer ini (epoch ms), atau null bila tidak bisa dipastikan. */
function waktuBoot() {
  // os.uptime() dalam detik; lebih murah dan portabel daripada WMI.
  try {
    const up = os.uptime();
    if (Number.isFinite(up) && up >= 0) return Date.now() - up * 1000;
  } catch (_) { /* lanjut ke cara lain */ }
  return null;
}

/**
 * Ambil identitas proses: { ada, mulai, nama }.
 * `mulai` dalam epoch ms, atau null bila tidak diketahui.
 *
 * Di Windows dipakai WMI karena `process.kill(pid, 0)` tidak memberi waktu
 * mulai maupun nama proses. Di POSIX dipakai /proc.
 */
function identitasProses(pid) {
  const n = parseInt(pid, 10);
  if (!Number.isFinite(n) || n <= 0) return { ada: false, mulai: null, nama: null };

  if (process.platform === 'win32') {
    try {
      const out = execFileSync(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command',
          'Get-CimInstance Win32_Process -Filter "ProcessId=' + n + '" | '
          + 'Select-Object ProcessId,Name,CreationDate | ConvertTo-Json -Compress'],
        { encoding: 'utf8', timeout: 20000, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
      );
      const teks = String(out || '').trim();
      if (!teks) return { ada: false, mulai: null, nama: null };
      const o = JSON.parse(teks);
      const satu = Array.isArray(o) ? o[0] : o;
      if (!satu || !satu.ProcessId) return { ada: false, mulai: null, nama: null };
      return {
        ada: true,
        mulai: uraiWaktuWmi(satu.CreationDate),
        nama: String(satu.Name || ''),
      };
    } catch (_) {
      // PowerShell gagal: jangan memutuskan apa pun. Kembalikan "tidak tahu".
      return { ada: null, mulai: null, nama: null };
    }
  }

  // POSIX: /proc/<pid> ada dan bisa dibaca.
  try {
    const stat = fs.readFileSync('/proc/' + n + '/stat', 'utf8');
    const nama = String(fs.readFileSync('/proc/' + n + '/comm', 'utf8')).trim();
    // /proc/<pid>/stat field 22 = starttime dalam clock ticks sejak boot.
    const bagian = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const startTicks = parseInt(bagian[19], 10);
    const uptimeDetik = os.uptime();
    const hz = 100; // asumsi umum Linux; cukup untuk pembandingan kasar
    const mulai = Date.now() - (uptimeDetik - startTicks / hz) * 1000;
    return { ada: true, mulai: Number.isFinite(mulai) ? mulai : null, nama };
  } catch (_) {
    return { ada: false, mulai: null, nama: null };
  }
}

/** Ubah CreationDate WMI ("/Date(1795169299079)/" atau ISO) ke epoch ms. */
function uraiWaktuWmi(v) {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const s = String(v);
  const m = s.match(/\/Date\((\d+)\)\//);
  if (m) return parseInt(m[1], 10);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Apakah proses ini adalah node? Dipakai menolak PID daur ulang. */
function tampakNode(nama) {
  if (!nama) return null; // tidak tahu
  return /^node(\.exe)?$/i.test(String(nama));
}

/**
 * Periksa apakah pemegang kunci masih benar-benar hidup.
 * @returns {{hidup:boolean, alasan:string}}
 */
function pemegangHidup(isi) {
  if (!isi || !isi.pid) return { hidup: false, alasan: 'kunci tanpa pid' };

  const pid = parseInt(isi.pid, 10);
  if (!Number.isFinite(pid) || pid <= 0) return { hidup: false, alasan: 'pid tidak sah' };

  // 1. Komputer sudah reboot sejak kunci dibuat? -> pasti basi.
  if (isi.boot != null) {
    const bootSekarang = waktuBoot();
    if (bootSekarang != null) {
      // Toleransi 2 menit: uptime dan jam tidak presisi sempurna.
      if (Math.abs(bootSekarang - Number(isi.boot)) > 120000) {
        return { hidup: false, alasan: 'komputer sudah reboot sejak kunci dibuat' };
      }
    }
  }

  // 2. Prosesnya masih ada?
  const id = identitasProses(pid);
  if (id.ada === false) return { hidup: false, alasan: 'pid ' + pid + ' sudah tidak ada' };
  if (id.ada === null) {
    // Tidak bisa dipastikan. Jangan memblokir: lebih baik dua penjaga
    // sesaat (kunci berkas tetap mencegah dua agen menulis bersamaan)
    // daripada agen tidak pernah menyala sama sekali.
    return { hidup: false, alasan: 'identitas pid ' + pid + ' tidak bisa dipastikan' };
  }

  // 3. PID daur ulang? Nama proses harus node.
  const node = tampakNode(id.nama);
  if (node === false) {
    return { hidup: false, alasan: 'pid ' + pid + ' sekarang milik proses lain (' + id.nama + ')' };
  }

  // 4. Waktu mulai cocok?
  if (isi.mulai != null && id.mulai != null) {
    const selisih = Math.abs(Number(id.mulai) - Date.parse(String(isi.mulai)));
    if (Number.isFinite(selisih) && selisih > TOLERANSI_MS) {
      return { hidup: false, alasan: 'pid ' + pid + ' dipakai ulang (waktu mulai berbeda ' + Math.round(selisih) + ' ms)' };
    }
  }

  return { hidup: true, alasan: 'pid ' + pid + ' masih hidup dan cocok' };
}

/**
 * Ambil kunci. Mengembalikan { ok, alasan, diambilAlih }.
 * Tidak pernah melempar.
 */
function ambilKunci(berkasKunci, opsi) {
  const o = opsi || {};
  let isi = null;
  try {
    if (fs.existsSync(berkasKunci)) {
      isi = JSON.parse(fs.readFileSync(berkasKunci, 'utf8'));
    }
  } catch (_) { isi = null; /* rusak -> anggap basi */ }

  if (isi && isi.pid && Number(isi.pid) !== process.pid) {
    const cek = pemegangHidup(isi);
    if (cek.hidup) {
      return { ok: false, alasan: cek.alasan, diambilAlih: false, pidLama: isi.pid };
    }
    // Basi: ambil alih.
    try {
      fs.writeFileSync(berkasKunci, JSON.stringify(baru()), 'utf8');
      return { ok: true, alasan: 'kunci basi diambil alih (' + cek.alasan + ')', diambilAlih: true, pidLama: isi.pid };
    } catch (e) {
      return { ok: true, alasan: 'kunci basi tidak bisa ditulis (' + (e && e.code) + ')', diambilAlih: true, pidLama: isi.pid };
    }
  }

  try {
    fs.writeFileSync(berkasKunci, JSON.stringify(baru()), 'utf8');
    return { ok: true, alasan: 'kunci diperoleh', diambilAlih: false };
  } catch (e) {
    // Tidak bisa menulis: jangan memblokir proses karena hal yang tidak pasti.
    return { ok: true, alasan: 'kunci tidak bisa ditulis (' + (e && e.code) + ') - dilewati', diambilAlih: false };
  }
}

function baru() {
  const id = identitasProses(process.pid);
  return {
    pid: process.pid,
    mulai: new Date().toISOString(),
    boot: waktuBoot(),
    prosesMulai: id && id.mulai ? new Date(id.mulai).toISOString() : null,
  };
}

/** Lepas kunci HANYA bila memang milik proses ini. */
function lepasKunci(berkasKunci) {
  try {
    if (!fs.existsSync(berkasKunci)) return;
    const isi = JSON.parse(fs.readFileSync(berkasKunci, 'utf8'));
    if (isi && Number(isi.pid) === process.pid) fs.unlinkSync(berkasKunci);
  } catch (_) { /* abaikan */ }
}

module.exports = { ambilKunci, lepasKunci, pemegangHidup, identitasProses, waktuBoot, TOLERANSI_MS };
