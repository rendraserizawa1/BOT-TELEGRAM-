# Insiden 2026-11-20: "SEMUA API iPos MATI SERENTAK"

**Kesimpulan satu baris:** ketiga API iPos **tidak pernah mati**. PC `BCODE-KEFA`
crash, lalu tidak ada yang login selama 74 menit, sehingga agen pengirim data
tidak menyala dan ketiga toko tampak mati bersamaan.

---

## 1. Gejala yang dilaporkan

Pengguna: *"SEMUA API IPOS KE MATI SERENTAK"*.

## 2. Yang benar-benar terjadi

### 2.1 API iPos sehat

Diuji langsung dari PC, autentikasi lewat query `?key=` (bukan header):

| Toko | Endpoint | `/health` | `/api/jual` |
|---|---|---|---|
| CP | `100.125.99.99:8080` | HTTP 200, 34 ms, `jual.err=null` | HTTP 200, 36 ms |
| NK | `100.110.152.33:8080` | HTTP 200, 17 ms, `jual.err=null` | HTTP 200, 14 ms |
| KEFA | `127.0.0.1:8080` | HTTP 200, 64 ms, `jual.err=null` | HTTP 200, 12 ms |

Catatan: `jual.err` NK yang dulu `"normJual is not defined"` kini **null**.

> **Jebakan yang hampir menyesatkan.** Uji pertama memakai header `x-ipos-key`
> dan mendapat `401 unauthorized` dari **ketiga** toko. Itu terbaca seperti
> "semua API mati", padahal itu kesalahan skrip uji: `push-agen.js` (baris 470,
> 550, 569) mengautentikasi lewat **query** `?key=`. Server yang benar-benar
> mati tidak sempat menjawab `401` dalam 20 ms.

### 2.2 Rantai penyebab

```
11:53:52  crash #1            (Event ID 41, BugcheckCode=0)
12:33:37  crash #2            (Event ID 41, BugcheckCode=0)
12:36:16  bot menandai cp/nk/kefa OFFLINE
12:40:11  crash #3 -> reboot  (Event ID 41, BugcheckCode=0)
   ...    TIDAK ADA YANG LOGIN selama 74 menit
13:54:27  logon RDP (LogonType=10)
13:54:39  jaga-push + jaga-poller menyala  (12 detik setelah logon)
13:55:46  ketiga toko kembali ONLINE
```

Log bot memperlihatkan pola percobaan ulang yang khas: umur data tumbuh
`1321 -> 1921 -> 2521 -> 3121 -> 3721 -> 4321 -> 4921` detik, yaitu **naik tepat
600 detik** setiap kali — jeda retry 10 menit, bukan tiga kegagalan terpisah.

### 2.3 Bukti penentu

Ketiga toko berhenti dalam jendela **25 detik** (4911, 4911, 4936 detik).
Tiga API yang berbeda mati bersamaan dalam 25 detik itu mustahil. Satu PC yang
berhenti mengirim menjelaskan semuanya.

## 3. Mengapa agen tidak menyala sendiri

| Fakta | Nilai |
|---|---|
| Pemicu tugas `BCODE-JAGA-PUSH` | `MSFT_TaskLogonTrigger` (hanya saat login) |
| `LogonType` | `Interactive` |
| `HKCU\...\Run` | **sudah berisi** `BCODE_JAGA_PUSH` + `BCODE_JAGA_POLLER` |
| Tailscale | Service, `Automatic` (jaringan hidup tanpa login) |
| Kunci anti-duplikat | `boot/.jaga-push.lock` sudah ada |

Jadi autostart-saat-login **sudah benar**. Yang tidak ada adalah autostart
**tanpa login**. Setelah crash, PC menyala ke layar login dan berhenti di situ
sampai ada manusia yang masuk RDP.

## 4. Penyebab crash — dan ini bukan software

| Bukti | Nilai | Arti |
|---|---|---|
| `BugcheckCode` | `0` pada ketiga Event 41 | mati mendadak, **bukan** blue screen |
| UPS / baterai | tidak terdeteksi | listrik turun = PC langsung mati |
| RAM total | **3,78 GB** | 1 keping 4 GB Micron, DIMM2 |
| RAM terpakai | **91,8 %** (sisa 312 MB) | Chrome 947 MB + opencode 463 MB + node 493 MB |
| Crash 30 hari | **12 kali** | 8 di antaranya jam **07:30–08:30** |
| Error WHEA | tidak ada | tidak ada bukti CPU/chipset rusak |
| Disk | `V-GEN10SM21SCY128HY` health=Healthy | tidak ada indikasi disk rusak |
| Model | Acer Aspire C22-963 | AIO kelas bawah |

