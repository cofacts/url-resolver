const normalize = require('../normalize');

describe('normalize', () => {
  it('should be able to normalize protocols', () => {
    const url = 'example.com';
    const expected = `http://${url}/`;
    expect(normalize(url)).toBe(expected);
  });

  it('should keep FB pages on the www host', () => {
    // Must NOT rewrite to m.facebook.com: the mobile host login-walls bots.
    expect(normalize('https://www.facebook.com/pages/blablablabla')).toBe(
      'https://www.facebook.com/pages/blablablabla'
    );
    expect(normalize('http://www.facebook.com/pages/blablablabla')).toBe(
      'http://www.facebook.com/pages/blablablabla'
    );
  });

  it('should be able to remove FB click ID', () => {
    const url = 'http://example.com/?aaa=bbb&fbclid=abcdef';
    const expected = `http://example.com/?aaa=bbb`;
    expect(normalize(url)).toBe(expected);
  });

  it('should throw in case of malformed URL', () => {
    const url = 'malformed url';
    expect(() => normalize(url)).toThrowErrorMatchingInlineSnapshot(
      `"TypeError: Invalid URL"`
    );
  });

  it.each([
    ['https://example.com/a?fbclid=X&id=5', 'https://example.com/a?id=5'],
    ['https://example.com/?a=1&fbclid=X&b=2', 'https://example.com/?a=1&b=2'],
    ['https://example.com/?a=1&fbclid=X#part', 'https://example.com/?a=1#part'],
    ['https://example.com/?fbclid=X#part', 'https://example.com/#part'],
    ['https://example.com/?fbclid=X&a=1&fbclid=Y', 'https://example.com/?a=1'],
    ['https://example.com/?fbclid=&a=1', 'https://example.com/?a=1'],
    [
      'https://example.com/?q=a%20b&x=~#part',
      'https://example.com/?q=a%20b&x=~#part',
    ],
    ['https://example.com/#?fbclid=X', 'https://example.com/#?fbclid=X'],
  ])('removes only the fbclid query parameter in %s', (input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});
