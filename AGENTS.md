## PM2
- Run PM2 commands as the Windows user that owns `%USERPROFILE%\.pm2`; set `PM2_HOME` to that path before every PM2 command.
- Windows recovery note: duplicate daemons caused CLI hangs; keep the Startup `pm2-resurrect.vbs` fallback disabled. Recover with `pm2 resurrect` only after checking the single `PM2_HOME` daemon, then verify `/health`.
- Check processes: `pm2 list`.
- Read logs only with `pm2 logs <name> --nostream --lines 100`.
- Restart: `pm2 restart <name> --update-env`; verify status and application health afterward.
- Never run streaming `pm2 logs`, `pm2 kill`, or `pm2 delete` without explicit approval.
