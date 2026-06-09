jest.mock('node-fetch', () => jest.fn());

const mockParse = jest.fn();
jest.mock('@mozilla/readability', () => ({
  Readability: jest.fn(() => ({ parse: mockParse })),
}));

jest.mock('jsdom', () => {
  return {
    JSDOM: jest.fn(),
  };
});

const fetch = require('node-fetch');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');
const extractStatic = require('../extractStatic');
const ResolveError = require('../ResolveError');

const URL = 'http://example.com/article';

const makeRes = ({
  ok = true,
  status = 200,
  contentType = 'text/html; charset=utf-8',
  body = '',
  finalUrl = null,
}) => ({
  ok,
  status,
  url: finalUrl || URL,
  headers: {
    get: header =>
      header.toLowerCase() === 'content-type' ? contentType : null,
  },
  text: async () => body,
});

function makeDom({
  canonical,
  ogUrl,
  ogImage,
  twitterImage,
  ogTitle,
  description,
  title,
} = {}) {
  const elements = {
    'link[rel=canonical]': canonical
      ? { href: canonical, getAttribute: () => canonical }
      : null,
    'meta[property="og:url"]': ogUrl
      ? { getAttribute: name => (name === 'content' ? ogUrl : null) }
      : null,
    'meta[property="og:image"]': ogImage
      ? { getAttribute: name => (name === 'content' ? ogImage : null) }
      : null,
    'meta[property="og:image:url"]': null,
    'meta[name="twitter:image"]': twitterImage
      ? { getAttribute: name => (name === 'content' ? twitterImage : null) }
      : null,
    'meta[property="og:title"]': ogTitle
      ? { getAttribute: name => (name === 'content' ? ogTitle : null) }
      : null,
    'meta[property="og:description"]': null,
    'meta[name=description]': description
      ? { getAttribute: name => (name === 'content' ? description : null) }
      : null,
  };
  const document = {
    title: title || '',
    querySelector: selector => elements[selector] || null,
  };
  return { window: { document } };
}

