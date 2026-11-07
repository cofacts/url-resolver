const pickCanonical = require('../pickCanonical');

describe('pickCanonical', () => {
  it('keeps a declared URL for a specific page', () => {
    expect(
      pickCanonical('https://a.test/post/1', 'https://a.test/post/1?utm=x')
    ).toBe('https://a.test/post/1');
  });

  it('ignores a declared homepage when the page is not the homepage', () => {
    expect(pickCanonical('https://a.test/', 'https://a.test/post/1')).toBe(
      'https://a.test/post/1'
    );
  });

  it('keeps a declared homepage for the homepage itself', () => {
    expect(pickCanonical('https://a.test/', 'https://a.test/')).toBe(
      'https://a.test/'
    );
  });

  it.each([
    'https://a.test/?utm_source=facebook&fbclid=x',
    'https://a.test/index.html',
    'https://a.test/index.php?utm_medium=social',
  ])('keeps a declared homepage for the homepage served as %s', page => {
    expect(pickCanonical('https://a.test/', page)).toBe('https://a.test/');
  });

  it('ignores a declared homepage for a page selected by query', () => {
    expect(pickCanonical('https://a.test/', 'https://a.test/?p=123')).toBe(
      'https://a.test/?p=123'
    );
  });

  it('falls back to the page URL when the declared URL is invalid', () => {
    expect(pickCanonical('not a url', 'https://a.test/post/1')).toBe(
      'https://a.test/post/1'
    );
  });
});
