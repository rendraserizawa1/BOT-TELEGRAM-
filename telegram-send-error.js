'use strict';

const NETWORK_CODE_RE = /^(EFATAL|ECONNRESET|ECONNREFUSED|ESOCKETTIMEDOUT|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|EHOSTUNREACH|ENETUNREACH|ECONNABORTED|ERR_SOCKET_CONNECTION_TIMEOUT)$/i;
const NETWORK_MSG_RE = /(EFATAL|ECONNRESET|ECONNREFUSED|ESOCKETTIMEDOUT|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|EHOSTUNREACH|ENETUNREACH|socket hang up|network socket disconnected|TLS connection|Bad Gateway|Service Unavailable|Gateway Timeout|Too Many Requests|retry after)/i;
const PARSE_ENTITY_RE = /parse entities|can't parse|can't find end|can't find start/i;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorText(err) {
  return String(err?.response?.body?.description || err?.message || err?.code || '');
}

function parseEntityError(err) {
  const status = Number(err?.response?.statusCode || err?.response?.status || 0);
  return (status === 400 || /ETELEGRAM:\s*400/i.test(String(err?.message || '')))
    && PARSE_ENTITY_RE.test(errorText(err));
}

// Dipertahankan untuk kompatibilitas: khusus error format Markdown/entity.
function shouldRetryTelegramSend(err) {
  return parseEntityError(err);
}

function retryAfterMs(err) {
  const body = err?.response?.body;
  const seconds = Number(body?.parameters?.retry_after || body?.retry_after);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, 30000);
  const match = String(err?.message || '').match(/retry after\s+(\d+)/i);
  if (match) return Math.min(Number(match[1]) * 1000, 30000);
  return 0;
}

function isRetryableTelegramSend(err) {
  if (parseEntityError(err)) return true;
  const status = Number(err?.response?.statusCode || err?.response?.status || 0);
  if (status === 429 || status >= 500) return true;
  const code = String(err?.code || '').trim();
  if (NETWORK_CODE_RE.test(code)) return true;
  return NETWORK_MSG_RE.test(errorText(err));
}

function delayForAttempt(err, attempt) {
  const retryAfter = retryAfterMs(err);
  if (retryAfter) return retryAfter;
  return Math.min(1000 * Math.pow(2, Math.max(0, attempt - 1)), 8000);
}

// Retry generik untuk teks maupun file. Tidak mengubah argumen.
async function sendTelegramWithRetry(send, ...args) {
  const maxAttempts = 4;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await send(...args);
    } catch (err) {
      if (!isRetryableTelegramSend(err) || attempt === maxAttempts) throw err;
      await sleep(delayForAttempt(err, attempt));
    }
  }
}

// Khusus pesan teks: kalau Markdown rusak, kirim ulang tanpa parse_mode.
async function sendTelegramMessage(send, ...args) {
  const maxAttempts = 4;
  let parseFallbackUsed = false;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await send(...args);
    } catch (err) {
      if (parseEntityError(err) && !parseFallbackUsed) {
        parseFallbackUsed = true;
        const [chatId, text, options = {}] = args;
        args = [chatId, String(text).replace(/[*_`\[\]]/g, ''), { ...options, parse_mode: undefined }];
        continue;
      }
      if (!isRetryableTelegramSend(err) || attempt === maxAttempts) throw err;
      await sleep(delayForAttempt(err, attempt));
    }
  }
}

module.exports = {
  shouldRetryTelegramSend,
  isRetryableTelegramSend,
  sendTelegramWithRetry,
  sendTelegramMessage,
};