describe('extractStatic', () => {
  beforeEach(() => {
    fetch.mockReset();
    JSDOM.mockReset();
    Readability.mockClear();
    mockParse.mockReset();
  });

  it('returns ScrapResult with Readability output for SSR HTML', async () => {
    fetch.mockResolvedValueOnce(makeRes({ body: '<html>...</html>' }));
    JSDOM.mockImplementationOnce(() =>
      makeDom({ ogImage: 'https://cdn/cover.jpg' })
    );
    mockParse.mockReturnValueOnce({
      title: 'Page Title',
      textContent: 'Article body text.',
    });

    const result = await extractStatic(URL);

    expect(result.status).toBe(200);
    expect(result.title).toBe('Page Title');
    expect(result.summary).toBe('Article body text.');
    expect(result.topImageUrl).toBe('https://cdn/cover.jpg');
    expect(result.html).toBe('<html>...</html>');
    expect(JSDOM).toHaveBeenCalledWith('<html>...</html>', { url: URL });
  });

  it('uses link[rel=canonical] for canonical URL', async () => {
    fetch.mockResolvedValueOnce(makeRes({ body: 'h' }));
    JSDOM.mockImplementationOnce(() =>
      makeDom({ canonical: 'https://example.com/canonical' })
    );
    mockParse.mockReturnValueOnce({ title: 't', textContent: 'x' });

    const result = await extractStatic(URL);
    expect(result.canonical).toBe('https://example.com/canonical');
  });

  it('falls back to og:url when canonical link missing', async () => {
    fetch.mockResolvedValueOnce(makeRes({ body: 'h' }));
    JSDOM.mockImplementationOnce(() =>
      makeDom({ ogUrl: 'https://example.com/og' })
    );
    mockParse.mockReturnValueOnce({ title: 't', textContent: 'x' });

    const result = await extractStatic(URL);
    expect(result.canonical).toBe('https://example.com/og');
  });

  it('falls back to response URL when no canonical or og:url', async () => {
    fetch.mockResolvedValueOnce(
      makeRes({ body: 'h', finalUrl: 'http://example.com/redirected' })
    );
    JSDOM.mockImplementationOnce(() => makeDom());
    mockParse.mockReturnValueOnce({ title: 't', textContent: 'x' });

    const result = await extractStatic(URL);
    expect(result.canonical).toBe('http://example.com/redirected');
  });

  it('resolves relative og:image against canonical', async () => {
    fetch.mockResolvedValueOnce(makeRes({ body: 'h' }));
    JSDOM.mockImplementationOnce(() =>
      makeDom({ ogImage: '/static/cover.png' })
    );
    mockParse.mockReturnValueOnce({ title: 't', textContent: 'x' });

    const result = await extractStatic(URL);
    expect(result.topImageUrl).toBe('http://example.com/static/cover.png');
  });

  it('falls back to twitter:image when og:image missing', async () => {
    fetch.mockResolvedValueOnce(makeRes({ body: 'h' }));
    JSDOM.mockImplementationOnce(() =>
      makeDom({ twitterImage: 'https://cdn/twitter.jpg' })
    );
    mockParse.mockReturnValueOnce({ title: 't', textContent: 'x' });

    const result = await extractStatic(URL);
    expect(result.topImageUrl).toBe('https://cdn/twitter.jpg');
  });

  it('falls back to og:title and meta description when Readability returns null', async () => {
    fetch.mockResolvedValueOnce(makeRes({ body: 'h' }));
    JSDOM.mockImplementationOnce(() =>
      makeDom({ ogTitle: 'OG Title', description: 'Short description.' })
    );
    mockParse.mockReturnValueOnce(null);

    const result = await extractStatic(URL);
    expect(result.title).toBe('OG Title');
    expect(result.summary).toBe('Short description.');
  });

  it('falls back to document.title when Readability and og:title are missing', async () => {
    fetch.mockResolvedValueOnce(makeRes({ body: 'h' }));
    JSDOM.mockImplementationOnce(() => makeDom({ title: 'HTML Title' }));
    mockParse.mockReturnValueOnce(null);

    const result = await extractStatic(URL);
    expect(result.title).toBe('HTML Title');
  });

  it('returns ScrapResult with status only when response is not ok', async () => {
    fetch.mockResolvedValueOnce(makeRes({ ok: false, status: 404 }));

    const result = await extractStatic(URL);
    expect(result.status).toBe(404);
    expect(result.title).toBeUndefined();
    expect(result.summary).toBeUndefined();
    expect(result.canonical).toBe(URL);
    expect(JSDOM).not.toHaveBeenCalled();
  });

  it('returns null when content-type is not html', async () => {
    fetch.mockResolvedValueOnce(
      makeRes({ contentType: 'application/json', body: '{}' })
    );

    expect(await extractStatic(URL)).toBeNull();
    expect(JSDOM).not.toHaveBeenCalled();
  });

  it('accepts application/xhtml+xml content type', async () => {
    fetch.mockResolvedValueOnce(
      makeRes({ contentType: 'application/xhtml+xml', body: 'h' })
    );
    JSDOM.mockImplementationOnce(() => makeDom({ title: 'X' }));
    mockParse.mockReturnValueOnce(null);

    const result = await extractStatic(URL);
    expect(result).not.toBeNull();
    expect(result.title).toBe('X');
  });

  it('returns null when JSDOM throws', async () => {
    fetch.mockResolvedValueOnce(makeRes({ body: 'h' }));
    JSDOM.mockImplementationOnce(() => {
      throw new Error('parse error');
    });

    expect(await extractStatic(URL)).toBeNull();
  });

  it('throws ResolveError on network timeout', async () => {
    const err = new Error('network timeout at:');
    err.name = 'FetchError';
    fetch.mockRejectedValueOnce(err);

    await expect(extractStatic(URL)).rejects.toThrow(ResolveError);
  });

  it('throws ResolveError on socket hang up', async () => {
    fetch.mockRejectedValueOnce(new Error('reason: socket hang up'));
    await expect(extractStatic(URL)).rejects.toThrow(ResolveError);
  });

  it('throws ResolveError on ECONNREFUSED', async () => {
    fetch.mockRejectedValueOnce(new Error('reason: connect ECONNREFUSED'));
    await expect(extractStatic(URL)).rejects.toThrow(ResolveError);
  });

  it('throws ResolveError on certificate altname mismatch', async () => {
    fetch.mockRejectedValueOnce(
      new Error("reason: Hostname/IP doesn't match certificate's altnames")
    );
    await expect(extractStatic(URL)).rejects.toThrow(ResolveError);
  });

  it('returns null on non-mapped fetch errors', async () => {
    fetch.mockRejectedValueOnce(new Error('some other failure'));
    expect(await extractStatic(URL)).toBeNull();
  });

  it('sends User-Agent on the fetch request', async () => {
    fetch.mockResolvedValueOnce(makeRes({ body: 'h' }));
    JSDOM.mockImplementationOnce(() => makeDom({ title: 't' }));
    mockParse.mockReturnValueOnce(null);

    await extractStatic(URL);
    expect(fetch.mock.calls[0][1].headers['User-Agent']).toMatch(/CofactsBot/);
  });
});
