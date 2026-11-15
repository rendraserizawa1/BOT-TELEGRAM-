> ## ⚠️ RENCANA INI SUDAH DIGANTIKAN — JANGAN DIJALANKAN
>
> Tailscale gagal (CGNAT → DERP relay → putus pada payload 780 KB) dan sudah
> dipensiunkan. Arsitektur yang dipakai sekarang adalah **dorong PC → Railway**.
> Baca: `docs/superpowers/specs/2026-11-16-ipos-dorong-final.md`

---
# Railway Tailscale (Opsi A1) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membuat container Railway menjadi anggota tailnet sendiri sehingga bot membaca iPos lewat IP Tailscale dengan URL tetap, tanpa tunnel Cloudflare dan tanpa ketergantungan pada PC ini.

**Architecture:** `tailscaled` dijalankan dalam mode userspace (tanpa TUN/NET_ADMIN) sebagai proses anak entrypoint, membuka proxy HTTP keluar di `127.0.0.1:1056`. Bot mengalihkan **hanya** panggilan iPos ke proxy itu lewat `dispatcher` per-permintaan; Telegram/GitHub/AI tetap langsung. Satu modul baru `boot/ipos-jalur.js` memusatkan logika jalur (utama + cadangan) agar 4 titik `fetch` di `ipos-bridge.js` tidak menduplikasi logika.

**Tech Stack:** Node 24.22 (`fetch` global + `dispatcher`), `undici` 7.x (`ProxyAgent`), Tailscale 1.102.4 statis (`-tun=userspace-networking -outbound-http-proxy-listen`), Docker `node:24-slim`, Railway (1 replika, volume `/data`).

**Spec:** `docs/superpowers/specs/2026-11-15-railway-tailscale-design.md`

## Global Constraints

- Node **24.x** wajib (`node:sqlite` butuh 22+). Jangan turunkan.
- Replika Railway **wajib 1**. Jangan pernah menambah.
- `PORT` **tidak boleh** diisi manual di Railway.
- **DILARANG** mencetak/menyimpan isi `.env`, `TS_AUTHKEY`, `BOT_TOKEN`, `IPOS_*_KEY`, atau token apa pun. Hanya panjangnya.
- **DILARANG** menebak IP/KUNCI. Uji konektivitas sebelum mengubah apa pun.
- Setiap perubahan kode **wajib** punya fallback ke nilai sekarang, sehingga perilaku di PC tidak berubah dan rollback trivial.
- `.github/workflows/bot.yml` **tidak boleh disentuh** (token tidak punya scope `workflow`; menyentuhnya memblokir semua push).
- Versi Tailscale dipatok `1.102.4`.
- `undici` dipatok major **7** (selaras dengan undici bawaan Node 24.22 = 7.29.1).
- Proxy hanya untuk iPos. **Telegram tidak boleh lewat proxy.**
- Setelah Tailscale terbukti, pengawas tunnel (`boot/jaga-tunnel.js`, task `BCODE-JAGA-TUNNEL`, HKCU `BCODE_JAGA_TUNNEL`) **dipensiunkan**. Urutan tidak boleh dibalik: verifikasi dulu, pensiunkan kemudian.
- `boot/jaga-poller-tunggal.js` **tetap hidup**; bot lokal tetap mati.

## Review Focus

1. **`fetch` global mengabaikan `dispatcher`** â†’ koneksi diam-diam tetap langsung dan Tailscale dianggap bekerja padahal tidak. Sudah diuji: **dihormati** (`_uji-undici.json`), tetapi tiap perubahan `undici` wajib mengulang uji ini.
2. **Proxy menahan body SSE** â†’ realtime mati lagi meski HTTP 200. Diuji oleh Task 3 dan Task 9.
3. **`tailscaled` gagal start di Railway** â†’ bot harus tetap hidup, bukan crash-loop. Diuji oleh Task 6 (fallback tanpa `TS_AUTHKEY`) dan Task 7 (blok tidak fatal).
4. **Pengawas tunnel menimpa `IPOS_*_URL`** â†’ deploy tidak pernah stabil. Ditangani Task 10 (pensiun berurutan).
5. **`formatError()` rusak karena perubahan mekanisme fetch** â†’ pesan error iPos salah, retry classifier salah. Dikunci oleh `boot/test-format-error.js` di Task 4.

