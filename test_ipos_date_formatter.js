'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, 'ipos-bridge.js'), 'utf8').replace(/\r/g, '');
assert.match(source, /const formatterTanggal = new Intl\.DateTimeFormat\('id-ID',[\s\S]*?\);\s*const tglHariIni = \(\) => formatterTanggal\.format\(new Date\(\)\);/,
  'formatter Intl harus dibuat sekali per bridge, bukan sekali per item katalog');
console.log('OK formatter tanggal dipakai ulang');
