const normalize = require('../normalize');

describe('normalize', () => {
  it('should be able to normalize protocols', () => {
    const url = 'example.com';
    const expected = `http://${url}`;
    expect(normalize(url)).toBe(expected);
  });

  it('should be able to normalize FB pages', () => {
    const urls = [
      'http://www.facebook.com/pages/blablablabla',
      'https://www.facebook.com/pages/blablablabla',
    ];
    const expected = 'https://m.facebook.com/pages/blablablabla';
    urls.map(url => expect(normalize(url)).toBe(expected));
  });

  it('should be able to remove FB click ID', () => {
    const url = 'http://example.com/?aaa=bbb&fbclid=abcdef';
    const expected = `http://example.com/?aaa=bbb`;
    expect(normalize(url)).toBe(expected);
  });
});
