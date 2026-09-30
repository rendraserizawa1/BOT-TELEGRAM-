'use strict';

module.exports = {
  apps: [{
    name: 'telegram-perabot',
    script: 'index.js',
    cwd: __dirname,
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    min_uptime: '10s',
    max_restarts: 1000,
    exp_backoff_restart_delay: 2000,
    max_memory_restart: '768M',
    // Mesin hanya 3.9 GB: batasi heap agar GC lebih rajin dan RSS tidak meliar.
    node_args: '--max-old-space-size=640',
    kill_timeout: 30000,
  }],
};
