#!/bin/sh
set -e

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
# container dan HILANG saat redeploy. Penanda .volume-ok dibaca
# boot/volume-check.js: kalau hilang, bot berteriak ke admin.
mkdir -p "$DATA_ROOT/data" "$DATA_ROOT/storage" "$DATA_ROOT/logs" "$HARGA_DIR"
if [ -w "$DATA_ROOT" ]; then
  : > "$DATA_ROOT/.volume-ok" 2>/dev/null || true
  echo "[ENTRY] Penanda volume: $DATA_ROOT/.volume-ok"
else
  echo "[ENTRY] PERINGATAN: $DATA_ROOT tidak bisa ditulis - volume mungkin tidak terpasang."
fi

dl() { # $1=outfile $2=repo-relative-path
  out="$1"; path="$2"
  code=$(curl -s -o "$out" -w "%{http_code}" \
    -H "Accept: application/vnd.github.raw" \
    -H "Authorization: Bearer ${DATA_TOKEN}" \
    "https://api.github.com/repos/${DATA_OWNER}/${DATA_REPO}/contents/${path}?ref=${BRANCH}")
  if [ "$code" = "200" ]; then
    echo "[ENTRY]   ok ${path} ($(wc -c < "$out")B)"
  else
    echo "[ENTRY]   WARN ${path} (HTTP $code) - dilewati"
    rm -f "$out"
  fi
}

if [ -n "$DATA_TOKEN" ] && [ -n "$DATA_OWNER" ] && [ -n "$DATA_REPO" ]; then
  echo "[ENTRY] Syncing harga_toko dari $DATA_OWNER/$DATA_REPO@$BRANCH ..."
  for tok in nk tdm oesapa kefa cp; do
    dl "${HARGA_DIR}/${tok}.xlsx" "harga_toko/${tok}.xlsx"
  done
else
  echo "[ENTRY] GITHUB_TOKEN/owner/repo tidak lengkap - harga_toko mungkin kosong."
fi

# ── LAPORKAN VERSI ────────────────────────────────────────────────────
# node:sqlite hanya ada di Node 22+. Bot sudah gagal keras kalau tidak ada,
# tetapi mencetak versinya di sini memudahkan diagnosa dari log Railway.
echo "[ENTRY] Node $(node --version)"

echo "[ENTRY] Selesai. Menjalankan bot..."
exec "$@"
