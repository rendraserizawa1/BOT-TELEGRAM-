'use strict';

function shouldRetryTelegramSend(err) {
  const description = String(err?.response?.body?.description || err?.message || '').toLowerCase();
  return (err?.response?.statusCode === 400 || err?.response?.statusCode === 200 && /ETELEGRAM: 400/.test(err?.message || ''))
    && /parse entities|can't parse|can't find end|can't find start/.test(description);
}

async function sendTelegramMessage(send, ...args) {
  try { return await send(...args); }
  catch (err) {
    if (!shouldRetryTelegramSend(err)) throw err;
    const [chatId, text, options = {}] = args;
    try { return await send(chatId, String(text).replace(/[*_`\[\]]/g, ''), { ...options, parse_mode: undefined }); }
    catch { return null; }
  }
}

module.exports = { shouldRetryTelegramSend, sendTelegramMessage };
