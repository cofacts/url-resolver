jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const fetchAndParseMeta = require('../fetchAndParseMeta');

const POST = 'https://www.threads.com/@user/post/CODE';
function response(url, html, status = 200, contentType = 'text/html') {
  return {
    url,
    status,
    arrayBuffer: async () => Buffer.from(html),
    headers: {
      get: name => (name.toLowerCase() === 'content-type' ? contentType : null),
    },
  };
}

describe('shared metadata fetch', () => {
  beforeEach(() => fetch.mockReset());

  it('keeps legacy charset decoding in unfurl for Threads', async () => {
    const html = Buffer.concat([
      Buffer.from('<meta property="og:title" content="'),
      Buffer.from([0xa4, 0xa4, 0xa4, 0xe5]),
      Buffer.from('">'),
    ]);
    fetch.mockResolvedValueOnce(
      response(POST, html, 200, 'text/html; charset=big5')
    );
    expect((await fetchAndParseMeta(POST)).title).toBe('中文');
  });

  it('parses Threads using unfurl and preserves the response URL and status', async () => {
    fetch.mockResolvedValueOnce(
      response(
        POST,
        '<meta property="og:url" content="https://www.threads.com/"><meta property="og:title" content="Name (@user) on Threads"><meta property="og:description" content="Post body"><meta property="og:image" content="https://example.com/image.jpg">'
      )
    );
    const result = await fetchAndParseMeta(POST);
    expect(result.canonical).toBe(POST);
    expect(result.title).toBe('Name (@user) on Threads');
    expect(result.summary).toBe('Post body');
    expect(result.status).toBe(200);
    expect(result.isIncomplete).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers['User-Agent']).toMatch(/CofactsBot/);
  });

  it('maps a deleted-post redirect to 410 even if the response is not HTML', async () => {
    fetch.mockResolvedValueOnce(
      response(
        'https://www.threads.com/?error=invalid_post',
        '',
        200,
        'application/json'
      )
    );
    const result = await fetchAndParseMeta(POST);
    expect(result.status).toBe(410);
    expect(result.title).toBeUndefined();
  });

  it('preserves an actual Threads 410 despite unfurl rejecting the HTTP status', async () => {
    fetch.mockResolvedValueOnce(response(POST, '', 410));
    expect((await fetchAndParseMeta(POST)).status).toBe(410);
  });

  it('filters login metadata but does not classify other error values as gone', async () => {
    fetch.mockResolvedValueOnce(
      response(
        'https://www.threads.com/?error=rate_limited',
        '<meta property="og:title" content="Threads • Log in"><meta property="og:description" content="Join Threads to share ideas"><meta property="og:image" content="https://example.com/login.jpg">'
      )
    );
    const result = await fetchAndParseMeta(POST);
    expect(result.status).toBe(200);
    expect(result.title).toBeUndefined();
    expect(result.summary).toBeUndefined();
    expect(result.topImageUrl).toBeUndefined();
    expect(result.isIncomplete).toBe(true);
  });

  it('still rejects a non-Threads 410 or a Threads 403 for browser fallback', async () => {
    fetch.mockResolvedValueOnce(response('https://example.com/', '', 410));
    await expect(fetchAndParseMeta('https://example.com/')).rejects.toThrow();
    fetch.mockResolvedValueOnce(response(POST, '', 403));
    await expect(fetchAndParseMeta(POST)).rejects.toThrow();
  });
});
