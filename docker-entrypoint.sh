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

# ── TAILSCALE (OPSIONAL, TIDAK PERNAH FATAL) ──────────────────────────
# Tujuan: container ini menjadi anggota tailnet sendiri supaya bisa memakai
# HTTP iPos yang SUDAH ADA lewat IP Tailscale (100.x), tanpa tunnel Cloudflare.
#
# ATURAN KERAS:
#   - TS_AUTHKEY kosong -> blok ini DILEWATI TOTAL. Bot jalan persis seperti
#     sebelumnya. Ini yang membuat rollback cukup mengosongkan satu variabel.
#   - Kegagalan APA PUN di sini hanya PERINGATAN, tidak boleh menghentikan
#     skrip. Container yang mati karena Tailscale gagal jauh lebih buruk
#     daripada container yang hidup tanpa iPos.
#   - Kunci TIDAK PERNAH dicetak. Hanya status yang dilaporkan.
#
# Kenapa `-tun=userspace-networking`: Railway tidak memberi /dev/net/tun dan
# tidak memberi NET_ADMIN. Mode userspace tidak butuh keduanya. Karena tidak
# ada TUN, lalu lintas keluar dialihkan lewat proxy HTTP lokal yang dibuka
# tailscaled sendiri (`--outbound-http-proxy-listen`).
if [ -z "${TS_AUTHKEY:-}" ]; then
  echo "[TAILSCALE] dilewati (TS_AUTHKEY kosong) - iPos memakai jalur langsung"
