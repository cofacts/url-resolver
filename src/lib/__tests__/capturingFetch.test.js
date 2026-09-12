jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const { createCapturingFetch } = require('../capturingFetch');

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

describe('createCapturingFetch', () => {
  it('performs the real GET with the CofactsBot user agent', async () => {
    fetch.mockResolvedValueOnce(makeRes());
    const capture = {};
    await createCapturingFetch(capture)(URL);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [calledUrl, opts] = fetch.mock.calls[0];
    expect(calledUrl).toBe(URL);
    expect(opts.method).toBe('GET');
    expect(opts.headers['User-Agent']).toMatch(/CofactsBot/);
    expect(opts.redirect).toBe('follow');
  });

  it('records the response bytes, status, content-type and final URL as a side effect', async () => {
    fetch.mockResolvedValueOnce(
      makeRes({ body: '<html>hi</html>', status: 200 })
    );
    const capture = {};
    await createCapturingFetch(capture)(URL);

    expect(capture.buffer.toString()).toBe('<html>hi</html>');
    expect(capture.status).toBe(200);
    expect(capture.contentType).toBe('text/html');
    expect(capture.finalUrl).toBe(URL);
  });

  it('returns an unfurl-compatible response object backed by the captured buffer', async () => {
    fetch.mockResolvedValueOnce(makeRes({ body: 'payload', status: 404 }));
    const capture = {};
    const res = await createCapturingFetch(capture)(URL);

    expect(res.status).toBe(404);
    expect((await res.arrayBuffer()).toString()).toBe('payload');
    expect(res.headers.get('content-type')).toBe('text/html');
  });
});
