const iconv = require('iconv-lite');

// Legacy charsets unfurl.js decodes (dist/index.js getPage). We mirror the
// exact same set + detection order so that the Readability fallback decodes a
// page identically to how unfurl decoded it for its meta extraction — no
// mojibake divergence between the two on Big5 / Shift_JIS / GBK etc. pages.
const SUPPORTED_CHARSETS = new Set([
  'CP932',
  'CP936',
  'CP949',
  'CP950',
  'GB2312',
  'GBK',
  'GB18030',
  'BIG5',
  'SHIFT_JIS',
  'EUC-JP',
]);

/**
 * Detect a page's charset from its Content-Type header, then (failing that)
 * from the <meta charset> / <meta http-equiv> tags in the first 1 KiB, exactly
 * as unfurl.js does.
 *
 * @param {Buffer} buffer
 * @param {?string} contentType
 * @returns {?string} upper-cased charset, or null when none is declared
 */
function detectCharset(buffer, contentType) {
  const head = buffer.slice(0, 1024).toString();
  let match;
  if (contentType) {
    match = /charset=([^;]*)/i.exec(contentType);
  }
  if (!match && head) {
    match = /<meta.+?charset=(['"])(.+?)\1/i.exec(head);
  }
  if (!match && head) {
    match = /<meta.+?content=["'].+;\s?charset=(.+?)["']/i.exec(head);
  }
  return match ? match.pop().toUpperCase() : null;
}

/**
 * Decode raw HTML bytes to a string, honoring the declared charset for the
 * legacy encodings unfurl.js supports and falling back to UTF-8 otherwise.
 *
 * @param {Buffer} buffer
 * @param {?string} contentType
 * @returns {string}
 */
function decodeHtml(buffer, contentType) {
  const charset = detectCharset(buffer, contentType);
  if (charset && SUPPORTED_CHARSETS.has(charset)) {
    return iconv.decode(buffer, charset).toString();
  }
  return buffer.toString();
}

module.exports = { decodeHtml };
