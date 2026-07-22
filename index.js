'use strict';

// ════════════════════════════════════════════════════════════════
//   🤖 BOT TELEGRAM TOKO PERABOT v4.0 - FULL REFACTORED
//   Fitur: Cari, AI Chat, Voice, Scan Foto, SO Multi-User, BA, Laporan
// ════════════════════════════════════════════════════════════════

require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const express = require('express');
const session = require('express-session');

// ════════════════════════════════════════════════════════════════
//   1. KONFIGURASI
// ════════════════════════════════════════════════════════════════

const CONFIG = {
  appName: 'Bot Telegram Toko Perabot v4.0',
  botToken: process.env.BOT_TOKEN,
  adminId: parseInt(process.env.ADMIN_ID || '0'),
  
  geminiKey: process.env.GEMINI_KEY || '',
  geminiKey2: process.env.GEMINI_KEY2 || '',
  geminiKey3: process.env.GEMINI_KEY3 || '',
  groqKey: process.env.GROQ_API_KEY || '',
  openrouterKey: process.env.OPENROUTER_API_KEY || '',
  
  dashboardUser: process.env.DASHBOARD_USER || 'admin',
  dashboardPass: process.env.DASHBOARD_PASS || 'admin123',
  sessionSecret: process.env.SESSION_SECRET || 'bot-telegram-secret-key',
  botUsername: process.env.BOT_USERNAME || 'Aivirtual_Robot',
  
    paths: {
    storage: path.join(__dirname, 'storage'),
    members: path.join(__dirname, 'storage', 'members.json'),
    kontak: path.join(__dirname, 'storage', 'kontak.json'),
    sesi: path.join(__dirname, 'storage', 'sesi.json'),
    disapa: path.join(__dirname, 'storage', 'disapa.json'),
    pending: path.join(__dirname, 'storage', 'pending.json'),
    stockopname: path.join(__dirname, 'storage', 'stockopname.json'),
    beritaacara: path.join(__dirname, 'storage', 'berita_acara.json'),
    soShared: path.join(__dirname, 'storage', 'so_shared.json'),
    roleLaporan: path.join(__dirname, 'storage', 'role_laporan.json'),
    excelFolder: path.join(__dirname, 'harga_toko'),
    excelPerToko: {
      nk: path.join(__dirname, 'harga_toko', 'nk.xlsx'),
      tdm: path.join(__dirname, 'harga_toko', 'tdm.xlsx'),
      oesapa: path.join(__dirname, 'harga_toko', 'oesapa.xlsx'),
      kefa: path.join(__dirname, 'harga_toko', 'kefa.xlsx'),
      cp: path.join(__dirname, 'harga_toko', 'cp.xlsx'),
    },
    logs: path.join(__dirname, 'logs', 'error.log'),
  },
  
  maxMember: parseInt(process.env.MAX_MEMBER || '50'),
  maxHasilCari: 20,
  sesiTimeoutMenit: 30,
  webPort: process.env.PORT || 3000,
};

if (!CONFIG.botToken) {
  console.error('\n❌ ERROR: BOT_TOKEN tidak ada!\n');
  process.exit(1);
}

if (!CONFIG.geminiKey) {
  console.warn('⚠️ WARNING: GEMINI_KEY belum diisi, AI scan tidak optimal');
}

// Buat folder yang dibutuhkan
[CONFIG.paths.storage, path.dirname(CONFIG.paths.logs), CONFIG.paths.excelFolder].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// ════════════════════════════════════════════════════════════════
//   2. EMOJI & DATA TOKO
// ════════════════════════════════════════════════════════════════

const EMOJI_NUM = ['0️⃣','1️⃣','2️⃣','3️⃣','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
function emojiNum(n) { return (n >= 0 && n <= 10) ? EMOJI_NUM[n] : String(n); }

const TOKO_LIST = [
  { kode: 'nk',     nama: 'Nasional Kitchen',          icon: '🏬', alias: ['nk','nasional','kitchen'] },
  { kode: 'tdm',    nama: 'Perabot Mama TDM',          icon: '🏪', alias: ['tdm','mama tdm'] },
  { kode: 'oesapa', nama: 'Perabot Mama Oesapa',       icon: '🏬', alias: ['oesapa','mama oesapa'] },
  { kode: 'kefa',   nama: 'Perabot Mamaku Kefamenanu', icon: '🏪', alias: ['kefa','mamaku','kefamenanu'] },
  { kode: 'cp',     nama: 'Central Perabot',           icon: '🏢', alias: ['cp','central','alak'] },
];

const TOKO_COLS = {
  nk:     { ecer: 'Ecer NK',     ambil: 'Ambil NK',     stok: 'Stok NK'     },
  tdm:    { ecer: 'Ecer TDM',    ambil: 'Ambil TDM',    stok: 'Stok TDM'    },
  oesapa: { ecer: 'Ecer Oesapa', ambil: 'Ambil Oesapa', stok: 'Stok Oesapa' },
  kefa:   { ecer: 'Ecer Kefa',   ambil: 'Ambil Kefa',   stok: 'Stok Kefa'   },
  cp:     { ecer: 'Ecer CP',     ambil: 'Ambil CP',     stok: 'Stok CP'     },
};

const NAMA_TOKO = {};
TOKO_LIST.forEach(t => { NAMA_TOKO[t.kode] = t.nama; });

const KASIR_CP_DEFAULT = {
  k1: 'Yuni-Salsa',
  k2: 'Nanda-Umi-Marselina',
  k3: 'Febri-Jien-Tika',
  k4: 'Delfi-Tirsa',
};

const SCAN_STEPS = {
  nk: [
    { step:1, label:'Kassa 1', fields:['k1'], scanField:'total_transaksi' },
    { step:2, label:'Kassa 2', fields:['k2'], scanField:'total_transaksi' },
    { step:3, label:'Total + Tunai + Debit + Credit', fields:['total','tunai','debit','kredit'], scanField:'multi' },
    { step:4, label:'Ecer', fields:['ecer'], scanField:'ecer_only' },
    { step:5, label:'Grosir', fields:['grosir'], scanField:'grosir_only' },
  ],
  tdm: [
    { step:1, label:'Kassa 1', fields:['k1'], scanField:'total_transaksi' },
    { step:2, label:'Kassa 2', fields:['k2'], scanField:'total_transaksi' },
    { step:3, label:'Total + Tunai + Debit + Credit', fields:['total','tunai','debit','kredit'], scanField:'multi' },
  ],
  oesapa: [
    { step:1, label:'Kassa 1', fields:['k1'], scanField:'total_transaksi' },
    { step:2, label:'Kassa 2', fields:['k2'], scanField:'total_transaksi' },
    { step:3, label:'Total + Tunai + Debit + Credit', fields:['total','tunai','debit','kredit'], scanField:'multi' },
  ],
  kefa: [
    { step:1, label:'Kassa 1', fields:['k1'], scanField:'total_transaksi' },
    { step:2, label:'Kassa 2', fields:['k2'], scanField:'total_transaksi' },
    { step:3, label:'Total + Tunai + Debit + Credit', fields:['total','tunai','debit','kredit'], scanField:'multi' },
  ],
  cp: [
    { step:1, label:'Kassa 1 (Yuni-Salsa)', fields:['k1'], scanField:'total_transaksi' },
    { step:2, label:'Kassa 2 (Nanda-Umi-Marselina)', fields:['k2'], scanField:'total_transaksi' },
    { step:3, label:'Kassa 3 (Febri-Jien-Tika)', fields:['k3'], scanField:'total_transaksi' },
    { step:4, label:'Kassa 4 (Delfi-Tirsa)', fields:['k4'], scanField:'total_transaksi' },
    { step:5, label:'Total + Tunai + Debit + Credit', fields:['total','tunai','debit','kredit'], scanField:'multi' },
    { step:6, label:'Ecer', fields:['ecer'], scanField:'ecer_only' },
    { step:7, label:'Grosir', fields:['grosir'], scanField:'grosir_only' },
    { step:8, label:'Kasir Promo', fields:['promo','promotunai','promodebit','promokredit'], scanField:'multi_promo' },
    { step:9, label:'Parkir Komputer', fields:['parkirkomputer'], scanField:'parkir_komputer' },
    { step:10, label:'Parkir Luar', fields:['parkirluar'], scanField:'parkir_luar' },
  ],
};

const SCAN_PROMPTS = {
  total_transaksi: 'Baca gambar laporan penjualan. Cari baris TOTAL paling bawah tabel. Ambil angka dari kolom Total Transaksi. Jawab HANYA dengan angka saja tanpa Rp tanpa titik tanpa koma tanpa teks lain. Contoh jawaban benar: 15741500',
  
  multi: 'Baca gambar laporan penjualan. Cari baris TOTAL paling bawah. Ambil 4 angka: total, tunai, debit, kredit. Jawab format persis:\ntotal: 40899000\ntunai: 26326500\ndebit: 14254500\nkredit: 318000\nKalau kosong tulis 0.',
  
  multi_promo: 'Baca gambar laporan Kasir Promo. Cari baris TOTAL. Ambil 4 angka: promo, promotunai, promodebit, promokredit. Jawab format:\npromo: 1675000\npromotunai: 1675000\npromodebit: 0\npromokredit: 0',
  
  ecer_only: 'Baca gambar laporan penjualan ECER. Cari baris TOTAL paling bawah. Ambil angka. Jawab HANYA angka.',
  
  grosir_only: 'Baca gambar laporan penjualan GROSIR. Cari baris TOTAL paling bawah. Ambil angka. Jawab HANYA angka.',
  
  parkir_komputer: 'Baca gambar laporan PARKIR DI KOMPUTER. Ambil total nominal. Jawab HANYA angka.',
  
  parkir_luar: 'Baca gambar laporan PARKIR STOR LUAR. Ambil total nominal. Jawab HANYA angka.',
  
  barang_baru_only: `Baca gambar daftar BARANG BARU dengan SANGAT TELITI.
⚠️ PENTING: Ambil SEMUA nama barang TANPA TERPOTONG! Jangan cuma 5 item!
Kalau ada 50 barang, tulis SEMUA 50 barang.

Jawab dengan format:
- Nama Barang 1
- Nama Barang 2
... dan seterusnya sampai HABIS

ATURAN:
1. WAJIB tulis SEMUA barang yang terlihat
2. Title Case, kode HURUF BESAR
3. Setiap item awali dengan "- "
4. JANGAN tulis "dan lain-lain"
5. Jika kosong, jawab: (kosong)

Sekarang baca SEMUA barang di foto:`,
  
  barang_naik_only: `Baca gambar daftar BARANG NAIK HARGA dengan SANGAT TELITI.
⚠️ PENTING: Ambil SEMUA nama barang TANPA TERPOTONG!
Kalau ada 50 barang, tulis SEMUA 50 barang.

Format:
- Nama Barang 1
- Nama Barang 2
... dan seterusnya sampai HABIS

ATURAN:
1. WAJIB tulis SEMUA
2. Title Case, kode HURUF BESAR
3. Awali "- "
4. JANGAN tulis "dan lain-lain"
5. Jika kosong: (kosong)

Sekarang baca SEMUA:`,
  
  barang_turun_only: `Baca gambar daftar BARANG TURUN HARGA dengan SANGAT TELITI.
⚠️ PENTING: Ambil SEMUA nama barang TANPA TERPOTONG!

Format:
- Nama Barang 1
... sampai HABIS

ATURAN:
1. WAJIB tulis SEMUA
2. Title Case, kode HURUF BESAR
3. Awali "- "
4. JANGAN "dan lain-lain"
5. Jika kosong: (kosong)

Sekarang baca SEMUA:`,
  
  ba_tabel: `Baca gambar tabel iPos. Ambil SEMUA baris data dengan kolom: Kode, Keterangan, Jumlah, Satuan.
Jawab JSON array:
[{"kode":"NN13223","nama":"NAMA BARANG","qty":"1","satuan":"PCS"}]
ATURAN: HURUF BESAR, qty tanpa koma, hanya JSON.`,
};

const KATA_RESET = ['batal','mulai','start','keluar','exit','stop','reset','/start','/menu','/batal'];
const GARIS_TEBAL = '━━━━━━━━━━━━━━━━━━';
const GARIS_TIPIS = '──────────────────';

// ════════════════════════════════════════════════════════════════
//   3. LOGGER
// ════════════════════════════════════════════════════════════════

function timestamp() {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Makassar', // ← WITA
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const obj = {};
  parts.forEach(p => { obj[p.type] = p.value; });
  return `${obj.year}-${obj.month}-${obj.day} ${obj.hour}:${obj.minute}:${obj.second}`;
}

const log = {
  info: (ctx, msg) => console.log(`[${timestamp()}] [INFO ] [${ctx}] ${msg}`),
  warn: (ctx, msg) => console.warn(`[${timestamp()}] [WARN ] [${ctx}] ${msg}`),
  error: (ctx, msg, err) => {
    const full = `[${timestamp()}] [ERROR] [${ctx}] ${msg}`;
    console.error(full, err || '');
    try { fs.appendFileSync(CONFIG.paths.logs, full + (err ? ' | ' + String(err) : '') + '\n'); } catch(e) {}
  },
};

// ════════════════════════════════════════════════════════════════
//   4. STORAGE HELPERS
// ════════════════════════════════════════════════════════════════

function loadJSON(filePath, def) {
  try {
    if (fs.existsSync(filePath)) return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch(e) { log.error('STORAGE', 'Load fail: ' + filePath, e.message); }
  return def;
}

function saveJSON(filePath, data) {
  try { fs.writeFileSync(filePath, JSON.stringify(data, null, 2)); return true; }
  catch(e) { log.error('STORAGE', 'Save fail', e.message); return false; }
}

let MEMBERS = loadJSON(CONFIG.paths.members, []);
let KONTAK = loadJSON(CONFIG.paths.kontak, {});
let SESI = loadJSON(CONFIG.paths.sesi, {});
let SUDAH_DISAPA = loadJSON(CONFIG.paths.disapa, {});
let PENDING = loadJSON(CONFIG.paths.pending, {});
let STOCKOPNAME = loadJSON(CONFIG.paths.stockopname, {});
let BERITA_ACARA = loadJSON(CONFIG.paths.beritaacara, {});
let SO_SHARED = loadJSON(CONFIG.paths.soShared, {});
let ROLE_LAPORAN = loadJSON(CONFIG.paths.roleLaporan, []);

log.info('INIT', `Members: ${MEMBERS.length}, Kontak: ${Object.keys(KONTAK).length}`);

const crypto = require('crypto');

// Key dari environment variable
const ENCRYPT_KEY = crypto.scryptSync(
  process.env.ENCRYPT_PASSWORD || 'default-please-change-me-in-env',
  'salt-perabot-bot',
  32
);

function encrypt(text) {
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-cbc', ENCRYPT_KEY, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch(e) { return text; }
}

function decrypt(text) {
  try {
    if (!text.includes(':')) return text; // Not encrypted
    const parts = text.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', ENCRYPT_KEY, iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch(e) { return text; }
}
// ════════════════════════════════════════════════════════════════
//   4B. GITHUB STORAGE - Data Permanent (Branch Terpisah - No Loop!)
// ════════════════════════════════════════════════════════════════

const GITHUB_CONFIG = {
  token: process.env.GITHUB_TOKEN || '',
  owner: process.env.GITHUB_USERNAME || '',
  repo: process.env.GITHUB_REPO || '',
  // ★ WAJIB branch terpisah dari main! Kalau sama, akan infinite loop deploy!
  branch: process.env.GITHUB_BRANCH || 'data-storage',
  folder: 'data',
};

// ⚠️ SAFETY CHECK: Jangan pernah simpan ke branch main!
if (GITHUB_CONFIG.branch === 'main' || GITHUB_CONFIG.branch === 'master') {
  console.error('🚨 CRITICAL: GITHUB_BRANCH tidak boleh "main" atau "master"! Akan infinite loop!');
  console.error('🔧 Set GITHUB_BRANCH = data-storage di Railway Variables');
  GITHUB_CONFIG.token = ''; // Disable GitHub sync
}

const GITHUB_SYNC_FILES = [
  'members', 'kontak', 'pending', 'roleLaporan',
  'stockopname', 'beritaacara', 'soShared',
];

const isGitHubEnabled = !!(GITHUB_CONFIG.token && GITHUB_CONFIG.owner && GITHUB_CONFIG.repo);

let githubClient = null;
if (isGitHubEnabled) {
  try {
    const { Octokit } = require('@octokit/rest');
    githubClient = new Octokit({ auth: GITHUB_CONFIG.token });
    log.info('GITHUB', `✅ GitHub Storage aktif`);
    log.info('GITHUB', `   Repo: ${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}`);
    log.info('GITHUB', `   Branch: ${GITHUB_CONFIG.branch} (data-only, no deploy)`);
  } catch(e) {
    log.error('GITHUB', 'Gagal init: ' + e.message);
  }
} else {
  log.warn('GITHUB', '⚠️ GITHUB_TOKEN belum diset atau branch salah!');
}

const githubFileSHA = {};

// ★ Rate limiter - max 1 commit per file per 2 menit
const lastCommitTime = {};
const MIN_COMMIT_INTERVAL = 2 * 60 * 1000; // 2 menit

async function loadFromGitHub(fileName) {
  if (!isGitHubEnabled) return null;
  
  try {
    const filePath = `${GITHUB_CONFIG.folder}/${fileName}.json`;
    const response = await githubClient.repos.getContent({
      owner: GITHUB_CONFIG.owner,
      repo: GITHUB_CONFIG.repo,
      path: filePath,
      ref: GITHUB_CONFIG.branch,
    });
    
    if (response.data && response.data.content) {
      githubFileSHA[fileName] = response.data.sha;
      const content = Buffer.from(response.data.content, 'base64').toString('utf8');
      const parsed = JSON.parse(content);
      log.info('GITHUB', `✅ Loaded ${fileName}.json`);
      return parsed;
    }
    return null;
  } catch(err) {
    if (err.status === 404) {
      log.info('GITHUB', `${fileName}.json belum ada (akan dibuat saat save)`);
    } else {
      log.warn('GITHUB', `Load ${fileName}: ${err.message}`);
    }
    return null;
  }
}

async function saveToGitHub(fileName, data) {
  if (!isGitHubEnabled) return false;
  
  // Rate limit check
  const now = Date.now();
  if (lastCommitTime[fileName] && (now - lastCommitTime[fileName]) < MIN_COMMIT_INTERVAL) {
    const waitSec = Math.ceil((MIN_COMMIT_INTERVAL - (now - lastCommitTime[fileName])) / 1000);
    log.info('GITHUB', `⏰ ${fileName}: rate limited (tunggu ${waitSec}s)`);
    return false;
  }
  
  try {
    const filePath = `${GITHUB_CONFIG.folder}/${fileName}.json`;
    const content = JSON.stringify(data, null, 2);
    const contentBase64 = Buffer.from(content).toString('base64');
    
    const params = {
      owner: GITHUB_CONFIG.owner,
      repo: GITHUB_CONFIG.repo,
      path: filePath,
      message: `data: update ${fileName}`,
      content: contentBase64,
      branch: GITHUB_CONFIG.branch,
    };
    
    if (githubFileSHA[fileName]) {
      params.sha = githubFileSHA[fileName];
    } else {
      try {
        const existing = await githubClient.repos.getContent({
          owner: GITHUB_CONFIG.owner,
          repo: GITHUB_CONFIG.repo,
          path: filePath,
          ref: GITHUB_CONFIG.branch,
        });
        if (existing.data.sha) {
          params.sha = existing.data.sha;
          githubFileSHA[fileName] = existing.data.sha;
        }
      } catch(e) {}
    }
    
    const response = await githubClient.repos.createOrUpdateFileContents(params);
    
    if (response.data && response.data.content && response.data.content.sha) {
      githubFileSHA[fileName] = response.data.content.sha;
    }
    
    lastCommitTime[fileName] = now;
    log.info('GITHUB', `✅ Saved ${fileName}.json ke branch ${GITHUB_CONFIG.branch}`);
    return true;
  } catch(err) {
    log.error('GITHUB', `Save ${fileName}: ${err.message}`);
    return false;
  }
}

async function loadAllFromGitHub() {
  if (!isGitHubEnabled) {
    log.warn('GITHUB', 'Skip sync: GitHub Storage tidak aktif');
    return;
  }
  
  log.info('GITHUB', '🔄 Loading data dari GitHub branch ' + GITHUB_CONFIG.branch + '...');
  
  for (const fileName of GITHUB_SYNC_FILES) {
    const data = await loadFromGitHub(fileName);
    if (data !== null) {
      switch(fileName) {
        case 'members':
          MEMBERS = data;
          _origSaveJSON(CONFIG.paths.members, MEMBERS);
          break;
        case 'kontak':
          KONTAK = data;
          _origSaveJSON(CONFIG.paths.kontak, KONTAK);
          break;
        case 'pending':
          PENDING = data;
          _origSaveJSON(CONFIG.paths.pending, PENDING);
          break;
        case 'roleLaporan':
          ROLE_LAPORAN = data;
          _origSaveJSON(CONFIG.paths.roleLaporan, ROLE_LAPORAN);
          break;
        case 'stockopname':
          STOCKOPNAME = data;
          _origSaveJSON(CONFIG.paths.stockopname, STOCKOPNAME);
          break;
        case 'beritaacara':
          BERITA_ACARA = data;
          _origSaveJSON(CONFIG.paths.beritaacara, BERITA_ACARA);
          break;
        case 'soShared':
          SO_SHARED = data;
          _origSaveJSON(CONFIG.paths.soShared, SO_SHARED);
          break;
      }
    }
  }
  
  log.info('GITHUB', `✅ Sync complete: ${MEMBERS.length} members, ${Object.keys(KONTAK).length} kontak`);
}

// Debounce: commit setelah 60 detik idle (mencegah spam)
const githubSaveTimers = {};

function saveToGitHubDebounced(fileName, data, delay = 60000) {  // ★ 60 detik
  if (!isGitHubEnabled) return;
  
  if (githubSaveTimers[fileName]) {
    clearTimeout(githubSaveTimers[fileName]);
  }
  
  githubSaveTimers[fileName] = setTimeout(() => {
    saveToGitHub(fileName, data).catch(e => log.error('GITHUB', e.message));
    delete githubSaveTimers[fileName];
  }, delay);
}

// Simpan reference ke saveJSON asli
const _origSaveJSON = saveJSON;

// Override saveJSON untuk auto-sync ke GitHub
saveJSON = function(filePath, data) {
  const result = _origSaveJSON(filePath, data);
  
  const fileName = path.basename(filePath, '.json');
  
  if (GITHUB_SYNC_FILES.includes(fileName)) {
    saveToGitHubDebounced(fileName, data);
  }
  
  return result;
};

// Load dari GitHub saat startup
if (isGitHubEnabled) {
  setTimeout(() => {
    loadAllFromGitHub().catch(e => log.error('GITHUB', 'Startup sync fail: ' + e.message));
  }, 3000);
}
// ════════════════════════════════════════════════════════════════
//   5. ROLE & MEMBER HELPERS
// ════════════════════════════════════════════════════════════════

function isAdmin(userId) {
  return parseInt(userId) === CONFIG.adminId;
}

function isMember(userId) {
  const id = String(userId);
  return isAdmin(userId) || MEMBERS.includes(id);
}

function bisaAksesLaporan(userId) {
  const id = String(userId);
  return isAdmin(userId) || ROLE_LAPORAN.includes(id);
}

function getNama(userId) {
  return KONTAK[String(userId)] || null;
}

function getUserRole(userId) {
  if (isAdmin(userId)) return '👑 Admin';
  if (bisaAksesLaporan(userId)) return '📊 Staff Laporan';
  if (isMember(userId)) return '✅ Member';
  return '👤 Guest';
}

function tambahMember(id) {
  id = String(id).replace(/[^0-9]/g, '');
  if (!id) return { ok: false, alasan: 'ID tidak valid' };
  if (isAdmin(id)) return { ok: false, alasan: 'Itu admin' };
  if (MEMBERS.includes(id)) return { ok: false, alasan: 'Sudah terdaftar' };
  if (MEMBERS.length >= CONFIG.maxMember) return { ok: false, alasan: 'Slot penuh' };
  MEMBERS.push(id);
  saveJSON(CONFIG.paths.members, MEMBERS);
  return { ok: true };
}

function hapusMember(id) {
  id = String(id).replace(/[^0-9]/g, '');
  const idx = MEMBERS.indexOf(id);
  if (idx === -1) return { ok: false, alasan: 'Tidak ditemukan' };
  MEMBERS.splice(idx, 1);
  saveJSON(CONFIG.paths.members, MEMBERS);
  return { ok: true };
}

function setNama(id, nama) {
  id = String(id).replace(/[^0-9]/g, '');
  if (!id || !nama) return { ok: false, alasan: 'ID & nama wajib' };
  KONTAK[id] = nama.trim();
  saveJSON(CONFIG.paths.kontak, KONTAK);
  return { ok: true };
}

function tambahRoleLaporan(id) {
  id = String(id).replace(/[^0-9]/g, '');
  if (!id) return { ok: false, alasan: 'ID tidak valid' };
  if (ROLE_LAPORAN.includes(id)) return { ok: false, alasan: 'Sudah ada' };
  ROLE_LAPORAN.push(id);
  saveJSON(CONFIG.paths.roleLaporan, ROLE_LAPORAN);
  return { ok: true };
}

function hapusRoleLaporan(id) {
  id = String(id).replace(/[^0-9]/g, '');
  const idx = ROLE_LAPORAN.indexOf(id);
  if (idx === -1) return { ok: false, alasan: 'Tidak ditemukan' };
  ROLE_LAPORAN.splice(idx, 1);
  saveJSON(CONFIG.paths.roleLaporan, ROLE_LAPORAN);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
//   6. SESSION MANAGEMENT
// ════════════════════════════════════════════════════════════════

const TIMEOUT_MS = CONFIG.sesiTimeoutMenit * 60 * 1000;
let sesiSaveTimer = null;

function getSesi(userId) {
  const id = String(userId);
  if (!SESI[id]) SESI[id] = {};
  SESI[id]._lastActive = Date.now();
  return SESI[id];
}

function resetSesi(userId) {
  const id = String(userId);
  delete SESI[id];
  SESI[id] = { _lastActive: Date.now() };
  scheduleSaveSesi();
}

function updateSesi(userId, data) {
  const id = String(userId);
  if (!SESI[id]) SESI[id] = {};
  Object.assign(SESI[id], data, { _lastActive: Date.now() });
  scheduleSaveSesi();
}

function scheduleSaveSesi() {
  clearTimeout(sesiSaveTimer);
  sesiSaveTimer = setTimeout(() => {
    saveJSON(CONFIG.paths.sesi, SESI);
  }, 2000);
}

setInterval(() => {
  const now = Date.now();
  let buang = 0;
  Object.keys(SESI).forEach(id => {
    if (now - (SESI[id]._lastActive || 0) > TIMEOUT_MS) { delete SESI[id]; buang++; }
  });
  if (buang > 0) saveJSON(CONFIG.paths.sesi, SESI);
}, 5 * 60 * 1000);

// ════════════════════════════════════════════════════════════════
//   7. UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════

function tunggu(ms) { return new Promise(r => setTimeout(r, ms)); }

// Rename ke getWitaDate, atau biarkan getJakartaDate aja
function getJakartaDate(kemarin) {
  const now = new Date();
  
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Makassar', // ← WITA
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  
  const parts = formatter.formatToParts(now);
  const obj = {};
  parts.forEach(p => { obj[p.type] = p.value; });
  
  const hour = obj.hour === '24' ? '00' : obj.hour;
  
  // PENTING: pakai +08:00 untuk WITA, bukan +07:00
  const witaTime = new Date(
    `${obj.year}-${obj.month}-${obj.day}T${hour}:${obj.minute}:${obj.second}+08:00`
  );
  
  if (kemarin) witaTime.setDate(witaTime.getDate() - 1);
  return witaTime;
}

function getWaktu() {
  // Ambil jam WITA langsung (bukan dari getJakartaDate yang mungkin masih WIB)
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Makassar',
    hour: '2-digit',
    hour12: false,
  });
  const j = parseInt(formatter.format(new Date()));
  
  // Range waktu sesuai NTT:
  // 00:00 - 10:00 = Pagi
  // 10:01 - 14:59 = Siang
  // 15:00 - 17:59 = Sore
  // 18:00 - 23:59 = Malam
  if (j >= 0 && j <= 10) return 'Pagi';
  if (j >= 11 && j <= 14) return 'Siang';
  if (j >= 15 && j <= 17) return 'Sore';
  return 'Malam';
}

function getWaktuKapital() {
  const w = getWaktu();
  return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
}

function getJamSekarang() {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Makassar', // ← WITA (Kupang, Makassar, Bali)
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  return formatter.format(new Date());
}

function getTanggal(kemarin) {
  const d = getJakartaDate(kemarin);
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
}

function getTanggalSlash(kemarin) {
  const d = getJakartaDate(kemarin);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;
}

function getTanggalIndonesia() {
  const hari = ['Minggu','Senin','Selasa','Rabu','Kamis','Jumat','Sabtu'];
  const bulan = ['Januari','Februari','Maret','April','Mei','Juni','Juli','Agustus','September','Oktober','November','Desember'];
  const d = getJakartaDate();
  return `${hari[d.getDay()]}, ${String(d.getDate()).padStart(2,'0')} ${bulan[d.getMonth()]} ${d.getFullYear()}`;
}

function formatRp(n) {
  const v = parseFloat(n) || 0;
  return v === 0 ? 'Rp. -' : 'Rp. ' + v.toLocaleString('id-ID');
}

const fRp = formatRp;

function escapeMd(text) {
  if (!text) return '';
  return String(text).replace(/[_*\[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ════════════════════════════════════════════════════════════════
//   8. BERITA ACARA & STOCK OPNAME HELPERS
// ════════════════════════════════════════════════════════════════

function simpanStockOpname(tokoKode, data) {
  if (!STOCKOPNAME[tokoKode]) STOCKOPNAME[tokoKode] = [];
  STOCKOPNAME[tokoKode].push({
    timestamp: Date.now(),
    tanggal: getTanggalSlash(false),
    data: data,
  });
  saveJSON(CONFIG.paths.stockopname, STOCKOPNAME);
}

function simpanBeritaAcara(tokoKode, data) {
  if (!BERITA_ACARA[tokoKode]) BERITA_ACARA[tokoKode] = [];
  BERITA_ACARA[tokoKode].push({
    timestamp: Date.now(),
    nomorBA: data.nomorBA,
    tanggal: data.tanggal,
    data: data,
  });
  saveJSON(CONFIG.paths.beritaacara, BERITA_ACARA);
}

function generateNomorBA(tokoKode) {
  const d = getJakartaDate();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const history = BERITA_ACARA[tokoKode] || [];
  const tanggalHariIni = `${yyyy}-${mm}-${dd}`;
  const baHariIni = history.filter(h => {
    const hDate = new Date(h.timestamp);
    const hStr = `${hDate.getFullYear()}-${String(hDate.getMonth()+1).padStart(2,'0')}-${String(hDate.getDate()).padStart(2,'0')}`;
    return hStr === tanggalHariIni;
  });
  const urutan = baHariIni.length + 1;
  return `BA-${yyyy}${mm}-${dd}${urutan > 1 ? '-' + urutan : ''}`;
}

// ════════════════════════════════════════════════════════════════
//   8B. SHARED STOCK OPNAME HELPERS (Multi-User + Edit + Gabungan)
// ════════════════════════════════════════════════════════════════

/**
 * Struktur SO_SHARED:
 * {
 *   "tdm": {
 *     "tanggal": "24/06/2026",
 *     "sesiAktif": true,
 *     "racks": {
 *       "Rak A1": {
 *         "items": {
 *           "NN00001": {
 *             "entries": [
 *               { userId, namaPetugas, qty, jenis, jamInput, timestamp }
 *             ]
 *           }
 *         },
 *         "createdBy": "123456789",
 *         "createdAt": 1719024900000
 *       }
 *     },
 *     "usersAktif": {
 *       "123456789": {
 *         nama, rakAktif, jamMulai, petugas:[], lastActive
 *       }
 *     }
 *   }
 * }
 */

function getSOShared(tokoKode) {
  const tanggalHariIni = getTanggalSlash(false);
  
  if (!SO_SHARED[tokoKode]) {
    SO_SHARED[tokoKode] = {
      tanggal: tanggalHariIni,
      sesiAktif: false,
      racks: {},
      usersAktif: {},
    };
  }
  
  // Reset jika tanggal berbeda (SO hari baru)
  if (SO_SHARED[tokoKode].tanggal !== tanggalHariIni) {
    // Backup sebelum reset
    backupSOShared(tokoKode);
    SO_SHARED[tokoKode] = {
      tanggal: tanggalHariIni,
      sesiAktif: false,
      racks: {},
      usersAktif: {},
    };
    saveJSON(CONFIG.paths.soShared, SO_SHARED);
  }
  
  return SO_SHARED[tokoKode];
}

function backupSOShared(tokoKode) {
  const shared = SO_SHARED[tokoKode];
  if (!shared || Object.keys(shared.racks || {}).length === 0) return;
  
  if (!STOCKOPNAME[tokoKode]) STOCKOPNAME[tokoKode] = [];
  STOCKOPNAME[tokoKode].push({
    timestamp: Date.now(),
    tanggal: shared.tanggal,
    sharedData: JSON.parse(JSON.stringify(shared)),
  });
  saveJSON(CONFIG.paths.stockopname, STOCKOPNAME);
}

function saveShared() {
  saveJSON(CONFIG.paths.soShared, SO_SHARED);
}

// ── User Management ──

function joinSesiSO(tokoKode, userId, namaPetugas, petugas, rak, jamMulai) {
  const shared = getSOShared(tokoKode);
  shared.sesiAktif = true;
  shared.usersAktif[String(userId)] = {
    nama: namaPetugas,
    petugas: petugas,
    rakAktif: rak,
    jamMulai: jamMulai,
    lastActive: Date.now(),
  };
  if (!shared.racks[rak]) {
    shared.racks[rak] = { items: {}, createdBy: String(userId), createdAt: Date.now() };
  }
  saveShared();
  triggerBackupAfterEvent(tokoKode, 60000); // ⬅️ Backup 1 menit setelah join
}

function updateUserRakSO(tokoKode, userId, rakBaru) {
  const shared = getSOShared(tokoKode);
  if (shared.usersAktif[String(userId)]) {
    shared.usersAktif[String(userId)].rakAktif = rakBaru;
    shared.usersAktif[String(userId)].lastActive = Date.now();
  }
  if (!shared.racks[rakBaru]) {
    shared.racks[rakBaru] = { items: {}, createdBy: String(userId), createdAt: Date.now() };
  }
  saveShared();
  triggerBackupAfterEvent(tokoKode); // ⬅️ TAMBAH INI
}

function leaveSesiSO(tokoKode, userId) {
  const shared = getSOShared(tokoKode);
  delete shared.usersAktif[String(userId)];
  if (Object.keys(shared.usersAktif).length === 0) {
    shared.sesiAktif = false;
  }
  saveShared();
  // Backup saat user leave (data final user tersebut)
  kirimBackupKeAdmin(tokoKode, 'event', true).catch(e => {});
}

function getAllUsersAktif(tokoKode) {
  const shared = getSOShared(tokoKode);
  return shared.usersAktif || {};
}

function getAllRacks(tokoKode) {
  const shared = getSOShared(tokoKode);
  return shared.racks || {};
}

// ── Item Management ──

function tambahInputSO(tokoKode, rak, kodeBarang, userId, namaPetugas, qty, jenis) {
  const shared = getSOShared(tokoKode);
  if (!shared.racks[rak]) {
    shared.racks[rak] = { items: {}, createdBy: String(userId), createdAt: Date.now() };
  }
  if (!shared.racks[rak].items[kodeBarang]) {
    shared.racks[rak].items[kodeBarang] = { entries: [] };
  }
  
  shared.racks[rak].items[kodeBarang].entries.push({
    userId: String(userId),
    namaPetugas: namaPetugas,
    qty: qty,
    jenis: jenis,
    jamInput: getJamSekarang(),
    timestamp: Date.now(),
  });
  
  if (shared.usersAktif[String(userId)]) {
    shared.usersAktif[String(userId)].lastActive = Date.now();
  }
  
  saveShared();
}

function editQtyItemSO(tokoKode, rak, kodeBarang, entryIndex, newQty) {
  const shared = getSOShared(tokoKode);
  const rackData = shared.racks[rak];
  if (!rackData || !rackData.items[kodeBarang]) return false;
  
  const entries = rackData.items[kodeBarang].entries;
  if (entryIndex < 0 || entryIndex >= entries.length) return false;
  
  if (newQty <= 0) {
    entries.splice(entryIndex, 1);
    if (entries.length === 0) {
      delete rackData.items[kodeBarang];
    }
  } else {
    entries[entryIndex].qty = newQty;
    entries[entryIndex].jamInput = getJamSekarang() + ' (edited)';
  }
  
  saveShared();
  triggerBackupAfterEvent(tokoKode); // ⬅️ TAMBAH INI
  return true;
}

function hapusItemSO(tokoKode, rak, kodeBarang) {
  const shared = getSOShared(tokoKode);
  if (!shared.racks[rak]) return false;
  if (!shared.racks[rak].items[kodeBarang]) return false;
  
  delete shared.racks[rak].items[kodeBarang];
  saveShared();
  triggerBackupAfterEvent(tokoKode); // ⬅️ TAMBAH INI
  return true;
}

function tambahQtyItemSO(tokoKode, rak, kodeBarang, userId, namaPetugas, tambahQty, jenis) {
  const shared = getSOShared(tokoKode);
  if (!shared.racks[rak] || !shared.racks[rak].items[kodeBarang]) {
    tambahInputSO(tokoKode, rak, kodeBarang, userId, namaPetugas, tambahQty, jenis);
    triggerBackupAfterEvent(tokoKode); // ⬅️ TAMBAH INI
    return;
  }
  
  const entries = shared.racks[rak].items[kodeBarang].entries;
  const existIdx = entries.findIndex(e => 
    String(e.userId) === String(userId) && e.jenis === jenis
  );
  
  if (existIdx >= 0) {
    entries[existIdx].qty += tambahQty;
    entries[existIdx].jamInput = getJamSekarang() + ' (updated)';
    entries[existIdx].timestamp = Date.now();
  } else {
    entries.push({
      userId: String(userId),
      namaPetugas: namaPetugas,
      qty: tambahQty,
      jenis: jenis,
      jamInput: getJamSekarang(),
      timestamp: Date.now(),
    });
  }
  
  saveShared();
  triggerBackupAfterEvent(tokoKode); // ⬅️ TAMBAH INI
}

// ── Query Functions ──

function getBarangDiRak(tokoKode, rak) {
  const shared = getSOShared(tokoKode);
  if (!shared.racks[rak]) return {};
  return shared.racks[rak].items || {};
}

function getBarangDiSemuaRak(tokoKode, kodeBarang) {
  const shared = getSOShared(tokoKode);
  const result = [];
  
  Object.entries(shared.racks || {}).forEach(([rakName, rackData]) => {
    const itemData = rackData.items[kodeBarang];
    if (itemData && itemData.entries.length > 0) {
      let totalFisik = 0, totalGudang = 0;
      itemData.entries.forEach(e => {
        if (e.jenis === 'fisik') totalFisik += e.qty;
        else totalGudang += e.qty;
      });
      result.push({
        rak: rakName,
        entries: itemData.entries,
        totalFisik,
        totalGudang,
        total: totalFisik + totalGudang,
      });
    }
  });
  
  return result;
}

function getTotalBarangSemuaRak(tokoKode, kodeBarang) {
  const raks = getBarangDiSemuaRak(tokoKode, kodeBarang);
  let totalFisik = 0, totalGudang = 0;
  raks.forEach(r => {
    totalFisik += r.totalFisik;
    totalGudang += r.totalGudang;
  });
  return { totalFisik, totalGudang, total: totalFisik + totalGudang, raks };
}

function getSOGabunganData(tokoKode) {
  const shared = getSOShared(tokoKode);
  const gabungan = { fisik: {}, gudang: {} };
  
  Object.values(shared.racks || {}).forEach(rackData => {
    Object.entries(rackData.items || {}).forEach(([kode, itemData]) => {
      itemData.entries.forEach(entry => {
        if (entry.jenis === 'fisik') {
          gabungan.fisik[kode] = (gabungan.fisik[kode] || 0) + entry.qty;
        } else {
          gabungan.gudang[kode] = (gabungan.gudang[kode] || 0) + entry.qty;
        }
      });
    });
  });
  
  return gabungan;
}

function formatInfoBarangDiRakLain(tokoKode, kodeBarang, currentRak, currentUserId) {
  const raks = getBarangDiSemuaRak(tokoKode, kodeBarang);
  // Filter: tampilkan info dari rak lain ATAU entry user lain
  const info = [];
  
  raks.forEach(r => {
    r.entries.forEach(e => {
      if (r.rak !== currentRak || String(e.userId) !== String(currentUserId)) {
        info.push({ ...e, rak: r.rak });
      }
    });
  });
  
  if (info.length === 0) return '';
  
  let m = `\n⚠️ *BARANG INI SUDAH ADA DI:*\n──────────────────\n`;
  info.forEach((inp, i) => {
    const jenisIcon = inp.jenis === 'fisik' ? '🏪' : '🏭';
    m += `${i+1}. *${inp.namaPetugas}* di *${inp.rak}*\n`;
    m += `   ⏰ ${inp.jamInput} | ${jenisIcon} ${inp.jenis.toUpperCase()}: ${inp.qty}\n`;
  });
  
  let totalLain = 0;
  info.forEach(inp => totalLain += inp.qty);
  m += `\n📦 *Total di rak/user lain:* ${totalLain}\n`;
  
  return m;
}

// ── Excel Gabungan Generator ──

function generateExcelSOGabungan(tokoKode, namaToko) {
  const shared = getSOShared(tokoKode);
  const gabungan = getSOGabunganData(tokoKode);
  
  const wb = xlsx.utils.book_new();
  
  // ── SHEET 1: INFO UMUM ──
  const infoRows = [
    { Info: 'LAPORAN STOCK OPNAME GABUNGAN', Detail: '' },
    { Info: 'Toko', Detail: namaToko },
    { Info: 'Tanggal', Detail: getTanggalIndonesia() },
    { Info: '', Detail: '' },
    { Info: 'PETUGAS YANG BERPARTISIPASI', Detail: '' },
  ];
  
  const allPetugas = new Set();
  Object.values(shared.usersAktif || {}).forEach(u => {
    (u.petugas || [u.nama]).forEach(p => allPetugas.add(p));
  });
  // Juga dari entries
  Object.values(shared.racks || {}).forEach(rackData => {
    Object.values(rackData.items || {}).forEach(itemData => {
      itemData.entries.forEach(e => allPetugas.add(e.namaPetugas));
    });
  });
  
  let petugasIdx = 0;
  allPetugas.forEach(p => {
    petugasIdx++;
    infoRows.push({ Info: `Petugas ${petugasIdx}`, Detail: p });
  });
  
  infoRows.push({ Info: '', Detail: '' });
  infoRows.push({ Info: 'RAK YANG DIOPNAME', Detail: '' });
  
  Object.entries(shared.racks || {}).forEach(([rakName, rackData], i) => {
    const totalItems = Object.keys(rackData.items || {}).length;
    infoRows.push({ 
      Info: `Rak ${i+1}`, 
      Detail: `${rakName} | ${totalItems} jenis barang` 
    });
  });
  
  const allKodes = new Set([
    ...Object.keys(gabungan.fisik),
    ...Object.keys(gabungan.gudang),
  ]);
  
  infoRows.push({ Info: '', Detail: '' });
  infoRows.push({ Info: 'Total Rak', Detail: Object.keys(shared.racks || {}).length });
  infoRows.push({ Info: 'Total Jenis Barang', Detail: allKodes.size });
  infoRows.push({ Info: 'Total Petugas', Detail: allPetugas.size });
  
  const wsInfo = xlsx.utils.json_to_sheet(infoRows);
  wsInfo['!cols'] = [{ wch: 30 }, { wch: 55 }];
  xlsx.utils.book_append_sheet(wb, wsInfo, 'Info Opname');
  
  // ── SHEET 2: REKAP GABUNGAN ──
  const rekapRows = [];
  allKodes.forEach(kode => {
    const item = DATA_BARANG.find(d => d.kode === kode);
    if (!item) return;
    const stokSistem = item.harga[tokoKode]?.stok || 0;
    const stokFisik = gabungan.fisik[kode] || 0;
    const stokGudang = gabungan.gudang[kode] || 0;
    const totalOpname = stokFisik + stokGudang;
    const selisih = totalOpname - stokSistem;
    rekapRows.push({
      'Kode Item': kode,
      'Nama Item': item.nama,
      'Jenis': item.jenis || '',
      'Merek': item.merek || '',
      'Satuan': item.satuan,
      'Stok Sistem': stokSistem,
      'Stok Fisik': stokFisik,
      'Stok Gudang': stokGudang,
      'Total Opname': totalOpname,
      'Selisih': selisih,
      'Status': selisih === 0 ? 'SESUAI' : selisih > 0 ? 'LEBIH' : 'KURANG',
    });
  });
  
  rekapRows.sort((a, b) => {
    const order = { 'KURANG': 0, 'LEBIH': 1, 'SESUAI': 2 };
    return (order[a.Status] || 0) - (order[b.Status] || 0);
  });
  
  const wsRekap = xlsx.utils.json_to_sheet(rekapRows);
  wsRekap['!cols'] = [
    { wch: 12 }, { wch: 45 }, { wch: 15 }, { wch: 15 }, { wch: 8 },
    { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 8 }, { wch: 10 },
  ];
  xlsx.utils.book_append_sheet(wb, wsRekap, 'Rekap Gabungan');
  
  // ── SHEET 3+: DETAIL PER RAK ──
  Object.entries(shared.racks || {}).forEach(([rakName, rackData], idx) => {
    const rakRows = [];
    Object.entries(rackData.items || {}).forEach(([kode, itemData]) => {
      const item = DATA_BARANG.find(d => d.kode === kode);
      itemData.entries.forEach(entry => {
        rakRows.push({
          'Kode': kode,
          'Nama Barang': item?.nama || kode,
          'Satuan': item?.satuan || '',
          'Petugas': entry.namaPetugas,
          'Jenis': entry.jenis.toUpperCase(),
          'Qty': entry.qty,
          'Jam Input': entry.jamInput,
        });
      });
    });
    
    if (rakRows.length === 0) return;
    
    const sheetName = `Rak ${idx+1} ${rakName}`.substring(0, 31);
    const wsRak = xlsx.utils.json_to_sheet(rakRows);
    wsRak['!cols'] = [
      { wch: 12 }, { wch: 40 }, { wch: 8 }, { wch: 15 },
      { wch: 10 }, { wch: 8 }, { wch: 18 },
    ];
    xlsx.utils.book_append_sheet(wb, wsRak, sheetName);
  });
  
  // ── SHEET: DETAIL PER PETUGAS ──
  const petugasMap = {};
  Object.entries(shared.racks || {}).forEach(([rakName, rackData]) => {
    Object.entries(rackData.items || {}).forEach(([kode, itemData]) => {
      const item = DATA_BARANG.find(d => d.kode === kode);
      itemData.entries.forEach(entry => {
        if (!petugasMap[entry.namaPetugas]) petugasMap[entry.namaPetugas] = [];
        petugasMap[entry.namaPetugas].push({
          'Rak': rakName,
          'Kode': kode,
          'Nama Barang': item?.nama || kode,
          'Jenis': entry.jenis.toUpperCase(),
          'Qty': entry.qty,
          'Jam': entry.jamInput,
        });
      });
    });
  });
  
  Object.entries(petugasMap).forEach(([nama, rows]) => {
    const sheetName = `Petugas ${nama}`.substring(0, 31);
    const wsPetugas = xlsx.utils.json_to_sheet(rows);
    wsPetugas['!cols'] = [
      { wch: 15 }, { wch: 12 }, { wch: 40 }, { wch: 10 }, { wch: 8 }, { wch: 18 },
    ];
    xlsx.utils.book_append_sheet(wb, wsPetugas, sheetName);
  });
  
  const filePath = path.join(CONFIG.paths.storage, `temp_so_gabungan_${tokoKode}_${Date.now()}.xlsx`);
  xlsx.writeFile(wb, filePath);
  return filePath;
}

function generateLaporanSOGabungan(tokoKode, namaToko) {
  const shared = getSOShared(tokoKode);
  const gabungan = getSOGabunganData(tokoKode);
  
  let m = `📋 *LAPORAN STOCK OPNAME GABUNGAN*\n🏦 ${namaToko}\n📅 ${getTanggalSlash(false)}\n${GARIS_TEBAL}\n\n`;
  
  // Petugas
  const allPetugas = new Set();
  Object.values(shared.racks || {}).forEach(rackData => {
    Object.values(rackData.items || {}).forEach(itemData => {
      itemData.entries.forEach(e => allPetugas.add(e.namaPetugas));
    });
  });
  Object.values(shared.usersAktif || {}).forEach(u => {
    (u.petugas || [u.nama]).forEach(p => allPetugas.add(p));
  });
  
  m += `👥 *PETUGAS:* ${[...allPetugas].join(', ')}\n\n`;
  
  // Rak
  m += `📦 *RAK DIOPNAME:*\n${GARIS_TIPIS}\n`;
  Object.entries(shared.racks || {}).forEach(([rakName, rackData], i) => {
    const totalItems = Object.keys(rackData.items || {}).length;
    m += `${i+1}. *${rakName}* — ${totalItems} jenis barang\n`;
  });
  m += '\n';
  
  // Hasil
  m += `${GARIS_TEBAL}\n📊 *HASIL OPNAME:*\n${GARIS_TEBAL}\n\n`;
  
  const allKodes = new Set([
    ...Object.keys(gabungan.fisik),
    ...Object.keys(gabungan.gudang),
  ]);
  
  const kurang = [], lebih = [], sesuai = [];
  allKodes.forEach(kode => {
    const item = DATA_BARANG.find(d => d.kode === kode);
    if (!item) return;
    const sistem = item.harga[tokoKode]?.stok || 0;
    const fisik = gabungan.fisik[kode] || 0;
    const gudang = gabungan.gudang[kode] || 0;
    const total = fisik + gudang;
    const selisih = total - sistem;
    const data = { kode, nama: item.nama, satuan: item.satuan, sistem, fisik, gudang, total, selisih };
    if (selisih < 0) kurang.push(data);
    else if (selisih > 0) lebih.push(data);
    else sesuai.push(data);
  });
    // SORT ABJAD semua kategori
  kurang.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  lebih.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  sesuai.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  
  if (kurang.length) {
    m += `➖ *KURANG (${kurang.length})*\n${GARIS_TIPIS}\n`;
    kurang.forEach((d, i) => {
      m += `${i+1}. ${d.nama}\n   💻 ${d.sistem} | 📦 ${d.fisik} | 🏭 ${d.gudang} = ${d.total} (${d.selisih})\n`;
    });
    m += '\n';
  }
  if (lebih.length) {
    m += `➕ *LEBIH (${lebih.length})*\n${GARIS_TIPIS}\n`;
    lebih.forEach((d, i) => {
      m += `${i+1}. ${d.nama}\n   💻 ${d.sistem} | 📦 ${d.fisik} | 🏭 ${d.gudang} = ${d.total} (+${d.selisih})\n`;
    });
    m += '\n';
  }
  if (sesuai.length) {
    m += `✅ *SESUAI (${sesuai.length})*\n`;
    sesuai.slice(0, 10).forEach((d, i) => m += `${i+1}. ${d.nama} (${d.total})\n`);
    if (sesuai.length > 10) m += `_+${sesuai.length - 10} lainnya_\n`;
  }
  
  m += `\n${GARIS_TEBAL}\n📊 *RINGKASAN:*\n`;
  m += `   📦 Rak: ${Object.keys(shared.racks || {}).length} | 📊 Barang: ${allKodes.size}\n`;
  m += `   ✅ ${sesuai.length} | ➕ ${lebih.length} | ➖ ${kurang.length}\n`;
  m += `   👥 Petugas: ${allPetugas.size}\n`;
  
  return m;
}

// ════════════════════════════════════════════════════════════════
//   8C. AUTO BACKUP SO KE ADMIN (Real-time Safety Net)
// ════════════════════════════════════════════════════════════════

// Track backup terakhir per toko (cegah spam)
const BACKUP_TRACKER = {
  lastBackup: {},        // { tokoKode: timestamp }
  lastDataHash: {},      // { tokoKode: hash string }
  backupCount: {},       // { tokoKode: count }
  intervalTimer: null,
};

// Hash sederhana untuk cek apakah data berubah
function hashSOData(tokoKode) {
  const shared = SO_SHARED[tokoKode];
  if (!shared) return '';
  
  let hash = '';
  Object.entries(shared.racks || {}).forEach(([rak, rackData]) => {
    hash += rak + ':';
    Object.entries(rackData.items || {}).forEach(([kode, itemData]) => {
      const total = itemData.entries.reduce((sum, e) => sum + e.qty, 0);
      hash += `${kode}=${total};`;
    });
  });
  return hash;
}

// Generate caption untuk backup file
function generateCaptionBackup(tokoKode, type = 'auto') {
  const shared = SO_SHARED[tokoKode];
  const namaToko = NAMA_TOKO[tokoKode] || tokoKode;
  
  if (!shared) return `📦 Backup SO ${namaToko}`;
  
  const usersAktif = Object.keys(shared.usersAktif || {}).length;
  const totalRak = Object.keys(shared.racks || {}).length;
  
  let totalItems = 0;
  Object.values(shared.racks || {}).forEach(rackData => {
    totalItems += Object.keys(rackData.items || {}).length;
  });
  
  const allPetugas = new Set();
  Object.values(shared.usersAktif || {}).forEach(u => {
    (u.petugas || [u.nama]).forEach(p => allPetugas.add(p));
  });
  Object.values(shared.racks || {}).forEach(rackData => {
    Object.values(rackData.items || {}).forEach(itemData => {
      itemData.entries.forEach(e => allPetugas.add(e.namaPetugas));
    });
  });
  
  let typeIcon = '🔄';
  let typeLabel = 'AUTO';
  if (type === 'crash') { typeIcon = '🚨'; typeLabel = 'EMERGENCY'; }
  else if (type === 'manual') { typeIcon = '👤'; typeLabel = 'MANUAL'; }
  else if (type === 'periodic') { typeIcon = '⏰'; typeLabel = 'PERIODIC'; }
  else if (type === 'event') { typeIcon = '⚡'; typeLabel = 'REAL-TIME'; }
  
  return `${typeIcon} *BACKUP SO [${typeLabel}]*\n` +
    `🏦 ${namaToko}\n` +
    `📅 ${getTanggalSlash(false)} ${getJamSekarang()}\n` +
    `${GARIS_TIPIS}\n` +
    `👥 Petugas: ${[...allPetugas].join(', ') || '-'}\n` +
    `🟢 Aktif: ${usersAktif} user\n` +
    `📦 Rak: ${totalRak}\n` +
    `📊 Total Barang: ${totalItems} jenis`;
}

// Kirim backup Excel ke admin
async function kirimBackupKeAdmin(tokoKode, type = 'auto', forceKirim = false) {
  try {
    if (!CONFIG.adminId) {
      log.warn('BACKUP', 'Admin ID belum diset, skip backup');
      return false;
    }
    
    const shared = SO_SHARED[tokoKode];
    if (!shared) return false;
    
    // Cek apakah ada data
    const totalRak = Object.keys(shared.racks || {}).length;
    if (totalRak === 0) {
      log.info('BACKUP', `${tokoKode}: tidak ada data, skip`);
      return false;
    }
    
    // Cek apakah data berubah (kalau bukan force)
    if (!forceKirim) {
      const currentHash = hashSOData(tokoKode);
      const lastHash = BACKUP_TRACKER.lastDataHash[tokoKode];
      
      if (currentHash === lastHash) {
        log.info('BACKUP', `${tokoKode}: data tidak berubah, skip`);
        return false;
      }
      
      BACKUP_TRACKER.lastDataHash[tokoKode] = currentHash;
    }
    
    const namaToko = NAMA_TOKO[tokoKode] || tokoKode;
    
    // Generate Excel
    const excelPath = generateExcelSOGabungan(tokoKode, namaToko);
    
    // Counter backup
    BACKUP_TRACKER.backupCount[tokoKode] = (BACKUP_TRACKER.backupCount[tokoKode] || 0) + 1;
    const counter = BACKUP_TRACKER.backupCount[tokoKode];
    
    // Format filename
    const tgl = getTanggalSlash(false).replace(/\//g, '-');
    const jam = getJamSekarang().replace(':', '');
    const filename = `SO_${type.toUpperCase()}_${tokoKode.toUpperCase()}_${tgl}_${jam}_#${counter}.xlsx`;
    
    // Caption
    const caption = generateCaptionBackup(tokoKode, type);
    
    // Kirim ke admin
    await bot.sendDocument(CONFIG.adminId, excelPath, {
      caption: caption,
      parse_mode: 'Markdown'
    }, {
      filename: filename
    });
    
    // Hapus file temp
    try { fs.unlinkSync(excelPath); } catch(e) {}
    
    BACKUP_TRACKER.lastBackup[tokoKode] = Date.now();
    log.info('BACKUP', `✅ Sent backup ${tokoKode} [${type}] to admin`);
    return true;
  } catch(err) {
    log.error('BACKUP', `Failed ${tokoKode}: ${err.message}`);
    return false;
  }
}

// Backup SEMUA toko yang ada SO aktif
async function backupSemuaToko(type = 'periodic') {
  const tokoList = Object.keys(SO_SHARED).filter(tokoKode => {
    const shared = SO_SHARED[tokoKode];
    return shared && Object.keys(shared.racks || {}).length > 0;
  });
  
  if (tokoList.length === 0) return;
  
  log.info('BACKUP', `Backup ${tokoList.length} toko [${type}]`);
  
  for (const tokoKode of tokoList) {
    await kirimBackupKeAdmin(tokoKode, type, type === 'crash' || type === 'manual');
    await tunggu(1500); // Jeda 1.5s antar kirim (anti rate-limit Telegram)
  }
}

// Emergency backup - dipanggil saat crash/shutdown
async function emergencyBackup() {
  log.warn('BACKUP', '🚨 EMERGENCY BACKUP triggered!');
  try {
    await backupSemuaToko('crash');
    log.info('BACKUP', '🚨 Emergency backup completed');
  } catch(err) {
    log.error('BACKUP', 'Emergency backup failed: ' + err.message);
  }
}

// Start auto-backup interval
function startAutoBackup() {
  // Stop previous timer kalau ada
  if (BACKUP_TRACKER.intervalTimer) {
    clearInterval(BACKUP_TRACKER.intervalTimer);
  }
  
  // Backup setiap 2 menit (kalau ada perubahan)
  const INTERVAL_MS = 2 * 60 * 1000; // 2 menit
  
  BACKUP_TRACKER.intervalTimer = setInterval(async () => {
    await backupSemuaToko('periodic');
  }, INTERVAL_MS);
  
  log.info('BACKUP', `✅ Auto-backup started (interval: 2 menit)`);
}

// Trigger backup setelah event penting (dengan debounce)
const eventBackupTimers = {};

function triggerBackupAfterEvent(tokoKode, delay = 30000) {
  // Debounce: kalau ada event berturut-turut, tunggu sampai user selesai
  if (eventBackupTimers[tokoKode]) {
    clearTimeout(eventBackupTimers[tokoKode]);
  }
  
  eventBackupTimers[tokoKode] = setTimeout(async () => {
    await kirimBackupKeAdmin(tokoKode, 'event', false);
    delete eventBackupTimers[tokoKode];
  }, delay);
}

// ════════════════════════════════════════════════════════════════
//   9. ANALYTICS
// ════════════════════════════════════════════════════════════════

const STATS = {
  chats: 0, searches: 0, voiceNotes: 0, photos: 0, aiQueries: 0,
  users: new Set(), topSearches: {}, recentChats: [],
  startTime: Date.now(),
};

function trackChat(userId, message, type = 'text') {
  STATS.chats++;
  STATS.users.add(String(userId));
  if (type === 'voice') STATS.voiceNotes++;
  if (type === 'photo') STATS.photos++;
  if (type === 'ai') STATS.aiQueries++;
  STATS.recentChats.push({
    userId: String(userId), name: KONTAK[String(userId)] || 'User',
    message: String(message).substring(0, 100), type, time: Date.now(),
  });
  if (STATS.recentChats.length > 100) STATS.recentChats.shift();
}

function trackSearch(keyword) {
  STATS.searches++;
  const k = String(keyword).toLowerCase().substring(0, 50);
  STATS.topSearches[k] = (STATS.topSearches[k] || 0) + 1;
}

console.log('\n' + '═'.repeat(60));
console.log(`🤖 ${CONFIG.appName}`);
console.log('═'.repeat(60));
console.log(`👑 Admin ID: ${CONFIG.adminId}`);
console.log(`👥 Members: ${MEMBERS.length}/${CONFIG.maxMember}`);
console.log('═'.repeat(60));
// ════════════════════════════════════════════════════════════════
//   10. AI VISION PROVIDERS
// ════════════════════════════════════════════════════════════════

async function visionGemini(imageBuffer, prompt) {
  if (!CONFIG.geminiKey || !Buffer.isBuffer(imageBuffer)) return null;
  
  let mimeType = 'image/jpeg';
  const header = imageBuffer.slice(0, 12);
  if (header[0] === 0xFF && header[1] === 0xD8) mimeType = 'image/jpeg';
  else if (header[0] === 0x89 && header[1] === 0x50) mimeType = 'image/png';
  else if (header[0] === 0x47 && header[1] === 0x49) mimeType = 'image/gif';
  else if (header[0] === 0x52 && header[1] === 0x49) mimeType = 'image/webp';
  
  const imageBase64 = imageBuffer.toString('base64');
  const keys = [CONFIG.geminiKey, CONFIG.geminiKey2, CONFIG.geminiKey3].filter(Boolean);
  const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.0-flash-001'];
  
  for (const key of keys) {
    for (const model of MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
        const response = await axios.post(url, {
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inline_data: { mime_type: mimeType, data: imageBase64 }}
            ]
          }],
          generationConfig: { 
            temperature: 0.1, 
            maxOutputTokens: 8192,
            topK: 40,
            topP: 0.95,
          }
        }, { timeout: 90000 });
        
        const text = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          console.log(`✅ [GEMINI ${model}] Response: ${text.length} chars`);
          return { provider: 'GEMINI', model, text };
        }
      } catch(err) {
        const status = err.response?.status;
        if (status !== 429 && status !== 503) {
          console.warn(`[GEMINI ${model}]`, status || err.message);
        }
      }
    }
  }
  return null;
}

async function visionGroq(imageBuffer, prompt) {
  if (!CONFIG.groqKey || !Buffer.isBuffer(imageBuffer)) return null;
  const MODELS = ['meta-llama/llama-4-scout-17b-16e-instruct', 'llama-3.3-70b-versatile'];
  const imageBase64 = imageBuffer.toString('base64');
  
  for (const model of MODELS) {
    try {
      const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imageBase64 }}
          ]
        }],
        temperature: 0.1, 
        max_tokens: 8192,
      }, {
        headers: { 'Authorization': `Bearer ${CONFIG.groqKey}`, 'Content-Type': 'application/json' },
        timeout: 90000,
      });
      
      const text = response.data?.choices?.[0]?.message?.content;
      if (text) {
        console.log(`✅ [GROQ ${model}] Response: ${text.length} chars`);
        return { provider: 'GROQ', model, text };
      }
    } catch(err) {
      console.warn(`[GROQ ${model}]`, err.response?.status || err.message);
    }
  }
  return null;
}

async function visionOpenRouter(imageBuffer, prompt) {
  if (!CONFIG.openrouterKey || !Buffer.isBuffer(imageBuffer)) return null;
  const MODELS = [
    'meta-llama/llama-3.2-b-vision-instruct:free',
    'qwen/qwen-2-vl-7b-instruct:free',
  ];
  const imageBase64 = imageBuffer.toString('base64');
  
  for (const model of MODELS) {
    try {
      const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
        model,
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + imageBase64 }}
          ]
        }],
        temperature: 0.1, max_tokens: 8192,
      }, {
        headers: {
          'Authorization': `Bearer ${CONFIG.openrouterKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://github.com/bot-telegram-perabot',
          'X-Title': 'Bot Telegram Toko Perabot',
        },
        timeout: 90000,
      });
      
      const text = response.data?.choices?.[0]?.message?.content;
      if (text) return { provider: 'OPENROUTER', model, text };
    } catch(err) {
      console.warn(`[OR ${model}]`, err.response?.status || err.message);
    }
  }
  return null;
}

async function analisaGambarBuffer(imageBuffer, prompt) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length < 100) {
    throw new Error('Image buffer invalid');
  }
  
  console.log('📸 Image:', (imageBuffer.length / 1024).toFixed(1), 'KB');
  
  const providers = [
    { name: 'GEMINI', fn: visionGemini, enabled: !!CONFIG.geminiKey },
    { name: 'GROQ', fn: visionGroq, enabled: !!CONFIG.groqKey },
    { name: 'OPENROUTER', fn: visionOpenRouter, enabled: !!CONFIG.openrouterKey },
  ].filter(p => p.enabled);
  
  if (providers.length === 0) throw new Error('Tidak ada AI provider');
  
  for (const provider of providers) {
    try {
      const result = await provider.fn(imageBuffer, prompt);
      if (result && result.text) {
        return result.text;
      }
    } catch(err) {
      console.error(`❌ ${provider.name}:`, err.message);
    }
  }
  throw new Error('Semua AI provider gagal');
}

// ════════════════════════════════════════════════════════════════
//   11. AI CHAT - NATURAL CONVERSATION (Teman Ngobrol)
// ════════════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════════════
//   11A. WEB SEARCH (Untuk pertanyaan real-time)
// ════════════════════════════════════════════════════════════════

/**
 * Deteksi: apakah pertanyaan butuh info terkini dari internet?
 */
function butuhWebSearch(text) {
  const low = text.toLowerCase();
  
  // Pertanyaan tentang waktu/tanggal/event terkini
  const realtimeKeywords = [
    'presiden', 'menteri', 'gubernur', 'walikota', 'bupati',
    'kurs', 'dolar', 'dollar', 'rupiah', 'euro', 'yen', 'ringgit',
    'harga emas', 'harga bbm', 'harga minyak', 'pertamina',
    'cuaca', 'hujan', 'gempa', 'tsunami', 'bencana',
    'berita', 'news', 'terkini', 'terbaru', 'update',
    'piala dunia', 'olimpiade', 'sepak bola', 'liga',
    'jadwal', 'siaran langsung', 'live',
    'covid', 'pandemi', 'vaksin',
    'jokowi', 'prabowo', 'gibran', 'megawati', 'sby',
    'pemilu', 'pilkada', 'pilpres',
    'inflasi', 'ekonomi', 'saham', 'ihsg', 'bitcoin', 'crypto',
    'bbm naik', 'tarif', 'kebijakan',
    'lagu terbaru', 'film terbaru', 'rilis',
    'siapa', 'kapan', 'dimana', 'apa itu',
    'sekarang', 'hari ini', 'kemarin', 'minggu ini', 'bulan ini', 'tahun ini',
    '2024', '2025', '2026', '2027',
  ];
  
  for (const kw of realtimeKeywords) {
    if (low.includes(kw)) return { butuh: true, alasan: 'keyword: ' + kw };
  }
  
  // Pattern: "Berapa harga X sekarang"
  if (/\bberapa.*(harga|nilai|kurs).*\b/i.test(low)) return { butuh: true, alasan: 'pertanyaan harga umum' };
  
  // Pattern: "Apa itu X" (pertanyaan pengetahuan)
  if (/\b(apa itu|apa sih|apakah)\b/i.test(low)) return { butuh: true, alasan: 'pertanyaan pengetahuan' };
  
  // Pattern: "Bagaimana cara X"
  if (/\bbagaimana cara\b/i.test(low)) return { butuh: true, alasan: 'how-to' };
  
  return { butuh: false };
}

/**
 * Cari di internet pakai DuckDuckGo Instant Answer (gratis, no API key)
 */
async function searchDuckDuckGo(query) {
  try {
    const response = await axios.get('https://api.duckduckgo.com/', {
      params: {
        q: query,
        format: 'json',
        no_html: '1',
        skip_disambig: '1',
      },
      timeout: 10000,
    });
    
    const data = response.data;
    let result = '';
    
    if (data.AbstractText) {
      result += `📝 ${data.AbstractText}\n`;
      if (data.AbstractSource) result += `📰 Sumber: ${data.AbstractSource}\n`;
    }
    
    if (data.Answer) {
      result = `💡 ${data.Answer}\n` + result;
    }
    
    if (data.Definition) {
      result += `📖 ${data.Definition}\n`;
    }
    
    if (data.RelatedTopics && data.RelatedTopics.length > 0) {
      const topTopic = data.RelatedTopics[0];
      if (topTopic.Text) result += `🔗 Terkait: ${topTopic.Text}\n`;
    }
    
    return result.trim() || null;
  } catch(err) {
    log.warn('WEB-DDG', err.message);
    return null;
  }
}

/**
 * Cari di internet pakai Wikipedia API (gratis, no API key)
 */
async function searchWikipedia(query) {
  try {
    // Coba Wikipedia Indonesia dulu
    let response;
    try {
      response = await axios.get('https://id.wikipedia.org/api/rest_v1/page/summary/' + 
        encodeURIComponent(query), { timeout: 10000 });
    } catch(e) {
      // Fallback ke English
      response = await axios.get('https://en.wikipedia.org/api/rest_v1/page/summary/' + 
        encodeURIComponent(query), { timeout: 10000 });
    }
    
    const data = response.data;
    if (data.extract) {
      return `📚 ${data.extract.substring(0, 800)}\n\n🔗 Sumber: Wikipedia`;
    }
    return null;
  } catch(err) {
    return null;
  }
}

/**
 * Search Wikipedia dengan keyword (lebih fleksibel)
 */
async function searchWikipediaQuery(query) {
  try {
    // Coba dengan beberapa variasi query
    const queries = [
      query,                                    // Original
      query.replace(/indonesia/gi, '').trim(),  // Tanpa "indonesia"
      query + ' Indonesia',                     // Tambah "Indonesia"
    ];
    
    for (const q of queries) {
      if (!q) continue;
      
      try {
        const response = await axios.get('https://id.wikipedia.org/w/api.php', {
          params: {
            action: 'query',
            format: 'json',
            list: 'search',
            srsearch: q,
            srlimit: 3,
            origin: '*',
          },
          timeout: 10000,
        });
        
        const results = response.data?.query?.search;
        if (results && results.length > 0) {
          const topResult = results[0];
          const summary = await searchWikipedia(topResult.title);
          if (summary) return summary;
        }
      } catch(e) {}
    }
    
    return null;
  } catch(err) {
    return null;
  }
}

/**
 * Get kurs mata uang dari API gratis
 */
async function getKursMataUang(from = 'USD', to = 'IDR') {
  try {
    const response = await axios.get(`https://api.exchangerate-api.com/v4/latest/${from}`, {
      timeout: 10000,
    });
    
    const rate = response.data?.rates?.[to];
    if (rate) {
      return {
        from, to, rate,
        text: `💱 1 ${from} = Rp ${rate.toLocaleString('id-ID')} (${response.data.date})`,
      };
    }
    return null;
  } catch(err) {
    log.warn('KURS', err.message);
    return null;
  }
}

/**
 * Deteksi pertanyaan kurs mata uang
 */
function deteksiKurs(text) {
  const low = text.toLowerCase();
  
  const currencies = {
    'dolar': 'USD', 'dollar': 'USD', 'usd': 'USD', 'us': 'USD',
    'euro': 'EUR', 'eur': 'EUR',
    'yen': 'JPY', 'jpy': 'JPY', 'jepang': 'JPY',
    'ringgit': 'MYR', 'myr': 'MYR', 'malaysia': 'MYR',
    'singapore': 'SGD', 'sgd': 'SGD', 'singapura': 'SGD',
    'pound': 'GBP', 'gbp': 'GBP', 'inggris': 'GBP',
    'aud': 'AUD', 'australia': 'AUD',
    'won': 'KRW', 'korea': 'KRW',
    'yuan': 'CNY', 'china': 'CNY', 'cny': 'CNY',
    'baht': 'THB', 'thailand': 'THB',
    'riyal': 'SAR', 'arab': 'SAR',
  };
  
  for (const [keyword, code] of Object.entries(currencies)) {
    if (low.includes(keyword)) {
      // Cek apakah ada kata kunci kurs/nilai/rupiah
      if (low.includes('rupiah') || low.includes('rp ') || low.includes('berapa') || 
          low.includes('kurs') || low.includes('nilai')) {
        return code;
      }
    }
  }
  return null;
}

/**
 * Main function: cari info di internet
 */
async function cariInfoInternet(query) {
  log.info('WEB', `Searching: ${query}`);
  
  let hasil = '';
  let sumber = [];
  
  // 1. Cek apakah pertanyaan kurs mata uang
  const kursCode = deteksiKurs(query);
  if (kursCode) {
    const kurs = await getKursMataUang(kursCode, 'IDR');
    if (kurs) return kurs.text;
  }
  
  // 2. Coba Wikipedia DULU (lebih reliable untuk pertanyaan umum)
  // Extract keyword utama dari query
  const cleanQuery = extractKeywordSearch(query);
  log.info('WEB', `Wikipedia query: ${cleanQuery}`);
  
  const wikiResult = await searchWikipediaQuery(cleanQuery);
  if (wikiResult) {
    hasil += wikiResult + '\n\n';
    sumber.push('Wikipedia');
  }
  
  // 3. Coba DuckDuckGo dengan query asli
  if (!hasil) {
    const ddgResult = await searchDuckDuckGo(query);
    if (ddgResult) {
      hasil += ddgResult + '\n\n';
      sumber.push('DuckDuckGo');
    }
  }
  
  // 4. Fallback: search dengan keyword bersih ke DDG
  if (!hasil && cleanQuery !== query) {
    const ddgResult2 = await searchDuckDuckGo(cleanQuery);
    if (ddgResult2) {
      hasil += ddgResult2;
      sumber.push('DuckDuckGo');
    }
  }
  
  if (hasil.trim().length > 0) {
    return hasil.trim();
  }
  
  return null;
}

// Extract keyword utama dari pertanyaan
function extractKeywordSearch(query) {
  let q = query.toLowerCase().trim();
  
  // Hapus kata tanya umum
  const stopWords = [
    'siapa', 'apa', 'kapan', 'dimana', 'mengapa', 'kenapa', 'bagaimana',
    'apakah', 'siapakah', 'kapankah', 'apa itu', 'siapa itu',
    'sekarang', 'hari ini', 'saat ini', 'sekarang ini',
    'berapa', 'tolong', 'mohon', 'kak', 'ka', 'dong', 'sih',
    'yang', 'adalah', 'itu', 'ini', 'di', 'ke', 'dari',
  ];
  
  stopWords.forEach(sw => {
    const regex = new RegExp(`\\b${sw}\\b`, 'gi');
    q = q.replace(regex, ' ');
  });
  
  // Cleanup spasi
  q = q.replace(/\s+/g, ' ').replace(/[?.,!]/g, '').trim();
  
  // Capitalize untuk Wikipedia
  q = q.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
  
  return q;
}

// Memory percakapan per user (last 10 messages)
const CHAT_MEMORY = {};
const MAX_MEMORY = 10;

function getChatMemory(userId) {
  if (!CHAT_MEMORY[userId]) CHAT_MEMORY[userId] = [];
  return CHAT_MEMORY[userId];
}

function addToMemory(userId, role, content) {
  const mem = getChatMemory(userId);
  mem.push({ role, content, timestamp: Date.now() });
  if (mem.length > MAX_MEMORY) mem.shift(); // Hapus yang paling lama
}

function clearMemory(userId) {
  delete CHAT_MEMORY[userId];
}

// Deteksi mood/intent dari pesan user
function detectMood(text) {
  const low = text.toLowerCase();
  
  // Sedih/curhat
  if (/\b(capek|cape|lelah|sedih|galau|sebel|kesal|kesel|stress|mumet|pusing|sakit|sakid|nangis|menangis|hancur|down)\b/i.test(low))
    return 'sedih';
  
  // Senang/excited
  if (/\b(senang|seneng|bahagia|happy|gembira|excited|yes+|asik|asyik|mantap|mantul|keren|wow|hore|yeay|yes!)\b/i.test(low))
    return 'senang';
  
  // Marah/frustrasi
  if (/\b(marah|kesel|sebel|gemes|jengkel|annoyed|wtf|anjir|anjay|anjg|sialan|brengsek)\b/i.test(low))
    return 'marah';
  
  // Bingung
  if (/\b(bingung|pusing|gak ngerti|nggak paham|how|gimana|kenapa|why|kok|knp)\b/i.test(low))
    return 'bingung';
  
  // Lapar
  if (/\b(lapar|laper|makan|haus|minum|ngemil|jajan|kuliner|nasi|mie|kopi|teh)\b/i.test(low))
    return 'lapar';
  
  // Lelah/ngantuk
  if (/\b(ngantuk|tidur|bobo|istirahat|rebahan|tepar)\b/i.test(low))
    return 'ngantuk';
  
  // Cinta/baper
  if (/\b(cinta|sayang|kangen|rindu|kepo|crush|gebetan|pacar|jomblo|baper)\b/i.test(low))
    return 'romantis';
  
  // Curhat tentang kerjaan
  if (/\b(kerja|kerjaan|bos|kantor|customer|pelanggan|atasan|gaji|lembur)\b/i.test(low))
    return 'kerja';
  
  return 'normal';
}

// Build system prompt yang natural
function buildSystemPrompt(userId, userName, webContext = null) {
  const nama = userName || 'Kakak';
  const waktu = getWaktu().toLowerCase();
  const jam = getJamSekarang();
  const tanggal = getTanggalIndonesia();
  
  let webInfo = '';
  if (webContext) {
    webInfo = `\n═══════════════════════════════════════════
📡 INFO DARI INTERNET (gunakan untuk jawab user):
═══════════════════════════════════════════
${webContext}

INSTRUKSI: Gunakan info di atas untuk jawab pertanyaan user dengan natural.
Sebutkan sumber kalau perlu (Wikipedia, dll).
═══════════════════════════════════════════\n`;
  }
  
  return `Kamu adalah Aiva, teman ngobrol AI di bot Telegram Toko Perabot.

═══════════════════════════════════════════
🚨 ATURAN MUTLAK (WAJIB DIPATUHI):
═══════════════════════════════════════════

1. ❌ JANGAN PERNAH karang data PRODUK TOKO (harga/stok/spek barang)
   - JANGAN bilang "ada 3 pcs di TDM"
   - JANGAN bilang "harganya 250 ribu"
   - Kalau ditanya produk toko, jawab: "Bentar aku cek di database..."

2. ✅ KALAU USER MINTA BUKA MENU/FITUR TERTENTU:
   Contoh: "buka stock opname", "mau ke menu utama", "menu admin dong"
   
   Jawab dengan: "Oke aku bukain menu [nama menu] ya kak!"
   JANGAN dijawab dengan ngobrol biasa. Sistem otomatis akan handle.

3. ✅ BOLEH JAWAB pertanyaan umum dengan info yang KAMU TAHU:
   - Sejarah, geografi, sains
   - Pengetahuan umum
   - Tips & saran
   - Bercanda & ngobrol bebas

4. ✅ KALAU ADA INFO DARI INTERNET (di atas), GUNAKAN itu untuk jawab.

5. ❌ JANGAN jawab "saya tidak tahu" untuk info umum.
   Coba jawab dengan pengetahuan yang ada, atau bilang "kayaknya sih..."

═══════════════════════════════════════════
KARAKTER:
═══════════════════════════════════════════
- Nama: Aiva (AI Virtual Assistant)
- Ramah, hangat, empati seperti teman dekat
- Bahasa santai Indonesia (aku/kamu/kak)
- Respon SINGKAT (2-4 kalimat)
- Pakai emoji secukupnya (max 2-3)

═══════════════════════════════════════════
MENU YANG TERSEDIA DI BOT:
═══════════════════════════════════════════
- 📋 Menu Utama (main menu)
- 🔍 Cari Barang (search produk)
- 📦 Stock Opname (SO)
- 📊 Laporan Penjualan
- 🏷️ Laporan Harga
- 🛒 Laporan Marketplace
- 📋 Berita Acara
- 🤖 AI Chat (kamu sendiri)
- 👑 Menu Admin (khusus admin)
- ℹ️ Info Bot
- ❓ Bantuan/Panduan

KALAU USER NYEBUT NAMA MENU, sarankan dia ketik nama menu itu langsung,
contoh: "Ketik 'stock opname' untuk buka SO" atau pakai tombol.

KONTEKS USER:
- Nama: ${nama}
- Waktu: ${jam} (${waktu})
- Tanggal: ${tanggal}
${webInfo}
═══════════════════════════════════════════
CONTOH BENAR vs SALAH:
═══════════════════════════════════════════

User: "Siapa presiden Indonesia sekarang?"
[Dengan info web]
✅ "Presiden Indonesia saat ini adalah Prabowo Subianto kak, dilantik Oktober 2024 😊"

User: "1 dolar berapa rupiah?"
[Dengan info kurs]
✅ "Sekarang 1 USD = Rp 16.250 kak (kurs real-time) 💱"

User: "saya capek"
✅ "Aduh kak ${nama}, capek ya 🥺 Cerita dong, kenapa?"

User: "harga panci eagle 20"
✅ "Bentar aku cek di database ya kak 🔍"

User: "apa itu blockchain?"
✅ "Blockchain itu kayak buku besar digital yang nyimpen transaksi, kak. 
   Datanya gak bisa diubah karena tersebar di banyak komputer 🔗"

User: "buka stock opname dong"
✅ "Oke aku bukain menu Stock Opname ya kak! 📦"

User: "kapan piala dunia 2026?"
[Dengan info web]
✅ "Piala Dunia 2026 bakal digelar di USA, Kanada, Meksiko bulan Juni-Juli 2026 ⚽"

Sekarang respon dengan natural sesuai konteks!`;
}

// AI Chat dengan Gemini (support history)
async function chatGeminiNatural(userId, userMessage, userName) {
  if (!CONFIG.geminiKey) return null;
  
  const keys = [CONFIG.geminiKey, CONFIG.geminiKey2, CONFIG.geminiKey3].filter(Boolean);
  const memory = getChatMemory(userId);
  const systemPrompt = buildSystemPrompt(userId, userName);
  
  // Build conversation history untuk Gemini
  const contents = [];
  
  // Tambah history sebelumnya
  memory.forEach(msg => {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    });
  });
  
  // Tambah pesan terbaru
  contents.push({
    role: 'user',
    parts: [{ text: userMessage }]
  });
  
  for (const key of keys) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
      const resp = await axios.post(url, {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: {
          temperature: 0.9, // Lebih kreatif & natural
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 500, // Cukup untuk respon natural
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      }, { timeout: 30000 });
      
      const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text.trim();
    } catch(err) {
      console.warn('[GEMINI-NATURAL]', err.message);
    }
  }
  return null;
}

// AI Chat dengan Groq (support history)
async function chatGroqNatural(userId, userMessage, userName) {
  if (!CONFIG.groqKey) return null;
  
  const memory = getChatMemory(userId);
  const systemPrompt = buildSystemPrompt(userId, userName);
  
  const messages = [
    { role: 'system', content: systemPrompt }
  ];
  
  // Tambah history
  memory.forEach(msg => {
    messages.push({
      role: msg.role,
      content: msg.content
    });
  });
  
  // Tambah pesan terbaru
  messages.push({ role: 'user', content: userMessage });
  
  try {
    const resp = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: messages,
      temperature: 0.9,
      max_tokens: 500,
      top_p: 0.95,
    }, {
      headers: { 'Authorization': `Bearer ${CONFIG.groqKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return resp.data?.choices?.[0]?.message?.content?.trim();
  } catch(err) {
    console.warn('[GROQ-NATURAL]', err.message);
    return null;
  }
}

// AI Chat dengan OpenRouter (support history)
async function chatOpenRouterNatural(userId, userMessage, userName) {
  if (!CONFIG.openrouterKey) return null;
  
  const memory = getChatMemory(userId);
  const systemPrompt = buildSystemPrompt(userId, userName);
  
  const messages = [
    { role: 'system', content: systemPrompt }
  ];
  
  memory.forEach(msg => {
    messages.push({ role: msg.role, content: msg.content });
  });
  
  messages.push({ role: 'user', content: userMessage });
  
  try {
    const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'meta-llama/llama-3.2-3b-instruct:free',
      messages: messages,
      temperature: 0.9,
      max_tokens: 500,
    }, {
      headers: { 'Authorization': `Bearer ${CONFIG.openrouterKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return resp.data?.choices?.[0]?.message?.content?.trim();
  } catch(err) { return null; }
}

// Main natural chat function dengan fallback
async function chatAINatural(userId, userMessage, userName) {
  let response = null;
  let provider = null;
  let webContext = null;
  
  // ★ STEP 1: Cek apakah butuh web search
  const webNeed = butuhWebSearch(userMessage);
  if (webNeed.butuh) {
    log.info('AI-WEB', `Butuh web search: ${webNeed.alasan}`);
    
    try {
      webContext = await cariInfoInternet(userMessage);
      if (webContext) {
        log.info('AI-WEB', `✅ Got web info: ${webContext.substring(0, 100)}`);
      } else {
        log.info('AI-WEB', 'Web search no result, AI jawab dari knowledge');
      }
    } catch(err) {
      log.warn('AI-WEB', err.message);
    }
  }
  
  // ★ STEP 2: Panggil AI dengan/tanpa web context
  if (CONFIG.groqKey) {
    response = await chatGroqNaturalWithContext(userId, userMessage, userName, webContext);
    if (response && response.length >= 5) provider = 'GROQ';
  }
  
  if (!response && CONFIG.geminiKey) {
    response = await chatGeminiNaturalWithContext(userId, userMessage, userName, webContext);
    if (response && response.length >= 5) provider = 'GEMINI';
  }
  
  if (!response && CONFIG.openrouterKey) {
    response = await chatOpenRouterNaturalWithContext(userId, userMessage, userName, webContext);
    if (response && response.length >= 5) provider = 'OPENROUTER';
  }
  
  if (response) {
    addToMemory(userId, 'user', userMessage);
    addToMemory(userId, 'assistant', response);
  }
  
  return response ? { jawaban: response, provider, webUsed: !!webContext } : null;
}

// Versi baru dari chat functions yang support webContext
async function chatGroqNaturalWithContext(userId, userMessage, userName, webContext) {
  if (!CONFIG.groqKey) return null;
  
  const memory = getChatMemory(userId);
  const systemPrompt = buildSystemPrompt(userId, userName, webContext);
  
  const messages = [{ role: 'system', content: systemPrompt }];
  memory.forEach(msg => {
    messages.push({ role: msg.role, content: msg.content });
  });
  messages.push({ role: 'user', content: userMessage });
  
  try {
    const resp = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: messages,
      temperature: 0.9,
      max_tokens: 500,
      top_p: 0.95,
    }, {
      headers: { 'Authorization': `Bearer ${CONFIG.groqKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return resp.data?.choices?.[0]?.message?.content?.trim();
  } catch(err) {
    console.warn('[GROQ-WEB]', err.message);
    return null;
  }
}

async function chatGeminiNaturalWithContext(userId, userMessage, userName, webContext) {
  if (!CONFIG.geminiKey) return null;
  
  const keys = [CONFIG.geminiKey, CONFIG.geminiKey2, CONFIG.geminiKey3].filter(Boolean);
  const memory = getChatMemory(userId);
  const systemPrompt = buildSystemPrompt(userId, userName, webContext);
  
  const contents = [];
  memory.forEach(msg => {
    contents.push({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }]
    });
  });
  contents.push({ role: 'user', parts: [{ text: userMessage }] });
  
  for (const key of keys) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
      const resp = await axios.post(url, {
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: contents,
        generationConfig: {
          temperature: 0.9,
          topK: 40, topP: 0.95,
          maxOutputTokens: 500,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        ],
      }, { timeout: 30000 });
      
      const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text.trim();
    } catch(err) {
      console.warn('[GEMINI-WEB]', err.message);
    }
  }
  return null;
}

async function chatOpenRouterNaturalWithContext(userId, userMessage, userName, webContext) {
  if (!CONFIG.openrouterKey) return null;
  
  const memory = getChatMemory(userId);
  const systemPrompt = buildSystemPrompt(userId, userName, webContext);
  
  const messages = [{ role: 'system', content: systemPrompt }];
  memory.forEach(msg => {
    messages.push({ role: msg.role, content: msg.content });
  });
  messages.push({ role: 'user', content: userMessage });
  
  try {
    const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'meta-llama/llama-3.2-3b-instruct:free',
      messages: messages,
      temperature: 0.9,
      max_tokens: 500,
    }, {
      headers: { 'Authorization': `Bearer ${CONFIG.openrouterKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return resp.data?.choices?.[0]?.message?.content?.trim();
  } catch(err) { return null; }
}

// Function lama tetap ada untuk backward compatibility
async function chatAI(prompt) {
  if (CONFIG.groqKey) { 
    const r = await chatGroq(prompt); 
    if (r && r.length >= 10) return { jawaban: r, provider: 'GROQ' }; 
  }
  if (CONFIG.geminiKey) { 
    const r = await chatGemini(prompt); 
    if (r && r.length >= 10) return { jawaban: r, provider: 'GEMINI' }; 
  }
  if (CONFIG.openrouterKey) { 
    const r = await chatOpenRouter(prompt); 
    if (r && r.length >= 10) return { jawaban: r, provider: 'OPENROUTER' }; 
  }
  return null;
}

// Function chat lama untuk backward compat
async function chatGemini(prompt) {
  if (!CONFIG.geminiKey) return null;
  const keys = [CONFIG.geminiKey, CONFIG.geminiKey2, CONFIG.geminiKey3].filter(Boolean);
  for (const key of keys) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${key}`;
      const resp = await axios.post(url, { contents: [{ parts: [{ text: prompt }] }] }, { timeout: 30000 });
      const text = resp.data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (text) return text.trim();
    } catch(err) {}
  }
  return null;
}

async function chatGroq(prompt) {
  if (!CONFIG.groqKey) return null;
  try {
    const resp = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7, max_tokens: 1500,
    }, {
      headers: { 'Authorization': `Bearer ${CONFIG.groqKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return resp.data?.choices?.[0]?.message?.content?.trim();
  } catch(err) { return null; }
}

async function chatOpenRouter(prompt) {
  if (!CONFIG.openrouterKey) return null;
  try {
    const resp = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'meta-llama/llama-3.2-3b-instruct:free',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7, max_tokens: 1500,
    }, {
      headers: { 'Authorization': `Bearer ${CONFIG.openrouterKey}`, 'Content-Type': 'application/json' },
      timeout: 30000,
    });
    return resp.data?.choices?.[0]?.message?.content?.trim();
  } catch(err) { return null; }
}

// Cleanup memory yang sudah lama (lebih dari 1 jam idle)
setInterval(() => {
  const ONE_HOUR = 60 * 60 * 1000;
  const now = Date.now();
  Object.keys(CHAT_MEMORY).forEach(userId => {
    const lastMsg = CHAT_MEMORY[userId][CHAT_MEMORY[userId].length - 1];
    if (lastMsg && now - lastMsg.timestamp > ONE_HOUR) {
      delete CHAT_MEMORY[userId];
    }
  });
}, 15 * 60 * 1000); // Cek setiap 15 menit

// ════════════════════════════════════════════════════════════════
//   12. VOICE NOTE - SPEECH TO TEXT
// ════════════════════════════════════════════════════════════════

async function voiceToText(audioBuffer) {
  if (!CONFIG.groqKey || !Buffer.isBuffer(audioBuffer)) return null;
  
  try {
    const form = new FormData();
    form.append('file', audioBuffer, { filename: 'voice.ogg', contentType: 'audio/ogg' });
    form.append('model', 'whisper-large-v3');
    form.append('language', 'id');
    form.append('response_format', 'text');
    form.append('temperature', '0');
    
    // ★ PROMPT untuk kasih context ke Whisper (biar lebih akurat)
    form.append('prompt', 
      'Toko perabot rumah tangga. Barang: panci, dandang, wajan, kompor, dispenser, ' +
      'setrika, kipas angin, magic com, blender, mixer, rice cooker, termos, ' +
      'gelas, piring, sendok, garpu, teko, sapu, ember, kasur, bed, lemari, meja, kursi. ' +
      'Merek: Eagle, Cosmos, Niko, Miyako, Maxim, Philips, Sharp, Panasonic, Sanken, ' +
      'Tefal, Oxone, Maspion, Sunflask, Elephant, Apolly, Ferona, Amazon, Flamboyan. ' +
      'Toko: NK (Nasional Kitchen), TDM, Oesapa, Kefa (Kefamenanu), CP (Central Perabot). ' +
      'Kata sering: harga, stok, cari, cek, di, ecer, grosir, ambil.'
    );
    
    const response = await axios.post(
      'https://api.groq.com/openai/v1/audio/transcriptions',
      form,
      {
        headers: { 'Authorization': `Bearer ${CONFIG.groqKey}`, ...form.getHeaders() },
        timeout: 30000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );
    
    return typeof response.data === 'string' ? response.data.trim() : (response.data?.text || '').trim();
  } catch(err) {
    log.error('VOICE', err.message);
    return null;
  }
}

async function koreksiVoiceText(rawText) {
  if (!rawText || rawText.length < 2) return rawText;
  
  let corrected = rawText.toLowerCase();
  
  // ═══ CLEANUP KARAKTER ANEH DULU ═══
  corrected = corrected.replace(/\\/g, ''); // Hapus backslash
  corrected = corrected.replace(/[.,!?;:]+$/g, ''); // Hapus tanda baca di akhir
  corrected = corrected.replace(/\s+/g, ' ').trim();
  
  const KOREKSI = {
    // ═══ FIX PISAH KATA (Whisper sering split) ═══
    'fero na': 'ferona',
    'fero nah': 'ferona',
    'perro na': 'ferona',
    'vero na': 'ferona',
    'verona': 'ferona',      // ← Verona = Ferona
    'perona': 'ferona',
    'ferrona': 'ferona',
    
    'mi yako': 'miyako',
    'mia ko': 'miyako',
    'miya co': 'miyako',
    
    'ni ko': 'niko',
    'nay ko': 'niko',
    
    'ea gle': 'eagle',
    'igel': 'eagle',
    'egel': 'eagle',
    
    'kos mos': 'cosmos',
    'kosmos': 'cosmos',
    
    'ma xim': 'maxim',
    'mak sim': 'maxim',
    
    'phi lips': 'philips',
    'fi lips': 'philips',
    'philip': 'philips',
    
    'a polly': 'apolly',
    'apoli': 'apolly',
    
    'sun flask': 'sunflask',
    'ele phant': 'elephant',
    
    'ma gic com': 'magic com',
    'ma gic': 'magic',
    'rice cook er': 'rice cooker',
    'ricecoo ker': 'rice cooker',
    
    // ═══ TOKO (yang sering salah) ═══
    'keva': 'kefa', 'kafa': 'kefa', 'kepa': 'kefa', 'kepha': 'kefa',
    'kefa menanu': 'kefa', 'kefamenanu': 'kefa',
    'oesafa': 'oesapa', 'usapa': 'oesapa', 'osapa': 'oesapa',
    'oe sapa': 'oesapa', 'we sapa': 'oesapa',
    'tedaem': 'tdm', 'te de em': 'tdm', 'ted em': 'tdm',
    'ce pe': 'cp', 'cepet': 'cp', 'dcp': 'cp', 'sepet': 'cp',
    'see pee': 'cp', 'sepe': 'cp', 'ce peh': 'cp', 'ce pee': 'cp',
    'central': 'cp', 'central perabot': 'cp',
    'nasional kitchen': 'nk', 'na sional': 'nasional',
    
    // ═══ KATA BARANG (yang sering salah) ═══
    'pantji': 'panci', 'panchi': 'panci', 'pancy': 'panci',
    'wadjan': 'wajan', 'wajen': 'wajan', 'wa jan': 'wajan',
    'komper': 'kompor', 'kompur': 'kompor', 'kom por': 'kompor',
    'saapu': 'sapu', 'sa pu': 'sapu',
    'dispencer': 'dispenser', 'despenser': 'dispenser',
    'dis penser': 'dispenser',
    'settrika': 'setrika', 'strika': 'setrika', 'setrikan': 'setrika',
    'set rika': 'setrika',
    'dandan': 'dandang', 'dendang': 'dandang', 'dan dang': 'dandang',
    'blander': 'blender', 'blen der': 'blender',
    'mikser': 'mixer', 'mixser': 'mixer', 'mix er': 'mixer',
    'kukas': 'kulkas', 'kul kas': 'kulkas',
    'termusd': 'termos', 'ter mos': 'termos',
    'ki pas': 'kipas', 'kipas an gin': 'kipas angin',
    
    // ═══ KATA UMUM ═══
    'grocer': 'grosir', 'groser': 'grosir', 'gerosir': 'grosir',
    'echer': 'ecer', 'eyecer': 'ecer', 'e cer': 'ecer',
    'har ga': 'harga', 'har ga nya': 'harganya',
    'stok nya': 'stoknya', 'sto knya': 'stoknya',
    'de cepet': 'di cp', 'de cepe': 'di cp',
    'dee cepe': 'di cp', 'di cepe': 'di cp',
    'di central': 'di cp', 'de central': 'di cp',
  };
  
  // Apply koreksi (case insensitive, word boundary)
  Object.keys(KOREKSI).forEach(salah => {
    const escaped = salah.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp('\\b' + escaped + '\\b', 'gi');
    corrected = corrected.replace(regex, KOREKSI[salah]);
  });
  
  // Format kode barang: "NK 8 WD" → "NK 8 WD" (biarkan spasi untuk search)
  corrected = corrected.replace(/([a-z])(\d+)([a-z])/gi, '$1 $2 $3');
  corrected = corrected.replace(/([a-z])(\d+)/gi, '$1 $2');
  corrected = corrected.replace(/(\d+)([a-z])/gi, '$1 $2');
  
  // Cleanup double space
  corrected = corrected.replace(/\s+/g, ' ').trim();
  
  // Fix "d cp" atau "de cp"
  corrected = corrected.replace(/\bd\s+cp\b/gi, 'di cp');
  corrected = corrected.replace(/\bde\s+cp\b/gi, 'di cp');
  
  return corrected.toLowerCase();
}

// ════════════════════════════════════════════════════════════════
//   13. EXCEL ENGINE (Multi-File Per Toko + Auto-Detect Header)
// ════════════════════════════════════════════════════════════════

let DATA_BARANG = [];

/**
 * Load Excel per toko dengan format:
 * - Header auto-detect (bisa di baris berapapun)
 * - Kolom fleksibel (support banyak variasi nama)
 * - Format angka Indonesia (25.000 → 25000)
 * 
 * Mapping kolom:
 * - Kode Item → kode barang
 * - Nama Item → nama barang
 * - Jenis → jenis material
 * - Stok → stok fisik
 * - Satuan → satuan (PCS, PACK, DZ, dll)
 * - Harga Price → HARGA ECER (retail 1-5 pcs)
 * - Harga Jual → HARGA AMBIL/GROSIR (6+ pcs)
 * - HPP (optional) → Harga Pokok/Modal
 */
function loadExcelPerToko(tokoKode) {
  const filePath = CONFIG.paths.excelPerToko[tokoKode];
  if (!filePath || !fs.existsSync(filePath)) {
    log.warn('EXCEL', `File ${tokoKode}: tidak ditemukan (${filePath})`);
    return [];
  }
  
  try {
    const wb = xlsx.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const allRows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: 0, blankrows: false });
    
    if (allRows.length < 3) {
      log.warn('EXCEL', `File ${tokoKode}: kurang data (< 3 baris)`);
      return [];
    }
    
    // ═══ AUTO-DETECT HEADER ═══
    // Header biasanya di baris 1-15 (karena ada logo/info toko di atas)
    let headerRowIdx = -1;
    let headers = [];
    
    for (let i = 0; i < Math.min(15, allRows.length); i++) {
      const row = allRows[i];
      if (!row) continue;
      
      const rowStr = row.map(c => String(c || '').toLowerCase()).join('|');
      
      // Header terdeteksi kalau mengandung "kode" dan "nama"
      if ((rowStr.includes('kode item') || rowStr.includes('kode')) && 
          (rowStr.includes('nama item') || rowStr.includes('nama'))) {
        headerRowIdx = i;
        headers = row.map(h => String(h || '').trim());
        break;
      }
    }
    
    if (headerRowIdx === -1) {
      log.error('EXCEL', `File ${tokoKode}: Header tidak ditemukan (cari "Kode Item" dan "Nama Item")`);
      return [];
    }
    
    log.info('EXCEL', `File ${tokoKode}: Header di baris ${headerRowIdx + 1}`);
    
    // ═══ FLEXIBLE COLUMN MATCHING ═══
    const findCol = (...names) => {
      // Exact match dulu
      for (const name of names) {
        const idx = headers.findIndex(h => 
          h.toLowerCase().replace(/\s+/g, ' ').trim() === name.toLowerCase()
        );
        if (idx !== -1) return idx;
      }
      // Partial match sebagai fallback
      for (const name of names) {
        const idx = headers.findIndex(h => 
          h.toLowerCase().includes(name.toLowerCase())
        );
        if (idx !== -1) return idx;
      }
      return -1;
    };
    
    const colMap = {
      no: findCol('No', 'no.', 'nomor'),
      kode: findCol('Kode Item', 'Kode', 'Code'),
      nama: findCol('Nama Item', 'Nama', 'Name', 'Item'),
      jenis: findCol('Jenis', 'Type', 'Category'),
      stok: findCol('Stok', 'Stock', 'Qty Stok'),
      satuan: findCol('Satuan', 'Unit', 'Sat'),
      qtyPaket: findCol('Qty / Paket', 'Qty/Paket', 'Paket'),
      // ★ Harga Price = ECER (retail 1-5 pcs) - harga lebih mahal
      hargaEcer: findCol('Harga Price', 'Price', 'Ecer', 'Retail', 'Harga Ecer'),
      // ★ Harga Jual = AMBIL/GROSIR (6+ pcs) - harga lebih murah
      hargaAmbil: findCol('Harga Jual', 'Jual', 'Ambil', 'Grosir', 'Wholesale'),
      // ★ HPP = Harga Pokok/Modal (opsional)
      hargaHPP: findCol('HPP', 'Harga Beli', 'Harga Pokok', 'Harga Modal', 'Modal'),
      merek: findCol('Merek', 'Merk', 'Brand'),
    };
    
    // Validasi kolom wajib
    if (colMap.kode === -1 || colMap.nama === -1) {
      log.error('EXCEL', `File ${tokoKode}: Kolom "Kode Item" atau "Nama Item" tidak ada`);
      log.error('EXCEL', `Headers ditemukan: ${headers.join(', ')}`);
      return [];
    }
    
    log.info('EXCEL', `${tokoKode} mapping: kode=${colMap.kode}, nama=${colMap.nama}, stok=${colMap.stok}, satuan=${colMap.satuan}, ecer=${colMap.hargaEcer}, ambil=${colMap.hargaAmbil}, hpp=${colMap.hargaHPP}`);
    
    // ═══ PARSER ANGKA FORMAT INDONESIA ═══
    const parseNum = (val) => {
      if (!val && val !== 0) return 0;
      if (typeof val === 'number') return Math.floor(val);
      
      let str = String(val).trim();
      // Hapus "Rp", spasi, dll
      str = str.replace(/[^0-9,.-]/g, '');
      if (!str) return 0;
      
      // Handle format Indonesia:
      // "25.000" → 25000 (titik = ribuan)
      // "25,000" → 25000 (koma = ribuan)
      // Hapus semua titik & koma (asumsi = pemisah ribuan)
      const cleaned = str.replace(/[.,]/g, '');
      return parseInt(cleaned) || 0;
    };
    
    // ═══ PARSE DATA (baris setelah header) ═══
    const items = [];
    for (let i = headerRowIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row || row.length === 0) continue;
      
      const kode = String(row[colMap.kode] || '').trim().toUpperCase();
      if (!kode || kode === '0' || kode === 'NO' || kode === 'KODE') continue;
      
      const nama = String(row[colMap.nama] || '').trim().toUpperCase();
      if (!nama || nama.length < 2) continue;
      
      // ★ Harga Price = ECER (mahal, untuk 1-5 pcs)
      // ★ Harga Jual = AMBIL/GROSIR (murah, untuk 6+ pcs)
      const hargaEcer = colMap.hargaEcer >= 0 ? parseNum(row[colMap.hargaEcer]) : 0;
      const hargaAmbil = colMap.hargaAmbil >= 0 ? parseNum(row[colMap.hargaAmbil]) : 0;
      const hargaHPP = colMap.hargaHPP >= 0 ? parseNum(row[colMap.hargaHPP]) : 0;
      
      items.push({
        kode,
        nama,
        jenis: colMap.jenis >= 0 ? String(row[colMap.jenis] || '').trim() : '',
        merek: colMap.merek >= 0 ? String(row[colMap.merek] || '').trim() : '',
        satuan: colMap.satuan >= 0 ? String(row[colMap.satuan] || 'PCS').trim().toUpperCase() : 'PCS',
        toko: tokoKode,
        hpp: hargaHPP,
        ecer: hargaEcer,                                    // ← Harga Price (retail)
        ambil: hargaAmbil > 0 ? hargaAmbil : hargaEcer,    // ← Harga Jual (grosir), fallback ke ecer
        stok: colMap.stok >= 0 ? parseNum(row[colMap.stok]) : 0,
      });
    }
    
    log.info('EXCEL', `File ${tokoKode}: ${items.length} item loaded`);
    return items;
  } catch(e) {
    log.error('EXCEL', `File ${tokoKode} gagal load: ${e.message}`);
    return [];
  }
}

/**
 * Load semua toko dan gabung jadi 1 array.
 * Barang dengan kode SAMA di multi-toko akan di-merge menjadi 1 entry
 * dengan harga per toko masing-masing.
 */
function loadExcel() {
  const perTokoItems = {};
  const totalPerToko = {};
  
  // Load setiap toko
  Object.keys(CONFIG.paths.excelPerToko).forEach(tokoKode => {
    const items = loadExcelPerToko(tokoKode);
    perTokoItems[tokoKode] = items;
    totalPerToko[tokoKode] = items.length;
  });
  
  // Merge: barang dengan kode SAMA di multi-toko → 1 entry
  const mergedMap = new Map();
  
  Object.entries(perTokoItems).forEach(([tokoKode, items]) => {
    items.forEach(item => {
      const key = item.kode;
      
      if (!mergedMap.has(key)) {
        // Barang baru
        mergedMap.set(key, {
          kode: item.kode,
          nama: item.nama,
          jenis: item.jenis,
          merek: item.merek,
          satuan: item.satuan,
          satuanPerToko: { [tokoKode]: item.satuan },
          namaPerToko: { [tokoKode]: item.nama },
          harga: {
            nk: { ecer: 0, ambil: 0, stok: 0, hpp: 0 },
            tdm: { ecer: 0, ambil: 0, stok: 0, hpp: 0 },
            oesapa: { ecer: 0, ambil: 0, stok: 0, hpp: 0 },
            kefa: { ecer: 0, ambil: 0, stok: 0, hpp: 0 },
            cp: { ecer: 0, ambil: 0, stok: 0, hpp: 0 },
          },
        });
      }
      
      const existing = mergedMap.get(key);
      // Set harga & stok untuk toko ini
      existing.harga[tokoKode] = {
        ecer: item.ecer,
        ambil: item.ambil,
        stok: item.stok,
        hpp: item.hpp || 0,
      };
      // Simpan satuan & nama spesifik per toko
      existing.satuanPerToko[tokoKode] = item.satuan;
      existing.namaPerToko[tokoKode] = item.nama;
    });
  });
  
  DATA_BARANG = Array.from(mergedMap.values());
  
  // Reset cache Homebase DB index kalau ada
  if (typeof resetDBIndex === 'function') {
    try { resetDBIndex(); } catch(e) {}
  }
  
  // Log ringkasan
  console.log('═'.repeat(60));
  console.log(`📦 EXCEL LOADED (per toko):`);
  Object.entries(totalPerToko).forEach(([tk, count]) => {
    const status = count > 0 ? '✅' : '⚠️';
    console.log(`   ${status} ${NAMA_TOKO[tk] || tk}: ${count} item`);
  });
  console.log(`📦 TOTAL UNIQUE BARANG: ${DATA_BARANG.length}`);
  console.log('═'.repeat(60));
  
  return DATA_BARANG.length > 0;
}

// Load saat startup
loadExcel();

// ════════════════════════════════════════════════════════════════
//   14. SEARCH ENGINE
// ════════════════════════════════════════════════════════════════

function levenshtein(a, b) {
  if (a.length > 50) a = a.substring(0, 50);
  if (b.length > 50) b = b.substring(0, 50);
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const matrix = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++)
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] = b[i-1] === a[j-1]
        ? matrix[i-1][j-1]
        : Math.min(matrix[i-1][j-1]+1, matrix[i][j-1]+1, matrix[i-1][j]+1);
    }
  return matrix[b.length][a.length];
}

function bersihkanTeks(str) {
  return String(str).toUpperCase().replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function kataMirip(kata, target) {
  if (kata === target) return true;
  if (kata.length <= 2 || target.length <= 2) return kata === target;
  if (target.includes(kata) || kata.includes(target)) return true;
  const maxJ = kata.length <= 4 ? 1 : 2;
  return levenshtein(kata, target) <= maxJ;
}

function bersihkanKeywordDariToko(pesan) {
  if (!pesan) return '';
  let cleaned = pesan;
  const pattern = /\s+di\s+([a-z\s]+?)\s*$/i;
  const match = cleaned.match(pattern);
  if (match) {
    const calon = match[1].toLowerCase().trim();
    let isToko = false;
    for (const t of TOKO_LIST) {
      if (t.kode === calon || t.alias.includes(calon) || calon === t.nama.toLowerCase()) {
        isToko = true; break;
      }
    }
    if (isToko) cleaned = cleaned.replace(pattern, '').trim();
  }
  cleaned = cleaned.replace(/\b(untuk|cek|cari|harga|stok|bandingkan|tolong|saya|mau|ada|gak)\b/gi, ' ');
  return cleaned.trim().replace(/\s+/g, ' ');
}

function cariBarang(keyword) {
  if (!keyword || typeof keyword !== 'string') return { hasil: [], saran: [], tipeHasil: 'kosong' };
  
  const qOri = keyword.trim().toUpperCase();
  const qBersih = qOri.replace(/[^A-Z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = qBersih.split(/\s+/).filter(w => w.length > 0);
  
  if (!words.length) return { hasil: [], saran: [], tipeHasil: 'kosong' };
  
  const byKode = DATA_BARANG.filter(d => d.kode === qOri);
  if (byKode.length > 0) return { hasil: byKode, saran: [], tipeHasil: 'exact', totalDitemukan: byKode.length };
  
  const fullMatch = DATA_BARANG.filter(item => {
    const fullText = `${item.nama} ${item.kode} ${item.merek} ${item.jenis || ''}`.toUpperCase();
    return words.every(w => {
      if (w.length <= 2) {
        return new RegExp(`(^|\\s)${w}(\\s|$)`, 'i').test(fullText);
      }
      return fullText.includes(w);
    });
  });
  
  if (fullMatch.length > 0) {
    fullMatch.sort((a, b) => {
      const aWords = a.nama.split(/\s+/).length;
      const bWords = b.nama.split(/\s+/).length;
      if (Math.abs(aWords - bWords) > 2) return aWords - bWords;
      return a.nama.localeCompare(b.nama);
    });
    return { hasil: fullMatch.slice(0, CONFIG.maxHasilCari), saran: [], tipeHasil: 'exact', totalDitemukan: fullMatch.length };
  }
  
  const minMatch = Math.max(1, Math.floor(words.length * 0.7));
  const scored = [];
  DATA_BARANG.forEach(item => {
    const nama = item.nama.toUpperCase();
    const kode = item.kode.toUpperCase();
    const merek = (item.merek || '').toUpperCase();
    const fullText = `${nama} ${kode} ${merek}`;
    
    let score = 0, matchCount = 0;
    words.forEach(w => {
      let matched = false;
      if (w.length <= 2) {
        if (new RegExp(`(^|\\s)${w}(\\s|$)`, 'i').test(fullText)) { score += 10; matched = true; }
      } else {
        if (nama.includes(w)) { score += 15; matched = true; if (nama.startsWith(w)) score += 5; }
        else if (kode.includes(w)) { score += 20; matched = true; }
        else if (merek.includes(w)) { score += 8; matched = true; }
        else {
          const namaWords = nama.split(/\s+/);
          for (const nw of namaWords) {
            if (kataMirip(w, nw)) { score += 3; matched = true; break; }
          }
        }
      }
      if (matched) matchCount++;
    });
    if (matchCount >= minMatch) {
      if (matchCount === words.length) score += 50;
      scored.push({ item, score, matchCount });
    }
  });
  
  if (scored.length > 0) {
    scored.sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      return b.score - a.score;
    });
    return {
      hasil: scored.slice(0, CONFIG.maxHasilCari).map(s => s.item),
      saran: [],
      tipeHasil: scored[0].matchCount === words.length ? 'exact' : 'fuzzy',
      totalDitemukan: scored.length,
    };
  }
  
  const saranScored = [];
  DATA_BARANG.forEach(item => {
    const fullText = `${item.nama} ${item.kode} ${item.merek || ''}`.toUpperCase();
    let matchCount = 0;
    words.forEach(w => { if (w.length >= 2 && fullText.includes(w)) matchCount++; });
    if (matchCount > 0) saranScored.push({ item, matchCount });
  });
  
  if (saranScored.length > 0) {
    saranScored.sort((a, b) => b.matchCount - a.matchCount);
    return { hasil: [], saran: saranScored.slice(0, 5).map(s => s.item), tipeHasil: 'saran' };
  }
  
  return { hasil: [], saran: [], tipeHasil: 'kosong' };
}

function cariBarangPrioritas(kw) {
  const q = kw.trim().toUpperCase();
  const byKode = DATA_BARANG.filter(d => d.kode === q);
  if (byKode.length) return { hasil: byKode, exact: true };
  const byNama = DATA_BARANG.filter(d => d.nama === q || d.nama.includes(q));
  if (byNama.length) return { hasil: byNama, exact: true };
  const words = q.split(/\s+/);
  const semuaKata = DATA_BARANG.filter(d =>
    words.every(w => d.nama.includes(w) || d.kode.includes(w))
  );
  if (semuaKata.length) return { hasil: semuaKata, exact: false };
  return { hasil: cariBarang(kw).hasil || [], exact: false };
}

function deteksiTokoDariTeks(low) {
  if (!low || typeof low !== 'string') return [];
  const found = [], ada = {};
  const pattern = /\s+di\s+([a-z\s]+?)\s*$/i;
  const match = low.trim().match(pattern);
  if (!match) return [];
  const calon = match[1].toLowerCase().trim();
  for (const t of TOKO_LIST) {
    let cocok = false;
    if (t.kode === calon) cocok = true;
    if (!cocok && t.alias.includes(calon)) cocok = true;
    if (!cocok && calon === t.nama.toLowerCase()) cocok = true;
    if (!cocok) {
      for (const alias of t.alias) {
        if (calon === alias || calon.startsWith(alias + ' ') || calon.endsWith(' ' + alias)) {
          cocok = true; break;
        }
      }
    }
    if (cocok && !ada[t.kode]) { found.push(t); ada[t.kode] = true; }
  }
  return found;
}

function detectTipeHarga(query) {
  const low = query.toLowerCase();
  if (/\b(grosir|ambil|borongan|partai)\b/i.test(low) || /\bharga\s*[6-9]\b/i.test(low) || /\bharga\s*\d{2,}\b/i.test(low)) return 'grosir';
  if (/\b(ecer|eceran|satuan|retail)\b/i.test(low) || /\bharga\s*[1-5]\b/i.test(low)) return 'ecer';
  return 'semua';
}

function isPertanyaanBarang(low) {
  const cleaned = low.trim();
  if (cleaned.length < 2) return false;
  if (/^[0-9]$/.test(cleaned)) return false;
  
  const KATA_TANYA = ['stok','stock','harga','price','berapa','cek','lihat','tampilkan','cari','mencari','mau','butuh','info','beli'];
  const KATA_BARANG = ['panci','dandang','wajan','rice cooker','kompor','gelas','piring','setrika','kipas','eagle','cosmos','niko','magic','dispenser'];
  
  const adaTanya = KATA_TANYA.some(k => low.includes(k));
  const adaBarang = KATA_BARANG.some(k => low.includes(k));
  const adaKode = /\b[a-z]{2,5}\d{2,5}\b/i.test(low);
  const adaPola = /\b[a-z]{2,5}\s*\d{1,3}\b/i.test(low);
  
  return adaKode || adaPola || (adaTanya && adaBarang) || (adaBarang && cleaned.split(/\s+/).length >= 2);
}

function isPertanyaanBanding(low) {
  return ['banding','bandingkan','compare','termurah','termahal','paling murah','paling mahal','selisih'].some(k => low.includes(k));
}

console.log(`📦 Data Barang: ${DATA_BARANG.length}`);

// ════════════════════════════════════════════════════════════════
//   15. PARSER
// ════════════════════════════════════════════════════════════════

function ambilAngka(str) {
  const angka = String(str || '').replace(/[^0-9]/g, '');
  return angka ? (parseInt(angka, 10) || 0) : 0;
}

function parseScanSingle(aiText) {
  if (!aiText) return 0;
  return ambilAngka(aiText);
}

const SCAN_ALIASES = {
  total: ['total','total transaksi','total keseluruhan'],
  tunai: ['tunai','cash'],
  debit: ['debit','k.debit'],
  kredit: ['kredit','credit','k.kredit'],
  ecer: ['ecer'], grosir: ['grosir'],
  promo: ['promo','total promo'],
  promotunai: ['promotunai','promo tunai'],
  promodebit: ['promodebit','promo debit'],
  promokredit: ['promokredit','promo kredit'],
  parkirkomputer: ['parkirkomputer','parkir komputer'],
  parkirluar: ['parkirluar','parkir luar'],
};

function parseScanFlexible(aiText, fields) {
  const hasil = {};
  fields.forEach(f => { hasil[f] = 0; });
  if (!aiText) return hasil;
  
  const lines = String(aiText).split('\n').map(x => x.trim()).filter(Boolean);
  lines.forEach(line => {
    const lower = line.toLowerCase();
    fields.forEach(field => {
      const aliases = SCAN_ALIASES[field] || [field];
      for (const alias of aliases) {
        if (lower.startsWith(alias + ':') || lower.includes(alias + ': ')) {
          hasil[field] = ambilAngka(line);
          break;
        }
      }
    });
  });
  return hasil;
}

function parseListBarang(aiText) {
  if (!aiText) return [];
  const hasil = [];
  aiText.split('\n').forEach(line => {
    const tr = line.trim();
    const lo = tr.toLowerCase();
    if (lo === '(kosong)' || lo === 'kosong') return;
    if (lo.startsWith('baru:') || lo.startsWith('naik:') || lo.startsWith('turun:')) return;
    if (tr.startsWith('-') || tr.startsWith('*')) {
      const item = tr.replace(/^[-*•]\s*/, '').trim();
      if (item && item.length > 2 && !hasil.includes(item) && !lo.includes('dst') && !lo.includes('dan lain')) {
        hasil.push(item);
      }
    }
  });
  return hasil;
}

function parseBAJsonScan(aiText) {
  if (!aiText) return [];
  try {
    let cleaned = aiText.trim().replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(i => i && i.nama && i.qty).map(i => ({
      kode: (i.kode || '').toString().trim(),
      nama: (i.nama || '').toString().trim().toUpperCase(),
      qty: (i.qty || '').toString().trim(),
      satuan: (i.satuan || 'PCS').toString().trim().toUpperCase(),
    }));
  } catch(err) { return []; }
}

function toTitleCase(str) {
  if (!str) return '';
  return String(str).toLowerCase().split(/\s+/).map(w =>
    w ? w.charAt(0).toUpperCase() + w.slice(1) : ''
  ).join(' ');
}
// ════════════════════════════════════════════════════════════════
//   15B. SCAN QR CODE + BARCODE RAK (MULTI-API + LIBRARY FALLBACK)
// ════════════════════════════════════════════════════════════════

const jsQR = require('jsqr');
const Jimp = require('jimp');
const QrCode = require('qrcode-reader');

// ─────────────────────────────────────────────────────────────
// API 1: qrserver.com (PALING RELIABLE - upload form)
// ─────────────────────────────────────────────────────────────
async function decodeQR_API_QRServer(imageBuffer) {
  try {
    const form = new FormData();
    form.append('file', imageBuffer, { 
      filename: 'qr.jpg', 
      contentType: 'image/jpeg' 
    });
    
    const response = await axios.post(
      'https://api.qrserver.com/v1/read-qr-code/',
      form,
      {
        headers: form.getHeaders(),
        timeout: 20000,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      }
    );
    
    const data = response.data;
    if (Array.isArray(data) && data[0]?.symbol?.[0]?.data) {
      const result = data[0].symbol[0].data;
      if (result && result !== 'null' && result.trim().length > 0) {
        log.info('QR', `✅ qrserver.com: ${result.substring(0, 60)}`);
        return result.trim();
      }
    }
    return null;
  } catch(err) {
    log.warn('QR-API1', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// API 2: ZXing.org (alternatif - parsing HTML response)
// ─────────────────────────────────────────────────────────────
async function decodeQR_API_ZXing(imageBuffer) {
  try {
    const form = new FormData();
    form.append('f', imageBuffer, { 
      filename: 'qr.png', 
      contentType: 'image/png' 
    });
    
    const response = await axios.post(
      'https://zxing.org/w/decode',
      form,
      {
        headers: form.getHeaders(),
        timeout: 15000,
        maxRedirects: 5,
      }
    );
    
    const html = response.data;
    if (typeof html === 'string') {
      // Pattern 1: Raw text in pre tag
      let match = html.match(/<td>Raw text<\/td>\s*<td[^>]*>\s*<pre[^>]*>([^<]+)<\/pre>/i);
      if (match && match[1]) {
        const result = match[1].trim();
        log.info('QR', `✅ zxing.org: ${result.substring(0, 60)}`);
        return result;
      }
      // Pattern 2: Parsed Result
      match = html.match(/<td>Parsed Result<\/td>\s*<td[^>]*>\s*<pre[^>]*>([^<]+)<\/pre>/i);
      if (match && match[1]) {
        const result = match[1].trim();
        log.info('QR', `✅ zxing.org (parsed): ${result.substring(0, 60)}`);
        return result;
      }
    }
    return null;
  } catch(err) {
    log.warn('QR-API2', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// LIBRARY 1: jsQR dengan MULTI-PREPROCESSING STRATEGY
// ─────────────────────────────────────────────────────────────
async function decodeQR_Library_JsQR(imageBuffer) {
  try {
    const originalImage = await Jimp.read(imageBuffer);
    
    log.info('QR', `Image size: ${originalImage.bitmap.width}x${originalImage.bitmap.height}`);
    
    // Helper: try decode dari Jimp image
    const tryDecode = (img, label) => {
      try {
        const { width, height, data } = img.bitmap;
        const uint8 = new Uint8ClampedArray(data.buffer);
        const code = jsQR(uint8, width, height, { inversionAttempts: 'attemptBoth' });
        if (code && code.data) {
          log.info('QR', `✅ jsQR [${label}]: ${code.data.substring(0, 60)}`);
          return code.data.trim();
        }
      } catch(e) {}
      return null;
    };
    
    // ═══ Strategy 1: Original ═══
    let result = tryDecode(originalImage.clone(), 'orig');
    if (result) return result;
    
    // ═══ Strategy 2: Multiple sizes ═══
    for (const size of [800, 1000, 600, 1200, 400, 1500]) {
      const img = originalImage.clone().resize(size, Jimp.AUTO);
      result = tryDecode(img, `r${size}`);
      if (result) return result;
    }
    
    // ═══ Strategy 3: Greyscale + contrast variations ═══
    for (const c of [0.3, 0.5, 0.7, 1.0]) {
      const img = originalImage.clone().greyscale().contrast(c);
      result = tryDecode(img, `gc${c}`);
      if (result) return result;
    }
    
    // ═══ Strategy 4: Normalize + Greyscale + Contrast ═══
    try {
      const img = originalImage.clone().greyscale().normalize().contrast(0.6);
      result = tryDecode(img, 'norm-gc');
      if (result) return result;
    } catch(e) {}
    
    // ═══ Strategy 5: Crop center + variations ═══
    const w = originalImage.bitmap.width;
    const h = originalImage.bitmap.height;
    for (const ratio of [0.5, 0.6, 0.7, 0.8]) {
      try {
        const cw = Math.floor(w * ratio);
        const ch = Math.floor(h * ratio);
        const cx = Math.floor((w - cw) / 2);
        const cy = Math.floor((h - ch) / 2);
        const cropped = originalImage.clone().crop(cx, cy, cw, ch);
        
        result = tryDecode(cropped.clone(), `crop${ratio}`);
        if (result) return result;
        
        result = tryDecode(cropped.clone().resize(800, Jimp.AUTO), `crop${ratio}-800`);
        if (result) return result;
        
        result = tryDecode(cropped.clone().greyscale().contrast(0.5), `crop${ratio}-gc`);
        if (result) return result;
        
        result = tryDecode(cropped.clone().greyscale().normalize().contrast(0.7), `crop${ratio}-ngc`);
        if (result) return result;
      } catch(e) {}
    }
    
    // ═══ Strategy 6: Crop top half (QR sering di atas) ═══
    try {
      const img = originalImage.clone().crop(0, 0, w, Math.floor(h * 0.7));
      result = tryDecode(img, 'crop-top');
      if (result) return result;
      
      result = tryDecode(img.clone().greyscale().contrast(0.5), 'crop-top-gc');
      if (result) return result;
    } catch(e) {}
    
    // ═══ Strategy 7: Binary threshold ═══
    try {
      const img = originalImage.clone().greyscale();
      img.scan(0, 0, img.bitmap.width, img.bitmap.height, function(x, y, idx) {
        const avg = (this.bitmap.data[idx] + this.bitmap.data[idx + 1] + this.bitmap.data[idx + 2]) / 3;
        const val = avg < 128 ? 0 : 255;
        this.bitmap.data[idx] = val;
        this.bitmap.data[idx + 1] = val;
        this.bitmap.data[idx + 2] = val;
      });
      result = tryDecode(img, 'binary');
      if (result) return result;
    } catch(e) {}
    
    // ═══ Strategy 8: Adaptive threshold (per-pixel) ═══
    try {
      const img = originalImage.clone().greyscale();
      const data = img.bitmap.data;
      const width = img.bitmap.width;
      const height = img.bitmap.height;
      
      // Calculate average brightness
      let sum = 0;
      let count = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += data[i];
        count++;
      }
      const avg = sum / count;
      const threshold = avg * 0.9; // slightly below average
      
      img.scan(0, 0, width, height, function(x, y, idx) {
        const v = this.bitmap.data[idx] < threshold ? 0 : 255;
        this.bitmap.data[idx] = v;
        this.bitmap.data[idx + 1] = v;
        this.bitmap.data[idx + 2] = v;
      });
      result = tryDecode(img, 'adaptive-thresh');
      if (result) return result;
    } catch(e) {}
    
    // ═══ Strategy 9: Rotation ═══
    for (const angle of [90, 180, 270, 45, -45, 15, -15, 30, -30]) {
      try {
        const img = originalImage.clone().rotate(angle);
        result = tryDecode(img, `rot${angle}`);
        if (result) return result;
      } catch(e) {}
    }
    
    // ═══ Strategy 10: Brightness + Contrast variations ═══
    for (const b of [-0.4, -0.2, 0.2, 0.4]) {
      try {
        const img = originalImage.clone().brightness(b).contrast(0.5);
        result = tryDecode(img, `b${b}`);
        if (result) return result;
      } catch(e) {}
    }
    
    // ═══ Strategy 11: Combined aggressive ═══
    try {
      const cw = Math.floor(w * 0.7);
      const ch = Math.floor(h * 0.7);
      const cx = Math.floor((w - cw) / 2);
      const cy = Math.floor((h - ch) / 2);
      
      const img = originalImage.clone()
        .crop(cx, cy, cw, ch)
        .resize(800, Jimp.AUTO)
        .greyscale()
        .normalize()
        .contrast(0.7);
      
      result = tryDecode(img, 'combined-aggressive');
      if (result) return result;
    } catch(e) {}
    
    return null;
  } catch(err) {
    log.error('QR-LIB1', err.message);
    return null;
  }
}

// ─────────────────────────────────────────────────────────────
// LIBRARY 2: qrcode-reader (fallback)
// ─────────────────────────────────────────────────────────────
async function decodeQR_Library_QRCodeReader(imageBuffer) {
  try {
    const image = await Jimp.read(imageBuffer);
    
    return new Promise((resolve) => {
      const qr = new QrCode();
      qr.callback = function(err, value) {
        if (err) { resolve(null); return; }
        if (value && value.result) {
          log.info('QR', `✅ qrcode-reader: ${value.result.substring(0, 60)}`);
          resolve(value.result.trim());
        } else {
          resolve(null);
        }
      };
      qr.decode(image.bitmap);
    });
  } catch(err) {
    log.warn('QR-LIB2', err.message);
    return null;
  }
}

/**
 * ════════════════════════════════════════════════════════════
 * MAIN DECODER: Coba semua strategi dengan urutan prioritas
 * ════════════════════════════════════════════════════════════
 */
async function decodeQRFromBuffer(imageBuffer) {
  if (!Buffer.isBuffer(imageBuffer) || imageBuffer.length < 100) {
    return null;
  }
  
  log.info('QR', `📸 Mulai decode, image: ${(imageBuffer.length / 1024).toFixed(1)} KB`);
  
  // ═══ STRATEGY 1: API qrserver.com ═══
  log.info('QR', 'Try API #1: qrserver.com...');
  let result = await decodeQR_API_QRServer(imageBuffer);
  if (result) return result;
  
  // ═══ STRATEGY 2: API ZXing.org ═══
  log.info('QR', 'Try API #2: zxing.org...');
  result = await decodeQR_API_ZXing(imageBuffer);
  if (result) return result;
  
  // ═══ STRATEGY 3: Library jsQR (multi preprocessing) ═══
  log.info('QR', 'Try Library #1: jsQR (multi-strategy)...');
  result = await decodeQR_Library_JsQR(imageBuffer);
  if (result) return result;
  
  // ═══ STRATEGY 4: Library qrcode-reader ═══
  log.info('QR', 'Try Library #2: qrcode-reader...');
  result = await decodeQR_Library_QRCodeReader(imageBuffer);
  if (result) return result;
  
  log.warn('QR', '❌ Semua strategi gagal');
  return null;
}

/**
 * ════════════════════════════════════════════════════════════
 * BERSIHKAN HASIL QR JADI NAMA RAK YANG VALID
 * ════════════════════════════════════════════════════════════
 */
function bersihkanHasilQR(qrText) {
  if (!qrText) return null;
  
  let cleaned = qrText.trim();
  
  // Jika QR berisi URL, ambil parameter atau path terakhir
  if (cleaned.startsWith('http://') || cleaned.startsWith('https://')) {
    try {
      const url = new URL(cleaned);
      const paramRak = url.searchParams.get('rak') || 
                       url.searchParams.get('nama') || 
                       url.searchParams.get('name') ||
                       url.searchParams.get('id');
      if (paramRak) {
        cleaned = paramRak;
      } else {
        const pathParts = url.pathname.split('/').filter(p => p);
        if (pathParts.length > 0) {
          cleaned = decodeURIComponent(pathParts[pathParts.length - 1]);
        }
      }
    } catch(e) {}
  }
  
  // Decode URL encoding
  try {
    cleaned = decodeURIComponent(cleaned);
  } catch(e) {}
  
  // Hapus karakter aneh, biarkan huruf, angka, spasi, dash
  cleaned = cleaned.replace(/[^\w\s\-]/g, ' ').replace(/\s+/g, ' ').trim();
  
  // Batas maksimal 50 karakter
  if (cleaned.length > 50) cleaned = cleaned.substring(0, 50);
  
  // Kalau hasilnya cuma kode pendek (A1, A-2), tambahkan "Rak"
  if (/^[a-z0-9\-]{1,6}$/i.test(cleaned)) {
    if (!cleaned.toLowerCase().startsWith('rak')) {
      cleaned = 'Rak ' + cleaned.toUpperCase();
    }
  }
  
  return cleaned.length >= 2 ? cleaned : null;
}

/**
 * ════════════════════════════════════════════════════════════
 * AI VISION PROMPT untuk fallback baca tulisan rak
 * ════════════════════════════════════════════════════════════
 */
const SCAN_PROMPT_RAK = `Tugas: Ekstrak NAMA RAK dari gambar.

KONTEKS: Gambar bisa berupa:
1. Label/tulisan rak (contoh: "RAK A1", "Rak Kaca Lantai 1")
2. QR code dengan tulisan di sekitarnya (baca tulisan, BUKAN QR code)
3. Barcode dengan label nama rak

INSTRUKSI:
- Cari TULISAN nama rak yang TERLIHAT di gambar (di sekitar QR/barcode)
- Jika ada teks seperti "RAK-A2", "Rak A1", "B-3", ambil sebagai nama rak
- Format jawaban: "Rak [kode]" atau nama lengkap rak
- JANGAN coba decode QR code (kamu tidak bisa)
- HANYA fokus pada tulisan yang dapat dibaca mata

CONTOH JAWABAN BENAR:
- Rak A1
- RAK-A2  
- Rak Kaca Lantai 2
- Gudang Belakang

JIKA TIDAK ADA TULISAN NAMA RAK yang jelas, jawab: TIDAK_TERBACA

Jawab HANYA nama rak (1 baris saja):`;

function parseHasilScanRak(aiText) {
  if (!aiText) return null;
  
  let cleaned = aiText.trim();
  cleaned = cleaned.replace(/[*_`]/g, '').trim();
  
  if (cleaned.toLowerCase().includes('tidak_terbaca') || 
      cleaned.toLowerCase().includes('tidak terbaca') ||
      cleaned.toLowerCase().includes('tidak ada')) {
    return null;
  }
  
  cleaned = cleaned.split('\n')[0].trim();
  cleaned = cleaned.replace(/^(jawaban|nama rak|rak|hasil)[:\s]*/i, '').trim();
  
  if (cleaned.length > 0 && cleaned.length < 50) {
    const low = cleaned.toLowerCase();
    if (!low.startsWith('rak') && !low.startsWith('gudang') && !low.startsWith('lantai')) {
      if (/^[a-z0-9\-]{1,5}$/i.test(cleaned)) {
        cleaned = 'Rak ' + cleaned.toUpperCase();
      }
    }
    return cleaned;
  }
  
  return null;
}

/**
 * ════════════════════════════════════════════════════════════
 * CARI RAK EXISTING YANG MIRIP (toleran format)
 * ════════════════════════════════════════════════════════════
 */
function findRakMirip(tokoKode, namaRakScan) {
  const allRacks = Object.keys(getAllRacks(tokoKode));
  if (allRacks.length === 0) return null;
  
  const scanNormalized = namaRakScan.toLowerCase().replace(/[\s\-_]/g, '');
  
  for (const rak of allRacks) {
    const rakNormalized = rak.toLowerCase().replace(/[\s\-_]/g, '');
    if (rakNormalized === scanNormalized) return rak;
    if (rakNormalized.includes(scanNormalized) || scanNormalized.includes(rakNormalized)) {
      return rak;
    }
  }
  
  return null;
}

// ════════════════════════════════════════════════════════════════
//   16. GENERATOR LAPORAN PENJUALAN
// ════════════════════════════════════════════════════════════════

function genLapPenjualan(data, kemarin, tokoKode) {
  const t = getTanggal(kemarin);
  const d = Object.assign({
    k1:0,k2:0,k3:0,k4:0,total:0,tunai:0,debit:0,kredit:0,
    ecer:0,grosir:0,promo:0,promotunai:0,promodebit:0,promokredit:0,
    parkirkomputer:0,parkirluar:0,
    nk1:KASIR_CP_DEFAULT.k1, nk2:KASIR_CP_DEFAULT.k2,
    nk3:KASIR_CP_DEFAULT.k3, nk4:KASIR_CP_DEFAULT.k4,
  }, data);
  
  const kassaTotal = tokoKode === 'cp' ? (d.k1+d.k2+d.k3+d.k4) : (d.k1+d.k2);
  const totalUtama = d.total > 0 ? d.total : kassaTotal;
  const fr = formatRp;
  
  if (tokoKode === 'cp') {
    let msg = `Laporan Penjualan Toko Central Perabot Periode ${t}\n\n`;
    msg += `Kassa 1 (${d.nk1}) ${fr(d.k1)}\nKassa 2 (${d.nk2}) ${fr(d.k2)}\n`;
    msg += `Kassa 3 (${d.nk3}) ${fr(d.k3)}\nKassa 4 (${d.nk4}) ${fr(d.k4)}\n\n`;
    msg += `Total Penjualan Keseluruhan: ${fr(totalUtama)}\n${'─'.repeat(45)}\n\n`;
    msg += `Tunai  ${fr(d.tunai)}\nDebit  ${fr(d.debit)}\nCredit ${fr(d.kredit)}\n${'─'.repeat(45)}\n\n`;
    msg += `Ecer: ${fr(d.ecer)}\nGrosir : ${fr(d.grosir)}\n${'─'.repeat(45)}\n\n`;
    msg += `Laporan Penjualan Kasir Promo\nPeriode ${t}\n\n`;
    msg += `Total Penjualan Keseluruhan: ${fr(d.promo)}\n${'─'.repeat(45)}\n`;
    msg += `Tunai  ${fr(d.promotunai)}\nDebit  ${fr(d.promodebit)}\nCredit ${fr(d.promokredit)}\n${'─'.repeat(45)}\n\n`;
    msg += `Laporan Parkir\nPeriode ${t}\n\n`;
    msg += `Parkir di Komputer : ${fr(d.parkirkomputer)}\nParkir Stor Luar : ${fr(d.parkirluar)}\n${'─'.repeat(45)}\n`;
    msg += `Total Parkir  ${fr(d.parkirkomputer + d.parkirluar)}`;
    return msg;
  }
  
  if (tokoKode === 'nk') {
    let msg = `Laporan Penjualan\nToko Nasional Kitchen\nPeriode ${t}\n\n`;
    msg += `Kassa 1 ${fr(d.k1)}\nKassa 2 ${fr(d.k2)}\n\n`;
    msg += `Total Penjualan Keseluruhan\n${fr(totalUtama)}\n${'─'.repeat(45)}\n\n`;
    msg += `Tunai  ${fr(d.tunai)}\nDebit  ${fr(d.debit)}\nCredit ${fr(d.kredit)}\n${'─'.repeat(45)}\n`;
    msg += `Ecer : ${fr(d.ecer)}\nGrosir : ${fr(d.grosir)}`;
    return msg;
  }
  
  const namaMap = { tdm: 'Perabot Mama TDM', oesapa: 'Perabot Mama Oesapa', kefa: 'Perabot Mamaku Kefamenanu' };
  const namaToko = namaMap[tokoKode] || tokoKode;
  let msg = `Laporan Penjualan\nToko ${namaToko}\nPeriode ${t}\n\n`;
  msg += `Kassa 1 ${fr(d.k1)}\nKassa 2 ${fr(d.k2)}\n\n`;
  msg += `Total Penjualan Keseluruhan\n${fr(totalUtama)}\n${'─'.repeat(45)}\n\n`;
  msg += `Tunai  ${fr(d.tunai)}\nDebit  ${fr(d.debit)}\nCredit ${fr(d.kredit)}`;
  return msg;
}

// ════════════════════════════════════════════════════════════════
//   17. GENERATOR LAPORAN HARGA
// ════════════════════════════════════════════════════════════════

function genLapHargaDariData(dataHarga, namaToko, kemarin) {
  const tgl = getTanggalSlash(kemarin);
  const hari = kemarin ? 'Kemarin' : 'Ini';
  const waktu = getWaktuKapital();
  
  const cat = 'Nota Semuanya Sudah Diinput Di Sistem, Bisa Langsung Di Print Barcodenya Ya.\n\nMohon Dicek Kembali Fisik Barang Dengan Yang Di Input Disistem, Jika Ada Yang Tidak Sesuai Mohon Di Konfirmasi Lagi. Terima Kasih🙏🏻';
  
  const kategoriAda = [];
  if (dataHarga.baru?.length > 0) kategoriAda.push('Baru');
  if (dataHarga.naik?.length > 0) kategoriAda.push('Naik');
  if (dataHarga.turun?.length > 0) kategoriAda.push('Turun');
  
  let kalimatPembuka = '';
  if (kategoriAda.length === 0) {
    kalimatPembuka = `Harga Barang Untuk Hari ${hari} ${tgl} Tidak Ada Perubahan.`;
  } else if (kategoriAda.length === 1) {
    kalimatPembuka = `Harga Barang Untuk Hari ${hari} ${tgl} Ada Beberapa Barang Yang ${kategoriAda[0]} Harga.`;
  } else if (kategoriAda.length === 2) {
    kalimatPembuka = `Harga Barang Untuk Hari ${hari} ${tgl} Ada Beberapa Barang Yang ${kategoriAda[0]} Dan ${kategoriAda[1]} Harga.`;
  } else {
    kalimatPembuka = `Harga Barang Untuk Hari ${hari} ${tgl} Ada Beberapa Barang Yang Baru, Naik Dan Turun Harga.`;
  }
  
  let msg = `Selamat ${waktu} Team ${namaToko} \n\n${kalimatPembuka}\n`;
  
  if (dataHarga.baru?.length > 0) {
    msg += '\nBerikut Barang Yang Baru:\n';
    dataHarga.baru.forEach(b => msg += `- ${toTitleCase(b)}\n`);
  }
  if (dataHarga.naik?.length > 0) {
    msg += '\nBarang Yang Naik Harga:\n';
    dataHarga.naik.forEach(b => msg += `- ${toTitleCase(b)}\n`);
  }
  if (dataHarga.turun?.length > 0) {
    msg += '\nBarang Yang Turun Harga :\n';
    dataHarga.turun.forEach(b => msg += `- ${toTitleCase(b)}\n`);
  }
  
  msg += '\n' + cat;
  return msg;
}

// ════════════════════════════════════════════════════════════════
//   18. GENERATOR LAPORAN MARKETPLACE
// ════════════════════════════════════════════════════════════════

function genLapMarket(text, kemarin) {
  const t = getTanggal(kemarin);
  const d = { oesapa:0,tdm:0,central:0,wa:0,shopee:0,tiktok:0,tokopedia:0,tunai:0,debit:0,kredit:0,nota:[] };
  
  text.trim().toLowerCase().split('\n').forEach(line => {
    const tr = line.trim();
    if (!tr) return;
    if (tr.startsWith('nota ')) { d.nota.push(line.trim().substring(5)); return; }
    const p = tr.split(/\s+/);
    if (p.length >= 2 && p[0] in d) {
      d[p[0]] = parseFloat(p.slice(1).join('').replace(/[^0-9]/g, '')) || 0;
    }
  });
  
  const tT = d.oesapa + d.tdm + d.central;
  const tC = d.wa + d.shopee + d.tiktok + d.tokopedia;
  let nt = '';
  if (d.nota.length) { nt = '\n'; d.nota.forEach(n => nt += `- Nomor Nota ${n}\n`); }
  
  return `${GARIS_TEBAL}\n🛒 *Total Penjualan Marketplace*\n*Perabot Mama*\n📅 Periode ${t}\n${GARIS_TEBAL}\n` +
    `🏦 *Per Toko*\n• Oesapa: ${fRp(d.oesapa)}\n• TDM: ${fRp(d.tdm)}\n• Central: ${fRp(d.central)}\n` +
    `${GARIS_TIPIS}\n💰 *Total*: ${fRp(tT)}\n\n📱 *Per Channel*\n• WA: ${fRp(d.wa)}\n• Shopee: ${fRp(d.shopee)}\n` +
    `• Tiktok: ${fRp(d.tiktok)}\n• Tokopedia: ${fRp(d.tokopedia)}\n${GARIS_TIPIS}\n💰 *Total*: ${fRp(tC)}\n\n` +
    `💳 *Metode Bayar*\n• Tunai: ${fRp(d.tunai)}\n• Debit: ${fRp(d.debit)}\n• Credit: ${fRp(d.kredit)}\n` +
    `${GARIS_TEBAL}\n${nt}_Laporan otomatis_`;
}



// ════════════════════════════════════════════════════════════════
//   20. GENERATOR EXCEL BERITA ACARA (LENGKAP)
// ════════════════════════════════════════════════════════════════

async function generateExcelBA(baData, tokoKode, namaToko) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Berita Acara');
  
  const fillSection = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDEEBF7' } };
  const fillHeader = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFBDD7EE' } };
  const fontTitle = { bold: true, size: 14 };
  const fontSection = { bold: true, size: 11 };
  const fontHeader = { bold: true, size: 10 };
  const fontData = { size: 10 };
  const fontBold = { size: 10, bold: true };
  const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
  const alignCenter = { horizontal: 'center', vertical: 'middle', wrapText: true };
  const alignLeft = { horizontal: 'left', vertical: 'middle', wrapText: true };
  
  ws.getColumn(1).width = 5; ws.getColumn(2).width = 35;
  ws.getColumn(3).width = 15; ws.getColumn(4).width = 28;
  ws.getColumn(5).width = 12; ws.getColumn(6).width = 25;
  ws.getColumn(7).width = 22;
  
  let row = 1;
  
  ws.mergeCells(`A${row}:E${row}`);
  ws.getCell(`A${row}`).value = 'BERITA ACARA';
  ws.getCell(`A${row}`).font = fontTitle;
  ws.getCell(`A${row}`).alignment = alignCenter;
  ws.mergeCells(`F${row}:G${row}`);
  ws.getCell(`F${row}`).value = 'TTD';
  ws.getCell(`F${row}`).font = fontSection;
  ws.getCell(`F${row}`).alignment = alignCenter;
  ws.getCell(`F${row}`).border = border;
  ws.getRow(row).height = 25; row++;
  
  ws.mergeCells(`F${row}:G${row + 1}`);
  ws.getCell(`F${row}`).border = border;
  row += 2;
  
  ws.getCell(`A${row}`).value = `Tanggal : ${getTanggalIndonesia()}`;
  ws.getCell(`A${row}`).font = fontSection; row++;
  ws.getCell(`A${row}`).value = `Nama Toko : ${namaToko}`;
  ws.getCell(`A${row}`).font = fontSection; row++;
  ws.getCell(`A${row}`).value = `Nomor Berita Acara : ${baData.nomorBA}`;
  ws.getCell(`A${row}`).font = fontSection;
  row += 2;
  
  function addSection4Kolom(title, qtyLabel, items, minRows) {
    ws.mergeCells(`A${row}:G${row}`);
    const tCell = ws.getCell(`A${row}`);
    tCell.value = title; tCell.font = fontSection; tCell.fill = fillSection;
    tCell.alignment = alignLeft; tCell.border = border;
    ws.getRow(row).height = 22; row++;
    
    ['NO', 'NAMA BARANG', qtyLabel].forEach((val, i) => {
      const cell = ws.getCell(`${String.fromCharCode(65 + i)}${row}`);
      cell.value = val; cell.font = fontHeader; cell.fill = fillHeader;
      cell.alignment = alignCenter; cell.border = border;
    });
    ws.mergeCells(`D${row}:G${row}`);
    ws.getCell(`D${row}`).value = 'KET';
    ws.getCell(`D${row}`).font = fontHeader; ws.getCell(`D${row}`).fill = fillHeader;
    ws.getCell(`D${row}`).alignment = alignCenter; ws.getCell(`D${row}`).border = border;
    ws.getRow(row).height = 30; row++;
    
    const total = Math.max(items.length, minRows);
    for (let i = 0; i < total; i++) {
      const item = items[i];
      ws.getCell(`A${row}`).value = i + 1;
      ws.getCell(`A${row}`).font = fontData;
      ws.getCell(`A${row}`).alignment = alignCenter;
      ws.getCell(`A${row}`).border = border;
      if (item) {
        ws.getCell(`B${row}`).value = item.nama || '';
        ws.getCell(`B${row}`).font = fontData;
        ws.getCell(`B${row}`).alignment = alignLeft;
        ws.getCell(`C${row}`).value = item.qty || '';
        ws.getCell(`C${row}`).font = fontBold;
        ws.getCell(`C${row}`).alignment = alignCenter;
        ws.mergeCells(`D${row}:G${row}`);
        ws.getCell(`D${row}`).value = item.keterangan || '';
        ws.getCell(`D${row}`).font = fontBold;
        ws.getCell(`D${row}`).alignment = alignLeft;
      } else {
        ws.mergeCells(`D${row}:G${row}`);
      }
      ws.getCell(`B${row}`).border = border;
      ws.getCell(`C${row}`).border = border;
      ws.getCell(`D${row}`).border = border;
      ws.getRow(row).height = 28; row++;
    }
    row++;
  }
  
  addSection4Kolom('1. PENAMBAHAN STOK KASIR', 'QTY MASUK', baData.penambahanKasir || [], 4);
  addSection4Kolom('2A. PENYESUAIAN STOK (TAMBAH STOK)', 'QTY DITAMBAH', baData.penyesuaianTambah || [], 3);
  addSection4Kolom('2B. PENYESUAIAN STOK (KURANGI/RETUR)', 'QTY DIKURANGI', baData.penyesuaianKurang || [], 3);
  
  // SECTION 3: SALAH KETIK
  ws.mergeCells(`A${row}:G${row}`);
  const s3T = ws.getCell(`A${row}`);
  s3T.value = '3. SALAH KETIK/BATAL/RETUR / TUKAR BARANG CUSTOMER';
  s3T.font = fontSection; s3T.fill = fillSection;
  s3T.alignment = alignLeft; s3T.border = border;
  ws.getRow(row).height = 22; row++;
  
  ['NO','NO. NOTA','NAMA BARANG','QTY','NAMA BARANG TUKAR','QTY','KET'].forEach((val, i) => {
    const cell = ws.getCell(`${String.fromCharCode(65 + i)}${row}`);
    cell.value = val; cell.font = fontHeader; cell.fill = fillHeader;
    cell.alignment = alignCenter; cell.border = border;
  });
  ws.getRow(row).height = 30; row++;
  
  const s3Items = baData.salahKetikRetur || [];
  const s3Total = Math.max(s3Items.length, 2);
  for (let i = 0; i < s3Total; i++) {
    const item = s3Items[i];
    ws.getCell(`A${row}`).value = i + 1;
    if (item) {
      ws.getCell(`B${row}`).value = item.noNota || '';
      ws.getCell(`C${row}`).value = item.namaBarang || '';
      ws.getCell(`D${row}`).value = item.qty || '';
      ws.getCell(`E${row}`).value = item.namaBarangTukar || '';
      ws.getCell(`F${row}`).value = item.qtyTukar || '';
      ws.getCell(`G${row}`).value = item.keterangan || '';
    }
    ['A','B','C','D','E','F','G'].forEach(c => {
      const cell = ws.getCell(`${c}${row}`);
      cell.border = border; cell.font = fontData;
      if (['D','F'].includes(c)) cell.font = fontBold;
      cell.alignment = c === 'A' || c === 'B' || c === 'D' || c === 'F' ? alignCenter : alignLeft;
    });
    ws.getRow(row).height = 30; row++;
  }
  row++;
  
  // SECTION 4: BARANG MASUK
  ws.mergeCells(`A${row}:G${row}`);
  const s4T = ws.getCell(`A${row}`);
  s4T.value = '4. BARANG MASUK (FISIK TIDAK SESUAI/BELUM ADA DI NOTA)';
  s4T.font = fontSection; s4T.fill = fillSection;
  s4T.alignment = alignLeft; s4T.border = border;
  ws.getRow(row).height = 22; row++;
  
  ['NO','NAMA BARANG','QTY NOTA','FISIK YANG MASUK','QTY MASUK'].forEach((val, i) => {
    const cell = ws.getCell(`${String.fromCharCode(65 + i)}${row}`);
    cell.value = val; cell.font = fontHeader; cell.fill = fillHeader;
    cell.alignment = alignCenter; cell.border = border;
  });
  ws.mergeCells(`F${row}:G${row}`);
  ws.getCell(`F${row}`).value = 'KET';
  ws.getCell(`F${row}`).font = fontHeader; ws.getCell(`F${row}`).fill = fillHeader;
  ws.getCell(`F${row}`).alignment = alignCenter; ws.getCell(`F${row}`).border = border;
  ws.getRow(row).height = 30; row++;
  
  const s4Items = baData.barangMasuk || [];
  const s4Total = Math.max(s4Items.length, 5);
  for (let i = 0; i < s4Total; i++) {
    const item = s4Items[i];
    ws.getCell(`A${row}`).value = i + 1;
    if (item) {
      ws.getCell(`B${row}`).value = item.namaBarang || '';
      ws.getCell(`C${row}`).value = item.qtyNota || '';
      ws.getCell(`D${row}`).value = item.fisikMasuk || '';
      ws.getCell(`E${row}`).value = item.qtyMasuk || '';
      ws.mergeCells(`F${row}:G${row}`);
      ws.getCell(`F${row}`).value = item.keterangan || '';
    } else {
      ws.mergeCells(`F${row}:G${row}`);
    }
    ['A','B','C','D','E','F'].forEach(c => {
      ws.getCell(`${c}${row}`).border = border;
      ws.getCell(`${c}${row}`).font = ['C','E'].includes(c) ? fontBold : fontData;
      ws.getCell(`${c}${row}`).alignment = ['A','C','E'].includes(c) ? alignCenter : alignLeft;
    });
    ws.getRow(row).height = 30; row++;
  }
  row++;
  
  // SECTION 5: DICORET GUDANG
  ws.mergeCells(`A${row}:G${row}`);
  const s5T = ws.getCell(`A${row}`);
  s5T.value = '5. DICORET GANTI/RUBAH/BATAL DARI GUDANG';
  s5T.font = fontSection; s5T.fill = fillSection;
  s5T.alignment = alignLeft; s5T.border = border;
  ws.getRow(row).height = 22; row++;
  
  ['NO','NAMA BARANG','QTY AWAL','RUBAH/KOREKSI','QTY KOREKSI'].forEach((val, i) => {
    const cell = ws.getCell(`${String.fromCharCode(65 + i)}${row}`);
    cell.value = val; cell.font = fontHeader; cell.fill = fillHeader;
    cell.alignment = alignCenter; cell.border = border;
  });
  ws.mergeCells(`F${row}:G${row}`);
  ws.getCell(`F${row}`).value = 'KET';
  ws.getCell(`F${row}`).font = fontHeader; ws.getCell(`F${row}`).fill = fillHeader;
  ws.getCell(`F${row}`).alignment = alignCenter; ws.getCell(`F${row}`).border = border;
  ws.getRow(row).height = 30; row++;
  
  const s5Items = baData.dicoretGudang || [];
  const s5Total = Math.max(s5Items.length, 4);
  for (let i = 0; i < s5Total; i++) {
    const item = s5Items[i];
    ws.getCell(`A${row}`).value = i + 1;
    if (item) {
      ws.getCell(`B${row}`).value = item.namaBarang || '';
      ws.getCell(`C${row}`).value = item.qtyAwal || '';
      ws.getCell(`D${row}`).value = item.rubahKoreksi || '';
      ws.getCell(`E${row}`).value = item.qtyKoreksi || '';
      ws.mergeCells(`F${row}:G${row}`);
      ws.getCell(`F${row}`).value = item.keterangan || '';
    } else {
      ws.mergeCells(`F${row}:G${row}`);
    }
    ['A','B','C','D','E','F'].forEach(c => {
      ws.getCell(`${c}${row}`).border = border;
      ws.getCell(`${c}${row}`).font = ['C','E'].includes(c) ? fontBold : fontData;
      ws.getCell(`${c}${row}`).alignment = ['A','C','E'].includes(c) ? alignCenter : alignLeft;
    });
    ws.getRow(row).height = 30; row++;
  }
  
  const filePath = path.join(CONFIG.paths.storage, `temp_ba_${tokoKode}_${Date.now()}.xlsx`);
  await wb.xlsx.writeFile(filePath);
  return filePath;
}

// ════════════════════════════════════════════════════════════════
//   21. INISIASI BOT TELEGRAM
// ════════════════════════════════════════════════════════════════

const bot = new TelegramBot(CONFIG.botToken, { polling: true });

console.log(`🤖 AI: ${[CONFIG.geminiKey && 'Gemini', CONFIG.groqKey && 'Groq', CONFIG.openrouterKey && 'OpenRouter'].filter(Boolean).join(', ') || 'None'}`);
console.log('═'.repeat(60));
console.log('✅ Bot READY!\n');

// ════════════════════════════════════════════════════════════════
//   22. INLINE KEYBOARD BUILDERS
// ════════════════════════════════════════════════════════════════

function kbMainMenu(userId) {
  const buttons = [];
  
  if (bisaAksesLaporan(userId)) {
    buttons.push([
      { text: '📊 Laporan Penjualan', callback_data: 'menu:1' },
      { text: '🏷️ Laporan Harga', callback_data: 'menu:2' },
    ]);
    buttons.push([
      { text: '🛒 Laporan Marketplace', callback_data: 'menu:3' },
      { text: '📦 Stock Opname', callback_data: 'menu:5' },
    ]);
    buttons.push([
      { text: '📋 Berita Acara', callback_data: 'menu:6' },
      { text: '🔍 Cari Barang', callback_data: 'menu:4' },
    ]);
        buttons.push([
      { text: '🏠 Input Homebase', callback_data: 'menu:7' },
    ]);
  } else if (isMember(userId)) {
    buttons.push([
      { text: '🔍 Cari Barang', callback_data: 'menu:4' },
      { text: '🤖 AI Chat', callback_data: 'menu:ai' },
    ]);
  }
  
  if (isAdmin(userId)) {
    buttons.push([
      { text: '👑 Menu Admin', callback_data: 'menu:9' },
    ]);
  }
  
  buttons.push([
    { text: 'ℹ️ Info', callback_data: 'menu:info' },
    { text: '❓ Bantuan', callback_data: 'menu:help' },
  ]);
  
  return { inline_keyboard: buttons };
}

function kbPilihToko(menuType, excludeCp = false) {
  const buttons = [];
  TOKO_LIST.forEach((t) => {
    if (excludeCp && t.kode === 'cp') return;
    buttons.push([{ text: `${t.icon} ${t.nama}`, callback_data: `toko:${menuType}:${t.kode}` }]);
  });
  buttons.push([{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]);
  return { inline_keyboard: buttons };
}

function kbPilihHari(menuType, tokoKode) {
  return {
    inline_keyboard: [
      [
        { text: `📅 HARI INI (${getTanggal(false)})`, callback_data: `hari:${menuType}:${tokoKode}:0` },
      ],
      [
        { text: `📅 KEMARIN (${getTanggal(true)})`, callback_data: `hari:${menuType}:${tokoKode}:1` },
      ],
      [
        { text: '🔙 Pilih Toko', callback_data: `menu:${menuType}` },
      ]
    ]
  };
}

function kbAdminMenu() {
  return {
    inline_keyboard: [
      [
        { text: '👥 List Members', callback_data: 'admin:listmember' },
        { text: '📒 List Kontak', callback_data: 'admin:listkontak' },
      ],
      [
        { text: '🔔 Pending Approval', callback_data: 'admin:pending' },
        { text: '📊 Statistics', callback_data: 'admin:stats' },
      ],
      [
        { text: '🔄 Reload Excel', callback_data: 'admin:reload' },
        { text: 'ℹ️ Info Sistem', callback_data: 'admin:info' },
      ],
      [
        { text: '📢 Broadcast', callback_data: 'admin:broadcast' },
        { text: '🔙 Menu Utama', callback_data: 'menu:main' },
      ]
    ]
  };
}

function kbBaSection(baData) {
  const c = {
    s1: (baData.penambahanKasir || []).length,
    s2a: (baData.penyesuaianTambah || []).length,
    s2b: (baData.penyesuaianKurang || []).length,
    s3: (baData.salahKetikRetur || []).length,
    s4: (baData.barangMasuk || []).length,
    s5: (baData.dicoretGudang || []).length,
  };
  
  return {
    inline_keyboard: [
      [{ text: `1️⃣ Penambahan Stok Kasir (${c.s1})`, callback_data: 'ba:section:1' }],
      [{ text: `2️⃣ Penyesuaian Tambah (${c.s2a})`, callback_data: 'ba:section:2' }],
      [{ text: `3️⃣ Penyesuaian Kurangi (${c.s2b})`, callback_data: 'ba:section:3' }],
      [{ text: `4️⃣ Salah Ketik/Retur (${c.s3})`, callback_data: 'ba:section:4' }],
      [{ text: `5️⃣ Barang Masuk Fisik (${c.s4})`, callback_data: 'ba:section:5' }],
      [{ text: `6️⃣ Dicoret Gudang (${c.s5})`, callback_data: 'ba:section:6' }],
      [
        { text: '📊 Review', callback_data: 'ba:review' },
        { text: '✅ Selesai', callback_data: 'ba:selesai' },
      ],
      [{ text: '🔙 Batal', callback_data: 'menu:main' }],
    ]
  };
}

// ════════════════════════════════════════════════════════════════
//   23. UTILITY KIRIM PESAN (AUTO-SPLIT PESAN PANJANG)
// ════════════════════════════════════════════════════════════════

function splitMessage(text, maxLength = 4000) {
  if (!text) return [];
  if (text.length <= maxLength) return [text];
  
  const chunks = [];
  const lines = text.split('\n');
  let currentChunk = '';
  
  for (const line of lines) {
    if (line.length > maxLength) {
      if (currentChunk) {
        chunks.push(currentChunk);
        currentChunk = '';
      }
      for (let i = 0; i < line.length; i += maxLength) {
        chunks.push(line.substring(i, i + maxLength));
      }
      continue;
    }
    
    if (currentChunk.length + line.length + 1 > maxLength) {
      chunks.push(currentChunk);
      currentChunk = line;
    } else {
      currentChunk += (currentChunk ? '\n' : '') + line;
    }
  }
  
  if (currentChunk) chunks.push(currentChunk);
  return chunks;
}

async function kirim(chatId, text, opts = {}) {
  const MAX_LENGTH = 4000;
  
  try {
    if (!text || text.length <= MAX_LENGTH) {
      const options = { parse_mode: 'Markdown', ...opts };
      try {
        return await bot.sendMessage(chatId, text, options);
      } catch(err) {
        log.error('SEND', err.message);
        try {
          return await bot.sendMessage(chatId, text.replace(/[*_`\[\]]/g, ''), 
            { ...opts, parse_mode: undefined });
        } catch(e) {
          log.error('SEND-FALLBACK', e.message);
          return null;
        }
      }
    }
    
    const chunks = splitMessage(text, MAX_LENGTH);
    const total = chunks.length;
    log.info('SEND', `Pesan panjang (${text.length} char) dipecah jadi ${total} bagian`);
    
    let lastResult = null;
    for (let i = 0; i < total; i++) {
      let chunkText = chunks[i];
      const isLast = i === total - 1;
      
      if (total > 1) {
        chunkText = `📄 _Bagian ${i + 1}/${total}_\n──────────────────\n\n` + chunkText;
      }
      
      const chunkOpts = isLast 
        ? { parse_mode: 'Markdown', ...opts }
        : { parse_mode: 'Markdown' };
      
      try {
        lastResult = await bot.sendMessage(chatId, chunkText, chunkOpts);
        if (!isLast) await tunggu(400);
      } catch(err) {
        log.error('SEND-CHUNK', `Gagal chunk ${i + 1}/${total}: ${err.message}`);
        try {
          const cleanText = chunkText.replace(/[*_`\[\]]/g, '');
          lastResult = await bot.sendMessage(chatId, cleanText, 
            isLast ? { ...opts, parse_mode: undefined } : {});
          if (!isLast) await tunggu(400);
        } catch(e) {
          log.error('SEND-CHUNK-FALLBACK', `Chunk ${i + 1} gagal total: ${e.message}`);
        }
      }
    }
    return lastResult;
    
  } catch(err) {
    log.error('SEND', 'Error utama: ' + err.message);
    try {
      return await bot.sendMessage(chatId, 
        text.substring(0, 4000).replace(/[*_`\[\]]/g, ''));
    } catch(e) {
      return null;
    }
  }
}

async function kirimDokumen(chatId, filePath, fileName) {
  try {
    return await bot.sendDocument(chatId, filePath, {}, { filename: fileName });
  } catch(err) {
    log.error('SEND-DOC', err.message);
    return null;
  }
}

// ════════════════════════════════════════════════════════════════
//   24. UI MESSAGES
// ════════════════════════════════════════════════════════════════

function buildWelcome(userId, userName) {
  const waktu = getWaktu();
  const role = getUserRole(userId);
  
  return `┌─────────────────────────┐
│  🏪 *BOT TOKO PERABOT*
│  Selamat ${waktu}!
└─────────────────────────┘

👋 Halo *${escapeMd(userName)}*!
${role}

✨ *Fitur Lengkap:*
🔍 Cari barang & harga (5 toko)
🤖 AI Chat pintar
🎙️ Voice note recognition
📸 Scan foto AI
📊 Stock Opname & Laporan
📋 Berita Acara

⚡ *Cara Cepat:*
Langsung ketik nama barang!

📝 *Contoh:*
\`dandang eagle 20\`
\`harga panci di cp\`
\`grosir kompor\`

👇 Pilih menu di bawah:`;
}

function buildGuestWelcome(userName, userId) {
  return `🔐 *AKSES TERBATAS*\n${GARIS_TEBAL}\n\n` +
    `👋 Halo *${escapeMd(userName)}*!\n\n` +
    `Anda belum terverifikasi sebagai member.\n\n` +
    `📝 *Cara request akses:*\n` +
    `Ketik: \`/request Nama Lengkap\`\n\n` +
    `*Contoh:* \`/request Pak Budi\`\n\n` +
    `🆔 Telegram ID Anda: \`${userId}\`\n\n` +
    `Admin akan review permintaan Anda.`;
}

function buildDetailBarang(item, tokoKode, tipeHarga = 'semua') {
  let msg = `📦 *DETAIL BARANG*\n${GARIS_TEBAL}\n`;
  msg += `🔖 *Kode:* \`${item.kode}\`\n`;
  msg += `📦 *Nama:* ${escapeMd(item.nama)}\n`;
  msg += `🏷️ *Jenis:* ${escapeMd(item.jenis || '-')}\n`;
  msg += `🏗️ *Merek:* ${escapeMd(item.merek || '-')}\n`;
  msg += `📏 *Satuan:* ${escapeMd(item.satuan)}\n`;
  msg += `${GARIS_TEBAL}\n\n`;
  
  if (tokoKode && tokoKode !== 'all') {
    const t = TOKO_LIST.find(x => x.kode === tokoKode);
    const h = item.harga[tokoKode];
    msg += `${t.icon} *${t.nama}*\n`;
    if (tipeHarga === 'grosir') {
      msg += `📦 Ambil (6+): ${formatRp(h.ambil)}\n`;
    } else if (tipeHarga === 'ecer') {
      msg += `💵 Ecer (1-5): ${formatRp(h.ecer)}\n`;
    } else {
      msg += `💵 Ecer: ${formatRp(h.ecer)}\n📦 Ambil: ${formatRp(h.ambil)}\n`;
    }
    msg += `📊 Stok: ${h.stok} ${h.stok > 0 ? '✅' : '⚠️'}`;
  } else {
    msg += `💰 *HARGA 5 TOKO:*\n\n`;
    TOKO_LIST.forEach(t => {
      const h = item.harga[t.kode];
      const stokIcon = h.stok > 0 ? '🟢' : '🔴';
      msg += `${stokIcon} *${t.nama}*\n`;
      if (tipeHarga === 'grosir') {
        msg += `   📦 Ambil: ${formatRp(h.ambil)}\n`;
      } else if (tipeHarga === 'ecer') {
        msg += `   💵 Ecer: ${formatRp(h.ecer)}\n`;
      } else {
        msg += `   💵 Ecer: ${formatRp(h.ecer)} | 📦 Ambil: ${formatRp(h.ambil)}\n`;
      }
      msg += `   📊 Stok: ${h.stok} ${item.satuan}\n\n`;
    });
  }
  return msg;
}
// ════════════════════════════════════════════════════════════════
//   25. PROSES CARI BARANG (dengan Pagination)
// ════════════════════════════════════════════════════════════════

const HASIL_PER_HALAMAN = 15; // ★ Item per halaman (bisa disesuaikan)

async function prosesCari(chatId, userId, keyword, tokoFilter, page = 0) {
  trackSearch(keyword);
  const loading = await kirim(chatId, '🔍 _Sedang mencari di database..._');
  
  const tokoDisebut = deteksiTokoDariTeks(keyword);
  const tipeHarga = detectTipeHarga(keyword);
  const cleanKeyword = bersihkanKeywordDariToko(keyword);
  
  const tokoKode = tokoFilter || (tokoDisebut.length > 0 ? tokoDisebut[0].kode : null);
  
  const results = cariBarang(cleanKeyword);
  
  try { if (loading) await bot.deleteMessage(chatId, loading.message_id); } catch(e) {}
  
  // === TIDAK ADA HASIL ===
  if (results.hasil.length === 0) {
    if (results.saran && results.saran.length > 0) {
      let msg = `🤔 *Tidak Ditemukan Persis*\n${GARIS_TEBAL}\n\n`;
      msg += `Pencarian: _"${escapeMd(keyword)}"_\n\n`;
      msg += `💡 *Mungkin yang kamu maksud:*\n\n`;
      
      const buttons = [];
      results.saran.forEach((d, i) => {
        msg += `*${i+1}. ${escapeMd(d.nama)}*\n   🔖 \`${d.kode}\`\n\n`;
        buttons.push([{
          text: `${i+1}. ${d.nama}`,
          callback_data: `detail:${d.kode}:${tokoKode || 'all'}`
        }]);
      });
      
      buttons.push([{ text: '🔄 Cari Lagi', callback_data: 'menu:4' }]);
      buttons.push([{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]);
      
      await kirim(chatId, msg, { reply_markup: { inline_keyboard: buttons }});
    } else {
      await kirim(chatId,
        `❌ *Barang tidak ditemukan*\n${GARIS_TEBAL}\n\n` +
        `Pencarian: _${escapeMd(keyword)}_\n\n` +
        `💡 *Tips:*\n• Coba nama lebih spesifik\n• Atau pakai kode barang`,
        { reply_markup: { inline_keyboard: [
          [{ text: '🔄 Cari Lagi', callback_data: 'menu:4' }],
          [{ text: '🔙 Menu Utama', callback_data: 'menu:main' }],
        ]}}
      );
    }
    return;
  }
  
  // === SINGLE RESULT (1 item saja) ===
  if (results.hasil.length === 1) {
    const item = results.hasil[0];
    const buttons = [];
    
    if (!tokoKode) {
      TOKO_LIST.forEach(t => {
        buttons.push([{ text: `${t.icon} Lihat di ${t.nama}`, callback_data: `detail:${item.kode}:${t.kode}` }]);
      });
    }
    buttons.push([{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]);
    
    await kirim(chatId, buildDetailBarang(item, tokoKode || 'all', tipeHarga), {
      reply_markup: { inline_keyboard: buttons }
    });
    return;
  }
  
  // === MULTIPLE RESULTS - dengan PAGINATION ===
  
  // Sort abjad
  const sortedResults = [...results.hasil].sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
  
  // Pagination
  const totalPages = Math.ceil(sortedResults.length / HASIL_PER_HALAMAN);
  const currentPage = Math.max(0, Math.min(page, totalPages - 1));
  const startIdx = currentPage * HASIL_PER_HALAMAN;
  const endIdx = Math.min(startIdx + HASIL_PER_HALAMAN, sortedResults.length);
  const pageItems = sortedResults.slice(startIdx, endIdx);
  
  // Simpan hasil pencarian di session untuk pagination
  updateSesi(userId, {
    lastSearch: {
      keyword: keyword,
      tokoFilter: tokoFilter,
      tokoKode: tokoKode,
      tipeHarga: tipeHarga,
      totalResults: sortedResults.length,
      totalPages: totalPages,
      currentPage: currentPage,
    }
  });
  
  // Build header pesan
  let msg = `🔍 *Ditemukan ${sortedResults.length} barang (A-Z)*\n`;
  if (tokoKode) {
    const t = TOKO_LIST.find(x => x.kode === tokoKode);
    msg += `🏪 ${t.nama}\n`;
  }
  if (totalPages > 1) {
    msg += `📄 Halaman ${currentPage + 1}/${totalPages} (item ${startIdx + 1}-${endIdx})\n`;
  }
  msg += `${GARIS_TEBAL}\n\n`;
  
  // Build list item
  const buttons = [];
  pageItems.forEach((item, i) => {
    const globalIdx = startIdx + i + 1;
    msg += `*${globalIdx}. ${escapeMd(item.nama)}*\n   🔖 \`${item.kode}\`\n`;
    if (tokoKode) {
      const h = item.harga[tokoKode];
      const harga = tipeHarga === 'grosir' ? h.ambil : h.ecer;
      msg += `   💰 ${formatRp(harga)} | 📊 ${h.stok} ${h.stok > 0 ? '✅' : '⚠️'}\n`;
    }
    msg += '\n';
    buttons.push([{ 
      text: `${globalIdx}. ${item.nama}`, 
      callback_data: `detail:${item.kode}:${tokoKode || 'all'}` 
    }]);
  });
  
  // ═══ TOMBOL PAGINATION ═══
  if (totalPages > 1) {
    const navRow = [];
    
    // Previous
    if (currentPage > 0) {
      navRow.push({ text: '⬅️ Sebelumnya', callback_data: `caripage:${currentPage - 1}` });
    }
    
    // Info halaman (info only)
    navRow.push({ 
      text: `📄 ${currentPage + 1}/${totalPages}`, 
      callback_data: `caripageinfo` 
    });
    
    // Next
    if (currentPage < totalPages - 1) {
      navRow.push({ text: 'Berikutnya ➡️', callback_data: `caripage:${currentPage + 1}` });
    }
    
    buttons.push(navRow);
    
    // Quick jump (kalau lebih dari 3 halaman)
    if (totalPages > 3) {
      const jumpRow = [];
      if (currentPage > 1) {
        jumpRow.push({ text: '⏮️ Awal', callback_data: `caripage:0` });
      }
      if (currentPage < totalPages - 2) {
        jumpRow.push({ text: 'Akhir ⏭️', callback_data: `caripage:${totalPages - 1}` });
      }
      if (jumpRow.length > 0) buttons.push(jumpRow);
    }
  }
  
  // Tombol aksi
  buttons.push([{ text: '🔄 Cari Lagi', callback_data: 'menu:4' }]);
  buttons.push([{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]);
  
  await kirim(chatId, msg, { reply_markup: { inline_keyboard: buttons }});
}

// ════════════════════════════════════════════════════════════════
//   26. AI CHAT HANDLER - SMART ROUTING (Anti Halusinasi)
// ════════════════════════════════════════════════════════════════

// Deteksi intent: apakah ini pertanyaan barang/harga/stok?
function deteksiIntentBarang(text) {
  const low = text.toLowerCase().trim();
  
  // ★ FILTER DULU: Kalau jelas-jelas pertanyaan NON-PRODUK, skip
  const nonProductPatterns = [
    /\b(siapa|kapan|dimana|apa itu|apa sih|mengapa|kenapa|bagaimana)\b/i,
    /\b(presiden|menteri|gubernur|walikota|bupati|raja|ratu|pemimpin)\b/i,
    /\b(kurs|dolar|dollar|euro|yen|rupiah|mata uang|exchange)\b/i,
    /\b(cuaca|hujan|cerah|mendung|gempa|tsunami)\b/i,
    /\b(berita|news|terkini|terbaru|update|informasi)\b/i,
    /\b(jokowi|prabowo|gibran|megawati|sby)\b/i,
    /\b(pemilu|pilkada|pilpres|politik|partai)\b/i,
    /\b(piala dunia|olimpiade|liga|sepak bola)\b/i,
    /\b(film|musik|lagu|artis|aktor|aktris|drakor|anime)\b/i,
    /\b(covid|vaksin|pandemi|virus|penyakit)\b/i,
    /\b(blockchain|crypto|bitcoin|ethereum|saham|ihsg)\b/i,
    /\b(saya capek|aku capek|sedih|galau|stres|happy|senang)\b/i,
    /\b(cerita|curhat|sharing|dengerin)\b/i,
    /\b(makan apa|minum apa|lagi ngapain|sedang apa)\b/i,
    /\b(siang|malam|pagi|sore) (kak|sis|bro)\b/i,
    /^(halo|hai|hi|hello|hey|p)\b/i,
  ];
  
  for (const pattern of nonProductPatterns) {
    if (pattern.test(low)) {
      return { isProduct: false, confidence: 'high', reason: 'pertanyaan umum/sapaan' };
    }
  }
  
  // 1. Ada kode barang? (NN00001, KS00456, dll)
  if (/\b[a-z]{2,5}\d{2,6}\b/i.test(low)) {
    return { isProduct: true, confidence: 'high', reason: 'kode barang' };
  }
  
  // 2. ★ NEW: Pattern generik "SINGKATAN + ANGKA" (contoh: DLP 21, LP 15, GK 200)
  // Ini pattern umum untuk nama produk dengan singkatan
  if (/\b[a-z]{2,4}\s*\d{1,4}\b/i.test(low) && low.length <= 30) {
    // Cek panjang total pesan (kalau pendek, kemungkinan besar nama barang)
    const wordCount = low.split(/\s+/).length;
    if (wordCount <= 5) {
      return { isProduct: true, confidence: 'high', reason: 'pattern singkatan+angka' };
    }
  }
  
  // 3. Kata kunci EXPLISIT cek harga/stok BARANG
  const eksplisitProduk = [
    'cek harga', 'cek stok', 'stok', 'harga',
    'cari barang', 'cari produk',
    'harga ecer', 'harga grosir',
    'ada barang', 'ada produk',
  ];
  
  for (const kw of eksplisitProduk) {
    if (low.includes(kw)) {
      return { isProduct: true, confidence: 'high', reason: 'eksplisit: ' + kw };
    }
  }
  
  // 4. Cek harga grosir/ecer
  if (/\b(grosir|ecer)\b/i.test(low)) {
    return { isProduct: true, confidence: 'high', reason: 'tipe harga' };
  }
  
  // 5. Nama brand + angka (eagle 20, cosmos 200, dll)
  const brands = [
    'eagle', 'cosmos', 'niko', 'miyako', 'maxim', 'philips', 'sharp', 
    'panasonic', 'sanken', 'sony', 'toshiba', 'tefal', 'oxone', 'maspion',
    'sunflask', 'elephant', 'amazon', 'apolly', 'flamboyan', 'ferona',
    'hock', 'rinnai', 'quantum', 'todachi', 'yamaha', 'polytron',
    'signora', 'lock&lock', 'tupperware', 'oneida', 'stanley',
    'kirin', 'denpoo', 'aqua', 'modena', 'electrolux', 'lg',
    'samsung', 'daikin', 'artugo', 'kris', 'kenwood',
  ];
  for (const brand of brands) {
    if (low.includes(brand)) {
      return { isProduct: true, confidence: 'high', reason: 'merek: ' + brand };
    }
  }
  
  // 6. Nama kategori barang
  const kategoriBarang = [
    'panci', 'dandang', 'wajan', 'kompor', 'rice cooker', 'magic com', 'magic',
    'dispenser', 'setrika', 'kipas', 'kasur', 'bed set', 'lemari', 'meja',
    'rak', 'piring', 'gelas', 'sendok', 'garpu', 'teko', 'termos', 'blender',
    'mixer', 'oven', 'microwave', 'kulkas', 'pisau', 'talenan',
    'baskom', 'ember', 'galon', 'tempat sampah', 'sapu', 'pel', 'sikat',
    'kursi', 'meja makan', 'lemari', 'karpet', 'tikar', 'handuk',
    'kompor gas', 'kompor listrik', 'water heater', 'exhaust', 'blower',
    'tempat kue', 'tempat sampah', 'tempat sendok', 'rak piring',
    'sendok makan', 'garpu makan', 'pisau dapur',
  ];
  
  for (const kat of kategoriBarang) {
    if (low.includes(kat)) {
      if (/\d+/.test(low)) {
        return { isProduct: true, confidence: 'high', reason: 'barang + ukuran: ' + kat };
      }
      if (/\b(harga|stok|cek|cari|ada|berapa)\b/.test(low)) {
        return { isProduct: true, confidence: 'high', reason: 'barang + tanya: ' + kat };
      }
      return { isProduct: true, confidence: 'medium', reason: 'nama barang: ' + kat };
    }
  }
  
  // 7. ★ NEW: Kata pendek yang bukan sapaan/kata umum → kemungkinan nama barang
  const wordCount = low.split(/\s+/).length;
  const isPendek = low.length <= 20 && wordCount <= 3;
  const bukanKalimat = !/\b(saya|aku|kamu|dia|mereka|kita|adalah|itu|ini|dan|atau|tapi|karena|jika)\b/i.test(low);
  const adaHuruf = /[a-z]/i.test(low);
  const adaAngkaAtauKode = /\d|[A-Z]{2,}/.test(text);
  
  if (isPendek && bukanKalimat && adaHuruf && adaAngkaAtauKode) {
    return { isProduct: true, confidence: 'medium', reason: 'pattern nama barang pendek' };
  }
  
  return { isProduct: false, confidence: 'high', reason: 'bukan produk' };
}

// Deteksi: apakah ini lanjutan dari pertanyaan barang sebelumnya?
function deteksiLanjutanBarang(text, memory) {
  if (!memory || memory.length === 0) return null;
  
  const low = text.toLowerCase().trim();
  
  // Pesan terakhir bot
  const lastBotMsg = [...memory].reverse().find(m => m.role === 'assistant');
  // Pesan user sebelum sekarang
  const userMessages = memory.filter(m => m.role === 'user');
  const lastUserMsg = userMessages[userMessages.length - 1];
  
  if (!lastUserMsg) return null;
  
  // Pattern lanjutan:
  // "cek harganya" / "harganya berapa" / "stoknya gimana" / "ada di toko lain?"
  const lanjutanPatterns = [
    'harga', 'harganya', 'stok', 'stoknya', 'berapa', 'ada di',
    'ditemukan', 'mau pesan', 'beli', 'order', 'cek toko lain',
    'di toko lain', 'cabang lain', 'grosir', 'ecer', 'ambil'
  ];
  
  const adaPatternLanjutan = lanjutanPatterns.some(p => low.includes(p));
  
  if (adaPatternLanjutan) {
    // Cek apakah pesan user sebelumnya tentang barang
    const sebelumProduct = deteksiIntentBarang(lastUserMsg.content);
    if (sebelumProduct.isProduct) {
      // Ambil nama barang dari pesan sebelumnya
      return {
        isLanjutan: true,
        contextBarang: lastUserMsg.content,
      };
    }
  }
  
  return null;
}

async function prosesAI(chatId, userId, pertanyaan) {
  trackChat(userId, pertanyaan, 'ai');
  
  try { await bot.sendChatAction(chatId, 'typing'); } catch(e) {}
  
  const nama = getNama(userId) || 'Kakak';
  const low = pertanyaan.toLowerCase().trim();
  
  // ═══ COMMAND KHUSUS ═══
  if (low === 'reset chat' || low === 'lupakan' || low === 'mulai lagi' || low === 'clear memory') {
    clearMemory(userId);
    await kirim(chatId, 
      `Oke kak ${escapeMd(nama)}, aku reset memori ngobrol kita ya 🔄\n\nMulai dari awal lagi nih! Mau ngobrol apa? 😊`
    );
    return;
  }
  
  if (low === 'lihat memory' || low === 'show memory') {
    const memory = getChatMemory(userId);
    if (memory.length === 0) {
      await kirim(chatId, `Belum ada percakapan tersimpan kak 😊`);
      return;
    }
    let m = `🧠 *Memori Percakapan*\n${GARIS_TIPIS}\n\n`;
    memory.slice(-5).forEach((msg) => {
      const role = msg.role === 'user' ? '👤 Kamu' : '🤖 Aku';
      m += `${role}: _${msg.content.substring(0, 80)}${msg.content.length > 80 ? '...' : ''}_\n\n`;
    });
    m += `\nTotal: ${memory.length} pesan tersimpan`;
    await kirim(chatId, m);
    return;
  }
  
  // ═══ ROUTER PINTAR ═══
  
  // 1. Cek lanjutan dari pertanyaan barang sebelumnya
  const memory = getChatMemory(userId);
  const lanjutan = deteksiLanjutanBarang(pertanyaan, memory);
  
  if (lanjutan && lanjutan.isLanjutan) {
    log.info('AI-ROUTER', `Lanjutan dari: "${lanjutan.contextBarang.substring(0, 30)}"`);
    const queryGabungan = `${lanjutan.contextBarang} ${pertanyaan}`;
    await prosesCari(chatId, userId, queryGabungan, null);
    addToMemory(userId, 'user', pertanyaan);
    addToMemory(userId, 'assistant', `[Sistem mencari: ${queryGabungan}]`);
    return;
  }
  
  // 2. Deteksi intent barang (yang sudah diperbaiki)
  const intent = deteksiIntentBarang(pertanyaan);
  log.info('AI-ROUTER', `Intent: ${intent.isProduct ? 'PRODUK' : 'NON-PRODUK'} (${intent.confidence}) - ${intent.reason}`);
  
  // 3. Confidence HIGH untuk PRODUK → langsung cari
  if (intent.isProduct && intent.confidence === 'high') {
    await prosesCari(chatId, userId, pertanyaan, null);
    addToMemory(userId, 'user', pertanyaan);
    addToMemory(userId, 'assistant', `[Sistem mencari barang: ${pertanyaan}]`);
    return;
  }
  
   // 4. Confidence MEDIUM → LANGSUNG CARI (tidak perlu tanya)
  // Karena user kasih input singkat, kemungkinan besar itu memang nama barang
  if (intent.isProduct && intent.confidence === 'medium') {
    log.info('AI-ROUTER', `Medium confidence → langsung cari: "${pertanyaan}"`);
    await prosesCari(chatId, userId, pertanyaan, null);
    addToMemory(userId, 'user', pertanyaan);
    addToMemory(userId, 'assistant', `[Sistem mencari barang: ${pertanyaan}]`);
    return;
  }
  
  // 5. NON-PRODUK → ngobrol natural dengan AI (with web search jika perlu)

  const result = await chatAINatural(userId, pertanyaan, nama);
  
  if (result?.jawaban) {
    const delay = Math.min(result.jawaban.length * 25, 2000);
    await tunggu(delay);
    
    let finalResponse = result.jawaban;
    
    if (result.webUsed) {
      finalResponse += `\n\n_💡 Info dari internet_`;
    }
    
    // Cek apakah AI bilang "bentar aku cek" → berarti AI kira ini produk
    const aiTriggersSearch = /\b(bentar|sebentar|tunggu|wait)\b.*(cek|cari|carikan|check|lihat).*(database|sistem|data|stok|toko)/i.test(result.jawaban) 
      || /(cek|cari|carikan|check|lihat).*(database|sistem|data|stok|toko).*(ya|dulu)/i.test(result.jawaban)
      || /\bbentar\b.*(kak|ya|dulu)/i.test(result.jawaban.toLowerCase().substring(0, 100));
    
    await kirim(chatId, finalResponse);
    
    // ★ Kalau AI bilang mau cek, LANGSUNG trigger pencarian
    if (aiTriggersSearch) {
      log.info('AI-TRIGGER', `AI meminta cari: "${pertanyaan}"`);
      await tunggu(800);
      await prosesCari(chatId, userId, pertanyaan, null);
    }
  } else {
    const fallbackResponses = [
      `Hmm, aku lagi blank nih kak 😅 Coba tanya lagi?`,
      `Aduh maaf, lagi loading 🤖💭 Coba lagi ya?`,
      `Lho, kok aku gak bisa mikir 😆 Coba ulang kak`,
    ];
    const random = fallbackResponses[Math.floor(Math.random() * fallbackResponses.length)];
    await kirim(chatId, random);
  }
}

// ════════════════════════════════════════════════════════════════
//   27. STOCK OPNAME HANDLER (EDIT RAK + EDIT ITEM + GABUNGAN)
// ════════════════════════════════════════════════════════════════

function tampilkanBarangPilihan(item, tokoKode, userId, rakAktif) {
  const h = item.harga[tokoKode];
  
  let m = `📦 *Barang ditemukan!*\n${GARIS_TEBAL}\n`;
  m += `🔖 ${item.kode}\n📦 ${escapeMd(item.nama)}\n📏 ${item.satuan}\n💻 Stok Sistem: ${h.stok}\n`;
  
  // Info di rak lain / user lain
  const infoLain = formatInfoBarangDiRakLain(tokoKode, item.kode, rakAktif, userId);
  if (infoLain) m += infoLain;
  
  // Info total semua rak
  const totalAll = getTotalBarangSemuaRak(tokoKode, item.kode);
  if (totalAll.total > 0) {
    m += `\n📊 *Total semua rak:*\n`;
    if (totalAll.totalFisik > 0) m += `   🏪 Fisik: ${totalAll.totalFisik}\n`;
    if (totalAll.totalGudang > 0) m += `   🏭 Gudang: ${totalAll.totalGudang}\n`;
    m += `   📦 TOTAL: ${totalAll.total}\n`;
    
    const selisih = totalAll.total - h.stok;
    const icon = selisih === 0 ? '✅' : selisih > 0 ? '➕' : '➖';
    m += `   ${icon} Selisih: ${selisih}\n`;
  }
  
  m += `${GARIS_TEBAL}\n\n💬 *Ketik:*\n• \`TOKO 15\` — stok fisik toko\n• \`GUDANG 20\` — stok gudang`;
  return m;
}

async function handleStockOpnameMode(chatId, userId, message, session) {
  const low = (message || '').toLowerCase().trim();
  const tokoKode = session.tokoKode;
  const namaToko = NAMA_TOKO[tokoKode];
  
  if (!session.soInfo) {
    session.soInfo = { petugas: [], rakAktif: null, jamMulaiAktif: null };
    updateSesi(userId, { soInfo: session.soInfo });
  }
  const soInfo = session.soInfo;
  
  if (low === 'batal' || low === '/batal') {
    leaveSesiSO(tokoKode, userId);
    resetSesi(userId);
    await kirim(chatId, '✅ Stock opname dibatalkan.', { reply_markup: kbMainMenu(userId) });
    return;
  }
  
  // ════════ WIZARD SETUP ════════
  
  if (session.soSetupStep === 'petugas') {
    if (!message || message.length < 2) return kirim(chatId, '⚠️ Minimal 2 karakter.');
    const petugas = message.split(',').map(n => n.trim()).filter(n => n.length >= 2);
    if (!petugas.length) return kirim(chatId, '⚠️ Contoh: `Budi` atau `Budi, Sari`');
    
    soInfo.petugas = petugas;
    updateSesi(userId, { soInfo, soSetupStep: 'rak' });
    
    // Cek rak yang sudah ada
    const existingRacks = Object.keys(getAllRacks(tokoKode));
    let rakMsg = `✅ *Petugas:* ${petugas.join(', ')}\n${GARIS_TIPIS}\n\n📦 *STEP 2/3: Pilih/Buat Rak*\n\n`;
    
    if (existingRacks.length > 0) {
      rakMsg += `📚 *Rak yang sudah ada:*\n`;
      const buttons = [];
      existingRacks.forEach((rak, i) => {
        const items = Object.keys(getBarangDiRak(tokoKode, rak)).length;
        rakMsg += `${i+1}. ${rak} (${items} barang)\n`;
        buttons.push([{ text: `📦 ${rak} (${items} barang)`, callback_data: `so:pilihrak:${rak}` }]);
      });
      buttons.push([{ text: '🆕 Buat Rak Baru', callback_data: 'so:rakbaru' }]);
      
      rakMsg += `\n💡 *3 cara input rak:*\n`;
      rakMsg += `   1. Pilih dari tombol di bawah\n`;
      rakMsg += `   2. 📸 *Kirim FOTO barcode/label rak*\n`;
      rakMsg += `   3. Ketik nama rak manual`;
      await kirim(chatId, rakMsg, { reply_markup: { inline_keyboard: buttons }});
        } else {
      rakMsg += `💡 *2 cara input rak:*\n`;
      rakMsg += `   1. 📸 *Kirim FOTO barcode/label rak* (auto-scan)\n`;
      rakMsg += `   2. Ketik nama manual\n\n`;
      rakMsg += `*Contoh ketik:* \`Rak A1\``;
      await kirim(chatId, rakMsg);
    }
    return;
  }
  
  if (session.soSetupStep === 'rak' || session.soSetupStep === 'rak_input') {
    if (!message || message.length < 2) return kirim(chatId, '⚠️ Nama rak minimal 2 karakter.');
    soInfo.rakAktif = message.trim();
    updateSesi(userId, { soInfo, soSetupStep: 'jam' });
    
    const jamSekarang = getJamSekarang();
    await kirim(chatId,
      `✅ *Rak:* ${escapeMd(soInfo.rakAktif)}\n${GARIS_TIPIS}\n\n` +
      `⏰ *STEP 3/3: Jam Mulai*\n\nFormat: \`HH:MM\`\n\n💡 Atau ketik *sekarang* (${jamSekarang})`
    );
    return;
  }
  
  if (session.soSetupStep === 'jam') {
    let jamMulai = '';
    if (low === 'sekarang' || low === 'now') {
      jamMulai = getJamSekarang();
    } else {
      const match = message.trim().match(/^(\d{1,2})[:.](\d{2})$/);
      if (!match) return kirim(chatId, '⚠️ Contoh: `08:30` atau `sekarang`');
      const jam = parseInt(match[1]), menit = parseInt(match[2]);
      if (jam < 0 || jam > 23 || menit < 0 || menit > 59) return kirim(chatId, '⚠️ Jam 0-23, menit 0-59.');
      jamMulai = `${String(jam).padStart(2,'0')}:${String(menit).padStart(2,'0')}`;
    }
    
    soInfo.jamMulaiAktif = jamMulai;
    updateSesi(userId, { soInfo, soSetupStep: null });
    
    const namaPetugas = soInfo.petugas[0] || getNama(userId) || 'User';
    joinSesiSO(tokoKode, userId, namaPetugas, soInfo.petugas, soInfo.rakAktif, jamMulai);
    
    const usersLain = Object.entries(getAllUsersAktif(tokoKode))
      .filter(([uid]) => String(uid) !== String(userId));
    
    let infoLain = '';
    if (usersLain.length > 0) {
      infoLain = `\n\n👥 *USER LAIN SEDANG SO:*\n──────────────────\n`;
      usersLain.forEach(([, info], i) => {
        infoLain += `${i+1}. *${info.nama}* di *${info.rakAktif}* (mulai ${info.jamMulai})\n`;
      });
    }
    
    // Cek rak ini sudah ada barang?
    const existingItems = Object.keys(getBarangDiRak(tokoKode, soInfo.rakAktif)).length;
    let infoRak = '';
    if (existingItems > 0) {
      infoRak = `\n📊 Rak ini sudah punya *${existingItems}* jenis barang (dari user lain/sebelumnya).\n`;
    }
    
    await kirim(chatId,
      `🎉 *SETUP SELESAI!*\n${GARIS_TEBAL}\n\n` +
      `🏦 ${namaToko}\n👥 ${soInfo.petugas.join(', ')}\n` +
      `📦 Rak: *${escapeMd(soInfo.rakAktif)}*\n` +
      `⏰ Mulai: *${jamMulai}*\n` +
      infoRak + infoLain +
      `\n${GARIS_TEBAL}\n\n📝 *INPUT BARANG:*\nKetik nama/kode → pilih → \`TOKO 15\` / \`GUDANG 20\`\n\n` +
      `*Perintah:* review | userlain | pindahrak | editrak | selesai | batal`,
      { reply_markup: kbSOAktif() }
    );
    return;
  }
  
  // ════════ PINDAH RAK ════════
  
  if (session.soSetupStep === 'pindahrak_namabaru' || session.soSetupStep === 'rak_input_pindah') {
    if (!message || message.length < 2) return kirim(chatId, '⚠️ Nama rak minimal 2 karakter.');
    soInfo.rakAktif = message.trim();
    updateSesi(userId, { soInfo, soSetupStep: null });
    
    updateUserRakSO(tokoKode, userId, soInfo.rakAktif);
    
    const existingItems = Object.keys(getBarangDiRak(tokoKode, soInfo.rakAktif)).length;
    
    await kirim(chatId,
      `✅ *Pindah ke: ${escapeMd(soInfo.rakAktif)}*\n${GARIS_TIPIS}\n` +
      (existingItems > 0 ? `📊 Rak ini sudah punya ${existingItems} jenis barang.\n` : '') +
      `\n📝 Lanjutkan input barang...`,
      { reply_markup: kbSOAktif() }
    );
    return;
  }
  
  // ════════ EDIT ITEM QTY ════════
  
  if (session.soEditMode) {
    const editInfo = session.soEditInfo;
    
    if (low === 'hapus' || low === 'delete') {
      hapusItemSO(tokoKode, editInfo.rak, editInfo.kode);
      updateSesi(userId, { soEditMode: false, soEditInfo: null });
      await kirim(chatId, `🗑️ *Barang dihapus dari ${editInfo.rak}!*`, { reply_markup: kbSOAktif() });
      return;
    }
    
    const match = message.trim().match(/^([+-]?)(\d+)$/);
    if (!match) {
      await kirim(chatId,
        `⚠️ Ketik angka baru, atau:\n• \`+5\` untuk tambah 5\n• \`-3\` untuk kurangi 3\n• \`0\` atau \`hapus\` untuk hapus`
      );
      return;
    }
    
    const sign = match[1];
    const angka = parseInt(match[2]);
    
    const entries = getBarangDiRak(tokoKode, editInfo.rak)[editInfo.kode]?.entries || [];
    const entryIdx = editInfo.entryIndex || 0;
    
    if (entryIdx >= entries.length) {
      updateSesi(userId, { soEditMode: false, soEditInfo: null });
      await kirim(chatId, '⚠️ Entry tidak ditemukan. Mungkin sudah dihapus.', { reply_markup: kbSOAktif() });
      return;
    }
    
    let newQty;
    if (sign === '+') {
      newQty = entries[entryIdx].qty + angka;
    } else if (sign === '-') {
      newQty = Math.max(0, entries[entryIdx].qty - angka);
    } else {
      newQty = angka;
    }
    
    editQtyItemSO(tokoKode, editInfo.rak, editInfo.kode, entryIdx, newQty);
    updateSesi(userId, { soEditMode: false, soEditInfo: null });
    
    const item = DATA_BARANG.find(d => d.kode === editInfo.kode);
    const namaBarang = item?.nama || editInfo.kode;
    
    if (newQty <= 0) {
      await kirim(chatId, `🗑️ *${escapeMd(namaBarang)}* dihapus dari ${editInfo.rak}!`, { reply_markup: kbSOAktif() });
    } else {
      const totalAll = getTotalBarangSemuaRak(tokoKode, editInfo.kode);
      await kirim(chatId,
        `✅ *Qty diubah!*\n${GARIS_TIPIS}\n` +
        `📦 ${escapeMd(namaBarang)}\n📍 ${editInfo.rak}\n` +
        `📊 Qty baru: *${newQty}*\n📊 Total semua rak: *${totalAll.total}*`,
        { reply_markup: kbSOAktif() }
      );
    }
    return;
  }
  
  // ════════ COMMANDS ════════
  
  if (low === 'userlain' || low === 'lihatuser') {
    const usersAktif = getAllUsersAktif(tokoKode);
    const userLainList = Object.entries(usersAktif).filter(([uid]) => String(uid) !== String(userId));
    
    if (!userLainList.length) {
      return kirim(chatId, `👥 Hanya kamu yang SO di ${namaToko} saat ini.`);
    }
    
    let m = `👥 *USER AKTIF SO DI ${namaToko}*\n${GARIS_TEBAL}\n\n`;
    userLainList.forEach(([, info], i) => {
      const lastMin = Math.floor((Date.now() - info.lastActive) / 60000);
      const st = lastMin < 5 ? '🟢' : lastMin < 15 ? '🟡' : '🔴';
      m += `${i+1}. ${st} *${info.nama}* di *${info.rakAktif}*\n   ⏰ Mulai: ${info.jamMulai} | Aktif ${lastMin < 1 ? 'baru saja' : lastMin + 'm lalu'}\n\n`;
    });
    
    await kirim(chatId, m, { reply_markup: kbSOAktif() });
    return;
  }
  
    if (low === 'pindahrak' || low === 'pindah rak' || low === 'ganti rak') {
    const existingRacks = Object.keys(getAllRacks(tokoKode));
    
    const buttons = [];
    existingRacks.forEach(rak => {
      if (rak === soInfo.rakAktif) return;
      const items = Object.keys(getBarangDiRak(tokoKode, rak)).length;
      buttons.push([{ text: `📦 ${rak} (${items} barang)`, callback_data: `so:pilihrak:${rak}` }]);
    });
    buttons.push([{ text: '🆕 Buat Rak Baru', callback_data: 'so:rakbaru' }]);
    buttons.push([{ text: '🔙 Kembali', callback_data: 'so:kembali' }]);
    
    await kirim(chatId,
      `📦 *PINDAH RAK*\n${GARIS_TEBAL}\n\n` +
      `Rak aktif: *${escapeMd(soInfo.rakAktif)}*\n\n` +
      `💡 *3 cara pindah:*\n` +
      `   1. Pilih dari tombol di bawah\n` +
      `   2. 📸 *Kirim FOTO barcode/label rak tujuan*\n` +
      `   3. Klik "Buat Rak Baru" + ketik nama`,
      { reply_markup: { inline_keyboard: buttons }}
    );
    return;
  }
  
  if (low === 'editrak' || low === 'edit rak') {
    const existingRacks = Object.keys(getAllRacks(tokoKode));
    
    if (!existingRacks.length) return kirim(chatId, '⚠️ Belum ada rak.');
    
    const buttons = [];
    existingRacks.forEach(rak => {
      const items = Object.keys(getBarangDiRak(tokoKode, rak)).length;
      buttons.push([{ text: `✏️ ${rak} (${items} barang)`, callback_data: `so:editrak:${rak}` }]);
    });
    buttons.push([{ text: '🔙 Kembali', callback_data: 'so:kembali' }]);
    
    await kirim(chatId,
      `✏️ *EDIT RAK*\nPilih rak yang ingin diedit:`,
      { reply_markup: { inline_keyboard: buttons }}
    );
    return;
  }
  
    if (low === 'review') {
    const gabungan = getSOGabunganData(tokoKode);
    const allRacks = getAllRacks(tokoKode);
    const allKodes = new Set([...Object.keys(gabungan.fisik), ...Object.keys(gabungan.gudang)]);
    
    let m = `👁️ *REVIEW SO - ${namaToko}*\n${GARIS_TEBAL}\n\n`;
    m += `📦 Rak aktif: *${soInfo.rakAktif}*\n`;
    m += `📚 Total rak: ${Object.keys(allRacks).length}\n\n`;
    
    // Info per rak
    Object.entries(allRacks).forEach(([rakName, rackData], i) => {
      const itemCount = Object.keys(rackData.items || {}).length;
      const isAktif = rakName === soInfo.rakAktif;
      m += `${i+1}. ${isAktif ? '📍' : '📦'} *${rakName}* — ${itemCount} barang ${isAktif ? '(AKTIF)' : ''}\n`;
    });
    
    m += `\n${GARIS_TIPIS}\n`;
    
    // Daftar SEMUA barang di SEMUA rak, SORT ABJAD
    if (allKodes.size > 0) {
      const allItems = [];
      allKodes.forEach(kode => {
        const item = DATA_BARANG.find(d => d.kode === kode);
        const nama = item?.nama || kode;
        const satuan = item?.satuan || '';
        const sistem = item?.harga[tokoKode]?.stok || 0;
        const fisik = gabungan.fisik[kode] || 0;
        const gudang = gabungan.gudang[kode] || 0;
        const total = fisik + gudang;
        const selisih = total - sistem;
        allItems.push({ kode, nama, satuan, sistem, fisik, gudang, total, selisih });
      });
      
      // SORT ABJAD
      allItems.sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
      
      m += `📋 *DAFTAR BARANG (A-Z):*\n${GARIS_TIPIS}\n\n`;
      
      allItems.forEach((d, i) => {
        const statusIcon = d.selisih === 0 ? '✅' : d.selisih > 0 ? '➕' : '➖';
        // Tampilkan NAMA LENGKAP (tidak dipotong)
        m += `*${i+1}. ${escapeMd(d.nama)}*\n`;
        m += `   🔖 \`${d.kode}\`\n`;
        m += `   💻 Sistem: ${d.sistem}`;
        if (d.fisik > 0) m += ` | 🏪 ${d.fisik}`;
        if (d.gudang > 0) m += ` | 🏭 ${d.gudang}`;
        m += ` | 📦 Total: ${d.total}`;
        m += ` ${statusIcon} ${d.selisih === 0 ? '' : (d.selisih > 0 ? '+' : '') + d.selisih}\n\n`;
      });
      
      // Ringkasan
      const kurang = allItems.filter(d => d.selisih < 0).length;
      const lebih = allItems.filter(d => d.selisih > 0).length;
      const sesuai = allItems.filter(d => d.selisih === 0).length;
      
      m += `${GARIS_TEBAL}\n📊 *RINGKASAN:*\n`;
      m += `   📦 Total: ${allItems.length} barang\n`;
      m += `   ✅ Sesuai: ${sesuai} | ➕ Lebih: ${lebih} | ➖ Kurang: ${kurang}\n`;
    } else {
      m += `\n_Belum ada barang diinput._\n`;
    }
    
    await kirim(chatId, m, {
      reply_markup: { inline_keyboard: [
        [{ text: '📊 Export Excel Gabungan', callback_data: 'so:exportgabungan' }],
        [{ text: '✏️ Edit Rak', callback_data: 'so:editrak' }],
        [{ text: '✅ Selesai SO', callback_data: 'so:selesai' }],
        [{ text: '🔙 Lanjut Input', callback_data: 'so:kembali' }],
      ]}
    });
    return;
  }
  
  if (low === 'selesai' || low === 'done') {
    await kirim(chatId,
      `🤔 *Selesai Stock Opname?*\n${GARIS_TEBAL}\n\nPilih:`,
      { reply_markup: { inline_keyboard: [
        [{ text: '📊 Export & Keluar (Saya Saja)', callback_data: 'so:selesaisaya' }],
        [{ text: '📊 Export Gabungan Semua User', callback_data: 'so:exportgabungan' }],
        [{ text: '🔙 Kembali Input', callback_data: 'so:kembali' }],
      ]}}
    );
    return;
  }
  
  // ════════ INPUT QTY ════════
  // ════════════ SEARCH IN RAK MODE ════════════
  
  if (session.soSearchMode && session.soSearchInRak) {
    const rakName = session.soSearchInRak;
    
    if (low === 'batal' || low === '/batal') {
      updateSesi(userId, { soSearchMode: false, soSearchInRak: null });
      // Redirect balik ke edit rak
      await kirim(chatId, '🔙 Batal, kembali ke edit rak.');
      // Trigger callback editrak
      const items = getBarangDiRak(tokoKode, rakName);
      const total = Object.keys(items).length;
      await kirim(chatId,
        `✏️ *EDIT RAK: ${rakName}*\n${GARIS_TEBAL}\n📦 Total: ${total} jenis barang\n\nKetik nama barang untuk cari, atau ketik *tampilkan* untuk lihat list lengkap.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '📋 Tampilkan List', callback_data: `so:editrak:${rakName}` }],
          [{ text: '🔙 Kembali', callback_data: 'so:kembali' }],
        ]}}
      );
      return;
    }
    
    if (low === 'tampilkan' || low === 'list' || low === 'lihat semua') {
      updateSesi(userId, { soSearchMode: false, soSearchInRak: null });
      // Trigger callback editrak langsung
      const items = getBarangDiRak(tokoKode, rakName);
      const itemList = Object.entries(items);
      
      if (itemList.length === 0) {
        await kirim(chatId, `📭 Rak ${rakName} kosong.`, { reply_markup: kbSOAktif() });
        return;
      }
      
      // Simulasikan callback editrak
      await kirim(chatId, 'Menampilkan list...', {
        reply_markup: { inline_keyboard: [
          [{ text: `📋 Buka List Edit ${rakName}`, callback_data: `so:editrak:${rakName}` }]
        ]}
      });
      return;
    }
    
    // Search item di rak
    const items = getBarangDiRak(tokoKode, rakName);
    const itemKodes = Object.keys(items);
    
    if (itemKodes.length === 0) {
      updateSesi(userId, { soSearchMode: false, soSearchInRak: null });
      await kirim(chatId, `📭 Rak ${rakName} kosong.`, { reply_markup: kbSOAktif() });
      return;
    }
    
    // Cari yang match
    const searchLower = message.toLowerCase().trim();
    const matches = [];
    
    itemKodes.forEach(kode => {
      const item = DATA_BARANG.find(d => d.kode === kode);
      const nama = (item?.nama || kode).toLowerCase();
      
      // Match by kode
      if (kode.toLowerCase().includes(searchLower)) {
        matches.push({ kode, item, matchType: 'kode' });
        return;
      }
      
      // Match by nama (any word)
      if (nama.includes(searchLower)) {
        matches.push({ kode, item, matchType: 'nama' });
        return;
      }
    });
    
    if (matches.length === 0) {
      await kirim(chatId,
        `❌ *Tidak ditemukan*\n\nItem "${escapeMd(message)}" tidak ada di rak ${rakName}.\n\nCoba kata lain, atau ketik *tampilkan* untuk lihat semua item.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '📋 Tampilkan Semua', callback_data: `so:editrak:${rakName}` }],
          [{ text: '🔙 Batal', callback_data: 'so:kembali' }],
        ]}}
      );
      return;
    }
  // ════════════ QUICK EDIT DENGAN DAFTAR HANYA TOMBOL ════════════
  
  if (data.startsWith('so:quickeditrak:')) {
    const parts = data.replace('so:quickeditrak:', '').split(':');
    const rakName = parts[0];
    const page = parts[1] ? parseInt(parts[1]) : 0;
    
    const session = getSesi(userId);
    const items = getBarangDiRak(session.tokoKode, rakName);
    const itemList = Object.entries(items);
    
    if (itemList.length === 0) {
      await kirim(chatId, `📭 Rak ${rakName} kosong.`, { reply_markup: kbSOAktif() });
      return;
    }
    
    // Sort abjad
    const sortedItems = itemList.map(([kode, itemData]) => {
      const item = DATA_BARANG.find(d => d.kode === kode);
      const nama = item?.nama || kode;
      let totalQty = 0;
      itemData.entries.forEach(e => totalQty += e.qty);
      return { kode, nama, totalQty };
    }).sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
    
    // Pagination: 40 tombol per halaman (mode ringkas)
    const ITEMS_PER_PAGE = 40;
    const totalPages = Math.ceil(sortedItems.length / ITEMS_PER_PAGE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIdx = currentPage * ITEMS_PER_PAGE;
    const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, sortedItems.length);
    const pageItems = sortedItems.slice(startIdx, endIdx);
    
    const m = `⚡ *QUICK EDIT: ${rakName}*\n${GARIS_TEBAL}\n` +
              `📦 ${sortedItems.length} item ${totalPages > 1 ? `| Hal ${currentPage + 1}/${totalPages}` : ''}\n\n` +
              `_Tap tombol untuk edit langsung_`;
    
    const buttons = [];
    pageItems.forEach((si, i) => {
      const globalIdx = startIdx + i + 1;
      buttons.push([{
        text: `${globalIdx}. ${si.nama.substring(0, 40)} [${si.totalQty}]`,
        callback_data: `so:edititem:${rakName}:${si.kode}`
      }]);
    });
    
    // Navigasi
    if (totalPages > 1) {
      const nav = [];
      if (currentPage > 0) nav.push({ text: '⬅️', callback_data: `so:quickeditrak:${rakName}:${currentPage - 1}` });
      nav.push({ text: `${currentPage + 1}/${totalPages}`, callback_data: `so:pageinfo:${rakName}:${currentPage}` });
      if (currentPage < totalPages - 1) nav.push({ text: '➡️', callback_data: `so:quickeditrak:${rakName}:${currentPage + 1}` });
      buttons.push(nav);
    }
    
    buttons.push([
      { text: '📋 View Detail', callback_data: `so:editrak:${rakName}:0` },
      { text: '🔍 Cari Item', callback_data: `so:searchinrak:${rakName}` },
    ]);
    buttons.push([{ text: '🔙 Kembali', callback_data: 'so:kembali' }]);
    
    await kirim(chatId, m, { reply_markup: { inline_keyboard: buttons }});
    return;
  }

    
    // Kalau ketemu, langsung tampilkan
    updateSesi(userId, { soSearchMode: false, soSearchInRak: null });
    
    if (matches.length === 1) {
      // 1 match → langsung buka edit item
      const match = matches[0];
      const item = match.item;
      const nama = item?.nama || match.kode;
      const itemData = items[match.kode];
      
      let totalQty = 0;
      itemData.entries.forEach(e => totalQty += e.qty);
      
      let m = `✏️ *EDIT ITEM (found!)*\n${GARIS_TEBAL}\n`;
      m += `📦 ${escapeMd(nama)}\n📍 Rak: ${rakName}\n📊 Total: ${totalQty}\n\n`;
      
      const buttons = [];
      itemData.entries.forEach((entry, i) => {
        m += `${i+1}. *${entry.namaPetugas}* | ${entry.jenis} | Qty: *${entry.qty}*\n   ⏰ ${entry.jamInput}\n\n`;
        buttons.push([
          { text: `✏️ Edit #${i+1} (${entry.qty})`, callback_data: `so:editentry:${rakName}:${match.kode}:${i}` },
        ]);
      });
      
      buttons.push([{ text: '🗑️ Hapus Semua', callback_data: `so:hapusitem:${rakName}:${match.kode}` }]);
      buttons.push([{ text: '🔙 Kembali ke Rak', callback_data: `so:editrak:${rakName}` }]);
      
      await kirim(chatId, m, { reply_markup: { inline_keyboard: buttons }});
      return;
    }
    
    // Multiple matches → tampilkan pilihan
    let m = `🔍 *${matches.length} item ditemukan di ${rakName}:*\n${GARIS_TEBAL}\n\n`;
    const buttons = [];
    
    matches.slice(0, 15).forEach((match, i) => {
      const nama = match.item?.nama || match.kode;
      const itemData = items[match.kode];
      let totalQty = 0;
      itemData.entries.forEach(e => totalQty += e.qty);
      
      m += `*${i+1}. ${escapeMd(nama)}*\n`;
      m += `   🔖 \`${match.kode}\` | 📊 ${totalQty}\n\n`;
      
      buttons.push([{
        text: `✏️ ${i+1}. ${nama} (${totalQty})`,
        callback_data: `so:edititem:${rakName}:${match.kode}`
      }]);
    });
    
    if (matches.length > 15) {
      m += `_... +${matches.length - 15} lainnya. Coba cari lebih spesifik._\n`;
    }
    
    buttons.push([{ text: '📋 Lihat Semua Item', callback_data: `so:editrak:${rakName}` }]);
    buttons.push([{ text: '🔙 Kembali', callback_data: 'so:kembali' }]);
    
    await kirim(chatId, m, { reply_markup: { inline_keyboard: buttons }});
    return;
  }
  
  if (session.pendingBarangKode) {
    const kode = session.pendingBarangKode;
    const item = DATA_BARANG.find(d => d.kode === kode);
    if (!item) { updateSesi(userId, { pendingBarangKode: null }); return; }
    
    const match = message.trim().match(/^(toko|fisik|gudang)\s+(\d+)$/i);
    if (!match) {
      const angka = message.replace(/[^0-9]/g, '');
      if (angka) return kirim(chatId, `⚠️ Ketik:\n• \`TOKO ${angka}\`\n• \`GUDANG ${angka}\``);
      return;
    }
    
    const jenis = match[1].toLowerCase();
    const jumlah = parseInt(match[2]);
    const jenisKey = (jenis === 'toko' || jenis === 'fisik') ? 'fisik' : 'gudang';
    const namaPetugas = soInfo.petugas[0] || getNama(userId) || 'User';
    
    tambahQtyItemSO(tokoKode, soInfo.rakAktif, kode, userId, namaPetugas, jumlah, jenisKey);
    updateSesi(userId, { pendingBarangKode: null });
    
    const totalAll = getTotalBarangSemuaRak(tokoKode, kode);
    const stockSistem = item.harga[tokoKode]?.stok || 0;
    const selisih = totalAll.total - stockSistem;
    const statusIcon = selisih === 0 ? '✅' : selisih > 0 ? '➕' : '➖';
    
    let msgK = `✅ *Tersimpan!*\n${GARIS_TEBAL}\n`;
    msgK += `📦 ${escapeMd(item.nama)}\n📍 ${soInfo.rakAktif} | ${jenisKey === 'fisik' ? '🏪' : '🏭'} ${jenisKey} +${jumlah}\n`;
    msgK += `👤 ${namaPetugas} ⏰ ${getJamSekarang()}\n\n`;
    
    // Breakdown per rak
    if (totalAll.raks.length > 1) {
      msgK += `📊 *Per rak:*\n`;
      totalAll.raks.forEach(r => {
        msgK += `   📦 ${r.rak}: 🏪 ${r.totalFisik} 🏭 ${r.totalGudang} = ${r.total}\n`;
      });
      msgK += '\n';
    }
    
    msgK += `💻 Sistem: ${stockSistem}\n📊 Total Opname: ${totalAll.total}\n${statusIcon} Selisih: ${selisih}\n`;
    
    await kirim(chatId, msgK, { reply_markup: kbSOAktif() });
    return;
  }
  
  // ════════ CARI BARANG ════════
  
  if (message && message.length >= 2) {
    const exactItem = DATA_BARANG.find(d => d.kode === message.trim().toUpperCase());
    if (exactItem) {
      updateSesi(userId, { pendingBarangKode: exactItem.kode });
      await kirim(chatId, tampilkanBarangPilihan(exactItem, tokoKode, userId, soInfo.rakAktif));
      return;
    }
    
    const hasil = cariBarang(message);
    if (hasil.hasil.length === 1) {
      updateSesi(userId, { pendingBarangKode: hasil.hasil[0].kode });
      await kirim(chatId, tampilkanBarangPilihan(hasil.hasil[0], tokoKode, userId, soInfo.rakAktif));
      return;
    }
    
        if (hasil.hasil.length > 0) {
      // SORT ABJAD
      const sortedHasil = [...hasil.hasil].sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
      
      let m = `🔍 *${sortedHasil.length} ditemukan (A-Z):*\n${GARIS_TEBAL}\n\n`;
      const buttons = [];
      sortedHasil.slice(0, 10).forEach((d, i) => {
        const totalAll = getTotalBarangSemuaRak(tokoKode, d.kode);
        const adaDiTempatlain = totalAll.total > 0;
        m += `*${i+1}. ${escapeMd(d.nama)}*\n   🔖 \`${d.kode}\` | Sistem: ${d.harga[tokoKode]?.stok || 0}`;
        if (adaDiTempatlain) m += ` | SO: ${totalAll.total}`;
        m += '\n\n';
        // NAMA LENGKAP di tombol (tanpa potong)
        buttons.push([{
          text: `${adaDiTempatlain ? '⚠️ ' : ''}${i+1}. ${d.nama}`,
          callback_data: `so:pick:${d.kode}`
        }]);
      });
      buttons.push([{ text: '🔙 Batal', callback_data: 'so:kembali' }]);
      await kirim(chatId, m, { reply_markup: { inline_keyboard: buttons }});
      return;
    }
    
    await kirim(chatId, `❌ "${message}" tidak ditemukan.`);
  }
}

function kbSOAktif() {
  return { inline_keyboard: [
    [
      { text: '👥 User Lain', callback_data: 'so:userlain' },
      { text: '📊 Review', callback_data: 'so:review' },
    ],
    [
      { text: '📦 Pindah Rak', callback_data: 'so:pindahrak' },
      { text: '✏️ Edit Rak', callback_data: 'so:editrak' },
    ],
    [
      { text: '📊 Export Gabungan', callback_data: 'so:exportgabungan' },
      { text: '✅ Selesai', callback_data: 'so:selesai' },
    ],
  ]};
}

// ════════════════════════════════════════════════════════════════
//   28. BERITA ACARA HANDLER
// ════════════════════════════════════════════════════════════════

function parseBAInput(sectionNo, text) {
  const parts = text.split('|').map(p => p.trim());
  if (sectionNo === 1 || sectionNo === 2 || sectionNo === 3) {
    if (parts.length < 2) return null;
    if (!parts[0] || !parts[1]) return null;
    return { nama: parts[0], qty: parts[1], keterangan: parts[2] || '' };
  }
  if (sectionNo === 4) {
    if (parts.length < 5) return null;
    return { noNota: parts[0], namaBarang: parts[1], qty: parts[2], namaBarangTukar: parts[3], qtyTukar: parts[4], keterangan: parts[5] || '' };
  }
  if (sectionNo === 5) {
    if (parts.length < 4) return null;
    return { namaBarang: parts[0], qtyNota: parts[1], fisikMasuk: parts[2], qtyMasuk: parts[3], keterangan: parts[4] || '' };
  }
  if (sectionNo === 6) {
    if (parts.length < 4) return null;
    return { namaBarang: parts[0], qtyAwal: parts[1], rubahKoreksi: parts[2], qtyKoreksi: parts[3], keterangan: parts[4] || '' };
  }
  return null;
}

async function handleBeritaAcaraMode(chatId, userId, message, session) {
  const low = (message || '').toLowerCase().trim();
  const tokoKode = session.tokoKode;
  const namaToko = NAMA_TOKO[tokoKode];
  const baData = session.baData;
  
  if (low === 'batal' || low === '/batal') {
    resetSesi(userId);
    await kirim(chatId, '✅ Berita Acara dibatalkan.', { reply_markup: kbMainMenu(userId) });
    return;
  }
  
  if (low === 'kembali' || low === 'menu') {
    updateSesi(userId, { baSection: null });
    await kirim(chatId, 
      `📋 *MENU BERITA ACARA*\n🏦 ${namaToko}\n🆔 ${baData.nomorBA}`,
      { reply_markup: kbBaSection(baData) }
    );
    return;
  }
  
  if (low === 'review') {
    const sections = [
      { no: 1, title: '📥 PENAMBAHAN STOK KASIR', field: 'penambahanKasir' },
      { no: 2, title: '➕ PENYESUAIAN TAMBAH', field: 'penyesuaianTambah' },
      { no: 3, title: '➖ PENYESUAIAN KURANGI', field: 'penyesuaianKurang' },
      { no: 4, title: '🔄 SALAH KETIK/RETUR', field: 'salahKetikRetur' },
      { no: 5, title: '📦 BARANG MASUK', field: 'barangMasuk' },
      { no: 6, title: '✏️ DICORET GUDANG', field: 'dicoretGudang' },
    ];
    
    let m = `📊 *REVIEW BERITA ACARA*\n🏦 ${namaToko}\n🆔 ${baData.nomorBA}\n${GARIS_TEBAL}\n\n`;
    let total = 0;
    sections.forEach(s => {
      const items = baData[s.field] || [];
      if (items.length === 0) return;
      total += items.length;
      m += `${s.title} (${items.length})\n`;
      items.slice(0, 3).forEach((item, i) => {
        const nama = item.nama || item.namaBarang || '-';
        m += `${i+1}. ${escapeMd(nama.substring(0, 35))}\n`;
      });
      if (items.length > 3) m += `_... +${items.length - 3}_\n`;
      m += '\n';
    });
    if (total === 0) m += '_Belum ada data_';
    else m += `${GARIS_TEBAL}\n📊 TOTAL: ${total} item`;
    
    await kirim(chatId, m, {
      reply_markup: { inline_keyboard: [[
        { text: '✅ Selesai', callback_data: 'ba:selesai' },
        { text: '🔙 Menu BA', callback_data: 'ba:menu' },
      ]]}
    });
    return;
  }
  
  if (low === 'selesai' || low === 'export') {
    const total = ['penambahanKasir','penyesuaianTambah','penyesuaianKurang','salahKetikRetur','barangMasuk','dicoretGudang']
      .reduce((sum, f) => sum + (baData[f]?.length || 0), 0);
    
    if (total === 0) {
      await kirim(chatId, '⚠️ Belum ada data. Input dulu!');
      return;
    }
    
    await kirim(chatId, '📊 _Membuat Excel..._');
    try {
      const excelPath = await generateExcelBA(baData, tokoKode, namaToko);
      await bot.sendDocument(chatId, excelPath, {}, {
        filename: `${baData.nomorBA}_${tokoKode.toUpperCase()}.xlsx`,
      });
      simpanBeritaAcara(tokoKode, baData);
      try { fs.unlinkSync(excelPath); } catch(e) {}
      resetSesi(userId);
      await kirim(chatId, `✅ *Berita Acara selesai!*\n🆔 ${baData.nomorBA}\n📥 File Excel terkirim.`, { reply_markup: kbMainMenu(userId) });
    } catch(err) {
      log.error('BA-EXCEL', err.message);
      await kirim(chatId, '❌ Gagal buat Excel: ' + err.message);
    }
    return;
  }
  
  // BA Scan Keterangan Input
  if (session.baInputKeterangan && session.baScanPending) {
    const sectionField = {
      1: 'penambahanKasir', 2: 'penyesuaianTambah', 3: 'penyesuaianKurang',
    }[session.baSection];
    
    if (!sectionField) return;
    
    const idx = session.baScanIndex;
    const item = session.baScanPending[idx];
    const keterangan = message.toLowerCase().trim() === 'skip' ? '' : message.trim();
    
    if (!session.baData[sectionField]) session.baData[sectionField] = [];
    session.baData[sectionField].push({
      nama: item.nama,
      qty: `${item.qty} ${item.satuan}`,
      keterangan: keterangan,
    });
    
    const nextIdx = idx + 1;
    
    if (nextIdx < session.baScanPending.length) {
      const nextItem = session.baScanPending[nextIdx];
      updateSesi(userId, { baData: session.baData, baScanIndex: nextIdx });
      
      await kirim(chatId,
        `✅ Tersimpan: ${escapeMd(item.nama.substring(0, 30))}\n${GARIS_TIPIS}\n\n` +
        `📝 *Item ${nextIdx + 1} dari ${session.baScanPending.length}:*\n` +
        `📦 ${escapeMd(nextItem.nama)}\n📊 ${nextItem.qty} ${nextItem.satuan}\n\n` +
        `💬 Ketik keterangan atau *skip*`
      );
      return;
    }
    
    const totalScan = session.baScanPending.length;
    updateSesi(userId, {
      baData: session.baData,
      baScanPending: null,
      baScanIndex: 0,
      baInputKeterangan: null,
    });
    
    await kirim(chatId,
      `🎉 *Selesai input keterangan!*\n${GARIS_TEBAL}\n\n` +
      `✅ ${totalScan} item tersimpan ke section ${session.baSection}\n` +
      `📊 Total section: *${session.baData[sectionField].length} item*`,
      { reply_markup: { inline_keyboard: [[
        { text: '🔙 Menu BA', callback_data: 'ba:menu' },
        { text: '📊 Review', callback_data: 'ba:review' },
      ]]}}
    );
    return;
  }
  
  // Input data section manual
  if (session.baSection && message) {
    const sectionField = {
      1: 'penambahanKasir', 2: 'penyesuaianTambah', 3: 'penyesuaianKurang',
      4: 'salahKetikRetur', 5: 'barangMasuk', 6: 'dicoretGudang',
    }[session.baSection];
    
    const parsed = parseBAInput(session.baSection, message);
    if (!parsed) {
      await kirim(chatId, `⚠️ *Format salah*\n\nGunakan \`|\` sebagai pemisah.\nLihat format dengan klik tombol section.`);
      return;
    }
    
    if (!baData[sectionField]) baData[sectionField] = [];
    baData[sectionField].push(parsed);
    updateSesi(userId, { baData });
    
    let k = `✅ *Item tersimpan!*\n${GARIS_TIPIS}\n`;
    Object.entries(parsed).forEach(([key, val]) => { if (val) k += `${key}: ${val}\n`; });
    k += `${GARIS_TIPIS}\n📊 Total section: *${baData[sectionField].length}*`;
    
    await kirim(chatId, k, {
      reply_markup: { inline_keyboard: [[
        { text: '🔙 Menu BA', callback_data: 'ba:menu' },
        { text: '📊 Review', callback_data: 'ba:review' },
      ]]}
    });
  }
}

// ════════════════════════════════════════════════════════════════
//   29. WIZARD HARGA HANDLER
// ════════════════════════════════════════════════════════════════

async function kirimMintaFotoHarga(chatId, stepIdx, namaToko, hargaData) {
  const KATEGORI = [
    { key: 'baru', label: 'BARANG BARU', icon: '🆕' },
    { key: 'naik', label: 'BARANG NAIK HARGA', icon: '📈' },
    { key: 'turun', label: 'BARANG TURUN HARGA', icon: '📉' },
  ];
  const cat = KATEGORI[stepIdx];
  if (!cat) return;
  
  const currentList = hargaData[cat.key] || [];
  let m = `🤖 *INPUT LAPORAN HARGA*\n🏦 ${namaToko}\n${GARIS_TEBAL}\n`;
  m += `📊 Step ${stepIdx + 1}/3\n\n${cat.icon} *${cat.label}*\n\n`;
  m += `📸 Kirim FOTO atau ketik manual (1 nama per baris)\n`;
  if (currentList.length > 0) {
    m += `\n✅ Sudah terisi (${currentList.length}):\n`;
    currentList.slice(0, 5).forEach(item => m += `• ${toTitleCase(item)}\n`);
  }
  
  await kirim(chatId, m, {
    reply_markup: { inline_keyboard: [
      [{ text: '⏭️ Skip Kategori', callback_data: 'harga:lanjut' }],
      [{ text: '✅ Selesai Sekarang', callback_data: 'harga:selesai' }],
      [{ text: '🔙 Batal', callback_data: 'menu:main' }],
    ]}
  });
}

async function finalisasiLaporanHarga(chatId, userId, hargaData, namaToko, kemarin) {
  const total = (hargaData.baru?.length || 0) + (hargaData.naik?.length || 0) + (hargaData.turun?.length || 0);
  if (total === 0) {
    await kirim(chatId, '⚠️ Tidak ada data!');
    resetSesi(userId);
    return;
  }
  
  if (!namaToko || namaToko === 'undefined') {
    const session = getSesi(userId);
    namaToko = NAMA_TOKO[session.toko] || NAMA_TOKO[session.tokoKode] || 'Toko';
  }
  
  const laporan = genLapHargaDariData(hargaData, namaToko, kemarin);
  
  await kirim(chatId, 
    `📄 *Laporan siap!*\n${GARIS_TEBAL}\n\n` +
    `🏪 ${namaToko}\n` +
    `📦 Baru: ${hargaData.baru?.length || 0}\n` +
    `📈 Naik: ${hargaData.naik?.length || 0}\n` +
    `📉 Turun: ${hargaData.turun?.length || 0}`
  );
  
  await kirim(chatId, laporan);
  resetSesi(userId);
  await tunggu(1500);
  await kirim(chatId, '✅ *Laporan harga selesai!*', { reply_markup: kbMainMenu(userId) });
}

async function handleHargaMode(chatId, userId, message, imageBuffer, session) {
  const low = (message || '').toLowerCase().trim();
  let namaToko = NAMA_TOKO[session.toko] || NAMA_TOKO[session.tokoKode];
  
  if (!namaToko) {
    await kirim(chatId, '⚠️ Session error. Mulai ulang.', { reply_markup: kbMainMenu(userId) });
    resetSesi(userId);
    return;
  }
  
  const kemarin = session.kemarin || false;
  const hargaData = session.hargaData || { baru: [], naik: [], turun: [] };
  
  if (low === 'batal' || low === '/batal') {
    resetSesi(userId);
    await kirim(chatId, '✅ Dibatalkan.', { reply_markup: kbMainMenu(userId) });
    return;
  }
  
  // MODE GABUNG
  if (session.hargaMode === 'GABUNG') {
    if (low === 'selesai') {
      await finalisasiLaporanHarga(chatId, userId, hargaData, namaToko, kemarin);
      return;
    }
    
    if (!imageBuffer) {
      await kirim(chatId, `📸 Kirim 1 foto berisi semua kategori barang.\n\n🏪 ${namaToko}\n\nKetik *batal* untuk keluar.`);
      return;
    }
    
    await kirim(chatId, '🤖 _Sedang scan semua kategori (bisa 30-60 detik)..._');
    
    try {
      const promptGabung = `Kamu AI yang ahli baca foto laporan toko perabot.

⚠️ INSTRUKSI WAJIB:
- Baca SEMUA barang di foto dengan TELITI
- JANGAN TERPOTONG! Kalau ada 50 barang, tulis SEMUA 50 barang
- JANGAN tulis "dan lain-lain" atau "dst"

Kelompokkan barang menjadi 3 kategori:

---baru---
- Nama Barang 1
- (tulis SEMUA barang baru)

---naik---
- Nama Barang 1
- (tulis SEMUA barang naik)

---turun---
- Nama Barang 1
- (tulis SEMUA barang turun)

ATURAN:
- Hanya tulis NAMA BARANG (tanpa harga)
- Awali "- " (dash spasi)
- Kategori kosong tetap tulis header
- Title Case nama barang
- Singkatan/kode HURUF BESAR

Sekarang baca SEMUA isi foto:`;
      
      const aiText = await analisaGambarBuffer(imageBuffer, promptGabung);
      
      const hasilParse = { baru: [], naik: [], turun: [] };
      let mode = null;
      aiText.split('\n').forEach(line => {
        const tr = line.trim();
        const lo = tr.toLowerCase();
        if (lo.includes('---baru---') || lo === 'baru' || lo === 'baru:') { mode = 'baru'; return; }
        if (lo.includes('---naik---') || lo === 'naik' || lo === 'naik:') { mode = 'naik'; return; }
        if (lo.includes('---turun---') || lo === 'turun' || lo === 'turun:') { mode = 'turun'; return; }
        if (mode && tr) {
          const item = tr.replace(/^[-*•]\s*/, '').trim();
          if (item && item.length > 2 && !item.toLowerCase().includes('dst') && !item.toLowerCase().includes('dan lain')) {
            hasilParse[mode].push(item);
          }
        }
      });
      
      const totalItem = hasilParse.baru.length + hasilParse.naik.length + hasilParse.turun.length;
      if (totalItem === 0) {
        await kirim(chatId, '⚠️ Tidak ada barang terdeteksi. Coba foto lebih jelas.');
        return;
      }
      
      updateSesi(userId, { hargaData: hasilParse });
      
      await kirim(chatId,
        `✅ *Scan selesai!*\n🏪 ${namaToko}\n🆕 Baru: ${hasilParse.baru.length}\n📈 Naik: ${hasilParse.naik.length}\n📉 Turun: ${hasilParse.turun.length}\n📦 Total: ${totalItem} item`
      );
      
      const rekap = genLapHargaDariData(hasilParse, namaToko, kemarin);
      await kirim(chatId, rekap);
      
      await kirim(chatId, '💡 Ketik *selesai* untuk simpan atau kirim foto lagi.',
        { reply_markup: { inline_keyboard: [[
          { text: '✅ Selesai & Simpan', callback_data: 'harga:selesai' },
          { text: '🔙 Batal', callback_data: 'menu:main' },
        ]]}}
      );
    } catch(err) {
      log.error('HARGA_GABUNG', err.message);
      await kirim(chatId, '❌ Gagal scan: ' + err.message);
    }
    return;
  }
  
  // MODE PER KATEGORI
  const KATEGORI = ['baru', 'naik', 'turun'];
  const NAMA_KAT = { baru: 'BARANG BARU', naik: 'BARANG NAIK HARGA', turun: 'BARANG TURUN HARGA' };
  const hargaStepIdx = session.hargaStepIdx || 0;
  
  if (hargaStepIdx >= KATEGORI.length) {
    await finalisasiLaporanHarga(chatId, userId, hargaData, namaToko, kemarin);
    return;
  }
  
  const currentKat = KATEGORI[hargaStepIdx];
  
  if (low === 'selesai') {
    await finalisasiLaporanHarga(chatId, userId, hargaData, namaToko, kemarin);
    return;
  }
  
  if (low === 'lanjut' || low === 'skip') {
    const nextIdx = hargaStepIdx + 1;
    updateSesi(userId, { hargaStepIdx: nextIdx });
    if (nextIdx >= KATEGORI.length) {
      await finalisasiLaporanHarga(chatId, userId, hargaData, namaToko, kemarin);
    } else {
      await kirimMintaFotoHarga(chatId, nextIdx, namaToko, hargaData);
    }
    return;
  }
  
  // Proses foto per kategori
  if (imageBuffer) {
    await kirim(chatId, `📸 _Sedang scan ${NAMA_KAT[currentKat]} (bisa 30-60 detik)..._\n🏪 ${namaToko}`);
    try {
      const prompt = SCAN_PROMPTS[`barang_${currentKat}_only`];
      const aiText = await analisaGambarBuffer(imageBuffer, prompt);
      const listBaru = parseListBarang(aiText);
      
      if (listBaru.length === 0) {
        await kirim(chatId, '⚠️ Tidak ada barang terdeteksi. Coba foto lebih jelas atau ketik *lanjut*.');
        return;
      }
      
      const listLama = hargaData[currentKat] || [];
      const itemBaru = [];
      listBaru.forEach(item => {
        if (!listLama.some(x => x.toLowerCase() === item.toLowerCase())) {
          listLama.push(item);
          itemBaru.push(item);
        }
      });
      hargaData[currentKat] = listLama;
      updateSesi(userId, { hargaData });
      
      let m = `✅ *Berhasil Scan!*\n🏪 ${namaToko}\n${NAMA_KAT[currentKat]}\n📦 Baru: ${itemBaru.length} | Total: ${listLama.length}\n\n`;
      m += `*Sampel ${Math.min(itemBaru.length, 10)} item baru:*\n`;
      itemBaru.slice(0, 10).forEach(item => m += `• ${toTitleCase(item)}\n`);
      if (itemBaru.length > 10) m += `_... +${itemBaru.length - 10} item lainnya_\n`;
      
      await kirim(chatId, m, {
        reply_markup: { inline_keyboard: [
          [{ text: '📸 Tambah Foto Lagi (kategori ini)', callback_data: 'harga:samekat' }],
          [{ text: '⏭️ Lanjut Kategori Berikutnya', callback_data: 'harga:lanjut' }],
          [{ text: '✅ Selesai Semua', callback_data: 'harga:selesai' }],
        ]}
      });
    } catch(err) {
      await kirim(chatId, '❌ Gagal scan: ' + err.message);
    }
    return;
  }
  
  // Input manual
  if (message && message.length > 2) {
    const listLama = hargaData[currentKat] || [];
    const itemBaru = [];
    message.split('\n').forEach(line => {
      const item = line.trim().replace(/^[-*•]\s*/, '').trim();
      if (item && item.length > 2 && !listLama.some(x => x.toLowerCase() === item.toLowerCase())) {
        listLama.push(item);
        itemBaru.push(item);
      }
    });
    
    if (itemBaru.length === 0) {
      await kirim(chatId, '⚠️ Tidak ada item baru.');
      return;
    }
    
    hargaData[currentKat] = listLama;
    updateSesi(userId, { hargaData });
    await kirim(chatId, `✅ *${itemBaru.length} item ditambahkan!*\n🏪 ${namaToko}\nTotal ${NAMA_KAT[currentKat]}: ${listLama.length}`, {
      reply_markup: { inline_keyboard: [[
        { text: '⏭️ Lanjut Kategori', callback_data: 'harga:lanjut' },
        { text: '✅ Selesai Semua', callback_data: 'harga:selesai' },
      ]]}
    });
  }
}

// ════════════════════════════════════════════════════════════════
//   30. WIZARD LAPORAN PENJUALAN (SCAN FOTO MULTI-STEP)
// ════════════════════════════════════════════════════════════════

function formatKonfirmasiScan(hasilScan) {
  let m = '✅ *Data tersimpan:*\n';
  Object.keys(hasilScan).forEach(k => {
    const v = hasilScan[k] || 0;
    m += `   • ${k}: ${v === 0 ? 'Rp. -' : 'Rp. ' + v.toLocaleString('id-ID')}\n`;
  });
  return m.trim();
}

function msgMintaFotoLaporan(tokoKode, stepIdx, namaToko, dataWizard) {
  const steps = SCAN_STEPS[tokoKode];
  if (!steps || stepIdx >= steps.length) return null;
  const si = steps[stepIdx];
  const total = steps.length;
  const no = stepIdx + 1;
  
  let m = `🤖 *INPUT LAPORAN*\n🏦 ${namaToko}\n${GARIS_TEBAL}\n`;
  m += `📊 *Step ${no} dari ${total}*\n[`;
  const prog = Math.floor((no / total) * 10);
  for (let i = 0; i < 10; i++) m += i < prog ? '█' : '░';
  m += `] ${Math.round((no / total) * 100)}%\n${GARIS_TEBAL}\n\n`;
  
  let icon = '📋';
  if (si.scanField === 'ecer_only') icon = '🛒';
  else if (si.scanField === 'grosir_only') icon = '📦';
  else if (si.scanField === 'parkir_komputer') icon = '🅿️';
  else if (si.scanField === 'parkir_luar') icon = '🚗';
  else if (si.scanField === 'multi_promo') icon = '🎁';
  else if (si.scanField === 'multi') icon = '💰';
  else if (si.scanField === 'total_transaksi') icon = '💵';
  
  m += `${icon} *${si.label}*\n\n`;
  m += `📸 *Kirim FOTO* bagian ini\n   → Bot akan scan otomatis ✨\n\n`;
  m += `⌨️ Atau ketik angka manual\n`;
  
  if (si.fields.length > 1) {
    const subIdx = dataWizard._subField || 0;
    const fn = si.fields[subIdx];
    m += `   Field aktif: *${fn.toUpperCase()}*\n`;
    m += `   Sub-step: ${subIdx + 1}/${si.fields.length}\n`;
  }
  
  return m;
}

async function selesaikanLaporanPenjualan(chatId, userId, scanData, tokoKode, namaToko, kemarin) {
  const fields = ['k1','k2','k3','k4','total','tunai','debit','kredit','ecer','grosir','promo','promotunai','promodebit','promokredit','parkirkomputer','parkirluar'];
  fields.forEach(f => { if (scanData[f] === undefined) scanData[f] = 0; });
  
  const laporan = genLapPenjualan(scanData, kemarin, tokoKode);
  await kirim(chatId, laporan);
  resetSesi(userId);
  await tunggu(1500);
  await kirim(chatId, '✅ *Laporan berhasil dibuat!* 😊', { reply_markup: kbMainMenu(userId) });
}

async function simpanDanLanjutScan(chatId, userId, scanData, stepIdx, tokoKode, namaToko, kemarin, hasilScan) {
  Object.assign(scanData, hasilScan);
  delete scanData._subField;
  
  const nextIdx = stepIdx + 1;
  const steps = SCAN_STEPS[tokoKode] || [];
  
  updateSesi(userId, { scanData, scanStepIdx: nextIdx });
  
  const konfirm = formatKonfirmasiScan(hasilScan);
  
  if (nextIdx >= steps.length) {
    await kirim(chatId, konfirm + '\n\n🎉 *Semua bagian sudah lengkap!*\nMembuat laporan...');
    await tunggu(1000);
    await selesaikanLaporanPenjualan(chatId, userId, scanData, tokoKode, namaToko, kemarin);
  } else {
    const pesanBerikut = msgMintaFotoLaporan(tokoKode, nextIdx, namaToko, scanData);
    await kirim(chatId, konfirm + '\n\n' + pesanBerikut);
  }
}

async function handleScanModeLaporan(chatId, userId, message, imageBuffer, session) {
  const scanData = session.scanData || {};
  const scanStepIdx = session.scanStepIdx || 0;
  const toko = session.toko;
  const kemarin = session.kemarin;
  const namaToko = NAMA_TOKO[toko] || toko;
  const steps = SCAN_STEPS[toko] || [];
  const si = steps[scanStepIdx] || null;
  const low = (message || '').toLowerCase().trim();
  
  if (!si) {
    await selesaikanLaporanPenjualan(chatId, userId, scanData, toko, namaToko, kemarin);
    return;
  }
  
  if (low === 'batal' || low === '/batal') {
    resetSesi(userId);
    await kirim(chatId, '✅ Dibatalkan.', { reply_markup: kbMainMenu(userId) });
    return;
  }
  
  // PROSES FOTO
  if (imageBuffer && imageBuffer.length > 0) {
    await kirim(chatId, `📸 _Sedang membaca foto step ${scanStepIdx + 1}..._`);
    
    try {
      const prompt = SCAN_PROMPTS[si.scanField];
      if (!prompt) throw new Error('Prompt tidak ditemukan');
      
      const aiText = await analisaGambarBuffer(imageBuffer, prompt);
      log.info('SCAN', `Step ${scanStepIdx + 1}: ${aiText.substring(0, 100)}`);
      
      let hasilScan = {};
      const SINGLE_FIELDS = ['total_transaksi','ecer_only','grosir_only','parkir_komputer','parkir_luar'];
      
      if (SINGLE_FIELDS.includes(si.scanField)) {
        const nilai = parseScanSingle(aiText);
        hasilScan[si.fields[0]] = nilai;
      } else {
        hasilScan = parseScanFlexible(aiText, si.fields);
      }
      
      const adaNilai = Object.values(hasilScan).some(v => v > 0);
      if (!adaNilai && aiText.length > 5) {
        const fallback = ambilAngka(aiText);
        if (fallback > 0 && si.fields.length === 1) {
          hasilScan[si.fields[0]] = fallback;
        }
      }
      
      await simpanDanLanjutScan(chatId, userId, scanData, scanStepIdx, toko, namaToko, kemarin, hasilScan);
    } catch(err) {
      log.error('SCAN_FOTO', err.message);
      await kirim(chatId,
        `❌ *Gagal membaca foto*\n${GARIS_TEBAL}\n\n` +
        `Penyebab: ${err.message}\n\n` +
        `*Solusi:*\n📸 Kirim ulang foto lebih jelas\n⌨️ Atau ketik angka manual\n\n` +
        `_Step ${scanStepIdx + 1}: ${si.label}_`
      );
    }
    return;
  }
  
  // INPUT MANUAL
  const isMulti = si.fields.length > 1;
  
  if (isMulti) {
    const subIdx = scanData._subField || 0;
    const currentField = si.fields[subIdx];
    
    let nominal = 0;
    if (message === '-' || low === 'kosong' || low === '0') {
      nominal = 0;
    } else {
      const angka = message.replace(/[^0-9]/g, '');
      if (!angka) {
        await kirim(chatId,
          `⚠️ Masukkan angka saja\nContoh: _15741500_\nAtau ketik *-* untuk nol\n📸 Atau kirim *foto*`
        );
        return;
      }
      nominal = parseInt(angka, 10);
    }
    
    scanData[currentField] = nominal;
    const fmtNom = nominal === 0 ? 'Rp. -' : 'Rp. ' + nominal.toLocaleString('id-ID');
    const nextSubIdx = subIdx + 1;
    
    if (nextSubIdx < si.fields.length) {
      scanData._subField = nextSubIdx;
      updateSesi(userId, { scanData });
      const nextField = si.fields[nextSubIdx];
      await kirim(chatId,
        `✅ _${currentField}: ${fmtNom}_\n\n` +
        `💰 Masukkan angka *${nextField.toUpperCase()}*\n   (angka atau *-* jika kosong)\n\n` +
        `📸 Atau kirim *foto*\n📊 Sub-step: ${nextSubIdx + 1}/${si.fields.length}`
      );
      return;
    }
    
    const hasilManual = {};
    si.fields.forEach(f => { hasilManual[f] = scanData[f] || 0; });
    delete scanData._subField;
    await simpanDanLanjutScan(chatId, userId, scanData, scanStepIdx, toko, namaToko, kemarin, hasilManual);
  } else {
    let nominal = 0;
    if (message === '-' || low === 'kosong' || low === '0') {
      nominal = 0;
    } else {
      const angka = message.replace(/[^0-9]/g, '');
      if (!angka) {
        await kirim(chatId, `⚠️ Masukkan angka saja\nContoh: _15741500_\n📸 Atau kirim *foto*`);
        return;
      }
      nominal = parseInt(angka, 10);
    }
    
    const hasilSingle = { [si.fields[0]]: nominal };
    await simpanDanLanjutScan(chatId, userId, scanData, scanStepIdx, toko, namaToko, kemarin, hasilSingle);
  }
}

// ════════════════════════════════════════════════════════════════
//   31. BERITA ACARA SCAN FOTO
// ════════════════════════════════════════════════════════════════

async function handleBaScanFoto(chatId, userId, imageBuffer, session) {
  const sectionNo = session.baSection;
  
  if (![1, 2, 3].includes(sectionNo)) {
    await kirim(chatId, '⚠️ Scan foto hanya untuk section 1, 2, atau 3.\nSection lain harus input manual.');
    return;
  }
  
  await kirim(chatId, '📸 _Sedang scan tabel iPos..._');
  
  try {
    const aiText = await analisaGambarBuffer(imageBuffer, SCAN_PROMPTS.ba_tabel);
    const items = parseBAJsonScan(aiText);
    
    if (items.length === 0) {
      await kirim(chatId,
        `⚠️ *Tidak ada data terdeteksi*\n${GARIS_TEBAL}\n\nPastikan foto jelas.\n\n📸 Kirim ulang atau ⌨️ ketik manual`
      );
      return;
    }
    
    updateSesi(userId, { baScanPending: items, baScanIndex: 0 });
    
    let m = `✅ *Berhasil Scan ${items.length} barang!*\n${GARIS_TEBAL}\n\n`;
    items.slice(0, 10).forEach((item, i) => {
      m += `${i+1}. ${escapeMd(item.nama)}\n   📦 ${item.qty} ${item.satuan}\n`;
    });
    if (items.length > 10) m += `\n_... +${items.length - 10} lainnya_\n`;
    m += `\n${GARIS_TEBAL}\n💬 *Pilihan:*`;
    
    await kirim(chatId, m, {
      reply_markup: { inline_keyboard: [
        [{ text: '📝 Isi Keterangan Satu-satu', callback_data: 'ba:scan:keterangan' }],
        [{ text: '⚡ Simpan Semua (Tanpa Keterangan)', callback_data: 'ba:scan:simpansemua' }],
        [{ text: '❌ Batal Scan', callback_data: 'ba:scan:batal' }],
      ]}
    });
  } catch(err) {
    log.error('BA_SCAN', err.message);
    await kirim(chatId, '❌ Gagal scan: ' + err.message);
  }
}
// ════════════════════════════════════════════════════════════════
//   31B. HOMEBASE - SCAN NOTA & BANDINGKAN HARGA SUPPLIER
//        (Multi-pass + Deep Match + Konversi + Pembulatan Cerdas)
// ════════════════════════════════════════════════════════════════

// ═══ PROMPT AI SUPER DETAIL ═══

const SCAN_PROMPT_HOMEBASE = `Kamu WAJIB baca tabel nota supplier dengan SANGAT DETAIL dan AKURAT.

⚠️ ATURAN MUTLAK:
- Setiap BARIS = 1 barang. Baca SATU PER SATU dari kiri ke kanan.
- JANGAN SKIP kolom apapun.
- JANGAN MENGARANG atau MENEBAK angka. Kalau tidak terbaca tulis 0.
- SETIAP ANGKA HARUS PERSIS seperti di gambar.
- BACA SAMPAI BARIS TERAKHIR.

CARA BACA PER BARIS (kiri ke kanan):
1. NAMA BARANG → Teks paling kiri, paling panjang. Tulis PERSIS seperti tertulis.
2. COL/ISI → Angka kecil setelah nama. ABAIKAN.
3. SAT (SATUAN) → PERHATIKAN BAIK-BAIK! Biasanya tertulis:
   - "pcs" = PCS (per buah)
   - "dz" = DZ (per lusin/dozen = 12 pcs)
   - "set" = SET
   - "lsn" = LSN (lusin)
   - BACA HURUFNYA TELITI! "dz" berbeda dengan "dx"!
   - "dx" BUKAN satuan! "DX" biasanya bagian dari NAMA barang.
4. SPOS → Simbol # atau -. ABAIKAN.
5. HPP → Angka PERTAMA setelah simbol #. Format: 326.470 → tulis 326470
6. Kolom A → Angka KEDUA. ABAIKAN.
7. Kolom B → Angka KETIGA. AMBIL INI! Tulis persis.
8. Kolom C → Angka KEEMPAT. ABAIKAN.
9. Kolom D → Angka TERAKHIR/PALING KANAN. AMBIL INI! Tulis persis.

⚠️ TIPS BACA ANGKA:
- Format Indonesia: 326.470 = 326470 (hapus titik)
- Kalau ada "N" atau "M" sebelum angka, abaikan huruf itu.
- Kalau ada coretan merah di atas angka hitam, baca yang PALING JELAS.

⚠️ TIPS BACA SATUAN:
- "pcs"/"dz"/"set"/"lsn" SELALU di kolom SAT
- JANGAN bingung dengan "DX" atau "LCS" yang merupakan bagian NAMA BARANG!
- Kolom SAT sempit (3-4 huruf saja)

CONTOH BENAR:
"Blender Cosmos CB 282 G Glass | 48 | pcs | # | - | 326.470 | 350.000 | 361.000 | 364.000 | 399.000"
→ {"nama":"BLENDER COSMOS CB 282 G GLASS","satuan":"PCS","hpp":326470,"hargaB":361000,"hargaD":399000}

"Eskan Pst Rivera M Putih 2246 P LCS | 12 | dz | # | # | 147.000 | 168.000 | 172.000 | 175.000 | 192.000"
→ {"nama":"ESKAN PST RIVERA M PUTIH 2246 P LCS","satuan":"DZ","hpp":147000,"hargaB":172000,"hargaD":192000}

"Meishing G 1199 Piring 9 Dalam Ulir Warna | ### | 8 | dz | # | # | 74.000 | 83.000 | 85.000 | 87.000 | 97.000"
→ {"nama":"MEISHING G 1199 PIRING 9 DALAM ULIR WARNA","satuan":"DZ","hpp":74000,"hargaB":85000,"hargaD":97000}

SEKARANG BACA GAMBAR. Output HANYA JSON array, tanpa penjelasan:
[{"nama":"...","satuan":"...","hpp":...,"hargaB":...,"hargaD":...}]`;

const SCAN_PROMPT_HOMEBASE_SIMPLE = `Baca tabel nota supplier. Setiap baris = 1 barang.

PER BARIS ambil:
1. Nama barang LENGKAP (teks paling kiri)
2. Satuan: BACA KOLOM SAT (pcs/dz/set/lsn). BUKAN DX/LCS!
3. HPP: angka PERTAMA setelah simbol #
4. Harga B: kolom ke-3 dari harga (kolom B)
5. Harga D: PALING KANAN (kolom D)

⚠️ PENTING:
- pcs/dz/set/lsn → BUKAN DX/LCS (itu nama barang)
- Angka HAPUS TITIK: 326.470 → 326470
- BACA SEMUA BARIS

Output JSON array:
[{"nama":"NAMA","satuan":"PCS","hpp":100000,"hargaB":120000,"hargaD":150000}]`;

// ═══ PARSER dengan VALIDASI SATUAN & HARGA ═══

function parseHomebaseScan(aiText) {
  if (!aiText) return [];
  try {
    let cleaned = aiText.trim()
      .replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    
    const jsonMatch = cleaned.match(/\[[\s\S]*\]/);
    if (!jsonMatch) { log.warn('HB-PARSE', 'No JSON. Raw: ' + cleaned.substring(0, 200)); return []; }
    
    let parsed;
    try { parsed = JSON.parse(jsonMatch[0]); }
    catch(e) {
      let fixed = jsonMatch[0].replace(/,\s*}/g, '}').replace(/,\s*\]/g, ']').replace(/'/g, '"');
      try { parsed = JSON.parse(fixed); }
      catch(e2) {
        const objects = jsonMatch[0].match(/\{[^{}]+\}/g) || [];
        parsed = [];
        objects.forEach(obj => { try { parsed.push(JSON.parse(obj)); } catch(ex) {} });
        if (!parsed.length) return [];
      }
    }
    
    if (!Array.isArray(parsed)) parsed = [parsed];
    
    const VALID_SATUAN = ['PCS','PC','DZ','DUZ','SET','LSN','LUSIN','BOX','PACK','PAK','UNIT','EA','BUAH','BIJI','GROSS','GRS','KODI','RIM'];
    
    return parsed.filter(i => i && (i.nama || i.name)).map(i => {
      let nama = String(i.nama || i.name || '').trim().toUpperCase();
      let satuan = String(i.satuan || i.sat || 'PCS').trim().toUpperCase();
      
      // Fix satuan salah baca
      const SATUAN_FIX = {
        'DY':'DZ','DS':'DZ','D2':'DZ','OZ':'DZ',
        'LN':'LSN','SFT':'SET','SEI':'SET',
        'PLCS':'PCS','PDCS':'PCS','DZLCS':'DZ',
      };
      if (SATUAN_FIX[satuan]) satuan = SATUAN_FIX[satuan];
      
      // Kalau satuan invalid, cek mungkin bagian nama
      if (!VALID_SATUAN.includes(satuan)) {
        log.warn('HB-PARSE', `Invalid satuan "${satuan}" for "${nama.substring(0, 30)}"`);
        if (['DX','LCS','NB','RG','WBS','WRG','BC','SSV','TCK'].includes(satuan)) {
          nama = nama + ' ' + satuan;
          satuan = 'PCS';
        } else {
          satuan = 'PCS';
        }
      }
      
      const hpp = parseInt(String(i.hpp || i.HPP || '0').replace(/[^0-9]/g, '')) || 0;
      let hargaB = parseInt(String(i.hargaB || i.harga_b || i.B || '0').replace(/[^0-9]/g, '')) || 0;
      let hargaD = parseInt(String(i.hargaD || i.harga_d || i.D || '0').replace(/[^0-9]/g, '')) || 0;
      
      // Validasi: D >= B (auto swap kalau terbalik)
      if (hargaB > 0 && hargaD > 0 && hargaB > hargaD) {
        log.warn('HB-PARSE', `B(${hargaB}) > D(${hargaD}) for ${nama.substring(0, 30)}, swap`);
        [hargaB, hargaD] = [hargaD, hargaB];
      }
      
      nama = nama.replace(/^[\s\-\/\\]+/, '').replace(/[\s\-\/\\]+$/, '').trim();
      
      return { nama, satuan, hpp, hargaB, hargaD };
    }).filter(i => i.nama.length >= 3);
  } catch(err) { log.error('HB-PARSE', err.message); return []; }
}

// ═══ PREPROCESS GAMBAR ═══

async function enhanceImageForOCR(imageBuffer) {
  try {
    const image = await Jimp.read(imageBuffer);
    const w = image.bitmap.width;
    if (w < 1500) image.resize(1500, Jimp.AUTO);
    else if (w > 3000) image.resize(2400, Jimp.AUTO);
    image.normalize().contrast(0.2);
    return await image.getBufferAsync(Jimp.MIME_JPEG);
  } catch(err) { return imageBuffer; }
}

// ═══ MULTI-PASS SCAN ═══

async function scanHomebaseMultiPass(imageBuffer) {
  let allItems = [];
  
  try {
    log.info('HB-SCAN', 'Attempt 1: Enhanced + Full');
    const enh = await enhanceImageForOCR(imageBuffer);
    const r1 = await analisaGambarBuffer(enh, SCAN_PROMPT_HOMEBASE);
    const i1 = parseHomebaseScan(r1);
    log.info('HB-SCAN', `A1: ${i1.length} items`);
    if (i1.length > allItems.length) allItems = i1;
  } catch(e) { log.warn('HB-SCAN', 'A1: ' + e.message); }
  
  if (allItems.length < 5) {
    try {
      log.info('HB-SCAN', 'Attempt 2: Original + Simple');
      const r2 = await analisaGambarBuffer(imageBuffer, SCAN_PROMPT_HOMEBASE_SIMPLE);
      const i2 = parseHomebaseScan(r2);
      log.info('HB-SCAN', `A2: ${i2.length} items`);
      if (i2.length > allItems.length) allItems = i2;
    } catch(e) { log.warn('HB-SCAN', 'A2: ' + e.message); }
  }
  
  if (allItems.length < 5) {
    try {
      log.info('HB-SCAN', 'Attempt 3: Enhanced + Simple');
      const enh = await enhanceImageForOCR(imageBuffer);
      const r3 = await analisaGambarBuffer(enh, SCAN_PROMPT_HOMEBASE_SIMPLE);
      const i3 = parseHomebaseScan(r3);
      log.info('HB-SCAN', `A3: ${i3.length} items`);
      if (i3.length > allItems.length) allItems = i3;
    } catch(e) { log.warn('HB-SCAN', 'A3: ' + e.message); }
  }
  
  log.info('HB-SCAN', `Final: ${allItems.length} items`);
  return allItems;
}

// ═══ KONVERSI SATUAN + PEMBULATAN CERDAS ═══

function getFaktorKonversi(satuan) {
  const sat = String(satuan || '').toUpperCase().trim();
  const k = {
    'DZ':12,'DUZ':12,'DUS':12,'LSN':12,'LUSIN':12,
    'GROSS':144,'GRS':144,'KODI':20,'RIM':500,
    'SET':1,'BOX':1,'PACK':1,'PAK':1,
    'PCS':1,'PC':1,'BUAH':1,'BIJI':1,'UNIT':1,'EA':1,
  };
  return k[sat] || 1;
}

function konversiHargaKePcs(item) {
  const f = getFaktorKonversi(item.satuan);
  
  if (f === 1) {
    return {
      ...item,
      hppPcs: item.hpp,
      hargaBPcs: item.hargaB,
      hargaDPcs: item.hargaD,
      hargaBPcsBulat: item.hargaB,
      hargaDPcsBulat: item.hargaD,
      faktorKonversi: 1,
      dikonversi: false,
    };
  }
  
  // Step 1: Bagi dan FLOOR (buang koma)
  const hppRaw = Math.floor(item.hpp / f);
  const hargaBRaw = Math.floor(item.hargaB / f);
  const hargaDRaw = Math.floor(item.hargaD / f);
  
  // Step 2: Bulatkan Harga D (Ecer) ke kelipatan 1000 KE ATAS
  const hargaDBulat = hargaDRaw > 0 ? Math.ceil(hargaDRaw / 1000) * 1000 : 0;
  
  // Step 3: Bulatkan Harga B (Grosir) ke kelipatan 500 KE ATAS
  const hargaBBulat = hargaBRaw > 0 ? Math.ceil(hargaBRaw / 500) * 500 : 0;
  
  return {
    ...item,
    hppPcs: hppRaw,
    hargaBPcs: hargaBRaw,
    hargaDPcs: hargaDRaw,
    hargaBPcsBulat: hargaBBulat,
    hargaDPcsBulat: hargaDBulat,
    faktorKonversi: f,
    dikonversi: true,
  };
}

// ═══ ULTRA DEEP MATCHING ═══

let DB_INDEX_CACHE = null;
let DB_INDEX_TIMESTAMP = 0;

function normalizeForMatch(str) {
  return String(str || '').toUpperCase()
    .replace(/[\\""''`]/g, ' ')
    .replace(/[.,;:!?()[\]{}]/g, ' ')
    .replace(/([A-Z0-9])[\-\/]([A-Z0-9])/g, '$1 $2')
    .replace(/\+/g, ' + ')
    .replace(/\s+/g, ' ').trim();
}

function extractAllNumbers(str) {
  const nums = new Set();
  const matches = str.match(/\d+/g) || [];
  matches.forEach(n => nums.add(n));
  return nums;
}

function extractAllWords(str) {
  const words = new Set();
  const tokens = normalizeForMatch(str).split(/\s+/);
  tokens.forEach(t => { if (/^[A-Z]+$/.test(t) && t.length >= 2) words.add(t); });
  return words;
}

function extractAllCodes(str) {
  const codes = new Set();
  const normalized = normalizeForMatch(str);
  const patterns = [
    /\b[A-Z]{2,5}\s*\d{2,6}\b/g,
    /\b[A-Z]+\d+[A-Z]*\b/g,
    /\b\d+[\-\/]\d+\b/g,
  ];
  patterns.forEach(p => {
    const matches = normalized.match(p) || [];
    matches.forEach(m => { codes.add(m.replace(/\s+/g, '')); codes.add(m); });
  });
  return codes;
}

function buildDatabaseIndex() {
  const now = Date.now();
  if (DB_INDEX_CACHE && (now - DB_INDEX_TIMESTAMP) < 300000) return DB_INDEX_CACHE;
  
  DB_INDEX_CACHE = DATA_BARANG.map(item => {
    const normalized = normalizeForMatch(item.nama);
    return {
      item, normalized,
      allNumbers: extractAllNumbers(item.nama),
      allWords: extractAllWords(item.nama),
      allCodes: extractAllCodes(item.nama),
      sortedString: normalized.split(/\s+/).sort().join(' '),
      compactString: normalized.replace(/\s+/g, ''),
    };
  });
  DB_INDEX_TIMESTAMP = now;
  return DB_INDEX_CACHE;
}

function resetDBIndex() { DB_INDEX_CACHE = null; }

function extractDeepSignature(str) {
  const normalized = normalizeForMatch(str);
  const tokens = normalized.split(/\s+/).filter(t => t);
  
  const sig = {
    raw: normalized,
    compact: normalized.replace(/\s+/g, ''),
    sorted: [...tokens].sort().join(' '),
    numbers: extractAllNumbers(str),
    words: extractAllWords(str),
    codes: extractAllCodes(str),
    plainWords: [], numericTokens: [], alphaNumeric: [],
    shortCodes: [], units: [], symbols: [],
  };
  
  tokens.forEach(t => {
    if (/^[+\/\-]+$/.test(t)) { sig.symbols.push(t); return; }
    if (/^\d+(L|CM|MM|ML|KG|G|INCH|W|WATT|LTR|PCS|M)$/i.test(t)) { sig.units.push(t); return; }
    if (/^\d+$/.test(t)) { sig.numericTokens.push(t); return; }
    if (/^\d+[\-\/]\d+$/.test(t)) { sig.numericTokens.push(t); return; }
    if (/^[A-Z]+\d+[A-Z]*$/.test(t)) { sig.alphaNumeric.push(t); return; }
    if (t.length <= 4 && /^[A-Z]+([\/][A-Z]+)*$/.test(t)) {
      sig.shortCodes.push(t);
      t.split('/').forEach(p => { if (p) sig.shortCodes.push(p); });
      return;
    }
    if (t.length >= 2 && /^[A-Z]+$/.test(t)) sig.plainWords.push(t);
  });
  
  return sig;
}

function scoreNumberMatch(notaNums, dbNums) {
  if (notaNums.size === 0 && dbNums.size === 0) return { score: 100, matched: 0, total: 0, hasNumberDiff: false };
  if (notaNums.size === 0) return { score: 50, matched: 0, total: dbNums.size, hasNumberDiff: false };
  
  let matched = 0;
  notaNums.forEach(n => { if (dbNums.has(n)) matched++; });
  const missing = notaNums.size - matched;
  const dbExtra = dbNums.size - matched;
  const hasNumberDiff = missing > 0 && matched > 0;
  
  if (matched === notaNums.size && matched === dbNums.size) return { score: 100, matched, total: notaNums.size, hasNumberDiff: false };
  const ratio = matched / Math.max(notaNums.size, dbNums.size);
  return { score: ratio * 100, matched, total: Math.max(notaNums.size, dbNums.size), hasNumberDiff: missing > 0 || dbExtra > 0 };
}

function scoreWordMatch(notaWords, dbWords) {
  if (notaWords.size === 0 && dbWords.size === 0) return { score: 100, matched: 0 };
  if (notaWords.size === 0) return { score: 50, matched: 0 };
  
  let matched = 0, fuzzyMatched = 0;
  notaWords.forEach(nw => {
    if (dbWords.has(nw)) { matched++; return; }
    for (const dw of dbWords) {
      if (nw.length >= 4 && dw.length >= 4) {
        if (nw.includes(dw) || dw.includes(nw)) { fuzzyMatched += 0.8; break; }
        const dist = levenshtein(nw, dw);
        if (dist <= 1) { fuzzyMatched += 0.9; break; }
        if (dist <= 2 && nw.length >= 5) { fuzzyMatched += 0.7; break; }
      }
    }
  });
  
  const total = Math.max(notaWords.size, dbWords.size);
  return { score: ((matched + fuzzyMatched) / total) * 100, matched: matched + fuzzyMatched };
}

function scoreCodeMatch(notaCodes, dbCodes) {
  if (notaCodes.size === 0 && dbCodes.size === 0) return { score: 100, matched: 0, hasNumberDiff: false };
  if (notaCodes.size === 0) return { score: 50, matched: 0, hasNumberDiff: false };
  
  let matched = 0, hasNumberDiff = false;
  notaCodes.forEach(nc => {
    if (dbCodes.has(nc)) { matched++; return; }
    const ncCompact = nc.replace(/\s+/g, '');
    for (const dc of dbCodes) {
      if (dc.replace(/\s+/g, '') === ncCompact) { matched++; return; }
    }
    const ncMatch = ncCompact.match(/^([A-Z]+)(\d+)/);
    if (ncMatch) {
      for (const dc of dbCodes) {
        const dcMatch = dc.replace(/\s+/g, '').match(/^([A-Z]+)(\d+)/);
        if (dcMatch && dcMatch[1] === ncMatch[1] && dcMatch[2] !== ncMatch[2]) hasNumberDiff = true;
      }
    }
  });
  
  const total = Math.max(notaCodes.size, dbCodes.size);
  return { score: (matched / total) * 100, matched, hasNumberDiff };
}

function scoreVariantMatch(notaSig, dbSig) {
  const nArr = [...notaSig.shortCodes];
  const dArr = [...dbSig.shortCodes];
  
  if (nArr.length === 0 && dArr.length === 0) return { score: 100, mismatch: false };
  if (nArr.length === 0) return { score: 60, mismatch: false };
  if (dArr.length === 0) return { score: 40, mismatch: true };
  
  const nSet = new Set(nArr), dSet = new Set(dArr);
  let matched = 0;
  nSet.forEach(n => { if (dSet.has(n)) matched++; });
  
  const total = Math.max(nSet.size, dSet.size);
  const mismatch = nSet.size !== dSet.size || matched < nSet.size;
  return { score: (matched / total) * 100, mismatch };
}

function matchBarangHomebase(namaNotaOri) {
  if (!namaNotaOri || !DATA_BARANG.length) return null;
  
  const dbIndex = buildDatabaseIndex();
  const notaSig = extractDeepSignature(namaNotaOri);
  const notaNormalized = normalizeForMatch(namaNotaOri);
  
  if (notaSig.numbers.size === 0 && notaSig.words.size === 0 && notaSig.codes.size === 0) return null;
  
  // EXACT MATCH
  const notaSorted = notaNormalized.split(/\s+/).sort().join(' ');
  const notaCompact = notaNormalized.replace(/\s+/g, '');
  
  for (const dbItem of dbIndex) {
    if (dbItem.normalized === notaNormalized || 
        dbItem.sortedString === notaSorted ||
        dbItem.compactString === notaCompact) {
      return { item: dbItem.item, matchScore: 100, matchType: 'exact', flags: [], details: {}, alternatives: [] };
    }
  }
  
  // DEEP SCORING
  const scored = [];
  
  dbIndex.forEach(dbItem => {
    const dbSig = extractDeepSignature(dbItem.item.nama);
    const numResult = scoreNumberMatch(notaSig.numbers, dbSig.numbers);
    const wordResult = scoreWordMatch(notaSig.words, dbSig.words);
    const codeResult = scoreCodeMatch(notaSig.codes, dbSig.codes);
    const variantResult = scoreVariantMatch(notaSig, dbSig);
    
    let finalScore = (numResult.score * 0.30) + (codeResult.score * 0.30) + 
                     (wordResult.score * 0.25) + (variantResult.score * 0.15);
    
    // PENALTIES
    if (numResult.hasNumberDiff && numResult.matched < notaSig.numbers.size) {
      const missingRatio = 1 - (numResult.matched / notaSig.numbers.size);
      finalScore *= (1 - missingRatio * 0.5);
    }
    if (codeResult.hasNumberDiff && codeResult.matched === 0) finalScore *= 0.6;
    if (variantResult.mismatch) finalScore *= 0.85;
    
    // BONUSES
    if (notaSig.sorted === dbSig.sorted && notaSig.sorted.length > 5) finalScore = Math.max(finalScore, 95);
    if (notaSig.compact === dbSig.compact && notaSig.compact.length > 5) finalScore = Math.max(finalScore, 95);
    
    const sim = 1 - (levenshtein(notaSig.compact, dbSig.compact) / Math.max(notaSig.compact.length, dbSig.compact.length));
    if (sim > 0.90) finalScore = Math.max(finalScore, 90);
    else if (sim > 0.80) finalScore = Math.max(finalScore, 80);
    
    if (numResult.matched === notaSig.numbers.size && 
        wordResult.matched >= notaSig.words.size * 0.8 && 
        codeResult.matched === notaSig.codes.size) {
      finalScore = Math.min(100, finalScore + 15);
    }
    
    finalScore = Math.round(Math.max(0, Math.min(100, finalScore)));
    
    if (finalScore >= 15) {
      scored.push({ item: dbItem.item, matchScore: finalScore, numResult, wordResult, codeResult, variantResult });
    }
  });
  
  if (!scored.length) return null;
  scored.sort((a, b) => b.matchScore - a.matchScore);
  
  const best = scored[0];
  const bestSig = extractDeepSignature(best.item.nama);
  
  const flags = [];
  if (best.numResult.hasNumberDiff && best.numResult.matched < notaSig.numbers.size) flags.push('angka-beda');
  if (best.codeResult.hasNumberDiff && best.codeResult.matched === 0) flags.push('kode-angka-beda');
  if (best.variantResult.mismatch) flags.push('variant-beda');
  
  const alternatives = [];
  for (let i = 1; i < scored.length && alternatives.length < 3; i++) {
    const cand = scored[i];
    if (cand.item.kode === best.item.kode) continue;
    const selisih = best.matchScore - cand.matchScore;
    if (cand.matchScore >= 40 || selisih <= 30) {
      alternatives.push({ item: cand.item, matchScore: cand.matchScore });
    }
  }
  
  return {
    item: best.item,
    matchScore: best.matchScore,
    matchType: best.matchScore >= 90 ? 'high' : best.matchScore >= 70 ? 'medium' : 'low',
    flags,
    details: {
      notaSuffixes: notaSig.shortCodes,
      dbSuffixes: bestSig.shortCodes,
      notaNumbers: [...notaSig.numbers],
      dbNumbers: [...bestSig.numbers],
    },
    alternatives,
  };
}

// Reset DB cache saat loadExcel
if (typeof loadExcel === 'function') {
  const _origLoadExcel = loadExcel;
  loadExcel = function() {
    const r = _origLoadExcel.apply(this, arguments);
    resetDBIndex();
    return r;
  };
}

// ═══ FORMAT PERBANDINGAN ═══

function formatPerbandinganHomebase(hasilBanding, tokoKode) {
  const namaToko = NAMA_TOKO[tokoKode] || 'Toko';
  let m = `🏠 *PERBANDINGAN HARGA HOMEBASE*\n🏦 ${namaToko}\n📅 ${getTanggalIndonesia()}\n${GARIS_TEBAL}\n\n`;
  let totalNaik = 0, totalTurun = 0, totalSama = 0, totalTidakMatch = 0, totalDikonversi = 0;
  
  hasilBanding.forEach((item, i) => {
    const konv = konversiHargaKePcs(item);
    if (konv.dikonversi) totalDikonversi++;
    
    m += `*${i+1}. ${escapeMd(item.namaNota)}*\n`;
    if (konv.dikonversi) m += `   📏 *${item.satuan}* (÷${konv.faktorKonversi} = per PCS)\n`;
    else m += `   📏 ${item.satuan}\n`;
    
    if (!item.matched) {
      totalTidakMatch++;
      m += `   ❌ _Tidak match_\n`;
      if (konv.dikonversi) {
        m += `   💰 HPP: ${formatRp(item.hpp)}/${item.satuan} = ${formatRp(konv.hppPcs)}/PCS\n`;
        m += `   B: ${formatRp(konv.hargaBPcsBulat)}/PCS | D: ${formatRp(konv.hargaDPcsBulat)}/PCS\n\n`;
      } else {
        m += `   💰 HPP: ${formatRp(item.hpp)} | B: ${formatRp(item.hargaB)} | D: ${formatRp(item.hargaD)}\n\n`;
      }
      return;
    }
    
    const db = item.matched;
    let matchIcon = db.matchScore >= 90 ? '✅' : db.matchScore >= 70 ? '🔗' : db.matchScore >= 50 ? '⚠️' : '❓';
    let warnText = db.matchScore < 70 ? ' _(perlu review)_' : '';
    
    m += `   ${matchIcon} → _${escapeMd(db.item.nama)}_ (${db.matchScore}%)${warnText}\n`;
    m += `   🔖 \`${db.item.kode}\`\n`;
    
    if (db.alternatives && db.alternatives.length > 0) {
      m += `   💡 *Alternatif mirip:*\n`;
      db.alternatives.forEach((alt, ai) => {
        const altIcon = alt.matchScore >= 70 ? '🔗' : '⚠️';
        m += `      ${altIcon} ${ai+1}. _${escapeMd(alt.item.nama)}_ (${alt.matchScore}%) \`${alt.item.kode}\`\n`;
      });
    }
    
    if (db.flags && db.flags.length > 0) {
      if (db.flags.includes('kode-angka-beda')) m += `   ⚠️ Kode angka BEDA!\n`;
      if (db.flags.includes('angka-beda')) m += `   ⚠️ Ada angka yang tidak cocok!\n`;
      if (db.flags.includes('variant-beda')) {
        const ns = db.details?.notaSuffixes || [], ds = db.details?.dbSuffixes || [];
        if (ns.length > 0 && ds.length === 0) m += `   ⚠️ Nota variant "${ns.join(', ')}" - Excel tidak\n`;
        else if (ds.length > 0 && ns.length === 0) m += `   ⚠️ Excel variant "${ds.join(', ')}" - Nota tidak\n`;
        else m += `   ⚠️ Variant: [${ns.join('/')}] vs [${ds.join('/')}]\n`;
      }
    }
    
    // HPP
    if (item.hpp > 0) {
      m += konv.dikonversi
        ? `   💰 HPP: ${formatRp(item.hpp)}/${item.satuan} → *${formatRp(konv.hppPcs)}/PCS*\n`
        : `   💰 HPP: ${formatRp(item.hpp)}\n`;
    }
    
    // ECER (D) - pakai harga BULAT (kelipatan 1000)
    const hargaEcer = db.item.harga[tokoKode]?.ecer || 0;
    if (konv.dikonversi && konv.hargaDPcsBulat > 0 && hargaEcer > 0) {
      const s = konv.hargaDPcsBulat - hargaEcer;
      const st = s === 0 ? '✅' : s > 0 ? '📈' : '📉';
      if (s > 0) totalNaik++; else if (s < 0) totalTurun++; else totalSama++;
      
      m += `   🏷️ Ecer: ${formatRp(item.hargaD)}/${item.satuan} ÷${konv.faktorKonversi} = ${formatRp(konv.hargaDPcs)} → *${formatRp(konv.hargaDPcsBulat)}*/PCS\n`;
      m += `      vs Excel: ${formatRp(hargaEcer)} ${st}${s !== 0 ? ` (${s>0?'+':''}${formatRp(s)})` : ''}\n`;
    } else if (!konv.dikonversi && konv.hargaDPcs > 0 && hargaEcer > 0) {
      const s = konv.hargaDPcs - hargaEcer;
      const st = s === 0 ? '✅' : s > 0 ? '📈' : '📉';
      if (s > 0) totalNaik++; else if (s < 0) totalTurun++; else totalSama++;
      m += `   🏷️ Ecer: ${formatRp(konv.hargaDPcs)} vs ${formatRp(hargaEcer)} ${st}${s !== 0 ? ` (${s>0?'+':''}${formatRp(s)})` : ''}\n`;
    }
    
    // GROSIR (B) - pakai harga BULAT (kelipatan 500)
    const hargaAmbil = db.item.harga[tokoKode]?.ambil || 0;
    if (konv.dikonversi && konv.hargaBPcsBulat > 0 && hargaAmbil > 0) {
      const s = konv.hargaBPcsBulat - hargaAmbil;
      const st = s === 0 ? '✅' : s > 0 ? '📈' : '📉';
      
      m += `   📦 Grosir: ${formatRp(item.hargaB)}/${item.satuan} ÷${konv.faktorKonversi} = ${formatRp(konv.hargaBPcs)} → *${formatRp(konv.hargaBPcsBulat)}*/PCS\n`;
      m += `      vs Excel: ${formatRp(hargaAmbil)} ${st}${s !== 0 ? ` (${s>0?'+':''}${formatRp(s)})` : ''}\n`;
    } else if (!konv.dikonversi && konv.hargaBPcs > 0 && hargaAmbil > 0) {
      const s = konv.hargaBPcs - hargaAmbil;
      const st = s === 0 ? '✅' : s > 0 ? '📈' : '📉';
      m += `   📦 Grosir: ${formatRp(konv.hargaBPcs)} vs ${formatRp(hargaAmbil)} ${st}${s !== 0 ? ` (${s>0?'+':''}${formatRp(s)})` : ''}\n`;
    }
    m += '\n';
  });
  
  m += `${GARIS_TEBAL}\n📊 *RINGKASAN:*\n📦 Total: ${hasilBanding.length}\n🔗 Match: ${hasilBanding.length - totalTidakMatch}\n❌ Tidak match: ${totalTidakMatch}\n🔄 Konversi (lusin→pcs): ${totalDikonversi}\n📈 NAIK: ${totalNaik} | 📉 TURUN: ${totalTurun} | ✅ SAMA: ${totalSama}\n`;
  return m;
}

// ═══ GENERATE EXCEL ═══

function generateExcelHomebase(hasilBanding, tokoKode) {
  const namaToko = NAMA_TOKO[tokoKode] || 'Toko';
  const rows = [];
  
  hasilBanding.forEach(item => {
    const konv = konversiHargaKePcs(item);
    const db = item.matched;
    const hargaEcer = db ? (db.item.harga[tokoKode]?.ecer || 0) : 0;
    const hargaAmbil = db ? (db.item.harga[tokoKode]?.ambil || 0) : 0;
    
    // Selisih pakai harga BULAT
    const notaEcerFinal = konv.dikonversi ? konv.hargaDPcsBulat : konv.hargaDPcs;
    const notaGrosirFinal = konv.dikonversi ? konv.hargaBPcsBulat : konv.hargaBPcs;
    const selisihEcer = notaEcerFinal > 0 && hargaEcer > 0 ? notaEcerFinal - hargaEcer : 0;
    const selisihAmbil = notaGrosirFinal > 0 && hargaAmbil > 0 ? notaGrosirFinal - hargaAmbil : 0;
    
    let warningNotes = '';
    if (db && db.flags) {
      if (db.flags.includes('kode-angka-beda')) warningNotes += 'KODE ANGKA BEDA! ';
      if (db.flags.includes('angka-beda')) warningNotes += 'ANGKA BEDA! ';
      if (db.flags.includes('variant-beda')) {
        const ns = db.details?.notaSuffixes || [], ds = db.details?.dbSuffixes || [];
        warningNotes += `Variant Nota[${ns.join('/')}] vs Excel[${ds.join('/')}] `;
      }
    }
    
    let altText = '';
    if (db && db.alternatives && db.alternatives.length > 0) {
      altText = db.alternatives.map(a => `${a.item.kode} - ${a.item.nama} (${a.matchScore}%)`).join(' | ');
    }
    
    rows.push({
      'Nama Barang (Nota)': item.namaNota,
      'Satuan': item.satuan,
      'Faktor': konv.faktorKonversi > 1 ? `÷${konv.faktorKonversi}` : '-',
      'Nama Barang (Excel)': db ? db.item.nama : 'TIDAK DITEMUKAN',
      'Kode': db ? db.item.kode : '-',
      'Match %': db ? db.matchScore + '%' : '0%',
      'Warning': warningNotes.trim(),
      'Alternatif Mirip': altText,
      'HPP Nota': item.hpp,
      'HPP/PCS': konv.hppPcs,
      'Harga B Nota': item.hargaB,
      'B/PCS (floor)': konv.hargaBPcs,
      'B/PCS (bulat 500)': konv.hargaBPcsBulat,
      'Harga D Nota': item.hargaD,
      'D/PCS (floor)': konv.hargaDPcs,
      'D/PCS (bulat 1000)': konv.hargaDPcsBulat,
      'Ecer Excel': hargaEcer,
      'Selisih Ecer': selisihEcer,
      'Status Ecer': (notaEcerFinal === 0 || hargaEcer === 0) ? '-' : selisihEcer === 0 ? 'SAMA' : selisihEcer > 0 ? 'NAIK' : 'TURUN',
      'Ambil Excel': hargaAmbil,
      'Selisih Grosir': selisihAmbil,
      'Status Grosir': (notaGrosirFinal === 0 || hargaAmbil === 0) ? '-' : selisihAmbil === 0 ? 'SAMA' : selisihAmbil > 0 ? 'NAIK' : 'TURUN',
    });
  });
  
  const wb = xlsx.utils.book_new();
  const ws = xlsx.utils.json_to_sheet(rows);
  ws['!cols'] = [
    {wch:40},{wch:6},{wch:6},{wch:40},{wch:12},{wch:8},{wch:30},{wch:60},
    {wch:12},{wch:12},{wch:12},{wch:12},{wch:14},{wch:12},{wch:12},{wch:14},
    {wch:12},{wch:12},{wch:10},{wch:12},{wch:12},{wch:10},
  ];
  xlsx.utils.book_append_sheet(wb, ws, `Homebase ${namaToko}`);
  
  const filePath = path.join(CONFIG.paths.storage, `temp_homebase_${tokoKode}_${Date.now()}.xlsx`);
  xlsx.writeFile(wb, filePath);
  return filePath;
}

// ═══ MAIN HANDLER ═══

async function handleHomebaseMode(chatId, userId, message, imageBuffer, session) {
  const low = (message || '').toLowerCase().trim();
  const tokoKode = session.homebaseToko;
  const namaToko = NAMA_TOKO[tokoKode];
  
  if (low === 'batal' || low === '/batal') {
    resetSesi(userId);
    return kirim(chatId, '✅ Dibatalkan.', { reply_markup: kbMainMenu(userId) });
  }
  
  if (low === 'selesai' || low === 'export') {
    const items = session.homebaseItems || [];
    if (!items.length) return kirim(chatId, '⚠️ Belum ada data. Kirim foto nota dulu!');
    
    await kirim(chatId, '📊 _Membuat laporan perbandingan..._');
    
    const hasilBanding = items.map(item => ({
      namaNota: item.nama, satuan: item.satuan,
      hpp: item.hpp, hargaB: item.hargaB, hargaD: item.hargaD,
      matched: matchBarangHomebase(item.nama),
    }));
    
    hasilBanding.sort((a, b) => {
      if (a.matched && !b.matched) return -1;
      if (!a.matched && b.matched) return 1;
      return a.namaNota.localeCompare(b.namaNota, 'id');
    });
    
    await kirim(chatId, formatPerbandinganHomebase(hasilBanding, tokoKode));
    
    try {
      const excelPath = generateExcelHomebase(hasilBanding, tokoKode);
      await bot.sendDocument(chatId, excelPath, {}, {
        filename: `Homebase_${tokoKode.toUpperCase()}_${getTanggalSlash(false).replace(/\//g, '-')}.xlsx`,
      });
      try { fs.unlinkSync(excelPath); } catch(e) {}
    } catch(err) {
      log.error('HB-EXCEL', err.message);
      await kirim(chatId, '❌ Gagal buat Excel: ' + err.message);
    }
    
    resetSesi(userId);
    await kirim(chatId, '✅ *Perbandingan Homebase selesai!*', { reply_markup: kbMainMenu(userId) });
    return;
  }
  
  if (low === 'review' || low === 'lihat') {
    const items = session.homebaseItems || [];
    if (!items.length) return kirim(chatId, '⚠️ Belum ada data.');
    
    let m = `📋 *REVIEW HOMEBASE*\n🏦 ${namaToko}\n${GARIS_TEBAL}\n📦 Total: ${items.length} item\n\n`;
    items.forEach((item, i) => {
      m += `${i+1}. *${escapeMd(item.nama)}*\n   ${item.satuan} | HPP: ${formatRp(item.hpp)} | B: ${formatRp(item.hargaB)} | D: ${formatRp(item.hargaD)}\n\n`;
    });
    
    await kirim(chatId, m, {
      reply_markup: { inline_keyboard: [
        [{ text: '📊 Selesai & Bandingkan', callback_data: 'homebase:selesai' }],
        [{ text: '🗑️ Reset', callback_data: 'homebase:reset' }],
        [{ text: '🔙 Batal', callback_data: 'menu:main' }],
      ]}
    });
    return;
  }
  
  if (imageBuffer) {
    await kirim(chatId, '📸 _Sedang scan nota (multi-pass, 60-90 detik)..._');
    
    try {
      const scannedItems = await scanHomebaseMultiPass(imageBuffer);
      log.info('HB', `Scanned: ${scannedItems.length} items`);
      
      if (!scannedItems.length) {
        await kirim(chatId,
          `⚠️ *Tidak ada barang terdeteksi*\n${GARIS_TIPIS}\n\n💡 Tips:\n1. Foto ASLI (jangan forward WA)\n2. Lurus dari atas\n3. Zoom sampai jelas\n4. Bagi 2-3 foto kalau panjang\n\n📸 Coba lagi.`,
          { reply_markup: { inline_keyboard: [[{ text: '🔙 Batal', callback_data: 'menu:main' }]] }}
        );
        return;
      }
      
      const existing = session.homebaseItems || [];
      const newItems = [];
      scannedItems.forEach(si => {
        if (!existing.some(ex => ex.nama === si.nama)) {
          existing.push(si);
          newItems.push(si);
        }
      });
      updateSesi(userId, { homebaseItems: existing });
      
      let m = `✅ *Scan ${scannedItems.length} item!*\n🆕 Baru: ${newItems.length} | Total: ${existing.length}\n${GARIS_TEBAL}\n\n`;
      
      newItems.slice(0, 8).forEach((si, i) => {
        const match = matchBarangHomebase(si.nama);
        const konv = konversiHargaKePcs(si);
        
        m += `*${i+1}. ${escapeMd(si.nama)}*\n`;
        m += `   📏 ${si.satuan}`;
        if (konv.dikonversi) m += ` (÷${konv.faktorKonversi})`;
        m += ` | HPP: ${formatRp(si.hpp)} | B: ${formatRp(si.hargaB)} | D: ${formatRp(si.hargaD)}\n`;
        
        if (si.hargaB > 0 && si.hargaD > 0 && si.hargaB > si.hargaD) {
          m += `   ⚠️ _Harga B > D (terswap otomatis)_\n`;
        }
        
        if (match) {
          const icon = match.matchScore >= 90 ? '✅' : match.matchScore >= 70 ? '🔗' : '⚠️';
          m += `   ${icon} → _${escapeMd(match.item.nama.substring(0, 45))}_ (${match.matchScore}%)`;
          if (match.alternatives && match.alternatives.length > 0) m += ` +${match.alternatives.length} alt`;
          m += '\n';
        } else {
          m += `   ❌ _Belum match_\n`;
        }
        m += '\n';
      });
      
      if (newItems.length > 8) m += `_... +${newItems.length - 8} lainnya_\n\n`;
      m += `${GARIS_TIPIS}\n📸 Kirim foto lagi atau pilih:`;
      
      await kirim(chatId, m, {
        reply_markup: { inline_keyboard: [
          [{ text: '📊 Selesai & Bandingkan', callback_data: 'homebase:selesai' }],
          [{ text: '📋 Review Semua', callback_data: 'homebase:review' }],
          [{ text: '🔙 Batal', callback_data: 'menu:main' }],
        ]}
      });
    } catch(err) {
      log.error('HB-SCAN', err.message);
      await kirim(chatId, '❌ Gagal: ' + err.message + '\n\n📸 Coba lagi.');
    }
    return;
  }
  
  await kirim(chatId,
    `📸 *Kirim FOTO nota Homebase*\n${GARIS_TIPIS}\n🏦 ${namaToko}\n📦 Data: ${(session.homebaseItems || []).length} item\n\n💡 Tips: Foto asli, lurus, zoom jelas, bagi 2-3 foto kalau panjang.`,
    { reply_markup: { inline_keyboard: [
      [{ text: '📋 Review', callback_data: 'homebase:review' }],
      [{ text: '📊 Selesai', callback_data: 'homebase:selesai' }],
      [{ text: '🔙 Batal', callback_data: 'menu:main' }],
    ]}}
  );
}
// ════════════════════════════════════════════════════════════════
//   32. COMMAND HANDLERS
// ════════════════════════════════════════════════════════════════
// ═══ AUDIT LOG untuk aktivitas sensitif ═══
const AUDIT_LOG_FILE = path.join(CONFIG.paths.storage, 'audit.log');

function auditLog(userId, action, details = '') {
  const timestamp = getJamSekarang();
  const nama = getNama(userId) || 'Unknown';
  const isAdminUser = isAdmin(userId) ? 'ADMIN' : 'USER';
  const entry = `[${timestamp}] [${isAdminUser}] ${nama} (${userId}) → ${action} | ${details}\n`;
  
  try {
    fs.appendFileSync(AUDIT_LOG_FILE, entry);
  } catch(e) {
    log.error('AUDIT', 'Fail write: ' + e.message);
  }
  
  // Notif ke admin untuk aktivitas SUPER sensitif
  const SENSITIVE_ACTIONS = ['LOGIN_FAILED', 'MEMBER_DELETED', 'CONFIG_CHANGED', 'BACKUP_DELETED'];
  if (SENSITIVE_ACTIONS.includes(action) && CONFIG.adminId) {
    try {
      bot.sendMessage(CONFIG.adminId, 
        `🚨 *AUDIT ALERT*\n\n👤 ${nama} (${userId})\n📝 Action: *${action}*\n${details ? '📋 Detail: ' + details : ''}\n⏰ ${timestamp}`,
        { parse_mode: 'Markdown' }
      );
    } catch(e) {}
  }
}

// Wrap command sensitif untuk auto-log
bot.onText(/\/approve (\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  auditLog(msg.from.id, 'APPROVE_MEMBER', `Target: ${match[1]}`);
  approveUser(msg.chat.id, match[1]);
});

bot.onText(/\/reject (\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  auditLog(msg.from.id, 'REJECT_MEMBER', `Target: ${match[1]}`);
  rejectUser(msg.chat.id, match[1]);
});

bot.onText(/\/removemember (\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  auditLog(msg.from.id, 'MEMBER_DELETED', `Target: ${match[1]}`);
  const r = hapusMember(match[1]);
  kirim(msg.chat.id, r.ok ? '✅ Member dihapus' : '❌ ' + r.alasan);
});

// Command untuk lihat audit log (admin only)
bot.onText(/\/auditlog/, (msg) => {
  if (!isAdmin(msg.from.id)) return kirim(msg.chat.id, '🚫 Khusus admin.');
  
  try {
    if (!fs.existsSync(AUDIT_LOG_FILE)) {
      return kirim(msg.chat.id, '📋 Audit log kosong.');
    }
    
    const content = fs.readFileSync(AUDIT_LOG_FILE, 'utf8');
    const lines = content.trim().split('\n').slice(-30); // 30 terakhir
    
    let m = `📋 *AUDIT LOG (30 terakhir)*\n${GARIS_TEBAL}\n\n`;
    m += '```\n' + lines.join('\n') + '\n```';
    
    kirim(msg.chat.id, m);
  } catch(e) {
    kirim(msg.chat.id, '❌ Error: ' + e.message);
  }
});

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const userName = getNama(userId) || msg.from.first_name || 'Kakak';
  trackChat(userId, '/start', 'command');
  
  if (!isMember(userId)) {
    return kirim(chatId, buildGuestWelcome(userName, userId));
  }
  
  kirim(chatId, buildWelcome(userId, userName), { reply_markup: kbMainMenu(userId) });
});

bot.onText(/\/menu/, (msg) => {
  const userId = msg.from.id;
  if (!isMember(userId)) return kirim(msg.chat.id, buildGuestWelcome(msg.from.first_name, userId));
  kirim(msg.chat.id, '📋 *MENU UTAMA*', { reply_markup: kbMainMenu(userId) });
});

bot.onText(/\/request (.+)/, (msg, match) => {
  const userId = msg.from.id;
  const nama = match[1].trim();
  
  if (isMember(userId)) {
    return kirim(msg.chat.id, '✅ Anda sudah jadi member!');
  }
  
  PENDING[userId] = { nama, timestamp: Date.now(), username: msg.from.username || '-' };
  saveJSON(CONFIG.paths.pending, PENDING);
  
  kirim(msg.chat.id,
    `✅ *Permintaan Terkirim!*\n👤 Nama: ${escapeMd(nama)}\n🆔 ID: \`${userId}\`\n\nAdmin akan review.`
  );
  
  if (CONFIG.adminId) {
    kirim(CONFIG.adminId,
      `🔔 *PERMINTAAN AKSES BARU*\n\n👤 ${escapeMd(nama)}\n🆔 \`${userId}\`\n📛 @${msg.from.username || '-'}`,
      { reply_markup: { inline_keyboard: [[
        { text: '✅ Approve', callback_data: `approve:${userId}` },
        { text: '❌ Reject', callback_data: `reject:${userId}` },
      ]]}}
    );
  }
});

bot.onText(/\/info/, (msg) => {
  const userId = msg.from.id;
  const uptime = Math.floor(process.uptime());
  kirim(msg.chat.id,
    `ℹ️ *INFO BOT*\n${GARIS_TEBAL}\n🤖 ${CONFIG.appName}\n📦 ${DATA_BARANG.length} barang\n👥 ${MEMBERS.length} members\n⏱️ Uptime: ${Math.floor(uptime/3600)}j ${Math.floor((uptime%3600)/60)}m\n\n*Your Info:*\n🆔 \`${userId}\`\n📛 ${getUserRole(userId)}`
  );
});

bot.onText(/\/approve (\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  approveUser(msg.chat.id, match[1]);
});

bot.onText(/\/reject (\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  rejectUser(msg.chat.id, match[1]);
});

bot.onText(/\/addstaff (\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const r = tambahRoleLaporan(match[1]);
  kirim(msg.chat.id, r.ok ? '✅ Staff laporan ditambahkan' : '❌ ' + r.alasan);
});

bot.onText(/\/removestaff (\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const r = hapusRoleLaporan(match[1]);
  kirim(msg.chat.id, r.ok ? '✅ Staff laporan dihapus' : '❌ ' + r.alasan);
});

bot.onText(/\/removemember (\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const r = hapusMember(match[1]);
  kirim(msg.chat.id, r.ok ? '✅ Member dihapus' : '❌ ' + r.alasan);
});
// Ubah nama member (admin)
bot.onText(/\/setnama (\d+) (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return kirim(msg.chat.id, '🚫 Khusus admin.');
  
  const targetId = String(match[1]).trim();
  const namaBaru = match[2].trim();
  
  if (namaBaru.length < 2) {
    return kirim(msg.chat.id, '⚠️ Nama minimal 2 karakter.');
  }
  
  const namaLama = KONTAK[targetId] || '_(belum ada nama)_';
  const isMember = MEMBERS.includes(targetId);
  
  KONTAK[targetId] = namaBaru;
  saveJSON(CONFIG.paths.kontak, KONTAK);
  
  kirim(msg.chat.id,
    `✅ *Nama berhasil diubah!*\n${GARIS_TIPIS}\n\n` +
    `🆔 ID: \`${targetId}\`\n` +
    `📛 Nama Lama: ${escapeMd(namaLama)}\n` +
    `📛 Nama Baru: *${escapeMd(namaBaru)}*\n` +
    `👤 Status: ${isMember ? '✅ Member' : '⚠️ Bukan member'}`
  );
  
  // Notif ke user yang bersangkutan
  try {
    kirim(targetId, `✨ *Nama Anda diubah oleh admin*\n\nNama baru: *${escapeMd(namaBaru)}*`);
  } catch(e) {}
});

// Cari member by nama atau ID
bot.onText(/\/carimember (.+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return kirim(msg.chat.id, '🚫 Khusus admin.');
  
  const query = match[1].trim().toLowerCase();
  const results = [];
  
  Object.entries(KONTAK).forEach(([id, nama]) => {
    if (id.includes(query) || nama.toLowerCase().includes(query)) {
      results.push({ id, nama, isMember: MEMBERS.includes(id) });
    }
  });
  
  if (results.length === 0) {
    return kirim(msg.chat.id, `❌ Tidak ada member yang cocok dengan "${escapeMd(query)}"`);
  }
  
  let m = `🔍 *HASIL PENCARIAN* (${results.length})\n${GARIS_TEBAL}\n\n`;
  results.slice(0, 20).forEach((r, i) => {
    m += `${i+1}. *${escapeMd(r.nama)}*\n`;
    m += `   🆔 \`${r.id}\`\n`;
    m += `   👤 ${r.isMember ? '✅ Member' : '⚠️ Bukan member'}\n`;
    m += `   ✏️ Ubah: \`/setnama ${r.id} [nama baru]\`\n\n`;
  });
  
  if (results.length > 20) m += `_... +${results.length - 20} lainnya_\n`;
  
  kirim(msg.chat.id, m);
});

// Hapus kontak (bukan member, hanya nama)
bot.onText(/\/hapuskontak (\d+)/, (msg, match) => {
  if (!isAdmin(msg.from.id)) return kirim(msg.chat.id, '🚫 Khusus admin.');
  
  const targetId = String(match[1]).trim();
  const namaLama = KONTAK[targetId];
  
  if (!namaLama) {
    return kirim(msg.chat.id, '⚠️ Kontak dengan ID tersebut tidak ditemukan.');
  }
  
  delete KONTAK[targetId];
  saveJSON(CONFIG.paths.kontak, KONTAK);
  
  kirim(msg.chat.id,
    `🗑️ *Kontak dihapus!*\n\n🆔 \`${targetId}\`\n📛 ${escapeMd(namaLama)}\n\n_Note: Ini hanya hapus nama, bukan hapus member. Untuk hapus member gunakan /removemember_`
  );
});

bot.onText(/\/reload/, (msg) => {
  if (!isAdmin(msg.from.id)) return;
  loadExcel();
  kirim(msg.chat.id, `✅ Excel reloaded! ${DATA_BARANG.length} barang`);
});

// Manual backup SO untuk admin
bot.onText(/\/backupso(?:\s+(\w+))?/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) {
    return kirim(msg.chat.id, '🚫 Khusus admin.');
  }
  
  const tokoKode = match[1]?.toLowerCase();
  
  if (tokoKode) {
    // Backup toko spesifik
    if (!NAMA_TOKO[tokoKode]) {
      return kirim(msg.chat.id, 
        `⚠️ Toko tidak valid. Pilih: ${Object.keys(NAMA_TOKO).join(', ')}`
      );
    }
    
    await kirim(msg.chat.id, `📦 _Membuat backup ${NAMA_TOKO[tokoKode]}..._`);
    const success = await kirimBackupKeAdmin(tokoKode, 'manual', true);
    
    if (success) {
      await kirim(msg.chat.id, `✅ Backup ${NAMA_TOKO[tokoKode]} terkirim!`);
    } else {
      await kirim(msg.chat.id, `⚠️ ${NAMA_TOKO[tokoKode]} tidak ada data SO.`);
    }
  } else {
    // Backup semua toko
    await kirim(msg.chat.id, '📦 _Membuat backup semua toko..._');
    
    const tokoList = Object.keys(SO_SHARED).filter(tk => {
      const shared = SO_SHARED[tk];
      return shared && Object.keys(shared.racks || {}).length > 0;
    });
    
    if (tokoList.length === 0) {
      return kirim(msg.chat.id, '⚠️ Tidak ada data SO aktif di toko manapun.');
    }
    
    await backupSemuaToko('manual');
    await kirim(msg.chat.id, `✅ Backup ${tokoList.length} toko selesai!`);
  }
});

// Info status backup
bot.onText(/\/statusbackup/, async (msg) => {
  if (!isAdmin(msg.from.id)) return;
  
  let m = `📊 *STATUS AUTO-BACKUP SO*\n${GARIS_TEBAL}\n\n`;
  m += `⏰ Interval auto-backup: 2 menit\n`;
  m += `🚨 Emergency backup: aktif\n`;
  m += `⚡ Event-triggered: aktif (30s debounce)\n\n`;
  
  m += `📦 *Status per toko:*\n${GARIS_TIPIS}\n`;
  
  const tokoList = Object.keys(NAMA_TOKO);
  tokoList.forEach((tk, i) => {
    const shared = SO_SHARED[tk];
    const hasData = shared && Object.keys(shared.racks || {}).length > 0;
    const lastBackup = BACKUP_TRACKER.lastBackup[tk];
    const count = BACKUP_TRACKER.backupCount[tk] || 0;
    
    m += `${i+1}. ${NAMA_TOKO[tk]}\n`;
    
    if (hasData) {
      const totalRak = Object.keys(shared.racks).length;
      const usersAktif = Object.keys(shared.usersAktif || {}).length;
      m += `   📦 ${totalRak} rak | 🟢 ${usersAktif} user aktif\n`;
      
      if (lastBackup) {
        const menitLalu = Math.floor((Date.now() - lastBackup) / 60000);
        m += `   ⏰ Backup terakhir: ${menitLalu < 1 ? 'baru saja' : menitLalu + 'm lalu'}\n`;
      } else {
        m += `   ⏰ Belum ada backup\n`;
      }
      m += `   🔢 Total backup: ${count}x\n`;
    } else {
      m += `   _Tidak ada SO aktif_\n`;
    }
    m += '\n';
  });
  
  m += `${GARIS_TIPIS}\n💬 *Command:*\n`;
  m += `• /backupso - backup semua\n`;
  m += `• /backupso tdm - backup toko spesifik\n`;
  m += `• /statusbackup - status ini`;
  
  await kirim(msg.chat.id, m);
});

bot.onText(/\/broadcast (.+)/, async (msg, match) => {
  if (!isAdmin(msg.from.id)) return;
  const message = match[1];
  const targets = [...MEMBERS, String(CONFIG.adminId)];
  let sent = 0, failed = 0;
  await kirim(msg.chat.id, `📢 Broadcasting ke ${targets.length} users...`);
  for (const id of targets) {
    try {
      await bot.sendMessage(id, `📢 *PENGUMUMAN*\n${GARIS_TEBAL}\n\n${message}\n\n${GARIS_TEBAL}\n_Pesan dari Admin_`, { parse_mode: 'Markdown' });
      sent++;
      await tunggu(1500);
    } catch(e) { failed++; }
  }
  kirim(msg.chat.id, `✅ Sent: ${sent} | ❌ Failed: ${failed}`);
});
// Reset memory percakapan AI
bot.onText(/\/resetchat/, (msg) => {
  if (!isMember(msg.from.id)) return;
  clearMemory(msg.from.id);
  kirim(msg.chat.id, 
    `🔄 *Memori reset!*\n\nOkay kak, aku lupakan obrolan kita sebelumnya ya 😊\n\nYuk mulai ngobrol fresh!`
  );
});

// Lihat memory
bot.onText(/\/memory/, (msg) => {
  if (!isMember(msg.from.id)) return;
  const memory = getChatMemory(msg.from.id);
  if (memory.length === 0) {
    return kirim(msg.chat.id, `Belum ada percakapan tersimpan kak 😊`);
  }
  let m = `🧠 *Memori Percakapan (${memory.length} pesan)*\n${GARIS_TIPIS}\n\n`;
  memory.slice(-5).forEach((msg) => {
    const role = msg.role === 'user' ? '👤' : '🤖';
    m += `${role} _${msg.content.substring(0, 100)}_\n\n`;
  });
  kirim(msg.chat.id, m);
});

async function approveUser(chatId, targetId) {
  targetId = String(targetId);
  const pending = PENDING[targetId];
  if (!pending) return kirim(chatId, '⚠️ Tidak ada pending atau sudah diproses.');
  
  // Hapus dari pending DULU untuk prevent race condition
  delete PENDING[targetId];
  saveJSON(CONFIG.paths.pending, PENDING);
  
  if (!MEMBERS.includes(targetId)) {
    MEMBERS.push(targetId);
    saveJSON(CONFIG.paths.members, MEMBERS);
  }
  KONTAK[targetId] = pending.nama;
  saveJSON(CONFIG.paths.kontak, KONTAK);
  
  kirim(chatId, `✅ Approved: ${pending.nama}`);
  try {
    await kirim(targetId, `🎉 *DISETUJUI!*\nSelamat datang ${pending.nama}!\n\nKetik /start untuk mulai!`);
  } catch(e) {}
}

async function rejectUser(chatId, targetId) {
  targetId = String(targetId);
  const pending = PENDING[targetId];
  if (!pending) return kirim(chatId, '⚠️ Tidak ada pending.');
  delete PENDING[targetId];
  saveJSON(CONFIG.paths.pending, PENDING);
  kirim(chatId, `❌ Rejected: ${pending.nama}`);
  try { await kirim(targetId, `❌ Maaf ${pending.nama}, akses ditolak admin.`); } catch(e) {}
}
// ═══ GitHub Storage Commands ═══

// Force sync SEMUA data ke GitHub
bot.onText(/\/synctogithub/, async (msg) => {
  if (!isAdmin(msg.from.id)) return kirim(msg.chat.id, '🚫 Khusus admin.');
  if (!isGitHubEnabled) return kirim(msg.chat.id, '❌ GitHub Storage belum diaktifkan!\n\nSet GITHUB_TOKEN di Railway Variables.');
  
  await kirim(msg.chat.id, '🔄 _Syncing data ke GitHub..._');
  
  let success = [], failed = [];
  const dataMap = {
    members: MEMBERS,
    kontak: KONTAK,
    pending: PENDING,
    roleLaporan: ROLE_LAPORAN,
    stockopname: STOCKOPNAME,
    beritaacara: BERITA_ACARA,
    soShared: SO_SHARED,
  };
  
  for (const [name, data] of Object.entries(dataMap)) {
    const ok = await saveToGitHub(name, data);
    if (ok) success.push(name);
    else failed.push(name);
    await tunggu(1000); // Jeda 1 detik antar save
  }
  
  let m = `✅ *SYNC KE GITHUB SELESAI*\n${GARIS_TEBAL}\n\n`;
  m += `📤 Berhasil: ${success.length}\n${success.map(s => `   ✅ ${s}.json`).join('\n')}\n\n`;
  if (failed.length > 0) {
    m += `❌ Gagal: ${failed.length}\n${failed.map(s => `   ❌ ${s}.json`).join('\n')}\n`;
  }
  m += `\n💡 Cek di GitHub: \`${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}\``;
  
  kirim(msg.chat.id, m);
});

// Load ulang dari GitHub (kalau data local corrupt)
bot.onText(/\/loadfromgithub/, async (msg) => {
  if (!isAdmin(msg.from.id)) return kirim(msg.chat.id, '🚫 Khusus admin.');
  if (!isGitHubEnabled) return kirim(msg.chat.id, '❌ GitHub Storage belum aktif!');
  
  await kirim(msg.chat.id, '🔄 _Loading data dari GitHub..._');
  
  await loadAllFromGitHub();
  
  kirim(msg.chat.id, 
    `✅ *DATA DI-LOAD DARI GITHUB*\n${GARIS_TEBAL}\n\n` +
    `👥 Members: ${MEMBERS.length}\n` +
    `📒 Kontak: ${Object.keys(KONTAK).length}\n` +
    `🔔 Pending: ${Object.keys(PENDING).length}\n` +
    `📊 Staff: ${ROLE_LAPORAN.length}\n`
  );
});

// Status GitHub Storage
bot.onText(/\/githubstatus/, (msg) => {
  if (!isAdmin(msg.from.id)) return kirim(msg.chat.id, '🚫 Khusus admin.');
  
  let m = `📊 *GITHUB STORAGE STATUS*\n${GARIS_TEBAL}\n\n`;
  
  if (!isGitHubEnabled) {
    m += `❌ *STATUS: NONAKTIF*\n\n`;
    m += `⚠️ Data hanya di memory Railway.\nSetiap deploy → DATA HILANG!\n\n`;
    m += `${GARIS_TIPIS}\n💡 *Cara Aktifkan:*\n`;
    m += `1. GitHub → Settings → Developer settings\n`;
    m += `2. Personal access tokens → Generate\n`;
    m += `3. Scope: repo (full access)\n`;
    m += `4. Copy token\n`;
    m += `5. Railway → Variables → Add:\n`;
    m += `   • GITHUB_TOKEN = ghp_xxx\n`;
    m += `   • GITHUB_USERNAME = username\n`;
    m += `   • GITHUB_REPO = nama-repo\n`;
    m += `6. Redeploy service`;
  } else {
    m += `✅ *STATUS: AKTIF*\n\n`;
    m += `📁 Repo: \`${GITHUB_CONFIG.owner}/${GITHUB_CONFIG.repo}\`\n`;
    m += `🌿 Branch: \`${GITHUB_CONFIG.branch}\`\n`;
    m += `📂 Folder: \`${GITHUB_CONFIG.folder}/\`\n\n`;
    m += `${GARIS_TIPIS}\n📊 *Data Tersimpan di GitHub:*\n`;
    m += `👥 Members: *${MEMBERS.length}*\n`;
    m += `📒 Kontak: *${Object.keys(KONTAK).length}*\n`;
    m += `🔔 Pending: *${Object.keys(PENDING).length}*\n`;
    m += `📊 Staff: *${ROLE_LAPORAN.length}*\n\n`;
    m += `${GARIS_TIPIS}\n💡 *Commands:*\n`;
    m += `• /synctogithub - Push semua data ke GitHub\n`;
    m += `• /loadfromgithub - Pull data dari GitHub\n`;
    m += `• /githubstatus - Status ini\n\n`;
    m += `✅ *Data AMAN!*\nSetiap perubahan otomatis backup ke GitHub.\nData tetap ada meski Railway restart/deploy.`;
  }
  
  kirim(msg.chat.id, m);
});

// ════════════════════════════════════════════════════════════════
//   33. VOICE HANDLER (LENGKAP DENGAN AUTO-RETRY & SMART ROUTING)
// ════════════════════════════════════════════════════════════════

bot.on('voice', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!isMember(userId)) return kirim(chatId, buildGuestWelcome(msg.from.first_name, userId));
  
  trackChat(userId, '[VOICE]', 'voice');
  let loading = null;
  
  try {
    loading = await kirim(chatId, '🎙️ _Sedang mendengarkan..._');
    
    // Download audio
    const fileLink = await bot.getFileLink(msg.voice.file_id);
    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const audioBuffer = Buffer.from(response.data);
    
    // Transcribe
    const rawText = await voiceToText(audioBuffer);
    
    // Hapus loading message
    try { if (loading) await bot.deleteMessage(chatId, loading.message_id); } catch(e) {}
    loading = null;
    
    // Gagal transcribe
    if (!rawText || rawText.trim().length < 2) {
      return kirim(chatId, 
        `⚠️ *Gagal mengenali voice*\n${GARIS_TIPIS}\n\n` +
        `Suara terlalu pelan/pendek/bising.\n\n` +
        `💡 *Tips:*\n` +
        `• Bicara jelas & tidak terlalu cepat\n` +
        `• Hindari noise background\n` +
        `• Coba ketik langsung jika susah\n\n` +
        `📝 Atau ketik pesan langsung:`,
        { reply_markup: kbMainMenu(userId) }
      );
    }
    
    // Koreksi teks voice
    const corrected = await koreksiVoiceText(rawText);
    const low = corrected.toLowerCase().trim();
    
    log.info('VOICE', `Raw: "${rawText}" → Corrected: "${corrected}"`);
    
    // Tampilkan hasil dengar
    let info = `🎙️ *Saya dengar:*\n_"${escapeMd(rawText)}"_\n`;
    if (corrected.toLowerCase() !== rawText.toLowerCase()) {
      info += `\n🧠 *Saya pahami:*\n_"${escapeMd(corrected)}"_\n`;
    }
    info += `\n${GARIS_TIPIS}\n⏳ _Memproses..._`;
    
    await kirim(chatId, info);
    await tunggu(500);
    
    // ════════════════════════════════════════════
    // SMART ROUTING (sama logikanya dengan text)
    // ════════════════════════════════════════════
    
    const session = getSesi(userId);
    
    // ★ PRIORITY 1: Mode aktif (SO, BA, Harga, Scan Laporan)
    if (session.mode === 'stockopname') {
      return await handleStockOpnameMode(chatId, userId, corrected, session);
    }
    
    if (session.mode === 'beritaacara') {
      return await handleBeritaAcaraMode(chatId, userId, corrected, session);
    }
    
    if (session.hargaActive) {
      return await handleHargaMode(chatId, userId, corrected, null, session);
    }
    
    if (session.scanActive) {
      return await handleScanModeLaporan(chatId, userId, corrected, null, session);
    }
    
    if (session.menu === 3 && session.kemarin !== undefined) {
      const laporan = genLapMarket(corrected, session.kemarin);
      await kirim(chatId, laporan);
      resetSesi(userId);
      return kirim(chatId, '✅ *Laporan Marketplace selesai!*', { reply_markup: kbMainMenu(userId) });
    }
    
    // ★ PRIORITY 2: Reset commands
    if (KATA_RESET.includes(low)) {
      resetSesi(userId);
      return kirim(chatId, '📋 *MENU UTAMA*', { reply_markup: kbMainMenu(userId) });
    }
    
    // ★ PRIORITY 3: Menu keyword (stock opname, menu utama, dll)
    const menuMatch = detectMenuKeyword(corrected);
    if (menuMatch) {
      if (menuMatch.adminOnly && !isAdmin(userId)) {
        return kirim(chatId, '🚫 Khusus admin.');
      }
      if (menuMatch.priority === 'high') {
        log.info('VOICE-MENU', `"${low}" → ${menuMatch.label}`);
        return executeMenuAction(chatId, userId, menuMatch.action);
      }
    }
    
    // ★ PRIORITY 4: Sapaan
    const kataSapaan = isSapaan(low);
    if (kataSapaan) {
      await kirim(chatId, balasSapaan(userId, kataSapaan));
      await tunggu(600);
      return kirim(chatId, '📋 *Mau cari apa?*', { reply_markup: kbMainMenu(userId) });
    }
    
    // ★ PRIORITY 5: Cari barang eksplisit (ada keyword "cari", "harga", dll)
    const isCariEksplisit = /^(cari|harga|stok|stock|cek|lihat|beli)\s+/i.test(low);
    if (isCariEksplisit) {
      const keyword = corrected.replace(/^(cari|harga|stok|stock|cek|lihat|beli)\s+/i, '').trim();
      if (keyword.length >= 2) {
        return await prosesVoiceSearch(chatId, userId, keyword, corrected);
      }
    }
    
    // ★ PRIORITY 6: Deteksi intent barang
    const intent = deteksiIntentBarang(corrected);
    log.info('VOICE-ROUTER', `Intent: ${intent.isProduct ? 'PRODUK' : 'NON-PRODUK'} (${intent.confidence}) - ${intent.reason}`);
    
    if (intent.isProduct) {
      // Untuk voice: langsung cari (baik HIGH maupun MEDIUM confidence)
      // Karena voice sudah effort user bicara, jadi langsung proses
      return await prosesVoiceSearch(chatId, userId, corrected, corrected);
    }
    
    // ★ PRIORITY 7: Non-produk → AI Chat
    return await prosesAI(chatId, userId, corrected);
    
  } catch(err) {
    log.error('VOICE', err.message);
    try { if (loading) await bot.deleteMessage(chatId, loading.message_id); } catch(e) {}
    await kirim(chatId, 
      `❌ *Error proses voice*\n${GARIS_TIPIS}\n\n` +
      `${err.message}\n\n` +
      `💡 Coba ketik pesannya langsung.`,
      { reply_markup: kbMainMenu(userId) }
    );
  }
});

/**
 * ════════════════════════════════════════════════════════════
 * VOICE SEARCH: Cari barang dari voice dengan auto-retry
 * ════════════════════════════════════════════════════════════
 * 
 * Strategy:
 * 1. Cari dengan teks lengkap yang sudah dikoreksi
 * 2. Kalau tidak match → coba tanpa kata kunci (cari/harga/cek/di/cp/dll)
 * 3. Kalau masih tidak → coba per kata (kata terpanjang dulu)
 * 4. Kalau tetap tidak → tampilkan saran + tombol
 */
async function prosesVoiceSearch(chatId, userId, searchText, originalText) {
  // Bersihkan keyword dari nama toko dll
  const tokoDisebut = deteksiTokoDariTeks(originalText);
  const tipeHarga = detectTipeHarga(originalText);
  const cleanKeyword = bersihkanKeywordDariToko(searchText);
  const tokoKode = tokoDisebut.length > 0 ? tokoDisebut[0].kode : null;
  
  log.info('VOICE-SEARCH', `Search: "${cleanKeyword}" | Toko: ${tokoKode || 'all'} | Tipe: ${tipeHarga}`);
  
  // ═══ ATTEMPT 1: Cari dengan keyword bersih ═══
  const result1 = cariBarang(cleanKeyword);
  if (result1.hasil.length > 0) {
    log.info('VOICE-SEARCH', `✅ Attempt 1: ${result1.hasil.length} hasil`);
    return await prosesCari(chatId, userId, originalText, tokoKode);
  }
  
  // ═══ ATTEMPT 2: Cari tanpa angka/ukuran ═══
  const keywordTanpaAngka = cleanKeyword.replace(/\d+/g, '').replace(/\s+/g, ' ').trim();
  if (keywordTanpaAngka.length >= 3 && keywordTanpaAngka !== cleanKeyword) {
    const result2 = cariBarang(keywordTanpaAngka);
    if (result2.hasil.length > 0) {
      log.info('VOICE-SEARCH', `✅ Attempt 2 (tanpa angka): ${result2.hasil.length} hasil`);
      return await prosesCari(chatId, userId, keywordTanpaAngka + (tokoKode ? ` di ${tokoKode}` : ''), tokoKode);
    }
  }
  
  // ═══ ATTEMPT 3: Cari per kata (kata terpanjang dulu) ═══
  const kataKata = cleanKeyword
    .split(/\s+/)
    .filter(k => k.length >= 3)
    .sort((a, b) => b.length - a.length); // Paling panjang dulu
  
  for (const kata of kataKata) {
    // Skip kata umum
    if (['harga', 'stok', 'cari', 'cek', 'lihat', 'beli', 'ada', 'yang', 'dan', 'atau'].includes(kata)) continue;
    
    const result3 = cariBarang(kata);
    if (result3.hasil.length > 0) {
      log.info('VOICE-SEARCH', `✅ Attempt 3 (per kata "${kata}"): ${result3.hasil.length} hasil`);
      
      // Tampilkan info bahwa kita cari dengan kata kunci berbeda
      await kirim(chatId, `🔍 Mencari dengan kata kunci: *${escapeMd(kata)}*`);
      await tunggu(500);
      return await prosesCari(chatId, userId, kata + (tokoKode ? ` di ${tokoKode}` : ''), tokoKode);
    }
    
    // Cek saran juga
    if (result3.saran && result3.saran.length > 0) {
      log.info('VOICE-SEARCH', `✅ Attempt 3 (saran dari "${kata}"): ${result3.saran.length} saran`);
      
      await kirim(chatId, `🔍 Mencari: *${escapeMd(kata)}*`);
      await tunggu(500);
      return await prosesCari(chatId, userId, kata + (tokoKode ? ` di ${tokoKode}` : ''), tokoKode);
    }
  }
  
  // ═══ ATTEMPT 4: Gabung 2 kata pertama ═══
  if (kataKata.length >= 2) {
    const gabung2 = kataKata.slice(0, 2).join(' ');
    const result4 = cariBarang(gabung2);
    if (result4.hasil.length > 0 || (result4.saran && result4.saran.length > 0)) {
      log.info('VOICE-SEARCH', `✅ Attempt 4 (gabung 2 kata): "${gabung2}"`);
      await kirim(chatId, `🔍 Mencari: *${escapeMd(gabung2)}*`);
      await tunggu(500);
      return await prosesCari(chatId, userId, gabung2 + (tokoKode ? ` di ${tokoKode}` : ''), tokoKode);
    }
  }
  
  // ═══ SEMUA ATTEMPT GAGAL ═══
  log.warn('VOICE-SEARCH', `❌ Semua attempt gagal untuk: "${cleanKeyword}"`);
  
  // Tampilkan pesan yang helpful
  await kirim(chatId,
    `❌ *Barang tidak ditemukan*\n${GARIS_TEBAL}\n\n` +
    `🎙️ Anda bilang: _"${escapeMd(originalText)}"_\n` +
    `🔍 Dicari: _"${escapeMd(cleanKeyword)}"_\n\n` +
    `💡 *Coba:*\n` +
    `• Ketik langsung: \`sapu ferona\`\n` +
    `• Ucapkan lebih jelas & pelan\n` +
    `• Sebutkan merek lengkap\n\n` +
    `📝 *Atau pilih cara lain:*`,
    { reply_markup: { inline_keyboard: [
      [{ text: '🔍 Cari Barang (Ketik)', callback_data: 'menu:4' }],
      [{ text: '📋 Menu Utama', callback_data: 'menu:main' }],
    ]}}
  );
}

// ════════════════════════════════════════════════════════════════
//   34. PHOTO HANDLER (TUNGGAL - ROUTE SEMUA MODE)
// ════════════════════════════════════════════════════════════════

bot.on('photo', async (msg) => {
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  if (!isMember(userId)) return kirim(chatId, buildGuestWelcome(msg.from.first_name, userId));
  
  trackChat(userId, '[PHOTO]', 'photo');
  
  try {
    const photo = msg.photo[msg.photo.length - 1];
    const fileLink = await bot.getFileLink(photo.file_id);
    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
    const imageBuffer = Buffer.from(response.data);
    
        const session = getSesi(userId);
    
    // ★ Homebase mode
    if (session.mode === 'homebase') {
      await handleHomebaseMode(chatId, userId, msg.caption || '', imageBuffer, session);
      return;
    }
    
    // ROUTING berdasarkan mode aktif (existing)
    if (session.mode === 'stockopname') {
      // Cek apakah lagi di step input rak (setup awal atau pindah rak)
      const isStepRak = session.soSetupStep === 'rak' || 
                       session.soSetupStep === 'rak_input' || 
                       session.soSetupStep === 'pindahrak_namabaru' || 
                       session.soSetupStep === 'rak_input_pindah';
      
      if (isStepRak) {
        await handleScanRak(chatId, userId, imageBuffer, session);
        return;
      }
      
      // Cek jika user kirim foto saat di mode SO aktif (tanpa step) - anggap mau pindah rak
      if (!session.soSetupStep && session.soInfo?.rakAktif && session.soInfo.rakAktif !== 'EDIT_MODE') {
        await handleScanRakPindah(chatId, userId, imageBuffer, session);
        return;
      }
    }
    
    if (session.scanActive) {
      await handleScanModeLaporan(chatId, userId, msg.caption || '', imageBuffer, session);
    } else if (session.hargaActive) {
      await handleHargaMode(chatId, userId, msg.caption || '', imageBuffer, session);
    } else if (session.mode === 'beritaacara' && session.baSection) {
      await handleBaScanFoto(chatId, userId, imageBuffer, session);
    } else if (session.menu === 3) {
      await kirim(chatId, '📸 _Scan laporan marketplace..._');
      try {
        const prompt = `Baca gambar laporan marketplace. Ekstrak per toko (oesapa, tdm, central), channel (wa, shopee, tiktok, tokopedia), bayar (tunai, debit, kredit). Format: nama nilai`;
        const aiText = await analisaGambarBuffer(imageBuffer, prompt);
        const laporan = genLapMarket(aiText, session.kemarin);
        await kirim(chatId, laporan);
        resetSesi(userId);
        await kirim(chatId, '✅ *Laporan Marketplace selesai!*', { reply_markup: kbMainMenu(userId) });
      } catch(err) {
        await kirim(chatId, '❌ Gagal: ' + err.message);
      }
    } else {
      // Default: AI Vision umum
      await kirim(chatId, '📸 _Menganalisa foto..._');
      const prompt = msg.caption
        ? `Foto toko perabot. ${msg.caption}. Jawab bahasa Indonesia.`
        : 'Foto toko perabot. Analisa singkat dalam bahasa Indonesia.';
      const result = await analisaGambarBuffer(imageBuffer, prompt);
      if (result) {
        await kirim(chatId, `📸 *Hasil Analisa AI:*\n${GARIS_TEBAL}\n\n${result}`);
      } else {
        await kirim(chatId, '❌ AI Vision tidak tersedia.');
      }
    }
  } catch(err) {
    log.error('PHOTO', err.message);
    kirim(chatId, '❌ Error: ' + err.message);
  }
});

// ════════════════════════════════════════════════════════════════
//   34B. HANDLER SCAN BARCODE/NAMA RAK
// ════════════════════════════════════════════════════════════════

async function handleScanRak(chatId, userId, imageBuffer, session) {
  const tokoKode = session.tokoKode;
  const namaToko = NAMA_TOKO[tokoKode];
  
  await kirim(chatId, '📸 _Sedang scan QR/barcode/nama rak..._');
  
  try {
    let namaRakScan = null;
    let metodeScan = '';
    
    // ★ METODE 1: Coba decode QR code dulu
    log.info('SCAN_RAK', 'Coba decode QR...');
    const qrResult = await decodeQRFromBuffer(imageBuffer);
    if (qrResult) {
      namaRakScan = bersihkanHasilQR(qrResult);
      if (namaRakScan) {
        metodeScan = 'QR Code';
        log.info('SCAN_RAK', `QR berhasil: ${namaRakScan}`);
      }
    }
    
    // ★ METODE 2: Jika QR gagal, fallback ke AI Vision (baca tulisan biasa)
    if (!namaRakScan) {
      log.info('SCAN_RAK', 'QR gagal, coba AI Vision...');
      try {
        const aiText = await analisaGambarBuffer(imageBuffer, SCAN_PROMPT_RAK);
        namaRakScan = parseHasilScanRak(aiText);
        if (namaRakScan) metodeScan = 'AI Vision (tulisan)';
      } catch(aiErr) {
        log.warn('SCAN_RAK', 'AI Vision juga gagal: ' + aiErr.message);
      }
    }
    
    // ★ Tidak ada yang berhasil
        if (!namaRakScan) {
      await kirim(chatId,
        `⚠️ *Tidak bisa membaca rak dari foto*\n${GARIS_TEBAL}\n\n` +
        `❌ QR Code: tidak terdeteksi\n` +
        `❌ Tulisan: tidak terbaca\n\n` +
        `💡 *Tips agar QR berhasil terbaca:*\n` +
        `• ✅ Foto QR code dari **layar HP langsung** (bukan screenshot)\n` +
        `• ✅ QR memenuhi **60-80% frame foto**\n` +
        `• ✅ Foto **tegak lurus** (tidak miring)\n` +
        `• ✅ Cahaya cukup, tidak ada **pantulan**\n` +
        `• ✅ Hindari foto **layar HP** dengan HP lain (moire pattern)\n\n` +
        `💡 *Alternatif:*\n` +
        `• Print QR code di kertas, lalu foto\n` +
        `• Foto tulisan nama rak langsung (jangan QR)\n` +
        `• Atau **ketik nama rak manual**\n\n` +
        `📸 Coba foto lagi, atau ketik nama rak.`
      );
      return;
    }
    
    // ★ Cek apakah rak sudah ada (mirip)
    const rakExisting = findRakMirip(tokoKode, namaRakScan);
    
    if (rakExisting) {
      // RAK SUDAH ADA
      const items = getBarangDiRak(tokoKode, rakExisting);
      const itemCount = Object.keys(items).length;
      const usersAktif = getAllUsersAktif(tokoKode);
      const pegangRak = Object.values(usersAktif).find(u => u.rakAktif === rakExisting);
      
      updateSesi(userId, { soScanRakPending: rakExisting });
      
      let m = `✅ *Berhasil scan!* (via ${metodeScan})\n${GARIS_TEBAL}\n\n`;
      m += `📸 Hasil scan: *${escapeMd(namaRakScan)}*\n`;
      m += `🔍 Ditemukan rak existing: *${escapeMd(rakExisting)}*\n\n`;
      m += `📊 Info rak:\n`;
      m += `   📦 ${itemCount} jenis barang\n`;
      if (pegangRak) m += `   🟢 Sedang dipegang: ${pegangRak.nama}\n`;
      m += `\n${GARIS_TIPIS}\n\n`;
      m += `💬 *Apa yang ingin Anda lakukan?*`;
      
      await kirim(chatId, m, {
        reply_markup: { inline_keyboard: [
          [{ text: `✅ Pakai Rak Ini (${rakExisting})`, callback_data: 'so:scanrak:pakai' }],
          [{ text: '🆕 Buat Rak Baru (Beda Nama)', callback_data: 'so:scanrak:baru' }],
          [{ text: '🔙 Batal', callback_data: 'so:scanrak:batal' }],
        ]}
      });
    } else {
      // RAK BARU
      updateSesi(userId, { soScanRakPending: namaRakScan });
      
      await kirim(chatId,
        `✅ *Berhasil scan!* (via ${metodeScan})\n${GARIS_TEBAL}\n\n` +
        `📸 Hasil scan: *${escapeMd(namaRakScan)}*\n` +
        `🆕 Status: *Rak BARU* (belum pernah ada)\n\n` +
        `${GARIS_TIPIS}\n\n` +
        `💬 *Pakai nama rak ini?*`,
        { reply_markup: { inline_keyboard: [
          [{ text: `✅ Ya, Buat "${namaRakScan}"`, callback_data: 'so:scanrak:pakai' }],
          [{ text: '✏️ Edit Nama Rak', callback_data: 'so:scanrak:edit' }],
          [{ text: '🔙 Batal', callback_data: 'so:scanrak:batal' }],
        ]}}
      );
    }
  } catch(err) {
    log.error('SCAN_RAK', err.message);
    await kirim(chatId, '❌ Gagal scan: ' + err.message + '\n\n💡 Coba foto lagi atau ketik nama rak manual.');
  }
}

async function handleScanRakPindah(chatId, userId, imageBuffer, session) {
  const tokoKode = session.tokoKode;
  const namaToko = NAMA_TOKO[tokoKode];
  const rakAktifSkrg = session.soInfo.rakAktif;
  
  await kirim(chatId, '📸 _Sedang scan QR/barcode/nama rak..._');
  
  try {
    let namaRakScan = null;
    let metodeScan = '';
    
    // ★ METODE 1: QR code dulu
    const qrResult = await decodeQRFromBuffer(imageBuffer);
    if (qrResult) {
      namaRakScan = bersihkanHasilQR(qrResult);
      if (namaRakScan) metodeScan = 'QR Code';
    }
    
    // ★ METODE 2: Fallback AI Vision
    if (!namaRakScan) {
      try {
        const aiText = await analisaGambarBuffer(imageBuffer, SCAN_PROMPT_RAK);
        namaRakScan = parseHasilScanRak(aiText);
        if (namaRakScan) metodeScan = 'AI Vision';
      } catch(aiErr) {
        log.warn('SCAN_RAK_PINDAH', 'AI gagal: ' + aiErr.message);
      }
    }
    
    if (!namaRakScan) {
      await kirim(chatId,
        `⚠️ *Tidak bisa membaca rak*\n\n` +
        `❌ QR Code: tidak terdeteksi\n` +
        `❌ Tulisan: tidak terbaca\n\n` +
        `💡 Coba foto QR lebih jelas atau ketik nama manual.`,
        { reply_markup: kbSOAktif() }
      );
      return;
    }
    
    // Cek apakah rak sama dengan yang aktif
    if (rakAktifSkrg.toLowerCase().replace(/[\s\-_]/g, '') === namaRakScan.toLowerCase().replace(/[\s\-_]/g, '')) {
      await kirim(chatId,
        `ℹ️ *Anda sudah di rak ini!*\n\n` +
        `📦 Rak Aktif: *${escapeMd(rakAktifSkrg)}*\n` +
        `📸 Hasil scan (via ${metodeScan}): *${escapeMd(namaRakScan)}*\n\n` +
        `Tetap lanjutkan input di rak ini.`,
        { reply_markup: kbSOAktif() }
      );
      return;
    }
    
    const rakExisting = findRakMirip(tokoKode, namaRakScan);
    const targetRak = rakExisting || namaRakScan;
    const isBaru = !rakExisting;
    
    updateSesi(userId, { soScanRakPindahPending: targetRak });
    
    const itemCount = isBaru ? 0 : Object.keys(getBarangDiRak(tokoKode, targetRak)).length;
    const usersAktif = getAllUsersAktif(tokoKode);
    const pegangRak = Object.values(usersAktif).find(u => u.rakAktif === targetRak);
    
    let m = `✅ *Hasil Scan!* (via ${metodeScan})\n${GARIS_TEBAL}\n\n`;
    m += `📸 Hasil: *${escapeMd(namaRakScan)}*\n`;
    m += `🎯 Target: *${escapeMd(targetRak)}* ${isBaru ? '(BARU)' : '(EXISTING)'}\n`;
    m += `📦 Rak aktif saat ini: ${rakAktifSkrg}\n\n`;
    
    if (!isBaru) {
      m += `📊 Info rak target:\n`;
      m += `   📦 ${itemCount} jenis barang\n`;
      if (pegangRak && String(pegangRak.nama) !== String(getNama(userId))) {
        m += `   ⚠️ Sedang dipegang: ${pegangRak.nama}\n`;
      }
      m += '\n';
    }
    
    m += `${GARIS_TIPIS}\n💬 *Pindah ke rak ini?*`;
    
    await kirim(chatId, m, {
      reply_markup: { inline_keyboard: [
        [{ text: `✅ Pindah ke "${targetRak}"`, callback_data: 'so:scanrak:pindah' }],
        [{ text: '🔙 Batal (Tetap di Rak Ini)', callback_data: 'so:scanrak:batal' }],
      ]}
    });
  } catch(err) {
    log.error('SCAN_RAK_PINDAH', err.message);
    await kirim(chatId, '❌ Gagal scan: ' + err.message, { reply_markup: kbSOAktif() });
  }
}

// ════════════════════════════════════════════════════════════════
//   35. SAPAAN HELPER
// ════════════════════════════════════════════════════════════════

const SAPAAN_MAP = {
  'halo': ['Halo','Haloo','Hai juga'],
  'hai': ['Hai','Haiii','Halo juga'],
  'hi': ['Hi','Hiii','Hello'],
  'hello': ['Hello','Helloo'],
  'assalamualaikum': ['Waalaikumsalam warahmatullahi wabarakatuh'],
  'pagi': ['Selamat pagi','Pagi juga'],
  'siang': ['Selamat siang','Siang juga'],
  'sore': ['Selamat sore','Sore juga'],
  'malam': ['Selamat malam','Malam juga'],
  'hey': ['Hey','Heyyy'],
};

const TERIMAKASIH_LIST = ['terima kasih','terimakasih','makasih','thanks','thank you','thx','tq','ty'];

function isSapaan(low) {
  const sorted = Object.keys(SAPAAN_MAP).sort((a, b) => b.length - a.length);
  for (const k of sorted) {
    if (low === k || low.startsWith(k + ' ') || low.startsWith(k + ',') || low.startsWith(k + '!')) return k;
  }
  return null;
}

function isTerimakasih(low) {
  return TERIMAKASIH_LIST.some(k => low === k || low.startsWith(k + ' '));
}

function balasSapaan(userId, kataSapaan) {
  const nama = getNama(userId);
  const balasan = SAPAAN_MAP[kataSapaan] || ['Halo'];
  const p = balasan[Math.floor(Math.random() * balasan.length)];
  return p + (nama ? `, *${escapeMd(nama)}*` : '') + '! 😊';
}

function balasTerimakasih(userId) {
  const nama = getNama(userId);
  const n = nama ? `, *${escapeMd(nama)}*` : '';
  const ops = [`Sama-sama${n}! 😊`, `Senang bisa membantu${n}! ✨`, `Anytime${n}! 🙏`];
  return ops[Math.floor(Math.random() * ops.length)];
}

// ════════════════════════════════════════════════════════════════
//   36. SMART KEYWORD DETECTOR (Untuk navigasi menu via ketik)
// ════════════════════════════════════════════════════════════════

const MENU_KEYWORDS = {
  // ═══ MENU UTAMA ═══
  'menu': { action: 'menu:main', label: '📋 Menu Utama', priority: 'high' },
  'menu utama': { action: 'menu:main', label: '📋 Menu Utama', priority: 'high' },
  'main menu': { action: 'menu:main', label: '📋 Menu Utama', priority: 'high' },
  'home': { action: 'menu:main', label: '📋 Menu Utama', priority: 'high' },
  'kembali ke menu': { action: 'menu:main', label: '📋 Menu Utama', priority: 'high' },
  'back to menu': { action: 'menu:main', label: '📋 Menu Utama', priority: 'high' },
  
  // ═══ CARI BARANG ═══
  'cari': { action: 'menu:4', label: '🔍 Cari Barang', priority: 'high' },
  'cari barang': { action: 'menu:4', label: '🔍 Cari Barang', priority: 'high' },
  'search': { action: 'menu:4', label: '🔍 Cari Barang', priority: 'high' },
  'lihat barang': { action: 'menu:4', label: '🔍 Cari Barang', priority: 'high' },
  'menu cari': { action: 'menu:4', label: '🔍 Cari Barang', priority: 'high' },
  
  // ═══ STOCK OPNAME ═══
  'so': { action: 'menu:5', label: '📦 Stock Opname', priority: 'high' },
  'stock opname': { action: 'menu:5', label: '📦 Stock Opname', priority: 'high' },
  'stok opname': { action: 'menu:5', label: '📦 Stock Opname', priority: 'high' },
  'opname': { action: 'menu:5', label: '📦 Stock Opname', priority: 'high' },
  'menu so': { action: 'menu:5', label: '📦 Stock Opname', priority: 'high' },
  'mulai so': { action: 'menu:5', label: '📦 Stock Opname', priority: 'high' },
  
  // ═══ LAPORAN PENJUALAN ═══
  'laporan penjualan': { action: 'menu:1', label: '📊 Laporan Penjualan', priority: 'high' },
  'lap penjualan': { action: 'menu:1', label: '📊 Laporan Penjualan', priority: 'high' },
  'menu penjualan': { action: 'menu:1', label: '📊 Laporan Penjualan', priority: 'high' },
  'penjualan': { action: 'menu:1', label: '📊 Laporan Penjualan', priority: 'medium' },
  'lap jual': { action: 'menu:1', label: '📊 Laporan Penjualan', priority: 'high' },
  
  // ═══ LAPORAN HARGA ═══
  'laporan harga': { action: 'menu:2', label: '🏷️ Laporan Harga', priority: 'high' },
  'lap harga': { action: 'menu:2', label: '🏷️ Laporan Harga', priority: 'high' },
  'menu harga': { action: 'menu:2', label: '🏷️ Laporan Harga', priority: 'high' },
  
  // ═══ LAPORAN MARKETPLACE ═══
  'laporan marketplace': { action: 'menu:3', label: '🛒 Laporan Marketplace', priority: 'high' },
  'lap marketplace': { action: 'menu:3', label: '🛒 Laporan Marketplace', priority: 'high' },
  'marketplace': { action: 'menu:3', label: '🛒 Laporan Marketplace', priority: 'high' },
  'lap mp': { action: 'menu:3', label: '🛒 Laporan Marketplace', priority: 'high' },
  'menu mp': { action: 'menu:3', label: '🛒 Laporan Marketplace', priority: 'high' },
  
  // ═══ BERITA ACARA ═══
  'berita acara': { action: 'menu:6', label: '📋 Berita Acara', priority: 'high' },
  'ba': { action: 'menu:6', label: '📋 Berita Acara', priority: 'medium' },
  'menu ba': { action: 'menu:6', label: '📋 Berita Acara', priority: 'high' },
  'buat ba': { action: 'menu:6', label: '📋 Berita Acara', priority: 'high' },

  // ═══ HOMEBASE ═══
  'homebase': { action: 'menu:7', label: '🏠 Input Homebase', priority: 'high' },
  'input homebase': { action: 'menu:7', label: '🏠 Input Homebase', priority: 'high' },
  'scan nota': { action: 'menu:7', label: '🏠 Input Homebase', priority: 'high' },
  'nota supplier': { action: 'menu:7', label: '🏠 Input Homebase', priority: 'high' },
  'banding harga': { action: 'menu:7', label: '🏠 Input Homebase', priority: 'high' },
  
  // ═══ AI CHAT ═══
  'ai': { action: 'menu:ai', label: '🤖 AI Chat', priority: 'medium' },
  'ai chat': { action: 'menu:ai', label: '🤖 AI Chat', priority: 'high' },
  'chat ai': { action: 'menu:ai', label: '🤖 AI Chat', priority: 'high' },
  'aiva': { action: 'menu:ai', label: '🤖 AI Chat', priority: 'high' },
  
  // ═══ MENU ADMIN ═══
  'admin': { action: 'menu:9', label: '👑 Menu Admin', priority: 'high', adminOnly: true },
  'menu admin': { action: 'menu:9', label: '👑 Menu Admin', priority: 'high', adminOnly: true },
  'panel admin': { action: 'menu:9', label: '👑 Menu Admin', priority: 'high', adminOnly: true },
  
  // ═══ INFO & BANTUAN ═══
  'info': { action: 'menu:info', label: 'ℹ️ Info Bot', priority: 'medium' },
  'info bot': { action: 'menu:info', label: 'ℹ️ Info Bot', priority: 'high' },
  'help': { action: 'menu:help', label: '❓ Bantuan', priority: 'high' },
  'bantuan': { action: 'menu:help', label: '❓ Bantuan', priority: 'high' },
  'panduan': { action: 'menu:help', label: '❓ Bantuan', priority: 'high' },
  'tutorial': { action: 'menu:help', label: '❓ Bantuan', priority: 'high' },
  'cara pakai': { action: 'menu:help', label: '❓ Bantuan', priority: 'high' },
};

function detectMenuKeyword(text) {
  const low = text.toLowerCase().trim();
  
  // Exact match dulu (paling akurat)
  if (MENU_KEYWORDS[low]) return { keyword: low, ...MENU_KEYWORDS[low] };
  
  // Match dengan punctuation removed
  const cleaned = low.replace(/[.,!?]/g, '').trim();
  if (MENU_KEYWORDS[cleaned]) return { keyword: cleaned, ...MENU_KEYWORDS[cleaned] };
  
  // Partial match (sorted by length, longest first untuk akurasi)
  const sortedKeys = Object.keys(MENU_KEYWORDS).sort((a, b) => b.length - a.length);
  
  for (const kw of sortedKeys) {
    const info = MENU_KEYWORDS[kw];
    
    // Match: text dimulai dengan keyword + spasi/koma
    if (low === kw) return { keyword: kw, ...info };
    if (low.startsWith(kw + ' ')) return { keyword: kw, ...info };
    if (low.startsWith(kw + ',')) return { keyword: kw, ...info };
    if (low.endsWith(' ' + kw)) return { keyword: kw, ...info };
    
    // Untuk priority HIGH, izinkan match di tengah
    if (info.priority === 'high' && low.includes(' ' + kw + ' ')) {
      return { keyword: kw, ...info };
    }
  }
  
  return null;
}

// Deteksi kalimat yang MENGANDUNG keyword menu (tapi tidak persis)
// Contoh: "buka menu utama dong" → match "menu utama"
function detectMenuInSentence(text) {
  const low = text.toLowerCase().trim();
  
  // Pattern: "buka/masuk/pergi ke MENU"
  const triggerWords = ['buka', 'masuk', 'pergi ke', 'kembali ke', 'mau ke', 'mau buka', 'ke menu', 'pindah ke'];
  
  for (const trigger of triggerWords) {
    if (low.includes(trigger)) {
      // Cek apakah ada nama menu setelah trigger
      const sortedKeys = Object.keys(MENU_KEYWORDS).sort((a, b) => b.length - a.length);
      for (const kw of sortedKeys) {
        if (low.includes(kw)) {
          return { keyword: kw, ...MENU_KEYWORDS[kw], viaSentence: true };
        }
      }
    }
  }
  
  return null;
}

// Eksekusi aksi menu secara langsung (tanpa callback)
async function executeMenuAction(chatId, userId, action) {
  // Simulasikan klik tombol
// ★ TAMBAH INI: Handler Menu Utama
  if (action === 'menu:main') {
    const userName = getNama(userId) || 'Kakak';
    return kirim(chatId, buildWelcome(userId, userName), { 
      reply_markup: kbMainMenu(userId) 
    });
  }
  
  if (action === 'menu:1' || action === 'menu:2' || action === 'menu:5' || action === 'menu:6') {
    const menuType = parseInt(action.split(':')[1]);
    if (menuType !== 4 && !bisaAksesLaporan(userId)) {
      return kirim(chatId, '🚫 Akses ditolak. Khusus staff laporan.');
    }
    const labels = { 1: 'Laporan Penjualan', 2: 'Laporan Harga', 5: 'Stock Opname', 6: 'Berita Acara' };
    return kirim(chatId, `🏦 *Pilih Toko - ${labels[menuType]}*\n${GARIS_TEBAL}`, { 
      reply_markup: kbPilihToko(menuType, menuType === 6) 
    });
  }
  
  if (action === 'menu:3') {
    resetSesi(userId);
    updateSesi(userId, { menu: 3 });
    return kirim(chatId, '🛒 *Laporan Marketplace*\n\nPilih hari:', {
      reply_markup: kbPilihHari(3, 'mp')
    });
  }
  
  if (action === 'menu:4') {
    return kirim(chatId, '🔍 *Cari Barang*\n\nKetik nama barang atau kode.\n\n*Contoh:*\n• `dandang eagle 20`\n• `harga panci di cp`\n• `grosir kompor`', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]]}
    });
  }
  
  if (action === 'menu:ai') {
    return kirim(chatId, '🤖 *AI Chat*\n\nKetik pertanyaan apa saja!', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]]}
    });
  }
    // ★ Homebase
  if (action === 'menu:7') {
    if (!bisaAksesLaporan(userId)) return kirim(chatId, '🚫 Akses ditolak.');
    return kirim(chatId, `🏠 *INPUT BARANG HOMEBASE*\n${GARIS_TEBAL}\n\nPilih toko:`, {
      reply_markup: kbPilihToko(7)
    });
  }
  if (action === 'menu:9' && isAdmin(userId)) {
    return kirim(chatId, '👑 *MENU ADMIN*', { reply_markup: kbAdminMenu() });
  }
  
  if (action === 'menu:info') {
    const uptime = Math.floor(process.uptime());
    return kirim(chatId,
      `ℹ️ *INFO BOT*\n${GARIS_TEBAL}\n🤖 ${CONFIG.appName}\n📦 ${DATA_BARANG.length} barang\n👥 ${MEMBERS.length} members\n⏱️ Uptime: ${Math.floor(uptime/3600)}j ${Math.floor((uptime%3600)/60)}m\n\n*Your Info:*\n🆔 \`${userId}\`\n📛 ${getUserRole(userId)}`
    );
  }
  
  if (action === 'menu:help') {
    return kirim(chatId,
      '❓ *PANDUAN*\n' + GARIS_TEBAL + '\n\n' +
      '💬 *Cara cepat (ketik langsung):*\n' +
      '• `stock opname` - buka SO\n' +
      '• `cari barang` - cari\n' +
      '• `laporan harga` - lap harga\n' +
      '• `marketplace` - lap mp\n' +
      '• `berita acara` - BA\n' +
      '• `info` - info bot\n\n' +
      '🔍 *Cari barang langsung:*\n' +
      'Ketik: `cari [nama]` atau `harga [nama]`\n' +
      '*Contoh:* `cari dandang eagle`\n\n' +
      '*Kode Toko:* NK, TDM, Oesapa, Kefa, CP',
      { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]]}}
    );
  }
}

// Cek apakah teks tampak seperti query cari barang (dengan keyword eksplisit)
function isCariBarangCommand(low) {
  const cariKeywords = ['cari ', 'harga ', 'stok ', 'stock ', 'cek ', 'lihat ', 'beli '];
  return cariKeywords.some(k => low.startsWith(k));
}

// Cek apakah ini kode barang (NN00001, dll)
function isKodeBarang(text) {
  return /^[a-z]{2,5}\d{2,6}$/i.test(text.trim());
}

// ════════════════════════════════════════════════════════════════
//   36B. MAIN MESSAGE HANDLER (SMART ROUTING + KONFIRMASI)
// ════════════════════════════════════════════════════════════════

bot.on('message', async (msg) => {
  if (msg.text && msg.text.startsWith('/')) return;
  if (!msg.text) return;
  if (msg.voice || msg.photo || msg.document) return;
  
  const chatId = msg.chat.id;
  const userId = msg.from.id;
  const text = msg.text.trim();
  const low = text.toLowerCase();
  
  if (!isMember(userId)) {
    return kirim(chatId, buildGuestWelcome(msg.from.first_name, userId));
  }
  
  trackChat(userId, text);
  const session = getSesi(userId);
  
  // ★ PRIORITY 1: Mode aktif (route DULU sebelum apapun)
    if (session.scanActive) {
    return handleScanModeLaporan(chatId, userId, text, null, session);
  }
  
  // ★ Homebase mode
  if (session.mode === 'homebase') {
    return handleHomebaseMode(chatId, userId, text, null, session);
  }
  
  if (session.hargaActive) {
    return handleHargaMode(chatId, userId, text, null, session);
  }
  
  if (session.mode === 'stockopname') {
    return handleStockOpnameMode(chatId, userId, text, session);
  }
  
  if (session.mode === 'beritaacara') {
    return handleBeritaAcaraMode(chatId, userId, text, session);
  }
  
  if (session.menu === 3 && session.kemarin !== undefined) {
    const laporan = genLapMarket(text, session.kemarin);
    await kirim(chatId, laporan);
    resetSesi(userId);
    return kirim(chatId, '✅ *Laporan Marketplace selesai!*', { reply_markup: kbMainMenu(userId) });
  }
  
  // ★ PRIORITY 2: Konfirmasi pending (user merespons konfirmasi sebelumnya)
  if (session.pendingKonfirmasi) {
    const pk = session.pendingKonfirmasi;
    updateSesi(userId, { pendingKonfirmasi: null });
    
    if (low === 'ya' || low === 'y' || low === 'yes' || low === 'ok' || low === 'oke') {
      // User setuju → jalankan aksi
      if (pk.action === 'cari') {
        return prosesCari(chatId, userId, pk.text, null);
      }
      if (pk.action === 'menu') {
        return executeMenuAction(chatId, userId, pk.menuAction);
      }
    } else if (low === 'tidak' || low === 'no' || low === 'n' || low === 'batal') {
      return kirim(chatId, '👌 OK, dibatalkan.', { reply_markup: kbMainMenu(userId) });
    } else {
      // User ketik hal lain → anggap perintah baru, lanjut proses normal
    }
  }

    // ★ PRIORITY 2.5: Konfirmasi pending menu navigation
  if (session.pendingMenuAction) {
    const pendingAction = session.pendingMenuAction;
    const pendingLabel = session.pendingMenuLabel || 'menu';
    updateSesi(userId, { pendingMenuAction: null, pendingMenuLabel: null });
    
    if (low === 'ya' || low === 'y' || low === 'yes' || low === 'ok' || low === 'oke') {
      return executeMenuAction(chatId, userId, pendingAction);
    } else if (low === 'tidak' || low === 'no' || low === 'n' || low === 'batal' || low === 'gak') {
      return kirim(chatId, `Oke kak, dibatalkan 😊 Mau ngapain?`, { reply_markup: kbMainMenu(userId) });
    }
    // Kalau jawaban lain, lanjut proses normal (jangan re-trigger menu)
  }
  
  // ★ PRIORITY 3: Reset commands
  if (KATA_RESET.includes(low)) {
    resetSesi(userId);
    return kirim(chatId, '📋 *MENU UTAMA*', { reply_markup: kbMainMenu(userId) });
  }
  
    // ★ PRIORITY 4: Menu keyword detection (SUPER PRIORITAS!)
  
  // 4A. Exact/Partial match keyword
  const menuMatch = detectMenuKeyword(text);
  if (menuMatch) {
    if (menuMatch.adminOnly && !isAdmin(userId)) {
      return kirim(chatId, '🚫 Khusus admin.');
    }
    
    // High priority → langsung eksekusi
    if (menuMatch.priority === 'high') {
      log.info('MENU', `[HIGH] "${low}" → ${menuMatch.label}`);
      return executeMenuAction(chatId, userId, menuMatch.action);
    }
    
    // Medium priority → tanya konfirmasi
    if (menuMatch.priority === 'medium') {
      log.info('MENU', `[MEDIUM] "${low}" → konfirmasi ${menuMatch.label}`);
      
      updateSesi(userId, { 
        pendingMenuAction: menuMatch.action,
        pendingMenuLabel: menuMatch.label,
      });
      
      return kirim(chatId,
        `🤔 Maksudnya mau buka *${escapeMd(menuMatch.label)}* ya kak?`,
        { reply_markup: { inline_keyboard: [
          [
            { text: `✅ Ya, Buka ${menuMatch.label}`, callback_data: `gomenu:yes` },
            { text: '❌ Bukan', callback_data: 'gomenu:no' },
          ],
          [{ text: '📋 Menu Utama', callback_data: 'menu:main' }],
        ]}}
      );
    }
  }
  
  // 4B. Deteksi kalimat yang MINTA buka menu
  const sentenceMatch = detectMenuInSentence(text);
  if (sentenceMatch) {
    if (sentenceMatch.adminOnly && !isAdmin(userId)) {
      return kirim(chatId, '🚫 Khusus admin.');
    }
    log.info('MENU', `[SENTENCE] "${low}" → ${sentenceMatch.label}`);
    
    // Untuk via sentence, tanya konfirmasi
    updateSesi(userId, { 
      pendingMenuAction: sentenceMatch.action,
      pendingMenuLabel: sentenceMatch.label,
    });
    
    return kirim(chatId,
      `🤔 Kakak mau buka *${escapeMd(sentenceMatch.label)}* ya?`,
      { reply_markup: { inline_keyboard: [
        [
          { text: `✅ Ya, Buka`, callback_data: `gomenu:yes` },
          { text: '❌ Tidak', callback_data: 'gomenu:no' },
        ],
      ]}}
    );
  }
  
  // ★ PRIORITY 5: Sapaan
  const kataSapaan = isSapaan(low);
  if (kataSapaan) {
    await kirim(chatId, balasSapaan(userId, kataSapaan));
    await tunggu(600);
    return kirim(chatId, '📋 *Mau cari apa?*', { reply_markup: kbMainMenu(userId) });
  }
  
  // ★ PRIORITY 6: Terima Kasih
  if (isTerimakasih(low)) {
    return kirim(chatId, balasTerimakasih(userId));
  }
  
  // ★ PRIORITY 7: Cari barang EKSPLISIT (ada keyword "cari", "harga", dll)
  if (isCariBarangCommand(low)) {
    // Hapus keyword "cari/harga/stok" dari awal
    const keyword = text.replace(/^(cari|harga|stok|stock|cek|lihat|beli)\s+/i, '').trim();
    if (keyword.length >= 2) {
      return prosesCari(chatId, userId, keyword, null);
    }
    return kirim(chatId, '⚠️ Ketik nama barang setelah `cari`.\n\n*Contoh:* `cari dandang eagle 20`');
  }
  
  // ★ PRIORITY 8: Kode barang (NN00001, KS00456, dll) → langsung cari
  if (isKodeBarang(text)) {
    return prosesCari(chatId, userId, text, null);
  }
  
  
  // ★ PRIORITY 10: Teks pendek/tidak jelas → tampilkan menu
  if (text.length < 4) {
    return kirim(chatId, 
      `🤔 Saya tidak mengerti "${escapeMd(text)}"\n\n` +
      `💡 *Coba ketik:*\n` +
      `• \`stock opname\` - buka SO\n` +
      `• \`cari [nama barang]\` - cari\n` +
      `• \`info\` - info bot\n` +
      `• \`menu\` - menu utama\n\n` +
      `Atau pilih dari tombol:`,
      { reply_markup: kbMainMenu(userId) }
    );
  }
  
    // ★ PRIORITY 11: Smart routing via prosesAI
  // prosesAI sudah include router pintar (cari barang vs ngobrol)
  return prosesAI(chatId, userId, text);
});
// ════════════════════════════════════════════════════════════════
//   37. CALLBACK QUERY HANDLER (LENGKAP - Semua Callback + Pagination)
// ════════════════════════════════════════════════════════════════

bot.on('callback_query', async (query) => {
  const chatId = query.message.chat.id;
  const userId = query.from.id;
  const data = query.data;
  const msgId = query.message.message_id;
  
  try { await bot.answerCallbackQuery(query.id); } catch(e) {}
  
  // ════════════ PAGINATION CARI BARANG ════════════
  
  if (data.startsWith('caripage:')) {
    const page = parseInt(data.replace('caripage:', ''));
    const session = getSesi(userId);
    
    if (!session.lastSearch || !session.lastSearch.keyword) {
      await kirim(chatId, '⚠️ Session pencarian expired. Silakan cari lagi.', {
        reply_markup: { inline_keyboard: [[{ text: '🔄 Cari Lagi', callback_data: 'menu:4' }]] }
      });
      return;
    }
    
    try { await bot.deleteMessage(chatId, msgId); } catch(e) {}
    
    const ls = session.lastSearch;
    await prosesCari(chatId, userId, ls.keyword, ls.tokoFilter, page);
    return;
  }
  
  if (data === 'caripageinfo') {
    try {
      await bot.answerCallbackQuery(query.id, {
        text: '📄 Info halaman - klik ⬅️ / ➡️ untuk navigasi',
        show_alert: false
      });
    } catch(e) {}
    return;
  }
  
  // ════════════ KONFIRMASI AI ROUTER ════════════
  
  if (data.startsWith('airouter:cari:')) {
    const textB64 = data.replace('airouter:cari:', '');
    let originalText = '';
    try { originalText = Buffer.from(textB64, 'base64').toString('utf8'); } catch(e) {}
    if (!originalText) {
      const session = getSesi(userId);
      originalText = session.aiPendingQuery || '';
    }
    if (!originalText) return kirim(chatId, '⚠️ Query hilang, coba ketik ulang.');
    updateSesi(userId, { aiPendingQuery: null });
    await prosesCari(chatId, userId, originalText, null);
    return;
  }
  
  if (data === 'airouter:batal') {
    updateSesi(userId, { aiPendingQuery: null });
    try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }); } catch(e) {}
    await kirim(chatId, `Oke kak, lanjut ngobrol aja 😊 Mau apa nih?`);
    return;
  }
  
  // ════════════ KONFIRMASI MENU NAVIGATION ════════════
  
  if (data === 'gomenu:yes') {
    const session = getSesi(userId);
    const action = session.pendingMenuAction;
    if (!action) return kirim(chatId, '⚠️ Aksi hilang, coba lagi.', { reply_markup: kbMainMenu(userId) });
    updateSesi(userId, { pendingMenuAction: null, pendingMenuLabel: null });
    try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }); } catch(e) {}
    await executeMenuAction(chatId, userId, action);
    return;
  }
  
  if (data === 'gomenu:no') {
    updateSesi(userId, { pendingMenuAction: null, pendingMenuLabel: null });
    try { await bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: msgId }); } catch(e) {}
    await kirim(chatId, `Oke kak, lanjut aja 😊 Mau apa?`);
    return;
  }
  
  // ════════════ KONFIRMASI CARI BARANG ════════════
  
  if (data.startsWith('konfirm:cari:')) {
    const textB64 = data.replace('konfirm:cari:', '');
    let originalText = '';
    try { originalText = Buffer.from(textB64, 'base64').toString('utf8'); } catch(e) {}
    if (!originalText) {
      const session = getSesi(userId);
      originalText = session.pendingKonfirmasi?.text || '';
    }
    if (!originalText) return kirim(chatId, '⚠️ Teks hilang, coba lagi.');
    updateSesi(userId, { pendingKonfirmasi: null });
    await prosesCari(chatId, userId, originalText, null);
    return;
  }
  
  if (data === 'konfirm:batal') {
    updateSesi(userId, { pendingKonfirmasi: null });
    try { await bot.editMessageText('👌 Dibatalkan.', { chat_id: chatId, message_id: msgId, reply_markup: kbMainMenu(userId) }); } catch(e) { await kirim(chatId, '👌 OK.', { reply_markup: kbMainMenu(userId) }); }
    return;
  }
  
  // ════════════ MENU NAVIGATION ════════════
  
  if (data === 'menu:main') {
    const userName = getNama(userId) || query.from.first_name || 'Kakak';
    try {
      await bot.editMessageText(buildWelcome(userId, userName), {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'Markdown', reply_markup: kbMainMenu(userId)
      });
    } catch(e) {
      await kirim(chatId, buildWelcome(userId, userName), { reply_markup: kbMainMenu(userId) });
    }
    return;
  }
  
  if (data === 'menu:1' || data === 'menu:2' || data === 'menu:5' || data === 'menu:6') {
    const menuType = parseInt(data.split(':')[1]);
    if (menuType !== 4 && !bisaAksesLaporan(userId)) return kirim(chatId, '🚫 Akses ditolak.');
    const labels = { 1: 'Laporan Penjualan', 2: 'Laporan Harga', 5: 'Stock Opname', 6: 'Berita Acara' };
    
    try {
      await bot.editMessageText(`🏦 *Pilih Toko - ${labels[menuType]}*\n${GARIS_TEBAL}`, {
        chat_id: chatId, message_id: msgId,
        parse_mode: 'Markdown', reply_markup: kbPilihToko(menuType, menuType === 6)
      });
    } catch(e) {
      await kirim(chatId, `🏦 *Pilih Toko - ${labels[menuType]}*`, { reply_markup: kbPilihToko(menuType, menuType === 6) });
    }
    return;
  }
  
  if (data === 'menu:3') {
    resetSesi(userId);
    updateSesi(userId, { menu: 3 });
    kirim(chatId, '🛒 *Laporan Marketplace*\n\nPilih hari:', { reply_markup: kbPilihHari(3, 'mp') });
    return;
  }
  
  if (data === 'menu:4') {
    try {
      await bot.editMessageText('🔍 *Cari Barang*\n\nKetik nama barang atau kode.\n\n*Contoh:*\n• `dandang eagle 20`\n• `harga panci di cp`\n• `grosir kompor`', {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]]}
      });
    } catch(e) {}
    return;
  }
  
  if (data === 'menu:ai') {
    const nama = getNama(userId) || 'kak';
    try {
      await bot.editMessageText(`🤖 *Halo ${escapeMd(nama)}! Aku Aiva* 😊\n\nAku temen ngobrol kamu! Yuk cerita apa aja 💬\n\n• Curhat & cerita harian\n• Tanya info umum & pengetahuan\n• Cek barang & harga toko\n• Apa aja deh 😄\n\n_Ketik \`/resetchat\` untuk reset memori_`, {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]]}
      });
    } catch(e) {}
    return;
  }
  
  if (data === 'menu:7') {
    if (!bisaAksesLaporan(userId)) return kirim(chatId, '🚫 Akses ditolak.');
    try {
      await bot.editMessageText(`🏠 *INPUT BARANG HOMEBASE*\n${GARIS_TEBAL}\n\nPilih toko untuk bandingkan harga:`, {
        chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
        reply_markup: kbPilihToko(7)
      });
    } catch(e) {
      await kirim(chatId, '🏠 *INPUT HOMEBASE*\nPilih toko:', { reply_markup: kbPilihToko(7) });
    }
    return;
  }
  
  if (data === 'menu:9' && isAdmin(userId)) {
    try {
      await bot.editMessageText('👑 *MENU ADMIN*', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: kbAdminMenu() });
    } catch(e) {
      await kirim(chatId, '👑 *MENU ADMIN*', { reply_markup: kbAdminMenu() });
    }
    return;
  }
  
  if (data === 'menu:info') {
    const uptime = Math.floor(process.uptime());
    await kirim(chatId,
      `ℹ️ *INFO BOT*\n${GARIS_TEBAL}\n🤖 ${CONFIG.appName}\n📦 ${DATA_BARANG.length} barang\n👥 ${MEMBERS.length} members\n⏱️ Uptime: ${Math.floor(uptime/3600)}j ${Math.floor((uptime%3600)/60)}m\n\n*Your Info:*\n🆔 \`${userId}\`\n📛 ${getUserRole(userId)}`
    );
    return;
  }
  
  if (data === 'menu:help') {
    try {
      await bot.editMessageText(
        '❓ *PANDUAN*\n' + GARIS_TEBAL + '\n\n' +
        '💬 *Cara cepat:*\n' +
        '• `stock opname` - buka SO\n' +
        '• `cari barang` - cari\n' +
        '• `laporan harga` - lap harga\n' +
        '• `marketplace` - lap mp\n' +
        '• `berita acara` - BA\n' +
        '• `homebase` - input nota supplier\n' +
        '• `info` - info bot\n' +
        '• `menu utama` - balik ke menu\n\n' +
        '🔍 *Cari barang:*\n' +
        '`cari [nama]` atau `harga [nama]`\n' +
        '*Contoh:* `cari dandang eagle`\n\n' +
        '*Kode Toko:* NK, TDM, Oesapa, Kefa, CP',
        {
          chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]]}
        }
      );
    } catch(e) {}
    return;
  }
  
  // ════════════ HOMEBASE ACTIONS ════════════
  
  if (data === 'homebase:selesai') {
    const session = getSesi(userId);
    await handleHomebaseMode(chatId, userId, 'selesai', null, session);
    return;
  }
  
  if (data === 'homebase:review') {
    const session = getSesi(userId);
    await handleHomebaseMode(chatId, userId, 'review', null, session);
    return;
  }
  
  if (data === 'homebase:reset') {
    updateSesi(userId, { homebaseItems: [] });
    await kirim(chatId, '🗑️ Data direset.', {
      reply_markup: { inline_keyboard: [[{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]] }
    });
    return;
  }
  
  // ════════════ PILIH TOKO ════════════
  
  if (data.startsWith('toko:')) {
    const [, menuType, tokoKode] = data.split(':');
    const toko = TOKO_LIST.find(t => t.kode === tokoKode);
    if (!toko) return;
    
    if (menuType === '4') {
      kirim(chatId, `🔍 Ketik nama barang untuk dicari di *${toko.nama}*`);
      return;
    }
    
    if (menuType === '5') {
      // Stock Opname
      const shared = getSOShared(toko.kode);
      const usersAktif = getAllUsersAktif(toko.kode);
      const allRacks = getAllRacks(toko.kode);
      const totalUsersAktif = Object.keys(usersAktif).length;
      const totalRacks = Object.keys(allRacks).length;
      
      updateSesi(userId, {
        mode: 'stockopname', tokoKode: toko.kode,
        soInfo: { petugas: [], rakHistory: [], rakAktif: null, jamMulaiAktif: null },
        soData: { fisik: {}, gudang: {} }, pendingBarangKode: null,
      });
      
      if (totalUsersAktif > 0 || totalRacks > 0) {
        let m = `📦 *STOCK OPNAME*\n🏦 ${toko.nama}\n📅 ${getTanggalSlash(false)}\n${GARIS_TEBAL}\n\n`;
        m += `⚠️ *SUDAH ADA SO BERJALAN HARI INI!*\n\n`;
        
        if (totalUsersAktif > 0) {
          m += `👥 *PETUGAS AKTIF (${totalUsersAktif}):*\n${GARIS_TIPIS}\n`;
          Object.entries(usersAktif).forEach(([uid, info], i) => {
            const lastMin = Math.floor((Date.now() - info.lastActive) / 60000);
            const st = lastMin < 5 ? '🟢' : lastMin < 15 ? '🟡' : '🔴';
            m += `${i+1}. ${st} *${info.nama}*\n   📦 Rak: ${info.rakAktif}\n   ⏰ Mulai: ${info.jamMulai} | ${lastMin < 1 ? 'baru saja' : lastMin + 'm lalu'}\n\n`;
          });
        }
        
        if (totalRacks > 0) {
          m += `📦 *RAK YANG SUDAH ADA (${totalRacks}):*\n${GARIS_TIPIS}\n`;
          Object.entries(allRacks).forEach(([rakName, rackData], i) => {
            const itemCount = Object.keys(rackData.items || {}).length;
            const pegangRak = Object.values(usersAktif).find(u => u.rakAktif === rakName);
            const statusRak = pegangRak ? `🟢 ${pegangRak.nama}` : '⚪ Kosong';
            m += `${i+1}. *${rakName}* (${itemCount} barang)\n   ${statusRak}\n`;
          });
          m += '\n';
        }
        
        m += `${GARIS_TEBAL}\n💬 *Apa yang ingin Anda lakukan?*`;
        
        const buttons = [
          [{ text: '➕ Bergabung (Daftar Petugas Baru)', callback_data: `so:join` }],
        ];
        if (totalRacks > 0) buttons.push([{ text: '✏️ Edit Rak Yang Sudah Ada', callback_data: 'so:editrakawal' }]);
        buttons.push([{ text: '🆕 Mulai SO BARU (Reset Data)', callback_data: 'so:reset_confirm' }]);
        buttons.push([{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]);
        
        try { await bot.editMessageText(m, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } }); }
        catch(e) { await kirim(chatId, m, { reply_markup: { inline_keyboard: buttons } }); }
        return;
      }
      
      updateSesi(userId, { soSetupStep: 'petugas' });
      try {
        await bot.editMessageText(`📦 *STOCK OPNAME*\n🏦 ${toko.nama}\n📅 ${getTanggalSlash(false)}\n${GARIS_TEBAL}\n\n✨ *SO BARU*\n\n👥 *STEP 1/3: Nama Petugas*\n\nKetik nama petugas.\nJika lebih dari 1, pisah koma.\n\n*Contoh:* \`Budi\` atau \`Budi, Sari\`\n\nKetik *batal* untuk keluar.`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
      } catch(e) {
        await kirim(chatId, `📦 *STOCK OPNAME - ${toko.nama}*\n\n👥 *STEP 1/3: Nama Petugas*\nKetik nama petugas.`);
      }
      return;
    }
    
    if (menuType === '6') {
      const nomorBA = generateNomorBA(toko.kode);
      const baData = { nomorBA, penambahanKasir: [], penyesuaianTambah: [], penyesuaianKurang: [], salahKetikRetur: [], barangMasuk: [], dicoretGudang: [] };
      updateSesi(userId, { mode: 'beritaacara', tokoKode: toko.kode, baData, baSection: null });
      try {
        await bot.editMessageText(`📋 *BERITA ACARA*\n🏦 ${toko.nama}\n📅 ${getTanggalIndonesia()}\n🆔 *${nomorBA}*\n${GARIS_TEBAL}`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: kbBaSection(baData) });
      } catch(e) {
        await kirim(chatId, `📋 *BERITA ACARA*\n🏦 ${toko.nama}\n🆔 ${nomorBA}`, { reply_markup: kbBaSection(baData) });
      }
      return;
    }
    
    if (menuType === '7') {
      // Homebase
      updateSesi(userId, { mode: 'homebase', homebaseToko: toko.kode, homebaseItems: [] });
      try {
        await bot.editMessageText(
          `🏠 *INPUT BARANG HOMEBASE*\n🏦 ${toko.nama}\n📅 ${getTanggalIndonesia()}\n${GARIS_TEBAL}\n\n` +
          `📸 *Kirim FOTO nota/faktur supplier*\n\nBot akan:\n` +
          `1. 📸 Scan nama, HPP, Harga B & D\n` +
          `2. 🔗 Cocokkan dengan database\n` +
          `3. 📊 Bandingkan harga\n` +
          `4. 📥 Export Excel\n\n` +
          `Bisa kirim beberapa foto.\nKetik *batal* untuk keluar.`,
          { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' }
        );
      } catch(e) {
        await kirim(chatId, `🏠 *HOMEBASE - ${toko.nama}*\n\n📸 Kirim foto nota.`);
      }
      return;
    }
    
    try { await bot.editMessageText(`🏦 *${toko.nama}*\n📅 Pilih hari:`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: kbPilihHari(menuType, tokoKode) }); } catch(e) {}
    return;
  }
  
  // ════════════ PILIH HARI ════════════
  
  if (data.startsWith('hari:')) {
    const [, menuType, tokoKode, kemarinFlag] = data.split(':');
    const kemarin = kemarinFlag === '1';
    const toko = TOKO_LIST.find(t => t.kode === tokoKode);
    
    if (menuType === '1') {
      updateSesi(userId, { menu: 1, toko: tokoKode, kemarin, scanActive: true, scanData: {}, scanStepIdx: 0 });
      const steps = SCAN_STEPS[tokoKode];
      const si = steps[0];
      try {
        await bot.editMessageText(`📸 *SCAN LAPORAN*\n🏦 ${toko.nama}\n📅 ${getTanggal(kemarin)}\n${GARIS_TEBAL}\n\n📊 Step 1/${steps.length}\n💵 *${si.label}*\n\n📸 Kirim FOTO atau ketik angka manual`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
      } catch(e) {}
      return;
    }
    
    if (menuType === '2') {
      updateSesi(userId, { menu: 2, toko: tokoKode, kemarin, hargaPilihMode: true, hargaData: { baru: [], naik: [], turun: [] } });
      try {
        await bot.editMessageText(`📸 *WIZARD LAPORAN HARGA*\n🏦 ${toko?.nama || NAMA_TOKO[tokoKode]}\n📅 ${getTanggal(kemarin)}\n${GARIS_TEBAL}\n\n📋 *Pilih mode input:*`, {
          chat_id: chatId, message_id: msgId, parse_mode: 'Markdown',
          reply_markup: { inline_keyboard: [
            [{ text: '1️⃣ Gabung (1 foto semua)', callback_data: 'hargamode:gabung' }],
            [{ text: '2️⃣ Per Kategori (3 step)', callback_data: 'hargamode:perkat' }],
            [{ text: '🔙 Batal', callback_data: 'menu:main' }],
          ]}
        });
      } catch(e) {}
      return;
    }
    
    if (menuType === '3') {
      updateSesi(userId, { menu: 3, kemarin });
      try {
        await bot.editMessageText(`🛒 *Laporan Marketplace*\n📅 ${getTanggal(kemarin)}\n\nKirim foto atau ketik format:\n\`\`\`\noesapa 0\ntdm 0\ncentral 21061000\n\`\`\``, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown' });
      } catch(e) {}
      return;
    }
  }
  
  // ════════════ HARGA MODE ════════════
  
  if (data === 'hargamode:gabung') {
    updateSesi(userId, { hargaPilihMode: false, hargaActive: true, hargaMode: 'GABUNG' });
    kirim(chatId, '✅ *Mode: GABUNG*\n\n📸 Kirim 1 foto berisi semua kategori.', { reply_markup: { inline_keyboard: [[{ text: '🔙 Batal', callback_data: 'menu:main' }]] } });
    return;
  }
  
  if (data === 'hargamode:perkat') {
    updateSesi(userId, { hargaPilihMode: false, hargaActive: true, hargaMode: 'PERKATEGORI', hargaStepIdx: 0 });
    const session = getSesi(userId);
    await kirimMintaFotoHarga(chatId, 0, NAMA_TOKO[session.toko], session.hargaData || { baru: [], naik: [], turun: [] });
    return;
  }
  
  if (data === 'harga:lanjut' || data === 'harga:selesai') {
    const session = getSesi(userId);
    await handleHargaMode(chatId, userId, data.split(':')[1], null, session);
    return;
  }
  
  if (data === 'harga:samekat') {
    const session = getSesi(userId);
    if (!session.hargaActive) return kirim(chatId, '⚠️ Session expired.', { reply_markup: kbMainMenu(userId) });
    const KATEGORI = ['baru', 'naik', 'turun'];
    const NAMA_KAT = { baru: 'BARANG BARU', naik: 'BARANG NAIK HARGA', turun: 'BARANG TURUN HARGA' };
    const currentKat = KATEGORI[session.hargaStepIdx || 0];
    const namaToko = NAMA_TOKO[session.toko] || 'Toko';
    await kirim(chatId, `📸 *Kirim foto lagi:*\n🏪 ${namaToko}\n📋 ${NAMA_KAT[currentKat]}\n\n💡 Item duplikat tidak akan ditambahkan.`, { reply_markup: { inline_keyboard: [[{ text: '⏭️ Lanjut Kategori', callback_data: 'harga:lanjut' }, { text: '✅ Selesai', callback_data: 'harga:selesai' }]] } });
    return;
  }
  
  // ════════════ DETAIL BARANG ════════════
  
  if (data.startsWith('detail:')) {
    const [, kode, tokoKode] = data.split(':');
    const item = DATA_BARANG.find(d => d.kode === kode);
    if (!item) return;
    const buttons = [];
    TOKO_LIST.forEach(t => { if (t.kode !== tokoKode) buttons.push([{ text: `${t.icon} Lihat di ${t.nama}`, callback_data: `detail:${kode}:${t.kode}` }]); });
    buttons.push([{ text: '🌐 Semua Toko', callback_data: `detail:${kode}:all` }]);
    buttons.push([{ text: '🔙 Kembali ke Hasil', callback_data: `caripage:${(getSesi(userId).lastSearch?.currentPage || 0)}` }]);
    buttons.push([{ text: '📋 Menu Utama', callback_data: 'menu:main' }]);
    try {
      await bot.editMessageText(buildDetailBarang(item, tokoKode, 'semua'), { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: buttons } });
    } catch(e) {
      await kirim(chatId, buildDetailBarang(item, tokoKode, 'semua'), { reply_markup: { inline_keyboard: buttons } });
    }
    return;
  }
  
  // ════════════ STOCK OPNAME: BASIC ACTIONS ════════════
  
  if (data.startsWith('so:pick:')) {
    const kode = data.replace('so:pick:', '');
    const item = DATA_BARANG.find(d => d.kode === kode);
    if (!item) return;
    const session = getSesi(userId);
    updateSesi(userId, { pendingBarangKode: kode });
    kirim(chatId, tampilkanBarangPilihan(item, session.tokoKode, userId, session.soInfo?.rakAktif));
    return;
  }
  
  if (data === 'so:review') { const session = getSesi(userId); await handleStockOpnameMode(chatId, userId, 'review', session); return; }
  if (data === 'so:selesai') { const session = getSesi(userId); await handleStockOpnameMode(chatId, userId, 'selesai', session); return; }
  if (data === 'so:userlain') { const session = getSesi(userId); await handleStockOpnameMode(chatId, userId, 'userlain', session); return; }
  if (data === 'so:pindahrak') { const session = getSesi(userId); await handleStockOpnameMode(chatId, userId, 'pindahrak', session); return; }
  if (data === 'so:editrak') { const session = getSesi(userId); await handleStockOpnameMode(chatId, userId, 'editrak', session); return; }
  
  // ════════════ STOCK OPNAME: JOIN / RESET ════════════
  
  if (data === 'so:join') {
    const session = getSesi(userId);
    if (!session.tokoKode) return;
    updateSesi(userId, { soSetupStep: 'petugas' });
    const usersAktif = getAllUsersAktif(session.tokoKode);
    let m = `➕ *BERGABUNG KE SO*\n🏦 ${NAMA_TOKO[session.tokoKode]}\n${GARIS_TEBAL}\n\n👥 *Petugas yang sudah ada:*\n`;
    Object.entries(usersAktif).forEach(([, info], i) => { m += `   ${i+1}. ${info.nama} (di ${info.rakAktif})\n`; });
    m += `\n${GARIS_TIPIS}\n\n👤 *Siapa nama Anda?*\n\nKetik nama.\n*Contoh:* \`Joko\` atau \`Joko, Andi\`\n\nKetik *batal* untuk keluar.`;
    await kirim(chatId, m);
    return;
  }
  
  if (data === 'so:editrakawal') {
    const session = getSesi(userId);
    if (!session.tokoKode) return;
    const allRacks = getAllRacks(session.tokoKode);
    const usersAktif = getAllUsersAktif(session.tokoKode);
    if (Object.keys(allRacks).length === 0) return kirim(chatId, '⚠️ Belum ada rak.', { reply_markup: kbMainMenu(userId) });
    const namaPetugas = getNama(userId) || 'User';
    updateSesi(userId, { mode: 'stockopname', soInfo: { petugas: [namaPetugas], rakHistory: [], rakAktif: 'EDIT_MODE', jamMulaiAktif: getJamSekarang() }, soData: { fisik: {}, gudang: {} }, soSetupStep: null, pendingBarangKode: null });
    let m = `✏️ *EDIT RAK*\n🏦 ${NAMA_TOKO[session.tokoKode]}\n${GARIS_TEBAL}\n\nPilih rak:\n\n`;
    const buttons = [];
    Object.entries(allRacks).forEach(([rakName, rackData]) => {
      const itemCount = Object.keys(rackData.items || {}).length;
      const pegangRak = Object.values(usersAktif).find(u => u.rakAktif === rakName);
      const statusIcon = pegangRak ? '🟢' : '⚪';
      m += `${statusIcon} *${rakName}* — ${itemCount} barang ${pegangRak ? `(${pegangRak.nama})` : ''}\n`;
      if (itemCount > 20) {
        buttons.push([
          { text: `📋 ${rakName} (Detail)`, callback_data: `so:editrak:${rakName}:0` },
          { text: `⚡ Quick`, callback_data: `so:quickeditrak:${rakName}:0` },
        ]);
      } else {
        buttons.push([{ text: `✏️ ${rakName} (${itemCount} barang)`, callback_data: `so:editrak:${rakName}:0` }]);
      }
    });
    buttons.push([{ text: '🔙 Menu Utama', callback_data: 'menu:main' }]);
    await kirim(chatId, m, { reply_markup: { inline_keyboard: buttons } });
    return;
  }
  
  if (data === 'so:reset_confirm') {
    const session = getSesi(userId);
    if (!session.tokoKode) return;
    const allRacks = getAllRacks(session.tokoKode);
    let totalItems = 0;
    Object.values(allRacks).forEach(r => { totalItems += Object.keys(r.items || {}).length; });
    await kirim(chatId, `⚠️ *PERINGATAN: RESET SO!*\n${GARIS_TEBAL}\n\n❌ *Data akan DIBACKUP & DIHAPUS:*\n   📦 ${Object.keys(allRacks).length} rak\n   📊 ${totalItems} jenis barang\n\n💡 Data lama disimpan ke history.\n\n*Yakin mau reset?*`, { reply_markup: { inline_keyboard: [[{ text: '🚨 YA, RESET', callback_data: 'so:reset_yes' }], [{ text: '❌ Batal', callback_data: 'menu:main' }]] } });
    return;
  }
  
  if (data === 'so:reset_yes') {
    const session = getSesi(userId);
    if (!session.tokoKode) return;
    if (typeof backupSOShared === 'function') backupSOShared(session.tokoKode);
    SO_SHARED[session.tokoKode] = { tanggal: getTanggalSlash(false), sesiAktif: false, racks: {}, usersAktif: {} };
    saveJSON(CONFIG.paths.soShared, SO_SHARED);
    updateSesi(userId, { soSetupStep: 'petugas' });
    await kirim(chatId, `✅ *Data lama di-backup & direset!*\n${GARIS_TEBAL}\n\n🆕 *SO BARU - ${NAMA_TOKO[session.tokoKode]}*\n\n👥 *STEP 1/3: Nama Petugas*\n\nKetik nama petugas.\n*Contoh:* \`Budi\` atau \`Budi, Sari\``);
    return;
  }
  
  // ════════════ STOCK OPNAME: PILIH RAK / RAK BARU ════════════
  
  if (data.startsWith('so:pilihrak:')) {
    const rakName = data.replace('so:pilihrak:', '');
    const session = getSesi(userId);
    if (session.soSetupStep === 'rak') {
      session.soInfo.rakAktif = rakName;
      updateSesi(userId, { soInfo: session.soInfo, soSetupStep: 'jam' });
      await kirim(chatId, `✅ *Rak dipilih:* ${escapeMd(rakName)}\n${GARIS_TIPIS}\n\n⏰ *STEP 3/3: Jam Mulai*\nFormat: \`HH:MM\` atau ketik *sekarang* (${getJamSekarang()})`);
    } else {
      session.soInfo.rakAktif = rakName;
      updateSesi(userId, { soInfo: session.soInfo, soSetupStep: null });
      if (typeof updateUserRakSO === 'function') updateUserRakSO(session.tokoKode, userId, rakName);
      const existingItems = Object.keys(getBarangDiRak(session.tokoKode, rakName)).length;
      await kirim(chatId, `✅ *Pindah ke: ${escapeMd(rakName)}*\n${existingItems > 0 ? `📊 ${existingItems} jenis barang sudah ada.\n` : '🆕 Rak baru.\n'}\n📝 Lanjutkan input barang...`, { reply_markup: kbSOAktif() });
    }
    return;
  }
  
  if (data === 'so:rakbaru') {
    const session = getSesi(userId);
    const step = session.soSetupStep === 'rak' ? 'rak_input' : 'rak_input_pindah';
    updateSesi(userId, { soSetupStep: step });
    await kirim(chatId, `📦 *Input Nama Rak Baru*\n${GARIS_TIPIS}\n\n💡 *2 cara:*\n   1. 📸 Kirim FOTO barcode/label rak\n   2. Ketik manual\n\n*Contoh ketik:* \`Rak C3\``);
    return;
  }
  
  // ════════════ STOCK OPNAME: EDIT RAK DENGAN PAGINATION ════════════
  
  if (data.startsWith('so:editrak:')) {
    const parts = data.replace('so:editrak:', '').split(':');
    const rakName = parts[0];
    const page = parts[1] ? parseInt(parts[1]) : 0;
    
    const session = getSesi(userId);
    const items = getBarangDiRak(session.tokoKode, rakName);
    const itemList = Object.entries(items);
    
    if (itemList.length === 0) {
      await kirim(chatId, `📭 Rak *${rakName}* kosong.`, { reply_markup: kbSOAktif() });
      return;
    }
    
    const sortedItems = itemList.map(([kode, itemData]) => {
      const item = DATA_BARANG.find(d => d.kode === kode);
      const nama = item?.nama || kode;
      let totalQty = 0;
      itemData.entries.forEach(e => totalQty += e.qty);
      return { kode, nama, itemData, totalQty };
    }).sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
    
    const ITEMS_PER_PAGE = 20;
    const totalPages = Math.ceil(sortedItems.length / ITEMS_PER_PAGE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIdx = currentPage * ITEMS_PER_PAGE;
    const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, sortedItems.length);
    const pageItems = sortedItems.slice(startIdx, endIdx);
    
    let m = `✏️ *EDIT RAK: ${rakName}*\n${GARIS_TEBAL}\n📦 Total: ${sortedItems.length} jenis barang\n`;
    if (totalPages > 1) m += `📄 Halaman ${currentPage + 1}/${totalPages} (item ${startIdx + 1}-${endIdx})\n`;
    m += `\n`;
    
    const buttons = [];
    pageItems.forEach((si, i) => {
      const globalIdx = startIdx + i + 1;
      m += `*${globalIdx}. ${escapeMd(si.nama)}*\n   🔖 \`${si.kode}\` | 📊 Total: ${si.totalQty} | ${si.itemData.entries.length} entri\n`;
      si.itemData.entries.forEach(e => {
        const jenisIcon = e.jenis === 'fisik' ? '🏪' : '🏭';
        m += `      ${e.namaPetugas}: ${jenisIcon} ${e.jenis} *${e.qty}*\n`;
      });
      m += '\n';
      buttons.push([{ text: `✏️ ${globalIdx}. ${si.nama} (${si.totalQty})`, callback_data: `so:edititem:${rakName}:${si.kode}` }]);
    });
    
    if (totalPages > 1) {
      const navButtons = [];
      if (currentPage > 0) navButtons.push({ text: '⬅️ Sebelumnya', callback_data: `so:editrak:${rakName}:${currentPage - 1}` });
      navButtons.push({ text: `📄 ${currentPage + 1}/${totalPages}`, callback_data: `so:pageinfo:${rakName}:${currentPage}` });
      if (currentPage < totalPages - 1) navButtons.push({ text: 'Berikutnya ➡️', callback_data: `so:editrak:${rakName}:${currentPage + 1}` });
      buttons.push(navButtons);
      if (totalPages > 3) {
        const quickJump = [];
        if (currentPage > 0) quickJump.push({ text: '⏮️ Awal', callback_data: `so:editrak:${rakName}:0` });
        if (currentPage < totalPages - 1) quickJump.push({ text: 'Akhir ⏭️', callback_data: `so:editrak:${rakName}:${totalPages - 1}` });
        if (quickJump.length > 0) buttons.push(quickJump);
      }
    }
    
    buttons.push([{ text: '🔍 Cari Item di Rak', callback_data: `so:searchinrak:${rakName}` }]);
    buttons.push([{ text: '🔙 Kembali', callback_data: 'so:kembali' }]);
    
    await kirim(chatId, m, { reply_markup: { inline_keyboard: buttons } });
    return;
  }
  
  if (data.startsWith('so:pageinfo:')) {
    try { await bot.answerCallbackQuery(query.id, { text: '📄 Klik ⬅️ / ➡️ untuk navigasi', show_alert: false }); } catch(e) {}
    return;
  }
  
  // ════════════ STOCK OPNAME: QUICK EDIT MODE ════════════
  
  if (data.startsWith('so:quickeditrak:')) {
    const parts = data.replace('so:quickeditrak:', '').split(':');
    const rakName = parts[0];
    const page = parts[1] ? parseInt(parts[1]) : 0;
    const session = getSesi(userId);
    const items = getBarangDiRak(session.tokoKode, rakName);
    const itemList = Object.entries(items);
    if (itemList.length === 0) return kirim(chatId, `📭 Rak ${rakName} kosong.`, { reply_markup: kbSOAktif() });
    
    const sortedItems = itemList.map(([kode, itemData]) => {
      const item = DATA_BARANG.find(d => d.kode === kode);
      const nama = item?.nama || kode;
      let totalQty = 0;
      itemData.entries.forEach(e => totalQty += e.qty);
      return { kode, nama, totalQty };
    }).sort((a, b) => a.nama.localeCompare(b.nama, 'id'));
    
    const ITEMS_PER_PAGE = 40;
    const totalPages = Math.ceil(sortedItems.length / ITEMS_PER_PAGE);
    const currentPage = Math.max(0, Math.min(page, totalPages - 1));
    const startIdx = currentPage * ITEMS_PER_PAGE;
    const endIdx = Math.min(startIdx + ITEMS_PER_PAGE, sortedItems.length);
    const pageItems = sortedItems.slice(startIdx, endIdx);
    
    const m = `⚡ *QUICK EDIT: ${rakName}*\n${GARIS_TEBAL}\n📦 ${sortedItems.length} item ${totalPages > 1 ? `| Hal ${currentPage + 1}/${totalPages}` : ''}\n\n_Tap tombol untuk edit_`;
    const buttons = [];
    pageItems.forEach((si, i) => {
      const globalIdx = startIdx + i + 1;
      buttons.push([{ text: `${globalIdx}. ${si.nama} [${si.totalQty}]`, callback_data: `so:edititem:${rakName}:${si.kode}` }]);
    });
    if (totalPages > 1) {
      const nav = [];
      if (currentPage > 0) nav.push({ text: '⬅️', callback_data: `so:quickeditrak:${rakName}:${currentPage - 1}` });
      nav.push({ text: `${currentPage + 1}/${totalPages}`, callback_data: `so:pageinfo:${rakName}:${currentPage}` });
      if (currentPage < totalPages - 1) nav.push({ text: '➡️', callback_data: `so:quickeditrak:${rakName}:${currentPage + 1}` });
      buttons.push(nav);
    }
    buttons.push([{ text: '📋 View Detail', callback_data: `so:editrak:${rakName}:0` }, { text: '🔍 Cari', callback_data: `so:searchinrak:${rakName}` }]);
    buttons.push([{ text: '🔙 Kembali', callback_data: 'so:kembali' }]);
    await kirim(chatId, m, { reply_markup: { inline_keyboard: buttons } });
    return;
  }
  
  // ════════════ STOCK OPNAME: SEARCH ITEM DI RAK ════════════
  
  if (data.startsWith('so:searchinrak:')) {
    const rakName = data.replace('so:searchinrak:', '');
    updateSesi(userId, { soSearchInRak: rakName, soSearchMode: true });
    await kirim(chatId, `🔍 *CARI ITEM DI RAK: ${rakName}*\n${GARIS_TEBAL}\n\nKetik nama atau kode barang.\n\n*Contoh:*\n• \`sendok\`\n• \`tempat kue\`\n• \`NN13863\`\n\n💡 Ketik *batal* untuk kembali.`, { reply_markup: { inline_keyboard: [[{ text: '⬅️ Kembali ke Edit Rak', callback_data: `so:editrak:${rakName}:0` }], [{ text: '🔙 Menu SO', callback_data: 'so:kembali' }]] } });
    return;
  }
  
  // ════════════ STOCK OPNAME: EDIT ITEM & ENTRY ════════════
  
  if (data.startsWith('so:edititem:')) {
    const parts = data.replace('so:edititem:', '').split(':');
    const rakName = parts[0];
    const kode = parts[1];
    const session = getSesi(userId);
    const items = getBarangDiRak(session.tokoKode, rakName);
    const itemData = items[kode];
    if (!itemData || !itemData.entries.length) return kirim(chatId, '⚠️ Item tidak ditemukan.', { reply_markup: kbSOAktif() });
    
    const item = DATA_BARANG.find(d => d.kode === kode);
    const nama = item?.nama || kode;
    let totalQty = 0;
    itemData.entries.forEach(e => totalQty += e.qty);
    
    let m = `✏️ *EDIT ITEM*\n${GARIS_TEBAL}\n📦 ${escapeMd(nama)}\n🔖 \`${kode}\`\n📍 Rak: ${rakName}\n📊 Total: ${totalQty}\n\n`;
    const buttons = [];
    itemData.entries.forEach((entry, i) => {
      m += `${i+1}. *${entry.namaPetugas}* | ${entry.jenis} | Qty: *${entry.qty}*\n   ⏰ ${entry.jamInput}\n\n`;
      buttons.push([{ text: `✏️ Edit #${i+1} (${entry.qty})`, callback_data: `so:editentry:${rakName}:${kode}:${i}` }]);
    });
    buttons.push([{ text: '🗑️ Hapus Semua', callback_data: `so:hapusitem:${rakName}:${kode}` }]);
    buttons.push([{ text: '🔙 Kembali ke Rak', callback_data: `so:editrak:${rakName}:0` }]);
    await kirim(chatId, m, { reply_markup: { inline_keyboard: buttons } });
    return;
  }
  
  if (data.startsWith('so:editentry:')) {
    const parts = data.replace('so:editentry:', '').split(':');
    const rakName = parts[0];
    const kode = parts[1];
    const entryIndex = parseInt(parts[2]);
    const session = getSesi(userId);
    const items = getBarangDiRak(session.tokoKode, rakName);
    const entry = items[kode]?.entries?.[entryIndex];
    if (!entry) return kirim(chatId, '⚠️ Entry tidak ditemukan.', { reply_markup: kbSOAktif() });
    const item = DATA_BARANG.find(d => d.kode === kode);
    updateSesi(userId, { soEditMode: true, soEditInfo: { rak: rakName, kode: kode, entryIndex: entryIndex } });
    await kirim(chatId, `✏️ *EDIT QTY*\n${GARIS_TEBAL}\n📦 ${escapeMd(item?.nama || kode)}\n📍 Rak: ${rakName}\n👤 ${entry.namaPetugas}\n📊 Qty saat ini: *${entry.qty}*\n${GARIS_TIPIS}\n\n💬 *Ketik:*\n• Angka baru: \`10\` (ganti jadi 10)\n• Tambah: \`+5\`\n• Kurangi: \`-3\`\n• \`0\` atau \`hapus\` untuk hapus entry`);
    return;
  }
  
  if (data.startsWith('so:hapusitem:')) {
    const parts = data.replace('so:hapusitem:', '').split(':');
    const rakName = parts[0];
    const kode = parts[1];
    const session = getSesi(userId);
    if (typeof hapusItemSO === 'function') hapusItemSO(session.tokoKode, rakName, kode);
    const item = DATA_BARANG.find(d => d.kode === kode);
    await kirim(chatId, `🗑️ *${escapeMd(item?.nama || kode)}* dihapus dari ${rakName}!`, { reply_markup: kbSOAktif() });
    return;
  }
  
  // ════════════ STOCK OPNAME: EXPORT / SELESAI ════════════
  
  if (data === 'so:exportgabungan') {
    const session = getSesi(userId);
    if (!session.tokoKode) return;
    const namaToko = NAMA_TOKO[session.tokoKode];
    await kirim(chatId, '📊 _Membuat laporan & Excel gabungan..._');
    try {
      const laporan = generateLaporanSOGabungan(session.tokoKode, namaToko);
      await kirim(chatId, laporan);
      const excelPath = generateExcelSOGabungan(session.tokoKode, namaToko);
      await bot.sendDocument(chatId, excelPath, {}, { filename: `SO_Gabungan_${session.tokoKode.toUpperCase()}_${getTanggalSlash(false).replace(/\//g, '-')}.xlsx` });
      try { fs.unlinkSync(excelPath); } catch(e) {}
      await kirim(chatId, '✅ *Excel gabungan terkirim!*\n💡 Data SO tetap tersimpan.', { reply_markup: kbSOAktif() });
    } catch(err) {
      log.error('SO-EXPORT', err.message);
      await kirim(chatId, '❌ Gagal: ' + err.message);
    }
    return;
  }
  
  if (data === 'so:selesaisaya') {
    const session = getSesi(userId);
    if (!session.tokoKode) return;
    const namaToko = NAMA_TOKO[session.tokoKode];
    await kirim(chatId, '📊 _Membuat Excel gabungan..._');
    try {
      const laporan = generateLaporanSOGabungan(session.tokoKode, namaToko);
      await kirim(chatId, laporan);
      const excelPath = generateExcelSOGabungan(session.tokoKode, namaToko);
      await bot.sendDocument(chatId, excelPath, {}, { filename: `SO_Gabungan_${session.tokoKode.toUpperCase()}_${getTanggalSlash(false).replace(/\//g, '-')}.xlsx` });
      try { fs.unlinkSync(excelPath); } catch(e) {}
      if (typeof leaveSesiSO === 'function') leaveSesiSO(session.tokoKode, userId);
      resetSesi(userId);
      await kirim(chatId, '✅ *SO Anda selesai!*\n📥 Excel terkirim.\n💡 Data tetap tersimpan untuk user lain.', { reply_markup: kbMainMenu(userId) });
    } catch(err) {
      log.error('SO-FINISH', err.message);
      await kirim(chatId, '❌ Gagal: ' + err.message);
    }
    return;
  }
  
  if (data === 'so:kembali') {
    const session = getSesi(userId);
    if (!session.soInfo) return;
    await kirim(chatId, `🔙 *Lanjut input barang*\n📍 Rak: *${escapeMd(session.soInfo.rakAktif)}*\n\nKetik nama/kode barang...`, { reply_markup: kbSOAktif() });
    return;
  }
  
  // ════════════ STOCK OPNAME: SCAN RAK ════════════
  
  if (data === 'so:scanrak:pakai') {
    const session = getSesi(userId);
    const namaRak = session.soScanRakPending;
    if (!namaRak) return kirim(chatId, '⚠️ Data scan hilang. Coba lagi.');
    const tokoKode = session.tokoKode;
    if (session.soSetupStep === 'rak' || session.soSetupStep === 'rak_input') {
      session.soInfo.rakAktif = namaRak;
      updateSesi(userId, { soInfo: session.soInfo, soSetupStep: 'jam', soScanRakPending: null });
      await kirim(chatId, `✅ *Rak: ${escapeMd(namaRak)}*\n${GARIS_TIPIS}\n\n⏰ *STEP 3/3: Jam Mulai*\nFormat: \`HH:MM\` atau *sekarang* (${getJamSekarang()})`);
    } else if (session.soSetupStep === 'pindahrak_namabaru' || session.soSetupStep === 'rak_input_pindah') {
      session.soInfo.rakAktif = namaRak;
      updateSesi(userId, { soInfo: session.soInfo, soSetupStep: null, soScanRakPending: null });
      if (typeof updateUserRakSO === 'function') updateUserRakSO(tokoKode, userId, namaRak);
      const existingItems = Object.keys(getBarangDiRak(tokoKode, namaRak)).length;
      await kirim(chatId, `✅ *Pindah ke: ${escapeMd(namaRak)}*\n${existingItems > 0 ? `📊 ${existingItems} barang ada.\n` : '🆕 Rak baru.\n'}\n📝 Lanjutkan input...`, { reply_markup: kbSOAktif() });
    } else {
      session.soInfo.rakAktif = namaRak;
      updateSesi(userId, { soInfo: session.soInfo, soSetupStep: 'jam', soScanRakPending: null });
      await kirim(chatId, `✅ *Rak: ${escapeMd(namaRak)}*\n\n⏰ Ketik jam mulai atau *sekarang*`);
    }
    return;
  }
  
  if (data === 'so:scanrak:baru' || data === 'so:scanrak:edit') {
    const session = getSesi(userId);
    updateSesi(userId, { soScanRakPending: null });
    const step = (session.soSetupStep === 'rak' || session.soSetupStep === 'rak_input') ? 'rak_input' : 'rak_input_pindah';
    updateSesi(userId, { soSetupStep: step });
    await kirim(chatId, `📦 Ketik nama rak ${data.includes('edit') ? 'yang benar' : 'baru'}:\n\n*Contoh:* \`Rak A1\``);
    return;
  }
  
  if (data === 'so:scanrak:pindah') {
    const session = getSesi(userId);
    const targetRak = session.soScanRakPindahPending;
    if (!targetRak) return kirim(chatId, '⚠️ Data hilang.', { reply_markup: kbSOAktif() });
    session.soInfo.rakAktif = targetRak;
    updateSesi(userId, { soInfo: session.soInfo, soScanRakPindahPending: null });
    if (typeof updateUserRakSO === 'function') updateUserRakSO(session.tokoKode, userId, targetRak);
    const existingItems = Object.keys(getBarangDiRak(session.tokoKode, targetRak)).length;
    await kirim(chatId, `✅ *Pindah ke: ${escapeMd(targetRak)}*\n${existingItems > 0 ? `📊 ${existingItems} barang ada.\n` : '🆕 Rak baru.\n'}\n📝 Lanjutkan input...`, { reply_markup: kbSOAktif() });
    return;
  }
  
  if (data === 'so:scanrak:batal') {
    updateSesi(userId, { soScanRakPending: null, soScanRakPindahPending: null });
    const session = getSesi(userId);
    if (session.soSetupStep) await kirim(chatId, '🔙 Batal. Kirim foto lagi atau ketik nama manual.');
    else await kirim(chatId, '🔙 Batal.', { reply_markup: kbSOAktif() });
    return;
  }
  
  // ════════════ BERITA ACARA ACTIONS ════════════
  
  if (data.startsWith('ba:section:')) {
    const sectionNo = parseInt(data.split(':')[2]);
    updateSesi(userId, { baSection: sectionNo });
    const formats = {
      1: { title: '📥 PENAMBAHAN STOK KASIR', format: 'NAMA | QTY | KET', contoh: 'PIRING BT PAUS BIRU | 1 PCS | SELISIH', scanable: true },
      2: { title: '➕ PENYESUAIAN TAMBAH', format: 'NAMA | QTY | KET', contoh: 'WAJAN ALM 22 CM | 12 PCS | TAMBAH', scanable: true },
      3: { title: '➖ PENYESUAIAN KURANGI', format: 'NAMA | QTY | KET', contoh: 'WAJAN ALM 22 CM | 2 PCS | RUSAK', scanable: true },
      4: { title: '🔄 SALAH KETIK/RETUR', format: 'NO_NOTA | NAMA | QTY | NAMA_TUKAR | QTY_TUKAR | KET', contoh: '001103 | DISPENSER | 1 | DISPENSER B | 1 | TUKAR', scanable: false },
      5: { title: '📦 BARANG MASUK', format: 'NAMA | QTY_NOTA | FISIK_MASUK | QTY_MASUK | KET', contoh: 'PANCI 24 | 10 | PANCI 26 | 10 | SALAH', scanable: false },
      6: { title: '✏️ DICORET GUDANG', format: 'NAMA | QTY_AWAL | RUBAH | QTY_KOREKSI | KET', contoh: 'TEKO 1.8L | 5 | TEKO 2L | 5 | UPGRADE', scanable: false },
    };
    const f = formats[sectionNo];
    let m = `${f.title}\n${GARIS_TEBAL}\n\n`;
    if (f.scanable) m += `📸 *Bisa scan foto tabel iPos!*\n\n`;
    m += `📝 *Format:*\n\`${f.format}\`\n\n*Contoh:*\n\`${f.contoh}\``;
    try { await bot.editMessageText(m, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Menu BA', callback_data: 'ba:menu' }]] } }); }
    catch(e) { await kirim(chatId, m, { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu BA', callback_data: 'ba:menu' }]] } }); }
    return;
  }
  
  if (data === 'ba:menu') {
    const session = getSesi(userId);
    updateSesi(userId, { baSection: null });
    try { await bot.editMessageText(`📋 *MENU BERITA ACARA*\n🏦 ${NAMA_TOKO[session.tokoKode]}\n🆔 ${session.baData.nomorBA}`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: kbBaSection(session.baData) }); }
    catch(e) { await kirim(chatId, `📋 *MENU BA*\n🆔 ${session.baData?.nomorBA}`, { reply_markup: kbBaSection(session.baData) }); }
    return;
  }
  
  if (data === 'ba:review' || data === 'ba:selesai') {
    const session = getSesi(userId);
    await handleBeritaAcaraMode(chatId, userId, data.split(':')[1], session);
    return;
  }
  
  if (data === 'ba:scan:keterangan') {
    const session = getSesi(userId);
    if (!session.baScanPending || session.baScanPending.length === 0) return;
    const item = session.baScanPending[0];
    updateSesi(userId, { baInputKeterangan: true });
    await kirim(chatId, `📝 *Input Keterangan*\n${GARIS_TEBAL}\n\n*Item 1/${session.baScanPending.length}:*\n📦 ${escapeMd(item.nama)}\n📊 ${item.qty} ${item.satuan}\n\n${GARIS_TIPIS}\n💬 Ketik keterangan atau *skip*`);
    return;
  }
  
  if (data === 'ba:scan:simpansemua') {
    const session = getSesi(userId);
    if (!session.baScanPending) return;
    const sectionField = { 1: 'penambahanKasir', 2: 'penyesuaianTambah', 3: 'penyesuaianKurang' }[session.baSection];
    if (!session.baData[sectionField]) session.baData[sectionField] = [];
    session.baScanPending.forEach(item => { session.baData[sectionField].push({ nama: item.nama, qty: `${item.qty} ${item.satuan}`, keterangan: '' }); });
    const total = session.baScanPending.length;
    updateSesi(userId, { baData: session.baData, baScanPending: null, baScanIndex: 0 });
    await kirim(chatId, `✅ *${total} item tersimpan!*\n📊 Total section: *${session.baData[sectionField].length}*`, { reply_markup: { inline_keyboard: [[{ text: '🔙 Menu BA', callback_data: 'ba:menu' }, { text: '📊 Review', callback_data: 'ba:review' }]] } });
    return;
  }
  
  if (data === 'ba:scan:batal') {
    updateSesi(userId, { baScanPending: null, baScanIndex: 0, baInputKeterangan: null });
    await kirim(chatId, '🔙 Scan dibatalkan.');
    return;
  }
  
  // ════════════ ADMIN ACTIONS ════════════
  
  if (data === 'admin:listmember' && isAdmin(userId)) {
    let m = `👥 *MEMBERS (${MEMBERS.length})*\n${GARIS_TEBAL}\n\n`;
    if (MEMBERS.length === 0) m += '_Belum ada._';
    else MEMBERS.forEach((id, i) => { m += `${i+1}. ${escapeMd(KONTAK[id] || 'Unknown')}\n   🆔 \`${id}\`\n\n`; });
    try { await bot.editMessageText(m, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'menu:9' }]] } }); }
    catch(e) { await kirim(chatId, m, { reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'menu:9' }]] } }); }
    return;
  }
  
  if (data === 'admin:listkontak' && isAdmin(userId)) {
    let m = `📒 *KONTAK TERSIMPAN (${Object.keys(KONTAK).length})*\n${GARIS_TEBAL}\n\n`;
    const kontakEntries = Object.entries(KONTAK);
    if (kontakEntries.length === 0) m += '_Belum ada kontak._';
    else {
      kontakEntries.slice(0, 25).forEach(([id, nama], i) => {
        const isMemberStatus = MEMBERS.includes(id) ? '✅' : '⚠️';
        m += `${i+1}. ${isMemberStatus} *${escapeMd(nama)}*\n   🆔 \`${id}\`\n\n`;
      });
      if (kontakEntries.length > 25) m += `_... +${kontakEntries.length - 25} lainnya_\n\n`;
    }
    m += `${GARIS_TIPIS}\n💡 *Cara Kelola:*\n`;
    m += `• Ubah nama: \`/setnama [ID] [nama baru]\`\n`;
    m += `• Cari member: \`/carimember [nama/ID]\`\n`;
    m += `• Hapus kontak: \`/hapuskontak [ID]\`\n`;
    try {
      await bot.editMessageText(m, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'menu:9' }]] } });
    } catch(e) {
      await kirim(chatId, m, { reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'menu:9' }]] } });
    }
    return;
  }
  
  if (data === 'admin:pending' && isAdmin(userId)) {
    const list = Object.entries(PENDING);
    let m = `🔔 *PENDING (${list.length})*\n${GARIS_TEBAL}\n\n`;
    if (list.length === 0) m += '_Tidak ada._';
    else list.forEach(([id, d], i) => { m += `${i+1}. ${escapeMd(d.nama)}\n   🆔 \`${id}\`\n   ✅ /approve ${id}\n   ❌ /reject ${id}\n\n`; });
    try { await bot.editMessageText(m, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'menu:9' }]] } }); }
    catch(e) { await kirim(chatId, m, { reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'menu:9' }]] } }); }
    return;
  }
  
  if (data === 'admin:stats' && isAdmin(userId)) {
    const top5 = Object.entries(STATS.topSearches).sort((a, b) => b[1] - a[1]).slice(0, 5);
    let m = `📊 *STATISTICS*\n${GARIS_TEBAL}\n💬 ${STATS.chats}\n👥 ${STATS.users.size}\n🔍 ${STATS.searches}\n🤖 ${STATS.aiQueries}\n🎙️ ${STATS.voiceNotes}\n📸 ${STATS.photos}\n\n`;
    if (top5.length) { m += `🔝 *Top:*\n`; top5.forEach((s, i) => m += `${i+1}. ${s[0]} (${s[1]}x)\n`); }
    try { await bot.editMessageText(m, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'menu:9' }]] } }); }
    catch(e) { await kirim(chatId, m, { reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'menu:9' }]] } }); }
    return;
  }
  
  if (data === 'admin:reload' && isAdmin(userId)) {
    loadExcel();
    try { await bot.editMessageText(`✅ *Reloaded!*\n📦 ${DATA_BARANG.length} barang`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'menu:9' }]] } }); }
    catch(e) { await kirim(chatId, `✅ Reloaded! ${DATA_BARANG.length} barang`); }
    return;
  }
  
  if (data === 'admin:info' && isAdmin(userId)) {
    const uptime = Math.floor(process.uptime());
    try { await bot.editMessageText(`ℹ️ *INFO SISTEM*\n${GARIS_TEBAL}\n🤖 ${CONFIG.appName}\n📦 ${DATA_BARANG.length}\n👥 ${MEMBERS.length}/${CONFIG.maxMember}\n⏱️ ${Math.floor(uptime / 3600)}j ${Math.floor((uptime % 3600) / 60)}m\n💬 ${STATS.chats}`, { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'menu:9' }]] } }); } catch(e) {}
    return;
  }
  
  if (data === 'admin:broadcast' && isAdmin(userId)) {
    try { await bot.editMessageText('📢 *Broadcast*\n\nKetik: `/broadcast [pesan]`', { chat_id: chatId, message_id: msgId, parse_mode: 'Markdown', reply_markup: { inline_keyboard: [[{ text: '🔙 Admin', callback_data: 'menu:9' }]] } }); } catch(e) {}
    return;
  }
  
  // ════════════ APPROVE/REJECT ════════════
  
  if (data.startsWith('approve:') && isAdmin(userId)) {
    approveUser(chatId, data.replace('approve:', ''));
    try { await bot.editMessageReplyMarkup({ inline_keyboard: [[{ text: '✅ Approved', callback_data: 'noop' }]] }, { chat_id: chatId, message_id: msgId }); } catch(e) {}
    return;
  }
  
  if (data.startsWith('reject:') && isAdmin(userId)) {
    rejectUser(chatId, data.replace('reject:', ''));
    try { await bot.editMessageReplyMarkup({ inline_keyboard: [[{ text: '❌ Rejected', callback_data: 'noop' }]] }, { chat_id: chatId, message_id: msgId }); } catch(e) {}
    return;
  }
  
  // ════════════ NOOP (dummy callback) ════════════
  
  if (data === 'noop') return;
  
}); // END callback_query handler

// ════════════════════════════════════════════════════════════════
//   38. WEB DASHBOARD (LENGKAP DENGAN CHAT LOG)
// ════════════════════════════════════════════════════════════════

const webApp = express();
webApp.use(express.json({ limit: '10mb' }));
webApp.use(express.urlencoded({ extended: true, limit: '10mb' }));

webApp.use(session({
  secret: CONFIG.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: false, httpOnly: true },
  name: 'botSession',
}));

webApp.set('trust proxy', 1);

// Suppress MemoryStore warning
const _origWarn = console.warn;
console.warn = function(...args) {
  const msg = args.join(' ');
  if (msg.includes('MemoryStore') || msg.includes('connect.session')) return;
  _origWarn.apply(console, args);
};

function requireLogin(req, res, next) {
  if (req.session && req.session.loggedIn) return next();
  res.redirect('/login');
}

const loginAttempts = {};

// ── ENHANCED CHAT LOG STORAGE ──

const CHAT_LOG = [];
const MAX_CHAT_LOG = 1000;

function addChatLog(userId, userName, username, messageText, messageType, direction = 'incoming') {
  const entry = {
    id: Date.now() + '_' + Math.random().toString(36).substr(2, 5),
    userId: String(userId),
    userName: userName || 'Unknown',
    username: username || '-',
    message: String(messageText || '').substring(0, 500),
    type: messageType || 'text',
    direction: direction,
    timestamp: Date.now(),
    date: getJamSekarang(),
    fullDate: getTanggalIndonesia(),
  };
  
  CHAT_LOG.push(entry);
  if (CHAT_LOG.length > MAX_CHAT_LOG) CHAT_LOG.shift();
  
  // Update STATS juga
  STATS.recentChats.push({
    userId: entry.userId, name: entry.userName,
    message: entry.message.substring(0, 100), type: entry.type, time: entry.timestamp,
  });
  if (STATS.recentChats.length > 100) STATS.recentChats.shift();
}

// Override trackChat untuk juga log ke CHAT_LOG
const _origTrackChat = trackChat;
function trackChat(userId, message, type = 'text') {
  STATS.chats++;
  STATS.users.add(String(userId));
  if (type === 'voice') STATS.voiceNotes++;
  if (type === 'photo') STATS.photos++;
  if (type === 'ai') STATS.aiQueries++;
  
  const nama = KONTAK[String(userId)] || 'User';
  addChatLog(userId, nama, '', message, type, 'incoming');
}

// ── CSS STYLES ──

const DASHBOARD_CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #0f0f1a; color: #e0e0e0; }
  
  .navbar { background: linear-gradient(135deg, #667eea, #764ba2); padding: 15px 30px; display: flex; justify-content: space-between; align-items: center; position: sticky; top: 0; z-index: 100; box-shadow: 0 4px 15px rgba(0,0,0,0.3); }
  .navbar h1 { font-size: 20px; color: white; }
  .navbar a { color: white; text-decoration: none; padding: 8px 16px; border-radius: 8px; background: rgba(255,255,255,0.15); font-size: 14px; }
  .navbar a:hover { background: rgba(255,255,255,0.25); }
  .nav-links { display: flex; gap: 10px; align-items: center; }
  
  .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
  
  .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 15px; margin: 20px 0; }
  .stat { background: #1a1a2e; padding: 20px; border-radius: 12px; text-align: center; border-left: 4px solid #667eea; transition: transform 0.2s; }
  .stat:hover { transform: translateY(-3px); }
  .stat h2 { margin: 0; color: #4ade80; font-size: 28px; }
  .stat p { margin: 5px 0 0; color: #888; font-size: 12px; }
  
  .section { background: #1a1a2e; border-radius: 12px; padding: 20px; margin: 20px 0; box-shadow: 0 4px 15px rgba(0,0,0,0.2); }
  .section h2 { color: #667eea; margin-bottom: 15px; font-size: 18px; }
  
  .tabs { display: flex; gap: 5px; margin-bottom: 15px; flex-wrap: wrap; }
  .tab { padding: 8px 16px; border-radius: 8px; background: #16213e; color: #888; cursor: pointer; border: none; font-size: 13px; transition: all 0.2s; }
  .tab:hover { background: #1e3a5f; color: white; }
  .tab.active { background: #667eea; color: white; }
  
  .search-bar { display: flex; gap: 10px; margin-bottom: 15px; flex-wrap: wrap; }
  .search-bar input, .search-bar select { padding: 10px 14px; border-radius: 8px; border: 2px solid #2a2a4a; background: #16213e; color: white; font-size: 13px; outline: none; }
  .search-bar input:focus, .search-bar select:focus { border-color: #667eea; }
  .search-bar input { flex: 1; min-width: 200px; }
  .search-bar select { min-width: 120px; }
  .search-bar button { padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 8px; cursor: pointer; font-size: 13px; }
  .search-bar button:hover { background: #5a6fd6; }
  
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #0f3460; color: #667eea; padding: 12px 10px; text-align: left; position: sticky; top: 60px; font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px; border-bottom: 1px solid #1e1e3a; vertical-align: top; }
  tr:hover { background: #16213e; }
  
  .badge { display: inline-block; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; }
  .badge-text { background: #1e3a5f; color: #60a5fa; }
  .badge-voice { background: #1e3a2e; color: #4ade80; }
  .badge-photo { background: #3a2e1e; color: #fbbf24; }
  .badge-command { background: #3a1e3a; color: #c084fc; }
  .badge-ai { background: #1e2e3a; color: #22d3ee; }
  .badge-incoming { background: #1a3a1a; color: #4ade80; }
  .badge-outgoing { background: #1a1a3a; color: #60a5fa; }
  
  .msg-text { max-width: 400px; word-wrap: break-word; line-height: 1.4; }
  .msg-text .highlight { background: #667eea33; padding: 1px 4px; border-radius: 3px; }
  
  .user-info { display: flex; flex-direction: column; gap: 2px; }
  .user-name { font-weight: bold; color: #e0e0e0; }
  .user-id { font-size: 11px; color: #666; font-family: monospace; }
  .user-username { font-size: 11px; color: #888; }
  
  .time-info { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
  .time-date { color: #888; }
  .time-clock { color: #4ade80; font-weight: bold; font-family: monospace; }
  
  .pagination { display: flex; justify-content: center; gap: 5px; margin-top: 15px; flex-wrap: wrap; }
  .pagination a { padding: 8px 14px; border-radius: 8px; background: #16213e; color: #888; text-decoration: none; font-size: 13px; }
  .pagination a:hover { background: #1e3a5f; color: white; }
  .pagination a.active { background: #667eea; color: white; }
  
  .empty { text-align: center; padding: 40px; color: #666; }
  .member-list { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 10px; }
  .member-card { background: #16213e; padding: 12px; border-radius: 8px; border-left: 3px solid #667eea; }
  .member-card .name { font-weight: bold; color: #e0e0e0; }
  .member-card .id { font-size: 11px; color: #888; font-family: monospace; }
  .member-card .role { font-size: 11px; color: #4ade80; }
  
  .refresh-info { text-align: center; padding: 10px; color: #666; font-size: 12px; }
  
  @media (max-width: 768px) {
    .container { padding: 10px; }
    .grid { grid-template-columns: repeat(2, 1fr); gap: 8px; }
    .stat { padding: 12px; }
    .stat h2 { font-size: 22px; }
    .navbar h1 { font-size: 16px; }
    .msg-text { max-width: 200px; }
    th, td { padding: 6px 4px; font-size: 11px; }
  }
`;

// ── ROUTES ──

webApp.get('/', (req, res) => {
  res.send(`<html><head><title>${escapeHtml(CONFIG.appName)}</title>
<style>body{font-family:Arial;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0}
.box{background:white;padding:50px;border-radius:20px;box-shadow:0 20px 60px rgba(0,0,0,0.3);text-align:center;max-width:600px}
h1{color:#667eea}.stat{display:inline-block;margin:10px;padding:15px;background:#f5f5f5;border-radius:10px;min-width:100px}
.stat b{color:#667eea;font-size:24px}a{color:#667eea;font-weight:bold}</style></head>
<body><div class="box"><h1>🤖 ${escapeHtml(CONFIG.appName)}</h1>
<p>📱 Bot: <a href="https://t.me/${escapeHtml(CONFIG.botUsername)}" target="_blank">@${escapeHtml(CONFIG.botUsername)}</a></p>
<div><div class="stat"><b>${DATA_BARANG.length}</b><br>📦 Barang</div>
<div class="stat"><b>${MEMBERS.length}</b><br>👥 Members</div>
<div class="stat"><b>${STATS.chats}</b><br>💬 Chats</div></div>
<p><a href="/login">🔐 Login Dashboard</a></p></div></body></html>`);
});

webApp.get('/login', (req, res) => {
  const error = req.query.error ? '<p style="color:red;margin-top:10px">❌ Username atau password salah</p>' : '';
  res.send(`<html><head><title>Login</title><style>body{font-family:Arial;background:linear-gradient(135deg,#667eea,#764ba2);min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0}
.box{background:white;padding:40px;border-radius:20px;width:350px}h2{color:#667eea}
input{width:100%;padding:12px;margin:8px 0;border:2px solid #e0e0e0;border-radius:8px;box-sizing:border-box;font-size:14px}
input:focus{border-color:#667eea;outline:none}
button{width:100%;padding:12px;background:linear-gradient(135deg,#667eea,#764ba2);color:white;border:none;border-radius:8px;font-weight:bold;cursor:pointer;font-size:14px}
button:hover{opacity:0.9}</style></head>
<body><div class="box"><h2>🔐 Admin Login</h2><form method="POST" action="/login">
<input name="username" placeholder="Username" required><input name="password" type="password" placeholder="Password" required>
<button>Login</button></form>${error}</div></body></html>`);
});

webApp.post('/login', (req, res) => {
  const ip = req.ip || '';
  const now = Date.now();
  if (!loginAttempts[ip]) loginAttempts[ip] = { count: 0, firstAttempt: now };
  if (now - loginAttempts[ip].firstAttempt > 15 * 60 * 1000) loginAttempts[ip] = { count: 0, firstAttempt: now };
  
  if (loginAttempts[ip].count >= 5) {
    // ★ ALERT ADMIN kalau ada brute force!
    if (CONFIG.adminId && loginAttempts[ip].count === 5) {
      try {
        bot.sendMessage(CONFIG.adminId, 
          `🚨 *SECURITY ALERT*\n\n⚠️ Brute force login attempt!\n🌐 IP: \`${ip}\`\n🕐 ${getJamSekarang()}\n\nAccount temporarily locked.`,
          { parse_mode: 'Markdown' }
        );
      } catch(e) {}
    }
    return res.status(429).send('<h1>⛔ Too Many Attempts</h1>');
  }
  
  if (req.body.username === CONFIG.dashboardUser && req.body.password === CONFIG.dashboardPass) {
    loginAttempts[ip] = { count: 0, firstAttempt: now };
    req.session.loggedIn = true;
    log.info('LOGIN', `✅ Success from IP: ${ip}`);
    return res.redirect('/dashboard');
  }
  
  loginAttempts[ip].count++;
  log.warn('LOGIN', `❌ Failed from IP: ${ip} (attempt ${loginAttempts[ip].count})`);
  res.redirect('/login?error=1');
});

// ── MAIN DASHBOARD ──

webApp.get('/dashboard', requireLogin, (req, res) => {
  const uptime = Math.floor(process.uptime());
  const uptimeStr = `${Math.floor(uptime/3600)}j ${Math.floor((uptime%3600)/60)}m`;
  const top10 = Object.entries(STATS.topSearches).sort((a,b) => b[1]-a[1]).slice(0, 10);
  
  res.send(`<html><head><title>Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="refresh" content="15">
<style>${DASHBOARD_CSS}</style></head>
<body>
<div class="navbar">
  <h1>📊 ${escapeHtml(CONFIG.appName)}</h1>
  <div class="nav-links">
    <a href="/dashboard">📊 Stats</a>
    <a href="/dashboard/chats">💬 Chat Log</a>
    <a href="/dashboard/members">👥 Members</a>
    <a href="/dashboard/searches">🔍 Searches</a>
    <a href="/logout">🚪 Logout</a>
  </div>
</div>
<div class="container">
  <div class="grid">
    <div class="stat"><h2>${STATS.chats}</h2><p>💬 Total Chats</p></div>
    <div class="stat"><h2>${STATS.users.size}</h2><p>👥 Active Users</p></div>
    <div class="stat"><h2>${STATS.searches}</h2><p>🔍 Searches</p></div>
    <div class="stat"><h2>${STATS.aiQueries}</h2><p>🤖 AI Queries</p></div>
    <div class="stat"><h2>${STATS.voiceNotes}</h2><p>🎙️ Voice</p></div>
    <div class="stat"><h2>${STATS.photos}</h2><p>📸 Photos</p></div>
    <div class="stat"><h2>${MEMBERS.length}</h2><p>👥 Members</p></div>
    <div class="stat"><h2>${DATA_BARANG.length}</h2><p>📦 Barang</p></div>
    <div class="stat"><h2>${uptimeStr}</h2><p>⏱️ Uptime</p></div>
  </div>
  
  <div class="section">
    <h2>🔝 Top Searches</h2>
    <table><tr><th>#</th><th>Keyword</th><th>Count</th></tr>
    ${top10.length === 0 ? '<tr><td colspan="3" class="empty">No data</td></tr>' : top10.map((s,i) => `<tr><td>${i+1}</td><td>${escapeHtml(s[0])}</td><td><b>${s[1]}</b></td></tr>`).join('')}
    </table>
  </div>
  
  <div class="section">
    <h2>💬 Recent Chats (Last 20)</h2>
    <table><tr><th>Time</th><th>User</th><th>Type</th><th>Message</th></tr>
    ${CHAT_LOG.slice(-20).reverse().map(c => `<tr>
      <td class="time-info"><span class="time-clock">${escapeHtml(c.date)}</span></td>
      <td class="user-info"><span class="user-name">${escapeHtml(c.userName)}</span><span class="user-id">${escapeHtml(c.userId)}</span></td>
      <td><span class="badge badge-${c.type}">${escapeHtml(c.type)}</span></td>
      <td class="msg-text">${escapeHtml(c.message)}</td>
    </tr>`).join('')}
    </table>
    <p style="text-align:center;margin-top:10px"><a href="/dashboard/chats" style="color:#667eea">Lihat Semua Chat →</a></p>
  </div>
  
  <div class="refresh-info">Auto-refresh 15 detik | ${getJamSekarang()} WITA</div>
</div></body></html>`);
});

// ── CHAT LOG PAGE (FULL) ──

webApp.get('/dashboard/chats', requireLogin, (req, res) => {
  const page = parseInt(req.query.page || '1');
  const search = (req.query.search || '').trim();
  const typeFilter = req.query.type || '';
  const userFilter = req.query.user || '';
  const perPage = 50;
  
  // Filter chat log
  let filtered = [...CHAT_LOG];
  
  if (search) {
    const searchLow = search.toLowerCase();
    filtered = filtered.filter(c => 
      c.message.toLowerCase().includes(searchLow) ||
      c.userName.toLowerCase().includes(searchLow) ||
      c.userId.includes(search) ||
      (c.username && c.username.toLowerCase().includes(searchLow))
    );
  }
  
  if (typeFilter) {
    filtered = filtered.filter(c => c.type === typeFilter);
  }
  
  if (userFilter) {
    filtered = filtered.filter(c => c.userId === userFilter);
  }
  
  // Sort newest first
  filtered.sort((a, b) => b.timestamp - a.timestamp);
  
  // Pagination
  const totalItems = filtered.length;
  const totalPages = Math.ceil(totalItems / perPage) || 1;
  const currentPage = Math.max(1, Math.min(page, totalPages));
  const startIdx = (currentPage - 1) * perPage;
  const pageItems = filtered.slice(startIdx, startIdx + perPage);
  
  // Unique users for filter dropdown
  const uniqueUsers = {};
  CHAT_LOG.forEach(c => {
    if (!uniqueUsers[c.userId]) uniqueUsers[c.userId] = c.userName;
  });
  
  // Build pagination links
  let paginationHtml = '';
  if (totalPages > 1) {
    const params = new URLSearchParams();
    if (search) params.set('search', search);
    if (typeFilter) params.set('type', typeFilter);
    if (userFilter) params.set('user', userFilter);
    
    paginationHtml = '<div class="pagination">';
    if (currentPage > 1) {
      params.set('page', '1');
      paginationHtml += `<a href="/dashboard/chats?${params}">⏮️</a>`;
      params.set('page', String(currentPage - 1));
      paginationHtml += `<a href="/dashboard/chats?${params}">⬅️</a>`;
    }
    
    const startPage = Math.max(1, currentPage - 3);
    const endPage = Math.min(totalPages, currentPage + 3);
    for (let i = startPage; i <= endPage; i++) {
      params.set('page', String(i));
      paginationHtml += `<a href="/dashboard/chats?${params}" class="${i === currentPage ? 'active' : ''}">${i}</a>`;
    }
    
    if (currentPage < totalPages) {
      params.set('page', String(currentPage + 1));
      paginationHtml += `<a href="/dashboard/chats?${params}">➡️</a>`;
      params.set('page', String(totalPages));
      paginationHtml += `<a href="/dashboard/chats?${params}">⏭️</a>`;
    }
    paginationHtml += '</div>';
  }
  
  res.send(`<html><head><title>Chat Log</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${DASHBOARD_CSS}</style></head>
<body>
<div class="navbar">
  <h1>💬 Chat Log</h1>
  <div class="nav-links">
    <a href="/dashboard">📊 Stats</a>
    <a href="/dashboard/chats" style="background:rgba(255,255,255,0.3)">💬 Chats</a>
    <a href="/dashboard/members">👥 Members</a>
    <a href="/logout">🚪</a>
  </div>
</div>
<div class="container">
  <div class="section">
    <h2>💬 Semua Chat (${totalItems} pesan)</h2>
    
    <form method="GET" action="/dashboard/chats" class="search-bar">
      <input name="search" placeholder="🔍 Cari pesan, nama, atau ID..." value="${escapeHtml(search)}">
      <select name="type">
        <option value="">Semua Tipe</option>
        <option value="text" ${typeFilter === 'text' ? 'selected' : ''}>💬 Text</option>
        <option value="voice" ${typeFilter === 'voice' ? 'selected' : ''}>🎙️ Voice</option>
        <option value="photo" ${typeFilter === 'photo' ? 'selected' : ''}>📸 Photo</option>
        <option value="command" ${typeFilter === 'command' ? 'selected' : ''}>⚡ Command</option>
        <option value="ai" ${typeFilter === 'ai' ? 'selected' : ''}>🤖 AI</option>
      </select>
      <select name="user">
        <option value="">Semua User</option>
        ${Object.entries(uniqueUsers).map(([id, nama]) => 
          `<option value="${escapeHtml(id)}" ${userFilter === id ? 'selected' : ''}>${escapeHtml(nama)} (${id})</option>`
        ).join('')}
      </select>
      <button type="submit">🔍 Filter</button>
      <a href="/dashboard/chats" style="padding:10px 16px;background:#16213e;color:#888;border-radius:8px;text-decoration:none;font-size:13px">🔄 Reset</a>
    </form>
    
    <div style="overflow-x:auto">
    <table>
      <tr>
        <th style="width:60px">#</th>
        <th style="width:140px">📅 Waktu</th>
        <th style="width:180px">👤 User</th>
        <th style="width:80px">📎 Tipe</th>
        <th>💬 Pesan</th>
      </tr>
      ${pageItems.length === 0 ? '<tr><td colspan="5" class="empty">Tidak ada chat ditemukan</td></tr>' : 
        pageItems.map((c, i) => {
          const rowNum = startIdx + i + 1;
          const dateObj = new Date(c.timestamp);
          const dateStr = dateObj.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Makassar' });
          const timeStr = dateObj.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false, timeZone: 'Asia/Makassar' });
          
          let msgHtml = escapeHtml(c.message);
          if (search) {
            const regex = new RegExp(`(${search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
            msgHtml = msgHtml.replace(regex, '<span class="highlight">$1</span>');
          }
          
          return `<tr>
            <td style="color:#666">${rowNum}</td>
            <td class="time-info">
              <span class="time-date">${dateStr}</span>
              <span class="time-clock">${timeStr}</span>
            </td>
            <td class="user-info">
              <span class="user-name">${escapeHtml(c.userName)}</span>
              <span class="user-id">ID: ${escapeHtml(c.userId)}</span>
              ${c.username && c.username !== '-' ? `<span class="user-username">@${escapeHtml(c.username)}</span>` : ''}
            </td>
            <td><span class="badge badge-${c.type}">${escapeHtml(c.type)}</span></td>
            <td class="msg-text">${msgHtml}</td>
          </tr>`;
        }).join('')
      }
    </table>
    </div>
    
    ${paginationHtml}
    
    <div class="refresh-info">
      Halaman ${currentPage}/${totalPages} | Total ${totalItems} pesan | 
      Log max ${MAX_CHAT_LOG} pesan | ${getJamSekarang()} WITA
    </div>
  </div>
</div></body></html>`);
});

// ── MEMBERS PAGE ──

webApp.get('/dashboard/members', requireLogin, (req, res) => {
  res.send(`<html><head><title>Members</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${DASHBOARD_CSS}</style></head>
<body>
<div class="navbar">
  <h1>👥 Members</h1>
  <div class="nav-links">
    <a href="/dashboard">📊 Stats</a>
    <a href="/dashboard/chats">💬 Chats</a>
    <a href="/dashboard/members" style="background:rgba(255,255,255,0.3)">👥 Members</a>
    <a href="/logout">🚪</a>
  </div>
</div>
<div class="container">
  <div class="section">
    <h2>👥 Members (${MEMBERS.length}/${CONFIG.maxMember})</h2>
    <div class="member-list">
      ${MEMBERS.length === 0 ? '<p class="empty">Belum ada member</p>' :
        MEMBERS.map((id, i) => {
          const nama = KONTAK[id] || 'Unknown';
          const role = isAdmin(id) ? '👑 Admin' : ROLE_LAPORAN.includes(id) ? '📊 Staff' : '✅ Member';
          const chatCount = CHAT_LOG.filter(c => c.userId === id).length;
          return `<div class="member-card">
            <div class="name">${i+1}. ${escapeHtml(nama)}</div>
            <div class="id">ID: ${id}</div>
            <div class="role">${role} | 💬 ${chatCount} chat</div>
          </div>`;
        }).join('')
      }
    </div>
  </div>
  
  ${Object.keys(PENDING).length > 0 ? `
  <div class="section">
    <h2>🔔 Pending Approval (${Object.keys(PENDING).length})</h2>
    <div class="member-list">
      ${Object.entries(PENDING).map(([id, d]) => `
        <div class="member-card" style="border-left-color: #fbbf24">
          <div class="name">${escapeHtml(d.nama)}</div>
          <div class="id">ID: ${id}</div>
          <div class="role">⏳ Pending | @${escapeHtml(d.username || '-')}</div>
        </div>
      `).join('')}
    </div>
  </div>` : ''}
  
  <div class="section">
    <h2>📊 Staff Laporan (${ROLE_LAPORAN.length})</h2>
    ${ROLE_LAPORAN.length === 0 ? '<p class="empty">Belum ada staff laporan</p>' :
      `<div class="member-list">${ROLE_LAPORAN.map(id => `
        <div class="member-card" style="border-left-color: #4ade80">
          <div class="name">${escapeHtml(KONTAK[id] || 'Unknown')}</div>
          <div class="id">ID: ${id}</div>
          <div class="role">📊 Staff Laporan</div>
        </div>
      `).join('')}</div>`
    }
  </div>
</div></body></html>`);
});

// ── SEARCH ANALYTICS PAGE ──

webApp.get('/dashboard/searches', requireLogin, (req, res) => {
  const allSearches = Object.entries(STATS.topSearches).sort((a,b) => b[1]-a[1]);
  
  res.send(`<html><head><title>Search Analytics</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${DASHBOARD_CSS}</style></head>
<body>
<div class="navbar">
  <h1>🔍 Search Analytics</h1>
  <div class="nav-links">
    <a href="/dashboard">📊 Stats</a>
    <a href="/dashboard/chats">💬 Chats</a>
    <a href="/dashboard/searches" style="background:rgba(255,255,255,0.3)">🔍 Searches</a>
    <a href="/logout">🚪</a>
  </div>
</div>
<div class="container">
  <div class="section">
    <h2>🔍 Search Analytics (${allSearches.length} keywords, ${STATS.searches} total)</h2>
    <table>
      <tr><th>#</th><th>Keyword</th><th>Count</th><th>Bar</th></tr>
      ${allSearches.length === 0 ? '<tr><td colspan="4" class="empty">No searches yet</td></tr>' :
        allSearches.slice(0, 100).map((s, i) => {
          const maxCount = allSearches[0][1];
          const barWidth = Math.max(5, Math.floor((s[1] / maxCount) * 200));
          return `<tr>
            <td>${i+1}</td>
            <td><b>${escapeHtml(s[0])}</b></td>
            <td>${s[1]}x</td>
            <td><div style="width:${barWidth}px;height:18px;background:linear-gradient(90deg,#667eea,#764ba2);border-radius:4px"></div></td>
          </tr>`;
        }).join('')
      }
    </table>
  </div>
</div></body></html>`);
});

// ── API ENDPOINTS ──

webApp.get('/api/chats', requireLogin, (req, res) => {
  const limit = parseInt(req.query.limit || '50');
  const offset = parseInt(req.query.offset || '0');
  res.json({
    total: CHAT_LOG.length,
    offset, limit,
    data: CHAT_LOG.slice(-limit - offset, CHAT_LOG.length - offset).reverse(),
  });
});

webApp.get('/api/stats', requireLogin, (req, res) => {
  res.json({
    chats: STATS.chats, users: STATS.users.size, searches: STATS.searches,
    ai: STATS.aiQueries, voice: STATS.voiceNotes, photos: STATS.photos,
    members: MEMBERS.length, barang: DATA_BARANG.length,
    uptime: process.uptime(),
  });
});

webApp.get('/health', (req, res) => {
  res.json({ status: 'OK', uptime: process.uptime(), barang: DATA_BARANG.length, members: MEMBERS.length });
});

webApp.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/');
});

// ── START WEB SERVER ──

const PORT = process.env.PORT || CONFIG.webPort || 3000;
const HOST = '0.0.0.0';

const server = webApp.listen(PORT, HOST, () => {
  console.log('═'.repeat(60));
  console.log(`🌐 Web Dashboard READY`);
  console.log(`🌐 Listening: ${HOST}:${PORT}`);
  console.log(`🌐 Local: http://localhost:${PORT}`);
  console.log('═'.repeat(60));
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') log.error('WEB', `Port ${PORT} already in use!`);
  else log.error('WEB', 'Server error: ' + err.message);
});
// ════════════════════════════════════════════════════════════════
//   39. ERROR HANDLERS & GRACEFUL SHUTDOWN
// ════════════════════════════════════════════════════════════════

let isShuttingDown = false;

// Polling error handler - jangan crash, biarkan auto-retry
bot.on('polling_error', (err) => {
  const msg = err.message || err.code || String(err);
  
  // Error 409 = conflict (ada bot lain running)
  if (msg.includes('409') || msg.includes('Conflict')) {
    log.error('POLLING', '⚠️ Bot conflict! Cek apakah ada instance lain running.');
    // Tunggu 30 detik baru retry
    if (!isShuttingDown) {
      setTimeout(() => {
        log.info('POLLING', 'Retrying after conflict...');
      }, 30000);
    }
    return;
  }
  
  // Error network biasa - biarkan polling auto-retry
  if (msg.includes('ETIMEDOUT') || msg.includes('ECONNRESET') || msg.includes('EFATAL')) {
    log.warn('POLLING', 'Network error: ' + msg.substring(0, 100));
    return;
  }
  
  log.error('POLLING', msg);
});

bot.on('error', (err) => log.error('BOT', err.message || String(err)));
bot.on('webhook_error', (err) => log.error('WEBHOOK', err.message || String(err)));

// Uncaught errors - log tapi jangan crash
process.on('uncaughtException', async (err) => {
  log.error('SYSTEM', 'Uncaught: ' + err.message);
  console.error(err.stack);
  
  // Emergency backup sebelum potentially crash
  try {
    await emergencyBackup();
  } catch(e) {}
});

process.on('unhandledRejection', async (reason) => {
  log.error('SYSTEM', 'Unhandled Rejection: ' + String(reason));
  
  // Emergency backup
  try {
    await emergencyBackup();
  } catch(e) {}
});

// Graceful shutdown function
async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  
  console.log(`\n👋 Received ${signal}, shutting down gracefully...`);
  
  try {
     // ⬇️ TAMBAH INI: Emergency backup SO ke admin
    console.log('🚨 Emergency backup SO data...');
    await emergencyBackup();
    // 1. Stop polling DULU agar tidak conflict saat restart
    console.log('🛑 Stopping bot polling...');
    await bot.stopPolling({ cancel: true });
    console.log('✅ Bot polling stopped');
    
    // 2. Close web server
    if (server) {
      console.log('🛑 Closing web server...');
      await new Promise((resolve) => server.close(resolve));
      console.log('✅ Web server closed');
    }
    
    // 3. Save semua data sebelum exit
    console.log('💾 Saving data...');
    if (sesiSaveTimer) clearTimeout(sesiSaveTimer);
    saveJSON(CONFIG.paths.sesi, SESI);
    saveJSON(CONFIG.paths.soShared, SO_SHARED);
    console.log('✅ Data saved');
    
    console.log('👋 Goodbye!\n');
    process.exit(0);
  } catch(err) {
    console.error('❌ Error during shutdown:', err.message);
    process.exit(1);
  }
}

// Listen ke berbagai signal shutdown
process.on('SIGINT', () => gracefulShutdown('SIGINT'));   // Ctrl+C
process.on('SIGTERM', () => gracefulShutdown('SIGTERM')); // Railway restart
process.on('SIGHUP', () => gracefulShutdown('SIGHUP'));   // Terminal close

console.log('═'.repeat(60));
// Start auto-backup SO ke admin
if (CONFIG.adminId) {
  startAutoBackup();
  log.info('BACKUP', `✅ Auto-backup SO aktif, target admin: ${CONFIG.adminId}`);
} else {
  log.warn('BACKUP', '⚠️ Admin ID belum diset, auto-backup DISABLED');
}
console.log('🚀 Bot polling started...');
console.log(`📱 Test: https://t.me/${CONFIG.botUsername}`);
console.log('═'.repeat(60));
console.log('');
