# SSH ke Komputer Toko NK — Hasil Penyelidikan (DITUTUP)

Tanggal: 17 November 2026
Mesin: `BARCODE-NN` (user `rdpadmin`), Tailscale `100.110.152.33`
Tujuan: memberi saya akses SSH seperti ke ADMIN_DIMAS

## Kesimpulan akhir: TIDAK MUNGKIN lewat service

`sshd.exe` **tidak bisa dieksekusi oleh LocalSystem** di mesin itu.

Bukti terakhir yang menutup penyelidikan:

```
=== UJI: bisakah LocalSystem mengeksekusi sshd.exe sama sekali? ===
   TIDAK ada keluaran -> sshd.exe TIDAK BISA dieksekusi LocalSystem
```

Uji itu menjalankan service sebagai LocalSystem dengan perintah:

```
cmd.exe /c "C:\Program Files\OpenSSH\sshd.exe" -h > C:\Windows\Temp\ssh-h.txt 2>&1
```

`sshd -h` hanya mencetak bantuan — tidak membuka port, tidak membaca konfigurasi,
tidak butuh kunci host. Berkas keluarannya **kosong**.

Pembandingnya menentukan:

| Service sebagai LocalSystem | Hasil |
|---|---|
| `cmd.exe /c echo OK > berkas` | ✅ `marker: True` — LocalSystem **bisa** menjalankan proses & menulis |
| `cmd.exe /c sshd.exe -h > berkas` | ❌ berkas **kosong** — sshd.exe tidak bisa dieksekusi |

Jadi bukan mesin yang rusak, bukan izin, bukan konfigurasi. Ada yang menghentikan
`sshd.exe` khusus di konteks non-admin.

## Fakta yang terbukti

| Pemeriksaan | Hasil |
|---|---|
| `sshd -d` sebagai `rdpadmin` | ✅ `Server listening on 0.0.0.0 port 22` |
| `sshd -D` sebagai `rdpadmin` | ✅ hidup, port 22 mendengarkan |
| `sshd -t` | ✅ kode keluar 0 |
| Service SCM langsung | ❌ `ExitCode 1067` (ERROR_PROCESS_ABORTED), tanpa log |
| NSSM 2.24 (dari ADMIN_DIMAS) | ❌ gagal start, log NSSM **kosong** |
| Scheduled Task | ❌ `LastTaskResult 255` |
| Service uji `cmd.exe` (LocalSystem) | ✅ `marker: True` |
| Kunci host RSA/ECDSA/ED25519 | ✅ terbaca |
| ACL `C:\Program Files\OpenSSH` | ✅ `SYSTEM:(I)(F)` |
| ACL `libcrypto.dll` | ✅ `SYSTEM:(I)(F)` |
| ACL `C:\ProgramData\ssh` + `logs` | ✅ `SYSTEM:(OI)(CI)(F)` |
| ACL `ssh_host_*_key` | ✅ `SYSTEM: FullControl` |
| ETW (`wevtutil im`) | ✅ kode 0; `OpenSSH/Admin` & `Operational` record=0 |
| Software Restriction Policies | ⚠️ kunci registry **ada tapi kosong** — bukan kebijakan aktif |
| Defender | aktif, `ControlledFolderAccess=0`, ASR kosong |
| AppLocker | tidak ada |
| Code Integrity | hanya pesan WHQL normal |
| Proxy iPos port 8080 | ✅ **tidak pernah tersentuh** (`proxy8080: True` di setiap percobaan) |

## Dugaan yang semuanya salah — jangan diulang

1. `Add-WindowsCapability` butuh Windows Update
2. MSI resmi rusak / rollback
3. Nama folder `OpenSSH-Win64`
4. Lokasi `sshd_config` di folder program
5. Izin kunci host tidak terbaca SYSTEM
6. Folder `logs` tidak ada
7. Izin `C:\ProgramData\ssh` salah
8. `-Execute` pada berkas `.bat`
9. SRP aktif memblokir
10. NSSM bisa menjadi jalan tengah

## Pelajaran penting

**Task Scheduler di PC `BCODE-KEFA` pun mengembalikan `LastTaskResult=255` untuk tugas
apa pun** — termasuk `cmd.exe /c echo OK > berkas`. Artinya di lingkungan ini
Scheduled Task tidak bisa dipakai sebagai alat uji tanpa memverifikasi mekanismenya
lebih dulu dengan berkas penanda. Dua ronde diagnosa sempat berdiri di atas bukti
kosong karena hal ini.

## Cara transfer berkas BCODE-KEFA → NK tanpa SSH (TERBUKTI)

Jalankan server HTTP sementara di PC ini yang hanya menyajikan **satu** berkas:

```js
// boot/sajikan-nssm.js — hanya berkas yang disebut, berhenti sendiri setelah 15 menit
const http = require('http'), fs = require('fs');
const isi = fs.readFileSync('C:\\path\\ke\\berkas.exe');
http.createServer((req, res) => {
  if (req.url === '/berkas.exe') { res.writeHead(200, {'Content-Length': isi.length}); res.end(isi); }
  else { res.writeHead(200); res.end('OK'); }
}).listen(8099, '0.0.0.0');
```

Lalu di komputer tujuan:

```powershell
Invoke-WebRequest "http://100.123.166.13:8099/berkas.exe" -OutFile "C:\tujuan\berkas.exe" -UseBasicParsing
```

Diuji dari ADMIN_DIMAS: **BERHASIL 331264 byte**.

## Jalan yang tersisa

**RDP ke `100.110.152.33`** (port 3389 terbuka). Di sesi RDP, user adalah
administrator penuh, sehingga `sshd -D` bisa dijalankan manual. Tapi tidak bertahan
setelah logoff, jadi bukan pengganti yang setara.

**Rekomendasi: cukupkan dengan RDP.** SSH hanya menambah kenyamanan, bukan syarat.

## Sisa yang perlu dibersihkan di NK (kalau diinginkan)

- Service `sshd` hasil NSSM masih terdaftar dalam keadaan stopped
- `C:\Program Files\OpenSSH\nssm.exe`
- `C:\ProgramData\ssh\uji.log`, `marker.txt`, `ssh-h.txt`
- `C:\ProgramData\ssh\logs\uji.log`

## Yang jauh lebih penting daripada SSH

`jualPromo` di NK **kosong total** (`{}`), padahal CP punya data:

```
CP  17/11  promo.nota=18  promo.omzet=524.000
NK  17/11  promo.nota=0   promo.omzet=0      (juga 16/11, 10/11, 01/11 — semua nol)
```

Belum bisa dibedakan apakah NK memang tidak punya penjualan promo, atau laporannya
rusak seperti `normJual is not defined` yang juga muncul di `/health` NK
(`rekon: null`). Kalau rusak, omzet promo NK tidak pernah muncul di laporan —
kerugian yang jauh lebih besar daripada tidak adanya SSH.

Pemeriksaan ini bisa dilakukan lewat RDP yang sudah terbuka.
