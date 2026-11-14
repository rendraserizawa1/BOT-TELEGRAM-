'use strict';
/**
 * Tes: tolak lebih dari 1 replika.
 *
 * Kenapa: kunci single-instance memakai `wmic` + `netstat -ano` (khusus
 * Windows). Di Linux keduanya gagal -> pemilikLockSah() = null -> lock
 * selalu bisa diambil. Dengan 2 replika, dua poller memanggil getUpdates
 * dengan token sama -> Telegram 409 Conflict -> pesan dan tombol hilang.
 *
 * Kontrak: pastikanSatuReplika() -> { ok, alasan }
 */

const { pastikanSatuReplika } = require('./replika-guard.js');

let gagal = 0;

// 1) tidak diset -> satu replika (default aman)
delete process.env.RAILWAY_REPLICA_COUNT;
let a = pastikanSatuReplika();
if (!a.ok) { console.error('GAGAL 1: tanpa env harus ok, dapat ' + JSON.stringify(a)); gagal++; }

// 2) = 1 -> ok
process.env.RAILWAY_REPLICA_COUNT = '1';
let b = pastikanSatuReplika();
if (!b.ok) { console.error('GAGAL 2: 1 replika harus ok, dapat ' + JSON.stringify(b)); gagal++; }

// 3) = 3 -> HARUS ditolak, alasan menyebut 409
process.env.RAILWAY_REPLICA_COUNT = '3';
let c = pastikanSatuReplika();
if (c.ok) { console.error('GAGAL 3: 3 replika harus ditolak'); gagal++; }
else if (!/409/.test(c.alasan)) { console.error('GAGAL 3b: alasan harus menyebut 409, dapat ' + c.alasan); gagal++; }

// 4) nilai tidak masuk akal -> jangan crash, anggap 1
process.env.RAILWAY_REPLICA_COUNT = 'abc';
let d = pastikanSatuReplika();
if (!d.ok) { console.error('GAGAL 4: nilai aneh harus dianggap 1, dapat ' + JSON.stringify(d)); gagal++; }

delete process.env.RAILWAY_REPLICA_COUNT;
if (gagal) process.exit(1);
console.log('OK replika-guard 4/4');
