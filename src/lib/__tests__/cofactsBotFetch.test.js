jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const { cofactsBotFetch } = require('../cofactsBotFetch');

const URL = 'http://example.com/article';

function makeRes({
  body = '<html></html>',
  status = 200,
  contentType = 'text/html',
} = {}) {
  return {
    status,
    url: URL,
    arrayBuffer: async () => Buffer.from(body),
    headers: {
      get: h => (h.toLowerCase() === 'content-type' ? contentType : null),
    },
  };
}

describe('cofactsBotFetch', () => {
  it('performs the real GET with the CofactsBot user agent', async () => {
    fetch.mockResolvedValueOnce(makeRes());
    await cofactsBotFetch(URL);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, opts] = fetch.mock.calls[0];
    expect(calledUrl).toBe(URL);
    expect(opts.method).toBe('GET');
    expect(opts.headers['User-Agent']).toMatch(/CofactsBot/);
    expect(opts.redirect).toBe('follow');
  });

  it('returns an unfurl-compatible response object', async () => {
    fetch.mockResolvedValueOnce(makeRes({ body: 'payload', status: 404 }));
    const res = await cofactsBotFetch(URL);

    expect(res.status).toBe(404);
    expect((await res.arrayBuffer()).toString()).toBe('payload');
    expect(res.headers.get('content-type')).toBe('text/html');
  });
});
