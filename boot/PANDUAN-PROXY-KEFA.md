# Panduan Memindahkan Proxy iPos KEFA ke Server Toko (Opsi D)

Tujuan: KEFA tetap hidup 24/7 **tanpa** bergantung pada PC `BCODE-KEFA`
yang hanya menyala sampai jam 20:00.

---

## 1. Fakta yang mendasari

Dari `C:\Users\rdpadmin\ipos-api\server.js` (679 baris), baris 35:

```js
const pool = new pg.Pool({ ... database: PGDATABASE, max: 4, ... });
```

Dan `DATABASE-KEFA2025.md`:

> Server `SRV` = `192.168.1.199`, port `5444`, PostgreSQL 9.5.3
> Database produksi `i5_KEFA2025` (238 MB), skema sama seperti NK/CP

Artinya proxy iPos KEFA **hanya penerjemah** dari HTTP ke PostgreSQL. Ia tidak
menyimpan data sendiri (kecuali cache `logs/jual-cache-KEFA.json`). Jadi ia
bisa dipindah tanpa menyentuh database.

Route table PC ini membuktikan `192.168.1.0/24` **On-link** lewat Ethernet
(`192.168.1.197`) — **tidak** diiklankan ke tailnet. Maka Railway tidak bisa
menjangkau PostgreSQL itu secara langsung.

---

## 2. Langkah

### 2.1 Siapkan server `192.168.1.199`

Butuh akses admin (RDP/SSH/console) ke server kasir itu.

1. Pastikan ada Node.js 18+ (atau Docker).
2. Salin dari PC ini:
   - `C:\Users\rdpadmin\ipos-api\server.js`
   - `C:\Users\rdpadmin\ipos-api\package.json`
   - `C:\Users\rdpadmin\ipos-api\.env`  ← berisi kredensial DB, JANGAN ke repo
3. Di server: `npm install --omit=dev`
4. Uji manual: `node --env-file=.env server.js` → harus listen di 8080.
5. Verifikasi lokal di server: `curl http://127.0.0.1:8080/ipos/health` → 200.

### 2.2 Buat auto-start

Pilih sesuai OS server:

**Windows (NSSM):**
```cmd
nssm install ipos-kefa "C:\Program Files\nodejs\node.exe" "--env-file=.env server.js"
nssm set ipos-kefa AppDirectory C:\ipos-api
nssm set ipos-kefa Start SERVICE_AUTO_START
nssm start ipos-kefa
```

**Windows (Task Scheduler):** trigger `AtStartup`, user `SYSTEM` atau admin,
action `node.exe` argumen `--env-file=.env server.js`, working dir `C:\ipos-api`.

**Linux (systemd):**
```ini
[Unit]
Description=iPos KEFA API
After=network.target

[Service]
WorkingDirectory=/opt/ipos-api
ExecStart=/usr/bin/node --env-file=.env server.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 2.3 Buka port 8080 KE TAILNET SAJA

**Jangan** port-forward ke internet publik. Data penjualan akan terbuka.

Pilih salah satu:

**A. Pasang Tailscale di server itu (paling sederhana)**
- Install Tailscale, login akun yang sama.
- Proxy langsung bisa diakses di `http://<ip-tailscale-server>:8080/ipos`.
- Pastikan `server.js` listen di `0.0.0.0` (bukan hanya `127.0.0.1`).

**B. Jadikan PC toko sebagai subnet router `192.168.1.0/24`**
- Di PC yang punya Tailscale: `tailscale up --advertise-routes=192.168.1.0/24`
- Setujui route di admin Tailscale.
- Railway lalu bisa menjangkau `192.168.1.199:5444` langsung, sehingga proxy
  bahkan tidak perlu dipindah — cukup ubah `IPOS_KEFA_URL` ke
  `http://192.168.1.199:8080/ipos`.
- **Catatan:** cara ini membuat Railway bergantung pada PC toko tetap hidup
  dan Tailscale-nya tetap jalan.

**C. `tailscale serve` di server itu**
- `tailscale serve --bg 8080`
- Memberi URL HTTPS di tailnet.

### 2.4 Verifikasi dari LUAR LAN

Dari PC lain di tailnet (atau dari Railway setelah deploy):

```bash
curl -s http://<alamat-tailscale>:8080/ipos/health
```

Harus HTTP 200. Kalau timeout, route/firewall belum benar.

### 2.5 Ubah di Railway

```
IPOS_KEFA_URL=http://<alamat-tailscale>:8080/ipos
```

Deploy ulang, lalu cek `/health` → `ipos.kefa.itemSegar` harus `true`.

---

## 3. Bukti keberhasilan

Uji **setelah PC `BCODE-KEFA` dimatikan** (mis. pukul 20:30):

| Cek | Lulus bila |
|---|---|
| `/health` `ipos.kefa.online` | `true` |
| `/health` `ipos.kefa.itemSegar` | `true` |
| `/health` `ipos.kefa.alasanTidakSegar` | `null` |
| Laporan kasir KEFA di bot | angka hari ini, bukan kemarin |

Kalau masih mati, baca `alasanTidakSegar` — sekarang sebabnya disebut eksplisit.

---

## 4. Risiko

| Risiko | Dampak | Mitigasi |
|---|---|---|
| Port 8080 terbuka ke publik | Data penjualan bocor | Hanya lewat tailnet, jangan port-forward |
| Kredensial DB di server toko | Bocor bila server disalahgunakan | File `.env` ACL ketat, jangan di repo |
| Server toko dimatikan malam | KEFA mati lagi | Pastikan server kasir memang 24/7 |
| Tailscale di server mati | KEFA tidak terjangkau | Notifikasi `online:false` + `alasanTidakSegar` |
| Cache `jual-cache-KEFA.json` hilang | Laporan lebih lambat saat start | Cache dibuat ulang otomatis |

---

## 5. Kalau server toko tidak bisa diakses

Kembali ke **Opsi A saja**: bot tetap 24/7 di Railway, CP & NK realtime 24/7,
KEFA hanya sampai jam 20:00. Bot akan menampilkan status jujur
("iPos tidak terjangkau — angka di atas adalah data terakhir …"),
bukan angka basi yang menyamar sebagai realtime.
