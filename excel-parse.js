// excel-parse.js
// Logika parsing Excel toko, DIPISAH dari index.js agar bisa dijalankan
// di worker thread. Tujuan: xlsx.readFile bersifat SINKRON dan memblokir
// event loop 0,5-5,3 detik per file (terukur 8,4 dtk untuk 5 toko), yang
// membuat poller Telegram macet dan watchdog me-restart bot.
//
// Modul ini tidak boleh memakai console/log milik index.js dan tidak boleh
// menyentuh state global: hanya menerima path + kode toko, mengembalikan hasil.
'use strict';
const fs = require('fs');
const xlsx = require('xlsx');

const MAX_HEADER_SCAN = 15;

function parseNum(val) {
  if (!val && val !== 0) return 0;
  if (typeof val === 'number') return Math.floor(val);
  let str = String(val).trim();
  str = str.replace(/[^0-9,.-]/g, '');
  if (!str) return 0;
  const cleaned = str.replace(/[.,]/g, '');
  return parseInt(cleaned) || 0;
}

/**
 * Parse satu file Excel toko.
 * @returns {{ok:boolean, items:Array, error?:string, messages:string[], stats?:object}}
 */
function parseExcelFile(filePath, tokoKode) {
  const messages = [];
  const info = (m) => messages.push('INFO|' + m);
  const warn = (m) => messages.push('WARN|' + m);
  const err = (m) => messages.push('ERROR|' + m);

  if (!filePath || !fs.existsSync(filePath)) {
    warn(`File ${tokoKode}: tidak ditemukan (${filePath})`);
    return { ok: false, items: [], error: 'file tidak ditemukan', messages };
  }

  try {
    const wb = xlsx.readFile(filePath);
    const ws = wb.Sheets[wb.SheetNames[0]];
    const allRows = xlsx.utils.sheet_to_json(ws, { header: 1, defval: 0, blankrows: false });

    if (allRows.length < 3) {
      warn(`File ${tokoKode}: kurang data (< 3 baris)`);
      return { ok: false, items: [], error: 'kurang data', messages };
    }

    // ═══ AUTO-DETECT HEADER ═══
    let headerRowIdx = -1;
    let headers = [];
    for (let i = 0; i < Math.min(MAX_HEADER_SCAN, allRows.length); i++) {
      const row = allRows[i];
      if (!row) continue;
      const rowStr = row.map((c) => String(c || '').toLowerCase()).join('|');
      if ((rowStr.includes('kode item') || rowStr.includes('kode')) &&
          (rowStr.includes('nama item') || rowStr.includes('nama'))) {
        headerRowIdx = i;
        headers = row.map((h) => String(h || '').trim());
        break;
      }
    }

    if (headerRowIdx === -1) {
      err(`File ${tokoKode}: Header tidak ditemukan (cari "Kode Item" dan "Nama Item")`);
      return { ok: false, items: [], error: 'header tidak ditemukan', messages };
    }
    info(`File ${tokoKode}: Header di baris ${headerRowIdx + 1}`);

    // ═══ FLEXIBLE COLUMN MATCHING ═══
    const findCol = (...names) => {
      for (const name of names) {
        const idx = headers.findIndex(
          (h) => h.toLowerCase().replace(/\s+/g, ' ').trim() === name.toLowerCase()
        );
        if (idx !== -1) return idx;
      }
      for (const name of names) {
        const idx = headers.findIndex((h) => h.toLowerCase().includes(name.toLowerCase()));
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
      hargaEcer: findCol('Harga Price', 'Price', 'Ecer', 'Retail', 'Harga Ecer'),
      hargaAmbil: findCol('Harga Jual', 'Jual', 'Ambil', 'Grosir', 'Wholesale'),
      hargaHPP: findCol('HPP', 'Harga Beli', 'Harga Pokok', 'Harga Modal', 'Modal'),
      merek: findCol('Merek', 'Merk', 'Brand'),
    };

    if (colMap.kode === -1 || colMap.nama === -1) {
      err(`File ${tokoKode}: Kolom "Kode Item" atau "Nama Item" tidak ada`);
      err(`Headers ditemukan: ${headers.join(', ')}`);
      return { ok: false, items: [], error: 'kolom wajib tidak ada', messages };
    }

    info(`${tokoKode} mapping: kode=${colMap.kode}, nama=${colMap.nama}, stok=${colMap.stok}, ` +
         `satuan=${colMap.satuan}, ecer=${colMap.hargaEcer}, ambil=${colMap.hargaAmbil}, hpp=${colMap.hargaHPP}`);

    const items = [];
    for (let i = headerRowIdx + 1; i < allRows.length; i++) {
      const row = allRows[i];
      if (!row || row.length === 0) continue;

      const kode = String(row[colMap.kode] || '').trim().toUpperCase();
      if (!kode || kode === '0' || kode === 'NO' || kode === 'KODE') continue;

      const nama = String(row[colMap.nama] || '').trim().toUpperCase();
      if (!nama || nama.length < 2) continue;

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
        ecer: hargaEcer,
        ambil: hargaAmbil > 0 ? hargaAmbil : hargaEcer,
        stok: colMap.stok >= 0 ? parseNum(row[colMap.stok]) : 0,
      });
    }

    info(`File ${tokoKode}: ${items.length} item loaded`);
    return { ok: true, items, messages };
  } catch (e) {
    err(`File ${tokoKode} gagal load: ${e.message}`);
    return { ok: false, items: [], error: e.message, messages };
  }
}

module.exports = { parseExcelFile, parseNum };
