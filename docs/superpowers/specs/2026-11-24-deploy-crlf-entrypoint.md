# Deploy Railway mati total karena entrypoint.sh ber-CRLF

Tanggal: 2026-11-24
Status: selesai diperbaiki

## Ringkasan

Saat mengirim perbaikan Stock Opname ke produksi lewat `railway up`, bot mati
**total selama ± 5 menit**. `/health` tidak menjawab sama sekali. Penyebabnya
bukan kode aplikasi, bukan iPos, bukan Telegram — melainkan **akhir baris
berkas `docker-entrypoint.sh`**.

## Gejala

Log container, berulang tiap ± 1 detik:

```
exec container process (missing dynamic library?)
`/app/./entrypoint.sh`: No such file or directory
```

Pesan itu **menyesatkan**. Berkasnya ada di `/app/entrypoint.sh`. Yang tidak
ada adalah **interpreter**-nya.

## Akar masalah

`core.autocrlf=true` di mesin Windows membuat working tree ber-CRLF.
`railway up` mengunggah **working tree**, bukan blob git. Baris pertama
`docker-entrypoint.sh` menjadi:

```
35,33,47,98,105,110,47,115,104,13,10
#  !  /  b  i  n  /  s  h  CR LF
```

Kernel membaca shebang sampai akhir baris, jadi ia mencari interpreter
bernama `/bin/sh\r` — dengan karakter CR menempel. Tidak ada. `exec` gagal.
Container tidak pernah sampai menjalankan `node index.js`.

### Kenapa deploy sebelumnya tidak pernah kena

Railway menarik **blob** langsung dari GitHub, dan blob git selalu disimpan
sebagai LF. Hanya jalur `railway up` (unggah working tree) yang terpengaruh.
Jadi bug ini laten sejak lama dan baru muncul saat deploy lewat `railway up`.

## Perbaikan

1. `docker-entrypoint.sh` diubah ke LF murni: 301 byte CR dihapus,
   14.194 → 13.893 byte, isi teks tidak berubah. Shebang menjadi
   `35,33,47,98,105,110,47,115,104,10` = `#!/bin/sh\n`.
2. `.gitattributes` baru memaksa akhir baris per jenis berkas:

   | Pola | Akhir baris | Alasan |
   |---|---|---|
   | `*.sh`, `*.bash` | `lf` | dieksekusi kernel Linux |
   | `Dockerfile`, `*.dockerfile`, `.dockerignore` | `lf` | dibaca builder Linux |
   | `*.js`, `*.mjs`, `*.cjs` | `lf` | Node di container Linux |
   | `*.yml`, `*.yaml`, `*.json`, `Procfile` | `lf` | dibaca tool Linux |
   | `*.ps1`, `*.bat`, `*.cmd` | `crlf` | khusus Windows |

   Dengan ini masalah tidak bisa terulang, apa pun setelan `core.autocrlf`
   di mesin mana pun.

## Verifikasi

```
$ git ls-files --eol docker-entrypoint.sh
i/lf    w/lf    attr/text eol=lf       docker-entrypoint.sh

$ git hash-object --no-filters docker-entrypoint.sh   -> 6936e71c...
$ git rev-parse HEAD:docker-entrypoint.sh              -> 6936e71c...
```

Blob di index **dan** berkas kerja sama-sama LF, dan hash-nya identik dengan
blob di HEAD — artinya yang tersimpan di git memang LF.

Pasca-deploy:

| Pemeriksaan | Hasil |
|---|---|
| `/health` status | OK |
| `polling` | true |
| `telegramPollErrorStreak` | 0 |
| `volumeOk` | true (`/data` terpasang) |
| uptime | naik terus (tidak crash-loop) |
| `db.outbox` | 0 |
| iPos cp / nk / kefa | online + `itemSegar` |

NK yang sebelumnya offline (umur data 50.457 detik) langsung pulih setelah
deploy.

## Aturan operasional

Sebelum `railway up`, pastikan berkas yang dieksekusi Linux tidak ber-CR:

```
node -e "const b=require('fs').readFileSync('docker-entrypoint.sh'); console.log(b.includes(13) ? 'ADA CR - JANGAN DEPLOY' : 'LF bersih')"
```

Kalau ada CR, jangan deploy. Perbaiki dulu (atau andalkan `.gitattributes`
dengan commit ulang berkasnya).

## Pelajaran

- Pesan error container "No such file or directory" untuk skrip yang jelas
  ada → curigai **shebang + CRLF**, bukan berkas hilang.
- `railway up` ≠ deploy dari GitHub. Yang diunggah adalah working tree apa
  adanya, termasuk artefak lokal seperti akhir baris.
- Repo yang dikembangkan di Windows tetapi dijalankan di Linux **wajib**
  punya `.gitattributes`.
