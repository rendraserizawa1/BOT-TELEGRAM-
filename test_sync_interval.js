'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const bridge = fs.readFileSync(path.join(__dirname, 'ipos-bridge.js'), 'utf8').replace(/\r/g, '');
const bot = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8').replace(/\r/g, '');
assert.match(bridge, /function mulaiAutoSync\(getDataBarang, intervalMs = Number\(process\.env\.IPOS_SYNC_MS \|\| 60000\)\)/,
  'bridge full-catalog fallback must default to 60 seconds');
assert.equal((bot.match(/mulaiAutoSync\(\(\) => DATA_BARANG, Number\(process\.env\.IPOS_SYNC_MS \|\| 60000\)\)/g) || []).length, 3,
  'all configured shops must use 60 seconds, not 15');
console.log('OK fallback full-sync default 60s at bridge and all 3 shop callers');
