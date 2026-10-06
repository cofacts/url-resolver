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
});