---

## Struktur Berkas

| Berkas | Tanggung jawab |
|---|---|
| `boot/ipos-jalur.js` (baru) | Satu-satunya tempat yang tahu soal proxy + jalur cadangan. Mengekspor `buatJalurIpos`. |
| `boot/test-ipos-jalur.js` (baru) | Uji modul di atas tanpa jaringan nyata. |
| `ipos-bridge.js` (ubah) | 4 titik `fetch` iPos memakai `jalur.ambil(...)`. |
| `docker-entrypoint.sh` (ubah) | Blok Tailscale: tidak fatal, dilewati bila `TS_AUTHKEY` kosong. |
| `Dockerfile` (ubah) | Unduh biner Tailscale saat build, tidak fatal bila gagal. |
| `package.json` (ubah) | Tambah `undici` 7.x. |
| `index.js` (ubah) | `/health` melaporkan `tailscale.*` dan `ipos.<toko>.jalur.*`. |
| `boot/uji-tailscale.js` (baru) | Uji di dalam container lewat `railway ssh`. |
| `boot/uji-jaminan.js` (ubah) | Assertion tunnel â†’ assertion Tailscale. |
| `boot/pensiun-tunnel.js` (baru) | Mematikan pengawas tunnel secara berurutan dan terverifikasi. |

---

### Task 1: Modul jalur iPos (proxy + cadangan)

**Files:**
- Create: `boot/ipos-jalur.js`
- Test: `boot/test-ipos-jalur.js`

**Interfaces:**
- Consumes: tidak ada (modul paling dasar).
- Produces:
  - `buatJalurIpos({ urlUtama, urlCadangan, proxy }) -> { ambil(url, opsi), dispatcher(), status() }`
  - `ambil(url, opsi)` â†’ `Promise<Response>`; `opsi` diteruskan ke `fetch` (mis. `{ signal }`).
  - `dispatcher()` â†’ `ProxyAgent | null`.
  - `status()` â†’ `{ proxyAktif: boolean, urlUtama: string, urlCadangan: string|null, jalurDipakai: 'utama'|'cadangan'|null }`

- [ ] **Step 1: Tulis uji yang gagal**

```js
// boot/test-ipos-jalur.js
'use strict';
const assert = require('assert');
const { buatJalurIpos } = require('./ipos-jalur');

let lulus = 0, gagal = 0;
function uji(nama, fn) {
  try { fn(); lulus++; console.log('  OK   ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
}
async function ujiAsync(nama, fn) {
  try { await fn(); lulus++; console.log('  OK   ' + nama); }
  catch (e) { gagal++; console.log('  GAGAL ' + nama + ' -> ' + e.message); }
}

(async () => {
  // Tanpa proxy dan tanpa cadangan: harus berperilaku seperti fetch biasa.
  uji('tanpa proxy -> dispatcher null', () => {
    const j = buatJalurIpos({ urlUtama: 'http://x/ipos', urlCadangan: '', proxy: '' });
    assert.strictEqual(j.dispatcher(), null);
  });

  uji('status melaporkan proxyAktif=false tanpa proxy', () => {
    const j = buatJalurIpos({ urlUtama: 'http://x/ipos', urlCadangan: '', proxy: '' });
    const s = j.status();
    assert.strictEqual(s.proxyAktif, false);
    assert.strictEqual(s.urlUtama, 'http://x/ipos');
    assert.strictEqual(s.urlCadangan, null);
    assert.strictEqual(s.jalurDipakai, null);
  });

  // Cadangan dipakai HANYA saat error jaringan, bukan saat 404.
  await ujiAsync('error jaringan -> pindah ke cadangan', async () => {
    const dipanggil = [];
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: 'http://cadangan/ipos', proxy: '',
      _fetch: async (url) => {
        dipanggil.push(url);
        if (url.startsWith('http://utama')) throw new TypeError('fetch failed');
        return { status: 200, ok: true, url };
      },
    });
    const r = await j.ambil('http://utama/ipos/api/items');
    assert.strictEqual(r.status, 200);
    assert.strictEqual(dipanggil.length, 2);
    assert.ok(dipanggil[1].startsWith('http://cadangan'));
    assert.strictEqual(j.status().jalurDipakai, 'cadangan');
  });

  await ujiAsync('HTTP 404 TIDAK memicu cadangan', async () => {
    const dipanggil = [];
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: 'http://cadangan/ipos', proxy: '',
      _fetch: async (url) => { dipanggil.push(url); return { status: 404, ok: false }; },
    });
    const r = await j.ambil('http://utama/ipos/api/item?kode=X');
    assert.strictEqual(r.status, 404);
    assert.strictEqual(dipanggil.length, 1);
  });

  await ujiAsync('setelah cadangan berhasil, jalur diingat', async () => {
    let utama = 0;
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: 'http://cadangan/ipos', proxy: '',
      _fetch: async (url) => {
        if (url.startsWith('http://utama')) { utama++; throw new TypeError('fetch failed'); }
        return { status: 200, ok: true };
      },
    });
    await j.ambil('http://utama/ipos/api/items');
    await j.ambil('http://utama/ipos/api/jual');
    // Panggilan kedua langsung ke cadangan: utama hanya dicoba sekali.
    assert.strictEqual(utama, 1);
  });

  await ujiAsync('cadangan juga gagal -> error asli dilempar', async () => {
    const j = buatJalurIpos({
      urlUtama: 'http://utama/ipos', urlCadangan: 'http://cadangan/ipos', proxy: '',
      _fetch: async () => { throw new TypeError('fetch failed'); },
    });
    await assert.rejects(() => j.ambil('http://utama/ipos/api/items'), /fetch failed/);
  });

  console.log('\n  lulus ' + lulus + '/' + (lulus + gagal));
  process.exit(gagal ? 1 : 0);
})();
```

