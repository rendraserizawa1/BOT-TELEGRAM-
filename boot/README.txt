BCODE-KEFA — START SAAT BOOT SEBELUM LOGIN
==========================================

Status 13 Nov 2026 08.35:
- Task boot SUDAH AKTIF. Bot + iPos API berjalan dari Scheduled Task di
  Session 0 (background), bukan dari sesi desktop.
- PM2 daemon sudah dimatikan. PM2 tidak lagi dipakai untuk autostart;
  package tetap ada untuk fallback login.
- Reboot berikutnya akan menjalankan task yang sama sebelum login.

Status awal sebelum perbaikan:
- Bot/iPos/PM2 lama hanya start dari HKCU Run / Startup folder, yaitu SETELAH login.
- Bukti: komputer boot 07.36, tetapi proses bot/iPos baru start 16.55.
- Solusi: 3 Scheduled Task berjalan sebagai rdpadmin dengan LogonType=Password,
  trigger AtStartup. Windows menyimpan password terenkripsi; password tidak
  pernah ditulis ke script/log/chat.

Task yang dibuat:
1. BCODE-KEFA-IPOS
   - start iPos API KEFA port 8080 lebih dulu (delay 20 detik).
2. BCODE-KEFA-BOT
   - start bot Telegram + dashboard port 3001 (delay 45 detik).
   - Node berjalan langsung sebagai proses task; Task Scheduler menjadi induk,
     jadi bisa restart otomatis jika proses mati.
3. BCODE-KEFA-WATCHDOG
   - start 2 menit setelah boot, lalu cek tiap 1 menit.
   - Restart task bot/iPos hanya setelah 2 kali gagal berturut-turut.
   - Masa startup 3 menit setelah boot tidak dianggap gagal.

Autostart login:
- HKCU Run PM2 dan iPosAPI diganti menjadi fallback health-gated.
- Saat login, fallback menunggu 90 detik. Jika task boot sudah sehat, fallback
  tidak menyalakan proses kedua (mencegah bentrok polling Telegram 409).
- Jika task boot gagal, fallback menyalakan PM2/iPos lama sebagai penyelamat.
- Nilai autostart lama dicadangkan ke autostart-backup.json.

Cara pasang:
- Jalankan install-boot-tasks.ps1 (bisa dari PowerShell biasa; script akan
  meminta UAC lalu meminta password rdpadmin).
- Password diketik di dialog Windows, bukan di chat.
- Installer awal tidak mematikan bot; setelah verifikasi, switch ke task
  dilakukan terkontrol (bot berhenti sebentar, lalu hidup dari task).
- Task sudah aktif sekarang; reboot berikutnya tetap start otomatis.

Setelah reboot (uji sebelum login):
- Jangan login dulu jika ingin membuktikan bot hidup sebelum desktop.
- Dari HP/perangkat lain buka dashboard port 3001 atau kirim pesan ke bot.
- Di mesin, buka C:\BOT-TELEGRAM-\logs\boot-events.log; harus ada baris
  "wrapper ipos mulai" dan "wrapper bot mulai" dengan jam setelah boot,
  sebelum jam login.
- Cek task: Get-ScheduledTask BCODE-KEFA-* | Select TaskName,State

Health:
- Bot:      http://127.0.0.1:3001/health  (status OK, polling true)
- iPos API: http://127.0.0.1:8080/ipos/health (ok true)

Log:
- C:\BOT-TELEGRAM-\logs\boot-events.log
- C:\BOT-TELEGRAM-\logs\watchdog-boot.log
- C:\BOT-TELEGRAM-\logs\service-out.log
- C:\Users\rdpadmin\ipos-api\api-service.log

Rollback:
- Jalankan rollback-boot-tasks.ps1 sebagai admin.
- Script menghapus task baru, memulihkan HKCU Run lama, meng-enable watchdog
  lama, lalu menyalakan PM2 + iPos lama.

Catatan penting:
- Jika password Windows rdpadmin berubah, task akan gagal logon. Jalankan
  installer lagi dengan password baru.
- PM2 tidak lagi dipakai untuk autostart. PM2 tetap terpasang dan bisa
  dijalankan manual; fallback login masih memakai PM2 jika task boot gagal.
- 9router tetap start dari Startup folder saat login; bot tidak memanggil
  9router secara langsung.
- Share UNC \\100.125.99.99 sedang tidak reachable saat pemeriksaan. Nota
  ke share tersebut bisa gagal sampai jaringan/share pulih. Tidak ada
  fallback simpan ke drive C (sesuai aturan).
- API CP remote 100.125.99.99:8080 timeout saat pemeriksaan; NK 401 karena
  tanpa key. Jangan menganggap data CP realtime sebelum koneksi diuji ulang.

════════════════════════════════════════════════════════════════
MIGRASI KE RAILWAY (14 Nov 2026)
════════════════════════════════════════════════════════════════

Dokumen terkait:
  boot\DESIGN-MIGRASI-RAILWAY.md   - desain + analisis penghalang
  boot\PANDUAN-DEPLOY-RAILWAY.md   - langkah deploy + verifikasi
  boot\PANDUAN-PROXY-KEFA.md       - agar KEFA hidup 24/7 (Opsi D)
  boot\CARA-PINDAH-REPO.md         - pindah repo ke akun baru
  docs\superpowers\plans\2026-11-14-migrasi-railway.md - rencana kerja

Perubahan kode yang SUDAH selesai (semua punya fallback, bot lokal tidak berubah):
  - Node 24 (Dockerfile + package.json). WAJIB: node:sqlite hanya ada di 22+.
  - bot-db.js gagal keras bila node:sqlite tidak ada (dulu mati senyap).
  - Path data/storage/logs/harga dari env (DATA_DIR/STORAGE_DIR/LOGS_DIR/HARGA_DIR).
  - boot\volume-check.js  - deteksi volume tidak persisten, lapor ke /health + admin.
  - boot\replika-guard.js - tolak replika >1 (cegah 409 Conflict).
  - boot\nota-simpan.js   - simpan nota dengan fallback lokal + notif admin.
  - boot\status-jujur.js  - alasan eksplisit saat data iPos tidak segar.
  - Perbaikan BUG PRA-ADA: path share nota ELT/KEF menunjuk share yang tidak ada.

Suite tes baru:
  node boot\test-db-require.js      (fail-fast node:sqlite)
  node boot\test-path-env.js        (path dari env + fallback)
  node boot\test-volume-check.js    (deteksi volume)
  node boot\test-nota-fallback.js   (fallback nota)
  node boot\test-path-nota.js       (path share nota benar)
  node boot\test-replika-guard.js   (tolak replika >1)
  node boot\test-status-jujur.js    (alasan data tidak segar)

CATATAN PENTING:
  - Workflow .github\workflows\bot.yml berstatus disabled_manually dan HARUS
    tetap begitu. Kalau dijalankan, ia jadi poller Telegram KEDUA -> 409
    Conflict -> pesan & tombol pengguna hilang.
    JANGAN menambahkan komentar peringatan ke dalam file bot.yml itu sendiri:
    menyentuh file workflow membuat GitHub menolak push dari token yang tidak
    punya scope `workflow` ("refusing to allow a Personal Access Token to
    create or update workflow"). Peringatan cukup di sini.
  - Jangan isi PORT manual di Railway (Railway menyuntik sendiri).
  - Replika Railway WAJIB 1.
