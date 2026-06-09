jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const unshorten = require('../unshorten');
const ResolveError = require('../ResolveError');

const URL = 'http://example.com/';

const makeRes = ({ status = 200, location = null } = {}) => ({
  status,
  headers: {
    get: header => (header.toLowerCase() === 'location' ? location : null),
  },
});

describe('unshorten', () => {
  beforeEach(() => fetch.mockReset());

  it('returns original URL and status when there is no redirect', async () => {
    fetch.mockResolvedValueOnce(makeRes({ status: 200 }));
    expect(await unshorten(URL)).toEqual({ url: URL, status: 200 });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].method).toBe('HEAD');
    expect(fetch.mock.calls[0][1].headers['User-Agent']).toMatch(/CofactsBot/);
  });

  it('follows a single Location redirect', async () => {
    fetch
      .mockResolvedValueOnce(
        makeRes({ status: 301, location: 'http://target/' })
      )
      .mockResolvedValueOnce(makeRes({ status: 200 }));
    expect(await unshorten(URL)).toEqual({
      url: 'http://target/',
      status: 200,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('follows multi-hop redirect chains', async () => {
    fetch
      .mockResolvedValueOnce(makeRes({ status: 301, location: 'http://hop1/' }))
      .mockResolvedValueOnce(makeRes({ status: 302, location: 'http://hop2/' }))
      .mockResolvedValueOnce(
        makeRes({ status: 302, location: 'http://final/' })
      )
      .mockResolvedValueOnce(makeRes({ status: 200 }));
    expect(await unshorten(URL)).toEqual({
      url: 'http://final/',
      status: 200,
    });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('resolves relative Location against current URL', async () => {
    fetch
      .mockResolvedValueOnce(makeRes({ status: 301, location: '/path' }))
      .mockResolvedValueOnce(makeRes({ status: 200 }));
    await unshorten('http://example.com/foo');
    expect(fetch.mock.calls[1][0]).toBe('http://example.com/path');
  });

  it('falls back to GET when HEAD returns 405', async () => {
    fetch
      .mockResolvedValueOnce(makeRes({ status: 405 }))
      .mockResolvedValueOnce(
        makeRes({ status: 301, location: 'http://target/' })
      )
      .mockResolvedValueOnce(makeRes({ status: 200 }));
    const result = await unshorten(URL);
    expect(result).toEqual({ url: 'http://target/', status: 200 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][1].method).toBe('HEAD');
    expect(fetch.mock.calls[1][1].method).toBe('GET');
  });

  it('falls back to GET when HEAD returns 501', async () => {
    fetch
      .mockResolvedValueOnce(makeRes({ status: 501 }))
      .mockResolvedValueOnce(makeRes({ status: 200 }));
    const result = await unshorten(URL);
    expect(result).toEqual({ url: URL, status: 200 });
    expect(fetch.mock.calls[1][1].method).toBe('GET');
  });

  it('stops following redirects on cycles', async () => {
    fetch
      .mockResolvedValueOnce(makeRes({ status: 301, location: 'http://a/' }))
      .mockResolvedValueOnce(makeRes({ status: 301, location: URL }));
    const result = await unshorten(URL);
    expect(result.url).toBe(URL);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('stops at MAX_HOPS', async () => {
    let counter = 0;
    fetch.mockImplementation(async () =>
      makeRes({
        status: 301,
        location: `http://hop-${counter++}/`,
      })
    );
    const result = await unshorten(URL);
    expect(fetch).toHaveBeenCalledTimes(unshorten.MAX_HOPS);
    expect(result.status).toBe(301);
  });

  it('returns status 0 when first fetch errors with non-mapped error', async () => {
    fetch.mockRejectedValueOnce(new Error('some other error'));
    expect(await unshorten(URL)).toEqual({ url: URL, status: 0 });
  });

  it('throws ResolveError on network timeout', async () => {
    const err = new Error('network timeout at:');
    err.name = 'FetchError';
    fetch.mockRejectedValueOnce(err);
    await expect(unshorten(URL)).rejects.toThrow(ResolveError);
  });

  it('throws ResolveError on socket hang up', async () => {
    fetch.mockRejectedValueOnce(new Error('reason: socket hang up'));
    await expect(unshorten(URL)).rejects.toThrow(ResolveError);
  });

  it('throws ResolveError on ECONNREFUSED', async () => {
    fetch.mockRejectedValueOnce(new Error('reason: connect ECONNREFUSED'));
    await expect(unshorten(URL)).rejects.toThrow(ResolveError);
  });

  it('throws ResolveError on certificate altname mismatch', async () => {
    fetch.mockRejectedValueOnce(
      new Error("reason: Hostname/IP doesn't match certificate's altnames")
    );
    await expect(unshorten(URL)).rejects.toThrow(ResolveError);
  });

  it('returns last URL on intermediate non-mapped error after some hops', async () => {
    fetch
      .mockResolvedValueOnce(makeRes({ status: 301, location: 'http://hop1/' }))
      .mockRejectedValueOnce(new Error('some other error'));
    const result = await unshorten(URL);
    expect(result).toEqual({ url: 'http://hop1/', status: 301 });
  });
});
