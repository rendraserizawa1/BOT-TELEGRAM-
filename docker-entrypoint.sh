#!/bin/sh
set -e

# Bot memuat JSON (members/kontak/...) sendiri dari GitHub saat startup.
# Yang perlu disediakan lokal hanya harga_toko/*.xlsx (dibaca loadExcel lokal).
BRANCH="${GITHUB_BRANCH:-data-storage}"
DATA_TOKEN="${GITHUB_TOKEN:-}"
DATA_OWNER="${GITHUB_USERNAME:-rendraserizawa1}"
DATA_REPO="${GITHUB_REPO:-BOT-TELEGRAM-DATA}"

mkdir -p /app/harga_toko

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
    dl "/app/harga_toko/${tok}.xlsx" "harga_toko/${tok}.xlsx"
  done
else
  echo "[ENTRY] GITHUB_TOKEN/owner/repo tidak lengkap - harga_toko mungkin kosong."
fi

echo "[ENTRY] Selesai. Menjalankan bot..."
exec "$@"