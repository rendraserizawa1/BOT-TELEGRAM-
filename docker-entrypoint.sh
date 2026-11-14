#!/bin/sh
# Entrypoint container.
#
# CATATAN: `set -e` sengaja TIDAK dipakai. Dulu skrip ini memakai `set -e`
# dan `curl`; image node:24-slim TIDAK menyertakan curl, sehingga perintah
# unduh gagal -> set -e mematikan skrip -> bot TIDAK PERNAH dijalankan dan
# container restart berulang tanpa satu pun pesan yang menjelaskan sebabnya.
# Sekarang: tanpa set -e, dan unduhan memakai `node` (sudah pasti ada karena
# image ini image Node).

# Bot memuat JSON (members/kontak/...) sendiri dari GitHub saat startup.
# Yang perlu disediakan lokal hanya harga_toko/*.xlsx (dibaca loadExcel lokal).
BRANCH="${GITHUB_BRANCH:-data-storage}"
DATA_TOKEN="${GITHUB_TOKEN:-}"
DATA_OWNER="${GITHUB_USERNAME:-rendraserizawa1}"
DATA_REPO="${GITHUB_REPO:-BOT-TELEGRAM-DATA}"

HARGA_DIR="${HARGA_DIR:-/data/harga_toko}"
DATA_ROOT="${DATA_DIR:-/data}"

# ── SIAPKAN VOLUME ────────────────────────────────────────────────────
# Semua state bot hidup di sini. Tanpa volume, folder ini ada di disk
# container dan HILANG saat redeploy.
#
# CATATAN PENTING: entrypoint ini TIDAK dipakai untuk membuktikan volume
# terpasang. Kalau volume tidak ada, /data hanyalah folder biasa di disk
# container -> mkdir di bawah tetap berhasil, jadi "berhasil menulis" bukan
# bukti apa pun. Uji volume yang sah ada di boot/volume-check.js dan memakai
# penanda .image-only yang dibuat saat BUILD image.
if ! mkdir -p "$DATA_ROOT/data" "$DATA_ROOT/storage" "$DATA_ROOT/logs" "$HARGA_DIR"; then
  echo "[ENTRY] PERINGATAN: gagal membuat folder di $DATA_ROOT (read-only / volume tidak terpasang)."
  echo "[ENTRY]            Bot tetap dijalankan; boot/volume-check.js akan melaporkan ini ke admin."
fi
if [ -f "$DATA_ROOT/.image-only" ]; then
  echo "[ENTRY] PERINGATAN: penanda image $DATA_ROOT/.image-only masih terlihat."
  echo "[ENTRY]            Artinya volume TIDAK ter-mount: data akan hilang saat redeploy."
else
  echo "[ENTRY] Folder data siap: $DATA_ROOT (volume ter-mount)"
fi

# ── UNDUH harga_toko ──────────────────────────────────────────────────
# Memakai node, bukan curl: image node:24-slim tidak punya curl.
# Node 24 punya fetch() global.
if [ -n "$DATA_TOKEN" ] && [ -n "$DATA_OWNER" ] && [ -n "$DATA_REPO" ]; then
  echo "[ENTRY] Syncing harga_toko dari ${DATA_OWNER}/${DATA_REPO}@${BRANCH} ..."
  HARGA_DIR="$HARGA_DIR" DATA_TOKEN="$DATA_TOKEN" DATA_OWNER="$DATA_OWNER" \
  DATA_REPO="$DATA_REPO" BRANCH="$BRANCH" node -e '
const fs = require("fs");
const path = require("path");
const dir = process.env.HARGA_DIR;
const owner = process.env.DATA_OWNER;
const repo = process.env.DATA_REPO;
const branch = process.env.BRANCH;
const token = process.env.DATA_TOKEN;
const toko = ["nk", "tdm", "oesapa", "kefa", "cp"];
(async () => {
  let ok = 0;
  for (const t of toko) {
    const tujuan = path.join(dir, t + ".xlsx");
    const url = "https://api.github.com/repos/" + owner + "/" + repo
      + "/contents/harga_toko/" + t + ".xlsx?ref=" + branch;
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/vnd.github.raw",
          Authorization: "Bearer " + token,
          "User-Agent": "bcode-kefa-bot",
        },
      });
      if (!res.ok) {
        console.log("[ENTRY]   WARN harga_toko/" + t + ".xlsx (HTTP " + res.status + ") - dilewati");
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(tujuan, buf);
      console.log("[ENTRY]   ok harga_toko/" + t + ".xlsx (" + buf.length + "B)");
      ok++;
    } catch (e) {
      console.log("[ENTRY]   WARN harga_toko/" + t + ".xlsx (" + e.message + ") - dilewati");
    }
  }
  console.log("[ENTRY] harga_toko: " + ok + "/" + toko.length + " terunduh");
})();
'
else
  echo "[ENTRY] GITHUB_TOKEN/owner/repo tidak lengkap - harga_toko mungkin kosong."
fi

# ── LAPORKAN VERSI ────────────────────────────────────────────────────
# node:sqlite hanya ada di Node 22+. Bot sudah gagal keras kalau tidak ada,
# tetapi mencetak versinya di sini memudahkan diagnosa dari log Railway.
echo "[ENTRY] Node $(node --version)"

echo "[ENTRY] Selesai. Menjalankan bot..."
exec "$@"
