jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const unshorten = require('../unshorten');
const ResolveError = require('../ResolveError');
const http = require('http');

const URL = 'http://example.com/';

const makeRes = ({ status = 200, location = null } = {}) => ({
  body: { destroy: jest.fn() },
  status,
  headers: {
    get: header => (header.toLowerCase() === 'location' ? location : null),
  },
});

describe('unshorten', () => {
  beforeEach(() => fetch.mockReset());

  it('cancels an unfinished GET body at the socket and still follows its redirect', async () => {
    fetch.mockImplementation(jest.requireActual('node-fetch/lib/index.js'));
    let signalBodyClosed;
    const bodyClosed = new Promise(resolve => {
      signalBodyClosed = resolve;
    });
    const sockets = new Set();
    const server = http.createServer((req, res) => {
      if (req.url === '/target') {
        res.end();
      } else if (req.method === 'HEAD') {
        res.writeHead(405);
        res.end();
      } else {
        res.writeHead(302, { Location: '/target' });
        res.write('unfinished body');
        res.on('close', signalBodyClosed);
        // Deliberately never end: draining this body cannot finish.
      }
    });
    server.on('connection', socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    let timer;
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const base = `http://127.0.0.1:${server.address().port}`;
      expect(await unshorten(base)).toEqual({
        url: `${base}/target`,
        status: 200,
      });
      await Promise.race([
        bodyClosed,
        new Promise((resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error('GET socket was not closed')),
            1000
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      sockets.forEach(socket => socket.destroy());
      await new Promise(resolve => server.close(resolve));
    }
  });

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
    const getResponse = makeRes({ status: 301, location: 'http://target/' });
    fetch
      .mockResolvedValueOnce(makeRes({ status: 405 }))
      .mockResolvedValueOnce(getResponse)
      .mockResolvedValueOnce(makeRes({ status: 200 }));
    const result = await unshorten(URL);
    expect(result).toEqual({ url: 'http://target/', status: 200 });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0][1].method).toBe('HEAD');
    expect(fetch.mock.calls[1][1].method).toBe('GET');
    expect(getResponse.body.destroy).toHaveBeenCalledTimes(1);
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

describe('Facebook outbound links', () => {
  beforeEach(() => fetch.mockReset());

  it('continues from l.php target without requesting Facebook', async () => {
    fetch.mockResolvedValueOnce(makeRes({ status: 200 }));
    expect(
      await unshorten(
        'https://lm.facebook.com/l.php?u=https%3A%2F%2Fwww.storm.mg%2Flifestyle%2F480609&h=AT2'
      )
    ).toEqual({ url: 'https://www.storm.mg/lifestyle/480609', status: 200 });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://www.storm.mg/lifestyle/480609',
    ]);
  });

  it('unwraps flx/warn and a double-encoded u', async () => {
    fetch.mockResolvedValue(makeRes({ status: 200 }));
    expect(
      (
        await unshorten(
          'https://m.facebook.com/flx/warn/?u=http%3A%2F%2Fldp.ink%2F6o1Gt&h=AU'
        )
      ).url
    ).toBe('http://ldp.ink/6o1Gt');
    expect(
      (
        await unshorten(
          'https://l.facebook.com/l.php?u=http%253A%252F%252Fexample.org%252Fa.html'
        )
      ).url
    ).toBe('http://example.org/a.html');
  });

  it('unwraps an outbound link reached through a shortener and login wall', async () => {
    const warn =
      'https://www.facebook.com/flx/warn/?u=https%3A%2F%2Flc.cx%2FTuF43-&h=AU';
    fetch
      .mockResolvedValueOnce(
        makeRes({
          status: 302,
          location: 'https://facebook.com/l.php?u=https://lc.cx/TuF43-',
        })
      )
      .mockResolvedValueOnce(makeRes({ status: 301, location: 'http://news/' }))
      .mockResolvedValueOnce(makeRes({ status: 200 }));
    expect(await unshorten('https://bit.ly/x')).toEqual({
      url: 'http://news/',
      status: 200,
    });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      'https://bit.ly/x',
      'https://lc.cx/TuF43-',
      'http://news/',
    ]);

    fetch.mockReset().mockResolvedValueOnce(makeRes({ status: 200 }));
    expect(
      (
        await unshorten(
          `https://www.facebook.com/login/?next=${encodeURIComponent(warn)}`
        )
      ).url
    ).toBe('https://lc.cx/TuF43-');
  });

  it('keeps a wrapper whose u is missing or not http(s)', async () => {
    fetch.mockResolvedValue(makeRes({ status: 200 }));
    for (const url of [
      'https://www.facebook.com/l.php',
      'https://www.facebook.com/l.php?u=javascript%3Aalert(1)',
    ]) {
      expect((await unshorten(url)).url).toBe(url);
    }
  });
});

describe('Facebook login walls', () => {
  beforeEach(() => fetch.mockReset());

  it('stops at the first login wall instead of following nested ones', async () => {
    const login =
      'https://www.fb.watch/login/?next=https%3A%2F%2Ffb.watch%2Fe1Z_TwovkP%2F';
    fetch.mockResolvedValue(makeRes({ status: 302, location: login }));
    expect(await unshorten('https://fb.watch/e1Z_TwovkP/')).toEqual({
      url: login,
      status: 302,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe('intermediate mapped failures', () => {
  it.each([
    ['FetchError', 'network timeout at: http://target/'],
    ['Error', 'reason: socket hang up'],
    ['Error', 'reason: connect ECONNREFUSED'],
    ['Error', "reason: Hostname/IP doesn't match certificate's altnames"],
  ])('retains the known target on %s: %s', async (name, message) => {
    const error = new Error(message);
    error.name = name;
    fetch
      .mockReset()
      .mockResolvedValueOnce(
        makeRes({ status: 302, location: 'http://target/' })
      )
      .mockRejectedValueOnce(error);
    expect(await unshorten(URL)).toEqual({
      url: 'http://target/',
      status: 302,
    });
    expect(fetch.mock.calls[1][1].signal.aborted).toBe(true);
  });
});
