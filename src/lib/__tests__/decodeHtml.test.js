const iconv = require('iconv-lite');
const { decodeHtml } = require('../decodeHtml');

describe('decodeHtml', () => {
  it('decodes UTF-8 bytes when no charset is declared', () => {
    const buf = Buffer.from('<html>你好，世界</html>', 'utf-8');
    expect(decodeHtml(buf, null)).toBe('<html>你好，世界</html>');
  });

  it('honors a Big5 charset from the Content-Type header', () => {
    const html = '<html><body>正體中文測試</body></html>';
    const buf = iconv.encode(html, 'BIG5');
    // Naive UTF-8 decode would mojibake; decodeHtml must round-trip.
    expect(buf.toString()).not.toBe(html);
    expect(decodeHtml(buf, 'text/html; charset=big5')).toBe(html);
  });

  it('honors a Shift_JIS charset from an HTML5 <meta charset> tag', () => {
    const html =
      '<html><head><meta charset="shift_jis"></head>こんにちは</html>';
    const buf = iconv.encode(html, 'SHIFT_JIS');
    expect(decodeHtml(buf, 'text/html')).toBe(html);
  });

  it('honors a GBK charset from an HTML4 http-equiv meta tag', () => {
    const html =
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=gbk"></head>简体中文</html>';
    const buf = iconv.encode(html, 'GBK');
    expect(decodeHtml(buf, null)).toBe(html);
  });

  it('falls back to UTF-8 for a declared but unsupported charset', () => {
    const buf = Buffer.from('<html>café</html>', 'utf-8');
    expect(decodeHtml(buf, 'text/html; charset=windows-1252')).toBe(
      '<html>café</html>'
    );
  });

  it('prefers the Content-Type charset over a conflicting meta tag', () => {
    const html = '<html><head><meta charset="utf-8"></head>測試</html>';
    const buf = iconv.encode(html, 'BIG5');
    expect(decodeHtml(buf, 'text/html; charset=big5')).toBe(html);
  });
});