else
  TS_DIR="$DATA_ROOT/tailscale"
  TS_SOCK="$TS_DIR/tailscaled.sock"
  TS_PROXY="127.0.0.1:1056"
  mkdir -p "$TS_DIR" 2>/dev/null || true

  # Folder log bisa tidak bisa ditulis (volume read-only). Kalau begitu pakai
  # /tmp, karena kalau redirect gagal `tailscaled` tidak akan pernah start dan
  # kegagalannya tidak terlihat sama sekali.
  TS_LOG="$DATA_ROOT/logs/tailscaled.log"
  if ! ( : >>"$TS_LOG" ) 2>/dev/null; then
    TS_LOG="/tmp/tailscaled.log"
    echo "[TAILSCALE] PERINGATAN: $DATA_ROOT/logs tidak bisa ditulis, log pindah ke $TS_LOG"
  fi

  if ! command -v tailscaled >/dev/null 2>&1; then
    echo "[TAILSCALE] PERINGATAN: biner tailscaled tidak ada di image - dilewati"
  else
    echo "[TAILSCALE] menjalankan tailscaled (userspace, http+socks5 di $TS_PROXY)"
    # HTTP proxy DAN SOCKS5 di port yang SAMA (didukung resmi Tailscale).
    #   - HTTP proxy  : dipakai untuk permintaan biasa (terbukti /health 200)
    #   - SOCKS5      : dipakai untuk STREAMING, karena ia hanya menyalurkan
    #                   TCP sehingga tidak bisa menahan body seperti proxy HTTP
    tailscaled \
      --tun=userspace-networking \
      --outbound-http-proxy-listen="$TS_PROXY" \
      --socks5-server="$TS_PROXY" \
      --state="$TS_DIR/tailscaled.state" \
      --socket="$TS_SOCK" \
      >>"$TS_LOG" 2>&1 &
    TS_PID=$!

    # Tunggu socket siap (maks 20 dtk). Jangan menggantung selamanya.
    i=0
    while [ $i -lt 20 ]; do
      if [ -S "$TS_SOCK" ]; then break; fi
      i=$((i + 1))
      sleep 1
    done

    if [ ! -S "$TS_SOCK" ]; then
      echo "[TAILSCALE] PERINGATAN: socket tidak siap dalam 20 dtk (pid $TS_PID) - lanjut tanpa tailnet"
    else
      # Kunci dibaca dari environment, TIDAK dicetak ke log.
      if tailscale --socket="$TS_SOCK" up \
           --authkey="$TS_AUTHKEY" \
           --hostname=bcode-railway \
           --accept-routes \
           --timeout=60s >>"$TS_LOG" 2>&1; then
        echo "[TAILSCALE] up berhasil"
      else
        echo "[TAILSCALE] PERINGATAN: 'tailscale up' gagal - lanjut tanpa tailnet"
      fi

      # Tunggu BackendState=Running (maks 60 dtk).
      i=0
      SIAP=0
      while [ $i -lt 60 ]; do
        if tailscale --socket="$TS_SOCK" status --json 2>/dev/null | grep -q '"BackendState":[[:space:]]*"Running"'; then
          SIAP=1
          break
        fi
        i=$((i + 1))
        sleep 1
      done

      if [ "$SIAP" = "1" ]; then
        echo "[TAILSCALE] siap hostname=bcode-railway"
        export TS_PROXY

        # Laporkan berapa peer yang terlihat. Ini bukti node benar-benar sudah
        # masuk tailnet dan melihat perangkat lain — bukan sekadar "daemon hidup".
        PEER=$(tailscale --socket="$TS_SOCK" status --json 2>/dev/null | node -e '
          let s=""; process.stdin.on("data",(d)=>s+=d).on("end",()=>{
            try { const j=JSON.parse(s); console.log(Object.keys(j.Peer||{}).length); }
            catch(_) { console.log("?"); }
          });' 2>/dev/null)
        echo "[TAILSCALE] peer terlihat = ${PEER:-?}"

        # Probe opsional: TS_PROBE_URL berisi satu/lebih URL tailnet yang HARUS
        # terjangkau, dipisah koma. Contoh:
        #   TS_PROBE_URL=http://100.123.166.13:8080/ipos/health
        #
        # Kenapa TIDAK memakai IPOS_*_URL: saat blok ini berjalan, URL itu
        # masih menunjuk tunnel publik. Mengujinya lewat tailnet hanya
        # menghasilkan kegagalan yang membingungkan dan tidak membuktikan apa pun.
        #
        # PENTING: probe WAJIB lewat proxy. Kalau memakai fetch langsung,
        # hasilnya bisa "HTTP 200" dari jalur internet biasa padahal tailnet
        # tidak berfungsi sama sekali — laporan yang menyesatkan.
        if [ -n "${TS_PROBE_URL:-}" ]; then
          echo "$TS_PROBE_URL" | tr ',' '\n' | while read -r U; do
            [ -z "$U" ] && continue
            HASIL=$(node -e '
              const undici = require("undici");
              const d = new undici.ProxyAgent("http://" + process.env.TS_PROXY);
              fetch(process.argv[1], { dispatcher: d, signal: AbortSignal.timeout(10000) })
                .then((r) => { console.log("HTTP " + r.status + " (lewat tailnet)"); process.exit(0); })
                .catch((e) => { console.log(((e.cause && e.cause.code) || e.message) + " (lewat tailnet)"); process.exit(1); });
            ' "$U" 2>&1 | tail -1)
            echo "[TAILSCALE]   $U -> $HASIL"
          done
        fi

        # Probe SSE: membuktikan byte MENGALIR BERTAHAP lewat tailnet.
        # Ini pembeda paling penting dibanding tunnel Cloudflare, yang memberi
        # HTTP 200 + content-type benar tetapi 0 byte selama 150 detik.
        #
        # Dicoba DUA jalur karena keduanya berperilaku berbeda:
        #   http://127.0.0.1:1056  -> proxy HTTP tailscaled
        #   socks5://127.0.0.1:1056 -> SOCKS5 tailscaled (menyalurkan TCP apa adanya)
        if [ -n "${TS_PROBE_SSE_URL:-}" ]; then
          for AGEN in "http://$TS_PROXY" "socks5://$TS_PROXY"; do
            HASIL_SSE=$(AGEN="$AGEN" node -e '
              const undici = require("undici");
              const alamat = process.env.AGEN;
              const d = /^socks5:\/\//i.test(alamat)
                ? new undici.Socks5ProxyAgent(alamat)
                : new undici.ProxyAgent(alamat);
              const ac = new AbortController();
              const batas = setTimeout(() => ac.abort(), 20000);
              const t0 = Date.now();
              (async () => {
                try {
                  const r = await fetch(process.argv[1], {
                    dispatcher: d, signal: ac.signal,
                    headers: { accept: "text/event-stream" },
                  });
                  if (!r.ok || !r.body) { console.log("HTTP " + r.status); process.exit(1); }
                  const reader = r.body.getReader();
                  const dec = new TextDecoder();
                  let potongan = 0, byte = 0, ping = 0, pertama = null, terakhir = null;
                  for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    const ms = Date.now() - t0;
                    if (pertama === null) pertama = ms;
                    terakhir = ms;
                    byte += value.length;
                    potongan++;
                    ping += (dec.decode(value, { stream: true }).match(/: ping/g) || []).length;
                    if (potongan >= 3) break;
                  }
                  try { reader.cancel(); } catch (_) {}
                  const rentang = (pertama !== null && terakhir !== null) ? terakhir - pertama : 0;
                  console.log("HTTP " + r.status + " potongan=" + potongan + " byte=" + byte + " ping=" + ping + " rentang=" + rentang + "ms");
                  process.exit(potongan >= 3 ? 0 : 1);
                } catch (e) {
                  console.log(((e.cause && e.cause.code) || e.message) + " (" + (Date.now() - t0) + "ms)");
                  process.exit(1);
                } finally { clearTimeout(batas); }
              })();
            ' "$TS_PROBE_SSE_URL" 2>&1 | tail -1)
            echo "[TAILSCALE] SSE tailnet via $AGEN -> $HASIL_SSE"
          done
        fi
      else
        echo "[TAILSCALE] PERINGATAN: BackendState bukan Running dalam 60 dtk - lanjut tanpa tailnet"
      fi
    fi
  fi
fi

echo "[ENTRY] Selesai. Menjalankan bot..."
exec "$@"
