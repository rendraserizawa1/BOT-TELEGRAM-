'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const source = fs.readFileSync(require('node:path').join(__dirname, 'ipos-bridge.js'), 'utf8').replace(/\r/g, '');
assert.match(source, /function mulaiAutoSync\(getDataBarang, intervalMs = Number\(process\.env\.IPOS_SYNC_MS \|\| 60000\)\)/,
  'full catalog fallback must default to 60 seconds, not 5 seconds');
console.log('OK sync katalog penuh default tiap 60 detik');
