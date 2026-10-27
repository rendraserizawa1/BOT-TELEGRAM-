'use strict';
const assert = require('node:assert/strict');
const { shouldRetryTelegramSend, sendTelegramMessage } = require('./telegram-send-error');
assert.equal(shouldRetryTelegramSend({ response: { statusCode: 200, body: { ok: false, error_code: 400, description: "Bad Request: can't parse entities" } }, message: "ETELEGRAM: 400 Bad Request: can't parse entities" }), true);
assert.equal(shouldRetryTelegramSend({ response: { statusCode: 400, body: { description: "Bad Request: can't parse entities" } } }), true);
assert.equal(shouldRetryTelegramSend({ code: 'EFATAL', message: 'ETIMEDOUT' }), false);
assert.equal(shouldRetryTelegramSend({ response: { statusCode: 500, body: { description: 'server error' } } }), false);
(async () => {
  let attempts = 0;
  const timeout = Object.assign(new Error('ETIMEDOUT'), { code: 'EFATAL' });
  await assert.rejects(() => sendTelegramMessage(async () => { attempts++; throw timeout; }), timeout);
  assert.equal(attempts, 1);
  let parseAttempts = 0;
  const parseErr = { response: { statusCode: 200, body: { description: "Bad Request: can't parse entities" } }, message: "ETELEGRAM: 400 Bad Request: can't parse entities" };
  const sent = await sendTelegramMessage(async (...args) => {
    parseAttempts++;
    if (parseAttempts === 1) throw parseErr;
    return args[1];
  }, 7, '*broken*', { parse_mode: 'Markdown' });
  assert.equal(sent, 'broken');
  assert.equal(parseAttempts, 2);
  console.log('OK retry hanya untuk format Telegram yang ditolak; timeout tidak dikirim ulang');
})().catch(err => { console.error(err); process.exitCode = 1; });