Jam 07:30–08:30 adalah jam buka toko. Tugas `WindowsUpdate\Scheduled Start`
berjalan 07:46 dan `InstallService\ScanForUpdates` 08:00 — beban puncak bertemu
mesin 3,8 GB tanpa UPS.

## 5. Apa yang TIDAK boleh dilakukan

**Jangan** menjalankan agen sebagai `SYSTEM` atau lewat `BootTrigger` tanpa
kredensial user.

Nota ditulis ke UNC:

```
\\100.125.99.99\E\TOKO NASIONAL KITCHEN
\\100.125.99.99\E\Nota Toko Perabot Mamaku Kefamenanu
```

Kredensial SMB-nya tersimpan **per user** (`cmdkey`:
`Target=Domain:target=100.125.99.99`, `User=ADMIN_DIMAS`). Akun `SYSTEM` tidak
bisa memakainya, sehingga penulisan nota akan rusak. Boot-start aman **hanya**
sebagai `rdpadmin` dengan password tersimpan.

## 6. Yang bisa dan tidak bisa diperbaiki tanpa admin

Diuji satu per satu; setiap uji yang mengubah sistem dikembalikan.

| Cara | Hasil |
|---|---|
| `AutoAdminLogon` (HKLM) | `Requested registry access is not allowed` |
| `BootTrigger` sebagai SYSTEM | `Access is denied` |
| `BootTrigger` sebagai user | `Access is denied` |
| Ubah tugas jadi `AtStartup` | `Access is denied` |
| `HKLM\...\Run` | `Requested registry access is not allowed` |
| `New-Service` | `Access is denied` |
| **`HKCU\...\Run`** | **BERHASIL** — tetapi tetap butuh login |

`HKCU\...\Run` sudah dipakai, jadi tidak ada perbaikan baru yang bisa
ditambahkan tanpa hak admin. Percobaan `Start-Process -Verb RunAs` gagal dua kali
(`canceled by the user`) karena prompt UAC tidak sampai ke layar sesi RDP.

## 7. Rekomendasi, berurutan menurut dampak

1. **Pasang UPS** (paling murah, dampak terbesar). Menghapus penyebab mati
   mendadak; `BugcheckCode=0` tanpa UPS adalah kesimpulan yang sulit dibantah.
2. **Tambah RAM ke 8 GB.** Mesin hanya punya 2 slot; 1 terpakai. RAM 92 %
   terpakai membuat crash jam sibuk lebih mungkin.
3. **Pindahkan Chrome/opencode keluar dari PC produksi ini.** Keduanya memakai
   ±1,4 GB dari 3,78 GB — lebih dari sepertiga RAM dipakai untuk hal yang tidak
   melayani toko.
4. **Aktifkan autologon `rdpadmin`** (butuh admin + password) supaya agen
   menyala tanpa manusia. Ini mitigasi, bukan penyembuh: kalau listrik mati,
   PC tetap mati.
5. **Kurangi jadwal Windows Update** agar tidak bertabrakan dengan jam buka.
6. **Pertimbangkan agen cadangan** — saat ini satu PC adalah titik gagal tunggal
   untuk ketiga toko.

## 8. Catatan keamanan

Kunci iPos tercetak di keluaran PowerShell selama investigasi ini (filter
penyamaran hanya menangkap `key=` di dalam *nilai*, bukan nama variabel
`IPOS_KEY=`). Ini kedua kalinya. **Rotasi kunci iPos wajib.**

## 9. Berkas terkait

- `boot/diag-admin.ps1` — diagnostik berhak admin, **hanya membaca**; menulis
  `logs/diag-admin.txt`. Belum pernah berhasil dijalankan (UAC ditolak).
- `boot/jaga-push.js` — kunci anti-duplikat `boot/.jaga-push.lock`.
- `boot/push-agen.js` — autentikasi iPos lewat query `?key=` (baris 470, 550, 569).
- `boot/nota-simpan.js` — akar nota sah (baris 335–336).
- `index.js` baris 5180–5251 — pemberitahuan OFFLINE/ONLINE ke admin.