- [ ] **Step 2: Jalankan uji, pastikan gagal**

Run: `node boot/test-ipos-jalur.js`
Expected: FAIL â€” `Cannot find module './ipos-jalur'`

- [ ] **Step 3: Implementasi `boot/ipos-jalur.js`**

Aturan yang mengikat implementasi:
- `proxy` kosong â†’ `dispatcher()` = `null`, `ambil()` = `fetch` biasa.
- `proxy` diisi â†’ `require('undici').ProxyAgent`, dibuat **sekali** (lazy), disimpan.
- `require('undici')` gagal â†’ kembalikan `null` dan catat sekali ke `console.warn` (jangan crash).
- Pindah ke cadangan **hanya** bila error bertipe jaringan: `TypeError` dengan pesan mengandung `fetch failed`, atau `e.code` di `ECONNRESET/ECONNREFUSED/ETIMEDOUT/ENOTFOUND/EAI_AGAIN/UND_ERR_*`, atau `e.name === 'AbortError'` **tidak** dihitung (abort bukan alasan pindah).
- URL cadangan dibentuk dengan mengganti awalan `urlUtama` pada URL yang diminta.
- `_fetch` hanya untuk uji (default `globalThis.fetch`).

- [ ] **Step 4: Jalankan uji, pastikan lulus**

Run: `node boot/test-ipos-jalur.js`
Expected: PASS â€” `lulus 6/6`

- [ ] **Step 5: Commit**

```bash
git add boot/ipos-jalur.js boot/test-ipos-jalur.js
git commit -m "feat(ipos): modul jalur iPos dengan proxy tailscale dan cadangan"
```

---

### Task 2: Tambah dependensi `undici`

**Files:**
- Modify: `package.json`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `require('undici')` tersedia di runtime.

- [ ] **Step 1: Pasang dengan versi dipatok**

Run: `npm install undici@^7.30.2 --save --no-audit --no-fund`
Expected: `package.json` memuat `"undici": "^7.30.2"`, `package-lock.json` diperbarui.

- [ ] **Step 2: Verifikasi undici bisa dimuat dan ProxyAgent ada**

Run: `node -e "const u=require('undici'); console.log('versi', require('undici/package.json').version, 'ProxyAgent', typeof u.ProxyAgent)"`
Expected: `versi 7.x.x ProxyAgent function`

- [ ] **Step 3: Verifikasi uji Task 1 masih lulus**

