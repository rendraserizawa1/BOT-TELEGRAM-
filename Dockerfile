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
# WAJIB dibuat SEBELUM instruksi VOLUME: perubahan pada folder volume setelah
# VOLUME dideklarasikan akan dibuang oleh Docker.
RUN mkdir -p /data && touch /data/.image-only

VOLUME ["/data"]

COPY package.json package-lock.json* ./
# --omit=dev: image produksi tidak butuh devDependencies.
# Catatan: node:24-slim TIDAK punya python3/make/g++. sharp@0.33 biasanya
# memakai binary prebuilt (@img/sharp-linux-x64) sehingga tidak perlu
# toolchain; kalau unduhan prebuilt gagal, build akan error di sini. Bila itu
# terjadi, tambahkan: apt-get install -y --no-install-recommends python3 make g++
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

COPY docker-entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

# Railway menyuntik PORT sendiri. EXPOSE hanya dokumentasi.
EXPOSE 3000

# Healthcheck bawaan Railway memakai /health (lihat railway.json).
ENTRYPOINT ["./entrypoint.sh"]
CMD ["node", "index.js"]
