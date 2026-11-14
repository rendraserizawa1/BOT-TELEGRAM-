'use strict';

/**
 * Database lokal bot (SQLite, tanpa server tambahan).
 * - Semua data disimpan di C:\BOT-TELEGRAM-\data
 * - Token/API key TIDAK dimasukkan ke database; hanya metadata & path backup.
 * - Semua fungsi dibuat tidak melempar error ke alur utama bot.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

let DatabaseSync = null;
let galatRequire = null;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  galatRequire = err;
  console.error('[DB] node:sqlite tidak tersedia:', err.message);
}

// GAGAL-KERAS: tanpa node:sqlite, SEMUA fungsi di bawah jadi no-op senyap
// (`return null`), sehingga riwayat chat, sesi, file, log proses, backup DB,
// dan metadata kredensial hilang tanpa satu pun error yang terlihat.
// Ini pernah tidak terdeteksi karena PC ini memakai Node 24 sementara image
// Docker memakai Node 20. Lebih baik mati keras dan kelihatan.
// DB_ALLOW_DEGRADED=1 hanya untuk sengaja menjalankan tanpa DB.
const ALLOW_DEGRADED = process.env.DB_ALLOW_DEGRADED === '1';

function tersedia() {
  return !!DatabaseSync;
}

function pesanTanpaSqlite() {
  return 'node:sqlite tidak tersedia (butuh Node 22+, Railway memakai 24.x).'
    + (galatRequire ? ' Penyebab: ' + galatRequire.message : '')
    + ' Tanpa ini SELURUH riwayat chat/sesi/file/log mati diam-diam.'
    + ' Set DB_ALLOW_DEGRADED=1 hanya bila memang sengaja.';
}

function pastikanTersedia() {
  if (DatabaseSync) return;
  const pesan = pesanTanpaSqlite();
  if (!ALLOW_DEGRADED) throw new Error(pesan);
  console.error('[DB] ' + pesan);
}

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH = path.join(DATA_DIR, 'bot.db');
const FILES_DIR = path.join(DATA_DIR, 'files');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const SECURE_DIR = path.join(DATA_DIR, 'secure');

let db = null;
let ready = false;

function now() { return Date.now(); }
function iso(ts = Date.now()) { return new Date(ts).toISOString(); }
function text(value, max = 12000) {
  if (value === undefined || value === null) return null;
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > max ? s.slice(0, max) : s;
}
function json(value, max = 12000) {
  if (value === undefined || value === null) return null;
  try { return text(JSON.stringify(value), max); } catch { return null; }
}
function safe(fn, fallback = null) {
  try { return fn(); } catch (err) {
    try { console.error('[DB]', err.message); } catch {}
    return fallback;
  }
}
function ensureDirs() {
  for (const dir of [DATA_DIR, FILES_DIR, BACKUP_DIR, SECURE_DIR]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function init() {
  if (ready) return db;
  pastikanTersedia();
  if (!DatabaseSync) return null;
  ensureDirs();
  try {
    db = new DatabaseSync(DB_PATH);
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA busy_timeout = 5000;
      PRAGMA foreign_keys = ON;
      PRAGMA wal_autocheckpoint = 1000;

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT,
        user_id TEXT,
        message_id INTEGER,
        direction TEXT NOT NULL,
        type TEXT,
        text TEXT,
        caption TEXT,
        file_id TEXT,
        file_unique_id TEXT,
        file_name TEXT,
        mime_type TEXT,
        file_size INTEGER,
        local_path TEXT,
        sha256 TEXT,
        status TEXT DEFAULT 'received',
        created_at INTEGER NOT NULL,
        meta TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_chat_time ON messages(chat_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_messages_user_time ON messages(user_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS sessions (
        user_id TEXT PRIMARY KEY,
        chat_id TEXT,
        state TEXT NOT NULL,
        last_message TEXT,
        last_intent TEXT,
        last_seen_at INTEGER,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts INTEGER NOT NULL,
        level TEXT,
        category TEXT,
        message TEXT,
        meta TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_events_time ON events(ts DESC);
      CREATE INDEX IF NOT EXISTS idx_events_level ON events(level, ts DESC);

      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_row_id INTEGER,
        chat_id TEXT,
        user_id TEXT,
        direction TEXT,
        kind TEXT,
        file_id TEXT,
        file_unique_id TEXT,
        file_name TEXT,
        mime_type TEXT,
        size INTEGER,
        local_path TEXT,
        sha256 TEXT,
        status TEXT DEFAULT 'saved',
        created_at INTEGER NOT NULL,
        meta TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_files_time ON files(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_files_chat_time ON files(chat_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_files_unique ON files(file_unique_id);

      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        chat_id TEXT NOT NULL,
        kind TEXT NOT NULL DEFAULT 'text',
        payload TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_outbox_status ON outbox(status, created_at);

      CREATE TABLE IF NOT EXISTS pending_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT,
        chat_id TEXT,
        action TEXT NOT NULL,
        payload TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        resumed_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON pending_tasks(status, created_at);

      CREATE TABLE IF NOT EXISTS backups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT,
        source_path TEXT,
        backup_path TEXT,
        sha256 TEXT,
        size INTEGER,
        status TEXT,
        created_at INTEGER NOT NULL,
        meta TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_backups_time ON backups(created_at DESC);

      CREATE TABLE IF NOT EXISTS credentials_meta (
        name TEXT PRIMARY KEY,
        source_path TEXT,
        backup_path TEXT,
        size INTEGER,
        last_write INTEGER,
        sha256 TEXT,
        updated_at INTEGER,
        note TEXT
      );

      CREATE TABLE IF NOT EXISTS chat_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_memory_user ON chat_memory(user_id, id DESC);

      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
    ready = true;
    return db;
  } catch (err) {
    console.error('[DB] Gagal inisialisasi:', err.message);
    try { if (db) db.close(); } catch {}
    db = null;
    return null;
  }
}

function getDb() { return ready ? db : init(); }

function recordEvent(level, category, message, meta) {
  const d = getDb();
  if (!d) return null;
  return safe(() => {
    const stmt = d.prepare('INSERT INTO events (ts, level, category, message, meta) VALUES (?, ?, ?, ?, ?)');
    return Number(stmt.run(now(), String(level || 'INFO').toUpperCase(), text(category, 80), text(message), json(meta)).lastInsertRowid);
  });
}

function recordMessage(row) {
  const d = getDb();
  if (!d) return null;
  return safe(() => {
    const stmt = d.prepare(`
      INSERT INTO messages
        (chat_id, user_id, message_id, direction, type, text, caption,
         file_id, file_unique_id, file_name, mime_type, file_size,
         local_path, sha256, status, created_at, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return Number(stmt.run(
      row.chat_id === undefined || row.chat_id === null ? null : String(row.chat_id),
      row.user_id === undefined || row.user_id === null ? null : String(row.user_id),
      row.message_id === undefined || row.message_id === null ? null : Number(row.message_id),
      row.direction || 'in',
      row.type || 'text',
      text(row.text),
      text(row.caption),
      row.file_id || null,
      row.file_unique_id || null,
      text(row.file_name, 500),
      text(row.mime_type, 200),
      row.file_size === undefined || row.file_size === null ? null : Number(row.file_size),
      text(row.local_path, 2000),
      row.sha256 || null,
      row.status || 'received',
      row.created_at || now(),
      json(row.meta)
    ).lastInsertRowid);
  });
}

function recordIncoming(msg, kind = 'message') {
  if (!msg || !msg.chat) return null;
  const from = msg.from || {};
  let type = kind;
  let file = null;
  if (kind === 'message') {
    if (msg.text) type = 'text';
    else if (msg.photo) { type = 'photo'; file = msg.photo[msg.photo.length - 1]; }
    else if (msg.document) { type = 'document'; file = msg.document; }
    else if (msg.voice) { type = 'voice'; file = msg.voice; }
    else if (msg.audio) { type = 'audio'; file = msg.audio; }
    else if (msg.video) { type = 'video'; file = msg.video; }
    else if (msg.video_note) { type = 'video_note'; file = msg.video_note; }
    else if (msg.animation) { type = 'animation'; file = msg.animation; }
    else if (msg.sticker) { type = 'sticker'; file = msg.sticker; }
    else type = 'other';
  }
  return recordMessage({
    chat_id: msg.chat.id,
    user_id: from.id,
    message_id: msg.message_id,
    direction: 'in',
    type,
    text: msg.text || null,
    caption: msg.caption || null,
    file_id: file && file.file_id,
    file_unique_id: file && file.file_unique_id,
    file_name: (file && (file.file_name || file.title)) || null,
    mime_type: file && file.mime_type,
    file_size: file && file.file_size,
    status: 'received',
    meta: {
      date: msg.date,
      username: from.username,
      first_name: from.first_name,
      last_name: from.last_name,
      kind,
      media_group_id: msg.media_group_id || null,
    },
  });
}

function recordOutgoingMessage(chatId, textValue, options, result) {
  return recordMessage({
    chat_id: chatId,
    message_id: result && result.message_id,
    direction: 'out',
    type: 'text',
    text: textValue,
    status: 'sent',
    meta: { parse_mode: options && options.parse_mode },
  });
}

function recordCallback(query) {
  if (!query || !query.message || !query.message.chat) return null;
  return recordMessage({
    chat_id: query.message.chat.id,
    user_id: query.from && query.from.id,
    message_id: query.message.message_id,
    direction: 'in',
    type: 'callback',
    text: query.data || null,
    status: 'received',
    meta: { callback_id: query.id, username: query.from && query.from.username },
  });
}

function recordFile(row) {
  const d = getDb();
  if (!d) return null;
  return safe(() => {
    const stmt = d.prepare(`
      INSERT INTO files
        (message_row_id, chat_id, user_id, direction, kind, file_id, file_unique_id,
         file_name, mime_type, size, local_path, sha256, status, created_at, meta)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    return Number(stmt.run(
      row.message_row_id || null,
      row.chat_id === undefined || row.chat_id === null ? null : String(row.chat_id),
      row.user_id === undefined || row.user_id === null ? null : String(row.user_id),
      row.direction || 'in',
      row.kind || 'document',
      row.file_id || null,
      row.file_unique_id || null,
      text(row.file_name, 500),
      text(row.mime_type, 200),
      row.size === undefined || row.size === null ? null : Number(row.size),
      text(row.local_path, 2000),
      row.sha256 || null,
      row.status || 'saved',
      row.created_at || now(),
      json(row.meta)
    ).lastInsertRowid);
  });
}

function fileExistsByUniqueId(fileUniqueId) {
  if (!fileUniqueId) return false;
  const d = getDb();
  if (!d) return false;
  return safe(() => !!d.prepare('SELECT 1 FROM files WHERE file_unique_id = ? LIMIT 1').get(String(fileUniqueId)), false);
}

function saveSession(userId, chatId, state, meta = {}) {
  const d = getDb();
  if (!d) return false;
  return safe(() => {
    const stmt = d.prepare(`
      INSERT INTO sessions (user_id, chat_id, state, last_message, last_intent, last_seen_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        chat_id = COALESCE(excluded.chat_id, sessions.chat_id),
        state = excluded.state,
        last_message = COALESCE(excluded.last_message, sessions.last_message),
        last_intent = COALESCE(excluded.last_intent, sessions.last_intent),
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      String(userId),
      chatId === undefined || chatId === null ? null : String(chatId),
      JSON.stringify(state || {}),
      text(meta.last_message || state && state._lastMessage || null),
      text(meta.last_intent || state && state._lastIntent || null),
      Number(meta.last_seen_at || state && state._lastActive || now()),
      now()
    );
    return true;
  }, false);
}

function loadSessions() {
  const d = getDb();
  if (!d) return [];
  return safe(() => d.prepare('SELECT user_id, chat_id, state, last_message, last_intent, last_seen_at, updated_at FROM sessions').all(), []);
}

function repairSessions() {
  const d = getDb();
  if (!d) return 0;
  return safe(() => {
    const result = d.prepare(`
      UPDATE sessions
      SET chat_id = COALESCE(chat_id, (
            SELECT m.chat_id FROM messages m
            WHERE m.user_id = sessions.user_id AND m.chat_id IS NOT NULL
            ORDER BY m.id DESC LIMIT 1)),
          last_message = COALESCE(last_message, (
            SELECT m.text FROM messages m
            WHERE m.user_id = sessions.user_id AND m.text IS NOT NULL
            ORDER BY m.id DESC LIMIT 1)),
          last_intent = COALESCE(last_intent, (
            SELECT m.text FROM messages m
            WHERE m.user_id = sessions.user_id AND m.text IS NOT NULL
            ORDER BY m.id DESC LIMIT 1))
      WHERE chat_id IS NULL OR last_message IS NULL
    `).run();
    return Number(result.changes || 0);
  }, 0);
}

function recordChatMemory(userId, role, content) {
  const d = getDb();
  if (!d) return null;
  return safe(() => {
    const stmt = d.prepare('INSERT INTO chat_memory (user_id, role, content, created_at) VALUES (?, ?, ?, ?)');
    return Number(stmt.run(String(userId), String(role), text(content), now()).lastInsertRowid);
  });
}

function loadChatMemory(userId, limit = 10) {
  const d = getDb();
  if (!d) return [];
  return safe(() => d.prepare('SELECT role, content, created_at FROM chat_memory WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(String(userId), Math.max(1, Math.min(50, Number(limit) || 10))).reverse(), []);
}

function clearChatMemory(userId) {
  const d = getDb();
  if (!d) return false;
  return safe(() => { d.prepare('DELETE FROM chat_memory WHERE user_id = ?').run(String(userId)); return true; }, false);
}

function enqueueOutbox(chatId, kind, payload) {
  const d = getDb();
  if (!d) return null;
  return safe(() => {
    const stmt = d.prepare('INSERT INTO outbox (chat_id, kind, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)');
    return Number(stmt.run(String(chatId), String(kind || 'text'), json(payload, 20000), 'pending', now(), now()).lastInsertRowid);
  });
}

function markOutbox(id, status, error) {
  if (!id) return false;
  const d = getDb();
  if (!d) return false;
  return safe(() => {
    d.prepare('UPDATE outbox SET status = ?, attempts = attempts + 1, last_error = ?, updated_at = ? WHERE id = ?')
      .run(String(status), text(error, 2000), now(), Number(id));
    return true;
  }, false);
}

function pendingOutbox(limit = 50) {
  const d = getDb();
  if (!d) return [];
  return safe(() => d.prepare("SELECT * FROM outbox WHERE status IN ('pending','retry') ORDER BY id ASC LIMIT ?").all(Math.max(1, Math.min(200, Number(limit) || 50))), []);
}

function addPendingTask(userId, chatId, action, payload) {
  const d = getDb();
  if (!d) return null;
  return safe(() => {
    const stmt = d.prepare('INSERT INTO pending_tasks (user_id, chat_id, action, payload, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    return Number(stmt.run(String(userId || ''), chatId === undefined || chatId === null ? null : String(chatId), String(action), json(payload), 'pending', now(), now()).lastInsertRowid);
  });
}

function markPendingTask(id, status, payload) {
  if (!id) return false;
  const d = getDb();
  if (!d) return false;
  return safe(() => {
    d.prepare('UPDATE pending_tasks SET status = ?, payload = COALESCE(?, payload), updated_at = ?, resumed_at = CASE WHEN ? = \'done\' THEN ? ELSE resumed_at END WHERE id = ?')
      .run(String(status), payload === undefined ? null : json(payload), now(), String(status), now(), Number(id));
    return true;
  }, false);
}

function pendingTasks(limit = 50) {
  const d = getDb();
  if (!d) return [];
  return safe(() => d.prepare("SELECT * FROM pending_tasks WHERE status IN ('pending','running') ORDER BY id ASC LIMIT ?").all(Math.max(1, Math.min(200, Number(limit) || 50))), []);
}

function recordBackup(row) {
  const d = getDb();
  if (!d) return null;
  return safe(() => {
    const stmt = d.prepare('INSERT INTO backups (kind, source_path, backup_path, sha256, size, status, created_at, meta) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    return Number(stmt.run(text(row.kind, 80), text(row.source_path, 2000), text(row.backup_path, 2000), row.sha256 || null, row.size || null, row.status || 'ok', row.created_at || now(), json(row.meta)).lastInsertRowid);
  });
}

function recordCredentialMeta(row) {
  const d = getDb();
  if (!d) return false;
  return safe(() => {
    d.prepare(`
      INSERT INTO credentials_meta (name, source_path, backup_path, size, last_write, sha256, updated_at, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        source_path = excluded.source_path,
        backup_path = excluded.backup_path,
        size = excluded.size,
        last_write = excluded.last_write,
        sha256 = excluded.sha256,
        updated_at = excluded.updated_at,
        note = excluded.note
    `).run(text(row.name, 120), text(row.source_path, 2000), text(row.backup_path, 2000), row.size || null, row.last_write || null, row.sha256 || null, now(), text(row.note, 500));
    return true;
  }, false);
}

function setKv(key, value) {
  const d = getDb();
  if (!d) return false;
  return safe(() => {
    d.prepare('INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at')
      .run(String(key), json(value), now());
    return true;
  }, false);
}

function getKv(key) {
  const d = getDb();
  if (!d) return null;
  return safe(() => {
    const row = d.prepare('SELECT value FROM kv WHERE key = ?').get(String(key));
    return row ? JSON.parse(row.value) : null;
  }, null);
}

function backupDatabase(keep = 30) {
  const d = getDb();
  if (!d) return null;
  ensureDirs();
  return safe(() => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(BACKUP_DIR, `bot-${stamp}.db`);
    const escaped = target.replace(/'/g, "''");
    d.exec(`VACUUM INTO '${escaped}'`);
    const stat = fs.statSync(target);
    const hash = crypto.createHash('sha256').update(fs.readFileSync(target)).digest('hex');
    recordBackup({ kind: 'database', source_path: DB_PATH, backup_path: target, sha256: hash, size: stat.size, status: 'ok' });
    const files = fs.readdirSync(BACKUP_DIR)
      .filter((f) => /^bot-.*\.db$/.test(f))
      .map((f) => ({ f, t: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t);
    for (const old of files.slice(keep)) {
      try { fs.unlinkSync(path.join(BACKUP_DIR, old.f)); } catch {}
    }
    return target;
  }, null);
}

function stats() {
  const d = getDb();
  if (!d) return { ready: false };
  return safe(() => {
    const one = (sql) => Number(d.prepare(sql).get().n || 0);
    return {
      ready: true,
      dbPath: DB_PATH,
      messages: one('SELECT COUNT(*) n FROM messages'),
      sessions: one('SELECT COUNT(*) n FROM sessions'),
      events: one('SELECT COUNT(*) n FROM events'),
      files: one('SELECT COUNT(*) n FROM files'),
      outbox: one("SELECT COUNT(*) n FROM outbox WHERE status IN ('pending','retry')"),
      tasks: one("SELECT COUNT(*) n FROM pending_tasks WHERE status IN ('pending','running')"),
      backups: one('SELECT COUNT(*) n FROM backups'),
    };
  }, { ready: false });
}

function recentMessages(limit = 100, chatId = null) {
  const d = getDb();
  if (!d) return [];
  const n = Math.max(1, Math.min(500, Number(limit) || 100));
  return safe(() => chatId
    ? d.prepare('SELECT * FROM messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?').all(String(chatId), n)
    : d.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?').all(n), []);
}

function recentMessagesForUser(userId, limit = 8) {
  const d = getDb();
  if (!d) return [];
  const n = Math.max(1, Math.min(50, Number(limit) || 8));
  return safe(() => d.prepare('SELECT direction, type, text, caption, created_at FROM messages WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(String(userId), n).reverse(), []);
}

function recentEvents(limit = 200, level = null) {
  const d = getDb();
  if (!d) return [];
  const n = Math.max(1, Math.min(1000, Number(limit) || 200));
  return safe(() => level
    ? d.prepare('SELECT * FROM events WHERE level = ? ORDER BY id DESC LIMIT ?').all(String(level).toUpperCase(), n)
    : d.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(n), []);
}

function recentFiles(limit = 100) {
  const d = getDb();
  if (!d) return [];
  return safe(() => d.prepare('SELECT * FROM files ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(500, Number(limit) || 100))), []);
}

function recentSessions(limit = 100) {
  const d = getDb();
  if (!d) return [];
  return safe(() => d.prepare('SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?').all(Math.max(1, Math.min(500, Number(limit) || 100))), []);
}

function recentBackups(limit = 50) {
  const d = getDb();
  if (!d) return [];
  return safe(() => d.prepare('SELECT * FROM backups ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(200, Number(limit) || 50))), []);
}

function recentOutbox(limit = 50) {
  const d = getDb();
  if (!d) return [];
  return safe(() => d.prepare('SELECT * FROM outbox ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(200, Number(limit) || 50))), []);
}

function recentTasks(limit = 50) {
  const d = getDb();
  if (!d) return [];
  return safe(() => d.prepare('SELECT * FROM pending_tasks ORDER BY id DESC LIMIT ?').all(Math.max(1, Math.min(200, Number(limit) || 50))), []);
}

function recentCredentials(limit = 20) {
  const d = getDb();
  if (!d) return [];
  return safe(() => d.prepare('SELECT * FROM credentials_meta ORDER BY updated_at DESC LIMIT ?').all(Math.max(1, Math.min(100, Number(limit) || 20))), []);
}

function getFile(id) {
  const d = getDb();
  if (!d) return null;
  return safe(() => d.prepare('SELECT * FROM files WHERE id = ?').get(Number(id)) || null, null);
}

function importLogFile(filePath, category = 'log-import') {
  const d = getDb();
  if (!d || !filePath || !fs.existsSync(filePath)) return 0;
  const stat = fs.statSync(filePath);
  const key = `import-offset:${filePath}`;
  let state = getKv(key);
  if (!state || typeof state.offset !== 'number') state = { offset: 0, mtime: 0 };
  // File dirotasi/dipotong: mulai dari awal lagi.
  if (stat.size < state.offset) state = { offset: 0, mtime: 0 };
  const full = fs.readFileSync(filePath);
  const lines = full.slice(state.offset).toString('utf8').split(/\r?\n/).filter(Boolean);
  let inserted = 0;
  const insert = d.prepare('INSERT INTO events (ts, level, category, message, meta) VALUES (?, ?, ?, ?, ?)');
  d.exec('BEGIN');
  try {
    for (const raw of lines) {
      let line = raw.replace(/\b\d{8,10}:[A-Za-z0-9_-]{30,}\b/g, '***TOKEN***')
        .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer ***');
      const tm = line.match(/^\[(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2})\]/);
      const ts = tm ? new Date(tm[1].replace(' ', 'T') + '+08:00').getTime() : now();
      const level = /\[ERROR\]/i.test(line) ? 'ERROR' : /\[WARN/i.test(line) ? 'WARN' : 'INFO';
      const cat = (line.match(/\[(?:ERROR|WARN\s*|INFO\s*)\]\s*\[([^\]]+)\]/i) || [])[1] || category;
      insert.run(Number.isFinite(ts) ? ts : now(), level, text(cat, 80), text(line), json({ file: filePath, imported: true }));
      inserted++;
    }
    d.exec('COMMIT');
  } catch (err) {
    try { d.exec('ROLLBACK'); } catch {}
    throw err;
  }
  setKv(key, { offset: stat.size, imported: inserted, at: now() });
  return inserted;
}

function dedupeEvents() {
  const d = getDb();
  if (!d) return 0;
  return safe(() => {
    const before = Number(d.prepare('SELECT COUNT(*) AS n FROM events').get().n);
    d.exec("DELETE FROM events WHERE id NOT IN (SELECT MIN(id) FROM events GROUP BY ts, level, category, message)");
    const after = Number(d.prepare('SELECT COUNT(*) AS n FROM events').get().n);
    return Math.max(0, before - after);
  }, 0);
}

function close() {
  if (db) { try { db.close(); } catch {} db = null; ready = false; }
}

module.exports = {
  ROOT, DATA_DIR, DB_PATH, FILES_DIR, BACKUP_DIR, SECURE_DIR,
  init, getDb, stats,
  tersedia, pastikanTersedia,
  recordEvent, recordMessage, recordIncoming, recordOutgoingMessage, recordCallback,
  recordFile, fileExistsByUniqueId,
  saveSession, loadSessions, repairSessions,
  recordChatMemory, loadChatMemory, clearChatMemory,
  enqueueOutbox, markOutbox, pendingOutbox,
  addPendingTask, markPendingTask, pendingTasks,
  recordBackup, recordCredentialMeta, backupDatabase,
  recentMessages, recentMessagesForUser, recentEvents, recentFiles, recentSessions, recentBackups,
  recentOutbox, recentTasks, recentCredentials, getFile,
  importLogFile, dedupeEvents, setKv, getKv, close,
};

// Inisialisasi saat modul dimuat (idempoten).
init();