Run: `node boot/test-ipos-jalur.js`
Expected: PASS â€” `lulus 6/6`

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): tambah undici 7.x untuk proxy tailscale"
```

---

### Task 3: Uji bahwa proxy tidak menahan body SSE

**Files:**
- Test: `boot/test-proxy-sse.js`

**Interfaces:**
- Consumes: `buatJalurIpos` (Task 1), `undici` (Task 2).
- Produces: bukti bahwa `dispatcher` meneruskan streaming. Tidak mengekspor API.

- [ ] **Step 1: Tulis uji**

Uji ini menyalakan dua server lokal: satu "server asal" yang mengirim `: ping` tiap 300 ms, satu "proxy penerus" yang menyalurkan body apa adanya. Lalu memanggil `jalur.ambil()` dengan proxy aktif dan menghitung potongan data.

Assertion yang wajib ada:
- `r.status === 200`
- `potongan > 1` (bukti tidak dibuffer)
- `ping >= 3`
- jeda antar potongan pertama dan terakhir `> 500 ms` (bukti mengalir bertahap, bukan sekali kirim)

- [ ] **Step 2: Jalankan, pastikan gagal**

Run: `node boot/test-proxy-sse.js`
Expected: FAIL â€” berkas belum ada

- [ ] **Step 3: Tulis berkas uji sesuai assertion di atas**

Server asal menutup setelah 10 ping. Uji keluar `exit 0` bila semua assertion lulus, `exit 1` bila tidak. Cetak `lulus N/N`.

- [ ] **Step 4: Jalankan, pastikan lulus**

Run: `node boot/test-proxy-sse.js`
Expected: PASS â€” `potongan > 1`, `ping >= 3`

- [ ] **Step 5: Commit**

```bash
git add boot/test-proxy-sse.js
git commit -m "test(ipos): buktikan proxy tailscale tidak menahan body SSE"
```

---

### Task 4: Sambungkan `ipos-bridge.js` ke modul jalur

**Files:**
- Modify: `ipos-bridge.js:104`, `ipos-bridge.js:147`, `ipos-bridge.js:407`, `ipos-bridge.js:506`
- Test: `boot/test-format-error.js` (sudah ada, tidak diubah)

**Interfaces:**
- Consumes: `buatJalurIpos` (Task 1).
- Produces: `bridge.jalurStatus()` â†’ `{ proxyAktif, urlUtama, urlCadangan, jalurDipakai }` untuk dipakai Task 8.

- [ ] **Step 1: Jalankan uji yang sudah ada sebagai garis dasar**

Run: `node boot/test-format-error.js`
Expected: PASS (catat jumlah lulusnya)

- [ ] **Step 2: Ubah 4 titik fetch**

Di dalam `buatBridge({ url, key, toko, label })`, tepat setelah `IPOS_KEY` didefinisikan, buat satu jalur:

```js
const jalur = require('./boot/ipos-jalur').buatJalurIpos({
  urlUtama: IPOS_URL,
  urlCadangan: process.env['IPOS_' + (toko || '').toUpperCase() + '_URL_CADANGAN'] || '',
  proxy: process.env.IPOS_TAILSCALE_PROXY || '',
});
```

Lalu ganti keempat panggilan:
- `fetch(\`${IPOS_URL}/api/items?key=...\`, { signal: controller.signal })` â†’ `jalur.ambil(\`${IPOS_URL}/api/items?key=...\`, { signal: controller.signal })`
- `fetch(url, { signal: controller.signal })` (baris 147) â†’ `jalur.ambil(url, { signal: controller.signal })`
- `fetch(url, { signal: controller.signal })` (baris 407) â†’ `jalur.ambil(url, { signal: controller.signal })`
- `fetch(\`${IPOS_URL}/api/events?key=...\`, { headers: { accept: 'text/event-stream' }, signal: ac.signal })` â†’ `jalur.ambil(\`${IPOS_URL}/api/events?key=...\`, { headers: { accept: 'text/event-stream' }, signal: ac.signal })`

Tambahkan ekspor di objek kembalian `buatBridge`: `jalurStatus: () => jalur.status()`.

- [ ] **Step 3: Verifikasi perilaku TIDAK berubah tanpa env**

Run: `node boot/test-format-error.js`
Expected: PASS dengan jumlah lulus **sama** seperti Step 1

- [ ] **Step 4: Verifikasi bridge masih memuat tanpa env Tailscale**

Run: `node -e "const b=require('./ipos-bridge'); console.log('modul ok, ekspor:', Object.keys(b).join(','))"`
Expected: tercetak tanpa error, memuat `buatBridge`

- [ ] **Step 5: Commit**

```bash
git add ipos-bridge.js
git commit -m "feat(ipos): bridge memakai jalur berproxy dengan fallback cadangan"
```

---

### Task 5: Laporkan status jalur di `/health`

**Files:**
- Modify: `index.js` (blok `iposRingkas`, sekitar baris 14074)

**Interfaces:**
- Consumes: `jalurStatus()` (Task 4).
- Produces: field `/health` `ipos.<toko>.jalur = { proxyAktif, urlUtama, urlCadangan, jalurDipakai }`.

- [ ] **Step 1: Tambahkan field tanpa menghapus field lama**

Di dalam `iposRingkas`, tambahkan properti `jalur` dengan nilai `bridge.jalurStatus ? bridge.jalurStatus() : null`. Jangan mengubah properti yang sudah ada.

- [ ] **Step 2: Verifikasi lokal â€” TANPA menyalakan bot**

**DILARANG** menjalankan `index.js` di PC ini: itu menyalakan poller kedua dan
menyebabkan Telegram 409 Conflict dengan bot di Railway.

Run: `node --check index.js` dan `node boot/pindai-rahasia.js`
Expected: sintaks valid; pindai rahasia `nol kebocoran`.
Verifikasi perilaku sebenarnya dilakukan di Railway pada Task 9 Step 5.

- [ ] **Step 3: Commit**

```bash
git add index.js
git commit -m "feat(health): laporkan jalur iPos (proxy/cadangan) per toko"
```

---

### Task 6: Blok Tailscale di entrypoint (tidak fatal)

**Files:**
- Modify: `docker-entrypoint.sh`

**Interfaces:**
- Consumes: `TS_AUTHKEY`, `IPOS_TAILSCALE_PROXY` dari environment.
- Produces: `tailscaled` berjalan + proxy di `127.0.0.1:1056` bila `TS_AUTHKEY` ada.

- [ ] **Step 1: Tambahkan blok sebelum `exec "$@"`**

Aturan yang mengikat:
- `TS_AUTHKEY` kosong â†’ cetak `[TAILSCALE] dilewati (TS_AUTHKEY kosong)` dan **lanjut**.
- Biner tidak ada â†’ cetak peringatan dan **lanjut**.
- Jalankan `tailscaled --tun=userspace-networking --outbound-http-proxy-listen=127.0.0.1:1056 --state=/data/tailscale/tailscaled.state --socket=/data/tailscale/tailscaled.sock` di background, log ke `/data/logs/tailscaled.log`.
- Tunggu socket siap maks 20 detik.
- `tailscale --socket=... up --authkey="$TS_AUTHKEY" --hostname=bcode-railway --accept-routes` (jangan pernah `echo` kuncinya).
- Tunggu `tailscale status --json` melaporkan `"BackendState":"Running"` maks 60 detik.
- Semua kegagalan hanya **peringatan**; skrip tidak boleh berhenti (ingat: jangan pakai `set -e`).

- [ ] **Step 2: Verifikasi tanpa kunci (perilaku lama terjaga)**

Docker **tidak tersedia** di PC ini, jadi verifikasi shell dilakukan tanpa
menyalakan bot (bot lokal harus tetap mati):

Run: `sh -n docker-entrypoint.sh`
Expected: tidak ada output (sintaks valid)

Verifikasi perilaku "tanpa `TS_AUTHKEY` â†’ dilewati" dilakukan di Railway pada
Task 9 Step 2â€“3 dengan `TS_AUTHKEY` dikosongkan sementara.

- [ ] **Step 3: Verifikasi sintaks shell**

Run: `sh -n docker-entrypoint.sh`
Expected: tidak ada output (sintaks valid)

- [ ] **Step 4: Commit**

```bash
git add docker-entrypoint.sh
git commit -m "feat(tailscale): jalankan tailscaled userspace di entrypoint (tidak fatal)"
```

---

### Task 7: Biner Tailscale di image

**Files:**
- Modify: `Dockerfile`

**Interfaces:**
- Consumes: tidak ada.
- Produces: `/usr/local/bin/tailscale` dan `/usr/local/bin/tailscaled` ada di image.

- [ ] **Step 1: Tambahkan unduhan saat build**

Aturan yang mengikat:
- Unduh `https://pkgs.tailscale.com/stable/tailscale_1.102.4_amd64.tgz` memakai `node` (image belum tentu punya `curl`/`wget`).
- Ekstrak ke `/usr/local/bin`.
- **Jangan** gagal bila unduhan gagal: cetak peringatan, build lanjut. (Kalau gagal, Task 6 otomatis melewati blok Tailscale.)
- Letakkan **setelah** `COPY . .` agar cache layer tidak rusak saat kode berubah.

- [ ] **Step 2: Verifikasi Dockerfile masuk akal tanpa Docker**

Run: `node -e "const t=require('fs').readFileSync('Dockerfile','utf8'); if(!t.includes('tailscale_1.102.4_amd64.tgz')) process.exit(1); console.log('ok')"`
Expected: `ok`

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "build(image): bawa biner tailscale 1.102.4 (tidak fatal bila gagal unduh)"
```

---

### Task 8: Uji Tailscale di dalam container

**Files:**
- Create: `boot/uji-tailscale.js`

**Interfaces:**
- Consumes: `IPOS_TAILSCALE_PROXY`, `IPOS_URL`, `IPOS_NK_URL`, `IPOS_KEFA_URL`, `/health` internal.
- Produces: laporan 8 pemeriksaan; `exit 1` bila ada yang gagal.

- [ ] **Step 1: Tulis berkas uji**

Pemeriksaan wajib (cetak `[LULUS]`/`[GAGAL]` per baris):
1. `IPOS_TAILSCALE_PROXY` terisi
2. proxy menjawab (`fetch` ke proxy dengan URL tak ada â†’ error jaringan, bukan `ECONNREFUSED` ke proxy)
3. `tailscale status --json` â†’ `BackendState === "Running"`
4. `IPOS_URL` menjawab `/ipos/health` 200 lewat proxy
5. `IPOS_NK_URL` menjawab 200 lewat proxy (boleh `[LEWAT]` bila sumbernya memang mati â€” dibedakan dari gagal proxy)
6. `IPOS_KEFA_URL` menjawab 200 lewat proxy
7. SSE `/ipos/api/events` menerima **â‰¥3** potongan dalam 60 detik
8. `api.telegram.org` **tidak** lewat proxy (panggil tanpa `dispatcher`, ukur: harus berhasil dan tidak memakai proxy)

- [ ] **Step 2: Verifikasi sintaks**

Run: `node --check boot/uji-tailscale.js`
Expected: tidak ada output

- [ ] **Step 3: Commit**

```bash
git add boot/uji-tailscale.js
git commit -m "test(tailscale): uji jalur tailnet di dalam container"
```

---

### Task 9: Deploy dan verifikasi di Railway

**Files:** tidak ada perubahan kode.

**Interfaces:**
- Consumes: semua task sebelumnya.
- Produces: `tailscale.siap=true`, `ipos.kefa.online=true`.

- [ ] **Step 1: Set variabel (tanpa mencetak nilai rahasia)**

Set `TS_AUTHKEY` (rahasia) dan `IPOS_TAILSCALE_PROXY=http://127.0.0.1:1056`. **Jangan** ubah `IPOS_*_URL` dulu.

- [ ] **Step 2: Deploy**

Run: `railway up --ci --service kefa-bot`
Expected: build sukses, deploy aktif

- [ ] **Step 3: Periksa log Tailscale**

Run: `railway logs --service kefa-bot`
Expected: memuat `[TAILSCALE]` dan `BackendState` Running; **tidak** memuat isi kunci

- [ ] **Step 4: Uji dari dalam container**

Run: `railway ssh --service kefa-bot "node /app/boot/uji-tailscale.js"`
Expected: `exit 0`, semua pemeriksaan `[LULUS]` (CP/NK boleh `[LEWAT]` bila listrik padam)

- [ ] **Step 5: Ubah URL ke tailnet, satu per satu**

Ubah **hanya** `IPOS_KEFA_URL=http://100.123.166.13:8080/ipos`. Tunggu redeploy.
Expected: `/health` â†’ `ipos.kefa.online=true`, `sse=true`, `tailscale.siap=true`

- [ ] **Step 6: Buktikan SSE stabil 5 menit**

Amati `/health` tiap 30 detik selama 5 menit.
Expected: `umurKoneksiDetik` **naik monoton**, tidak pernah reset ke 0, dan `laporanUmurDetik` < 120

- [ ] **Step 7: Commit catatan hasil**

Tulis hasil ke `boot/STATUS-TAILSCALE.md` (tanpa rahasia) dan commit.

---

### Task 10: Pensiunkan pengawas tunnel (SETELAH Task 9 lulus)

**Files:**
- Create: `boot/pensiun-tunnel.js`
- Modify: `boot/uji-jaminan.js`

**Interfaces:**
- Consumes: Task 9 terbukti.
- Produces: tidak ada proses `jaga-tunnel`/`cloudflared`; `uji-jaminan.js` versi baru lulus penuh.

- [ ] **Step 1: Tulis `boot/pensiun-tunnel.js`**

Urutan wajib, tiap langkah diverifikasi:
1. `Disable-ScheduledTask BCODE-JAGA-TUNNEL`
2. Hapus HKCU `BCODE_JAGA_TUNNEL`
3. Hentikan proses `jaga-tunnel.js` (cocokkan `jaga-tunnel`, **bukan** `jaga-poller`)
4. Hentikan `cloudflared`
5. Hapus `boot/.jaga-tunnel.lock`
6. Verifikasi: tidak ada proses tersisa, dan `boot/jaga-poller-tunggal.js` **masih hidup**

- [ ] **Step 2: Ubah `boot/uji-jaminan.js`**

Ganti assertion tunnel (pengawas hidup, lock tunnel, tunnel publik) dengan:
- `tailscale.siap === true` dari `/health`
- `ipos.kefa.online === true`
- `ipos.kefa.sse === true`
- tidak ada proses `jaga-tunnel`
- tidak ada proses `cloudflared`
- `jaga-poller-tunggal` **tetap** hidup dan lock-nya sah

Pertahankan semua assertion poller tunggal yang sudah ada.

- [ ] **Step 3: Jalankan pensiun**

Run: `node boot/pensiun-tunnel.js`
Expected: keenam langkah `OK`

- [ ] **Step 4: Jalankan uji jaminan versi baru**

Run: `node boot/uji-jaminan.js`
Expected: `exit 0`, semua lulus, dan **tidak** ada baris `[GAGAL]`

- [ ] **Step 5: Commit**

```bash
git add boot/pensiun-tunnel.js boot/uji-jaminan.js
git commit -m "chore(tunnel): pensiunkan pengawas tunnel setelah tailscale terbukti"
```

---

### Task 11: Uji regresi menyeluruh

**Files:** tidak ada perubahan kode kecuali perbaikan yang ditemukan.

- [ ] **Step 1: Uji unit yang ada**

Run: `node boot/test-ipos-jalur.js`, `node boot/test-proxy-sse.js`, `node boot/test-format-error.js`, `node boot/test-penjaga-laporan.js`, `node boot/test-umur-laporan.js`, `node boot/test-penjaga-kesegaran.js`, `node boot/test-laporan-backoff.js`
Expected: semua PASS

- [ ] **Step 2: Pindai rahasia**

Run: `node boot/pindai-rahasia.js`
Expected: `HASIL: nol kebocoran.`

- [ ] **Step 3: Uji produksi end-to-end**

Run: `node boot/uji-railway.js`
Expected: 25/25

- [ ] **Step 4: Verifikasi pengganti Docker (Docker tidak ada di PC ini)**

Run: `railway up --ci --service kefa-bot` lalu `railway logs`
Expected: build sukses; bila blok Tailscale gagal, bot **tetap** start (bukan crash-loop)

- [ ] **Step 5: Commit perbaikan bila ada**

```bash
git add -A
git commit -m "fix: perbaikan dari uji regresi menyeluruh"
```

---

## Rollback

1. Kosongkan `IPOS_TAILSCALE_PROXY` di Railway â†’ `ipos-jalur.js` memakai `fetch` biasa.
2. Isi `IPOS_KEFA_URL` kembali ke URL tunnel.
3. `Enable-ScheduledTask BCODE-JAGA-TUNNEL` untuk menghidupkan pengawas tunnel.
4. Tidak perlu deploy ulang kode.

