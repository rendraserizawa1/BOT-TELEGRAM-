# Node 24 WAJIB: bot-db.js memakai `node:sqlite` (Node 22+). Di Node 20
# seluruh fungsi DB jadi no-op senyap -> riwayat chat/sesi/file/log hilang
# tanpa error. Lihat bot-db.js pastikanTersedia().
FROM node:24-slim

WORKDIR /app

ENV NODE_ENV=production
# Penanda bahwa container ini MENGHARAPKAN volume persisten. Bila volume
# lupa dipasang, bot tetap start tetapi berteriak keras (lihat
# boot/volume-check.js dan blok notifikasi admin di index.js).
ENV EXPECT_VOLUME=1

# Folder data ada di volume Railway. Dideklarasikan agar jelas & agar
# `docker run -v` tanpa nama tidak menimpa folder aplikasi.
ENV DATA_DIR=/data
ENV STORAGE_DIR=/data/storage
ENV LOGS_DIR=/data/logs
ENV HARGA_DIR=/data/harga_toko

# ── PENANDA VOLUME (dibuat di IMAGE, bukan saat runtime) ──────────────────
# Ini uji volume yang TIDAK BISA DIPALSUKAN. Bila volume benar-benar ter-mount
# di /data, mount itu menutupi folder image sehingga .image-only TIDAK terlihat.
# Kalau penanda ini masih terlihat saat bot jalan, artinya /data masih folder
# image -> volume tidak terpasang -> boot/volume-check.js menolak dan admin
# diberi tahu. Entrypoint TIDAK pernah membuat file ini.
#
# CATATAN: instruksi `VOLUME ["/data"]` sengaja TIDAK dipakai. Railway
# menolak Dockerfile yang mendeklarasikan VOLUME ("docker VOLUME at Line N is
# not supported, use Railway Volumes"). Volume Railway dipasang di level
# platform (/data, lihat railway.json / dashboard), dan justru itulah yang
# dibuktikan oleh penanda .image-only di atas.
RUN mkdir -p /data && touch /data/.image-only

COPY package.json package-lock.json* ./
# --omit=dev: image produksi tidak butuh devDependencies.
# Catatan: node:24-slim TIDAK punya python3/make/g++. sharp@0.33 biasanya
# memakai binary prebuilt (@img/sharp-linux-x64) sehingga tidak perlu
# toolchain; kalau unduhan prebuilt gagal, build akan error di sini. Bila itu
# terjadi, tambahkan: apt-get install -y --no-install-recommends python3 make g++
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# ── TAILSCALE (OPSIONAL) ──────────────────────────────────────────────
# Railway tidak memberi /dev/net/tun maupun NET_ADMIN, jadi tailscaled dipakai
# dalam mode userspace (`-tun=userspace-networking`) dan lalu lintas keluar
# dialihkan lewat proxy HTTP lokal yang dibuka tailscaled sendiri.
#
# PENTING: unduhan ini TIDAK BOLEH menggagalkan build. Kalau gagal, entrypoint
# otomatis melewati blok Tailscale dan bot tetap jalan seperti sebelumnya.
# Unduhan memakai `node` (sudah pasti ada; node:24-slim tidak punya curl).
#
# Diletakkan SETELAH `COPY . .` supaya cache layer tidak rusak tiap kode berubah.
ARG TAILSCALE_VER=1.102.4
RUN node -e " \
      const { execSync } = require('child_process'); \
      const fs = require('fs'); \
      const os = require('os'); \
      const path = require('path'); \
      const ver = process.env.TAILSCALE_VER; \
      const url = 'https://pkgs.tailscale.com/stable/tailscale_' + ver + '_amd64.tgz'; \
      const tgz = path.join(os.tmpdir(), 'ts.tgz'); \
      (async () => { \
        try { \
          const r = await fetch(url, { signal: AbortSignal.timeout(180000) }); \
          if (!r.ok) throw new Error('HTTP ' + r.status); \
          fs.writeFileSync(tgz, Buffer.from(await r.arrayBuffer())); \
          execSync('tar -xzf ' + tgz + ' -C /usr/local/bin --strip-components=1 tailscale_' + ver + '_amd64/tailscale tailscale_' + ver + '_amd64/tailscaled', { stdio: 'inherit' }); \
          fs.chmodSync('/usr/local/bin/tailscale', 0o755); \
          fs.chmodSync('/usr/local/bin/tailscaled', 0o755); \
          console.log('[BUILD] tailscale ' + ver + ' terpasang'); \
        } catch (e) { \
          console.log('[BUILD] PERINGATAN: tailscale gagal diunduh (' + e.message + ') - container akan jalan tanpa tailnet'); \
        } \
      })(); \
    " \
 && (test -x /usr/local/bin/tailscaled && echo "[BUILD] tailscaled siap" || echo "[BUILD] tailscaled tidak ada (tidak fatal)")

COPY docker-entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Railway menyuntik PORT sendiri. EXPOSE hanya dokumentasi.
EXPOSE 3000

# Healthcheck bawaan Railway memakai /health (lihat railway.json).
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "index.js"]
