'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ps = fs.readFileSync(path.join(__dirname, 'watchdog-bot.ps1'), 'utf8').replace(/\r/g, '');
// Guard memakai sinyal macet event-loop, bukan RAM (sesuai keputusan: tanpa batas RAM).
assert.ok(ps.includes('loopLagMax60s'), 'watchdog harus membaca loopLagMax60s dari /health');
// Restart hanya setelah gagal beruntun, bukan sekali gagal.
assert.ok(/gagalBeruntun|GagalBeruntun|consecutive/i.test(ps), 'watchdog harus menghitung gagal beruntun');
// Tidak boleh ada restart berbasis WorkingSet/RAM.
assert.ok(!/WorkingSet|PrivateMemory|VirtualMemory/.test(ps), 'watchdog tidak boleh restart berbasis RAM');
console.log('OK watchdog guard tanpa batas RAM, pakai lag + gagal beruntun');
