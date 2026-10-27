jest.mock('../../lib/resolveFacebookUrl', () => ({
  ...jest.requireActual('../../lib/resolveFacebookUrl'),
  resolveFacebookUrl: jest.fn(),
}));
const { resolveFacebookUrl } = require('../../lib/resolveFacebookUrl');
jest.mock('../../lib/unshorten');
jest.mock('../../lib/normalize');
jest.mock('../../lib/fetchAndParseMeta');
jest.mock('../../lib/scrape');

const ScrapeResult = require('../../lib/ScrapeResult');
const unshorten = require('../../lib/unshorten');
const normalize = require('../../lib/normalize');
const fetchAndParseMeta = require('../../lib/fetchAndParseMeta');

const scrape = require('../../lib/scrape');
const { resolveUrls } = require('../resolveUrls');
const ResolveError = require('../../lib/ResolveError');
const {
  ResolveError: ResolveErrorEnum,
  // eslint-disable-next-line node/no-unpublished-require
} = require('../../lib/resolve_error_pb');

describe('resolveUrls', () => {
  it('reports the browser error, not UNKNOWN_UNFURL_ERROR, when both stages fail', async () => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    fetchAndParseMeta.mockRejectedValue(
      new ResolveError(ResolveErrorEnum.UNKNOWN_UNFURL_ERROR)
    );
    scrape.mockRejectedValue(
      new ResolveError(ResolveErrorEnum.UNKNOWN_SCRAPE_ERROR)
    );
    const call = {
      request: { urls: ['https://example.test/'] },
      write: jest.fn(),
      end: jest.fn(),
    };
    await resolveUrls(call);
    expect(call.write.mock.calls[0][0].error).toBe(
      ResolveErrorEnum.UNKNOWN_SCRAPE_ERROR
    );
    expect(call.write.mock.calls[0][0].successfully_resolved).toBeUndefined();
    expect(scrape).toHaveBeenCalledTimes(1);
  });
  afterEach(() => {
    normalize.mockClear();
    unshorten.mockClear();
    fetchAndParseMeta.mockClear();
    scrape.mockClear();
  });

  it('should resolve multiple valid urls', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    fetchAndParseMeta.mockImplementation(async url => scrape.getResult(url));

    const urls = [
      'some url with complete meta',
      'another url with complete meta',
      'the other url with complete meta',
    ];
    const call = {
      request: {
        urls,
      },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(normalize).toHaveBeenCalledTimes(urls.length);
        expect(unshorten).toHaveBeenCalledTimes(urls.length);
        expect(fetchAndParseMeta).toHaveBeenCalledTimes(urls.length);
        expect(scrape).toHaveBeenCalledTimes(0); // No need to scrape
        expect(call.write).toHaveBeenCalledTimes(urls.length);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('falls back to puppeteer when fetchAndParseMeta rejects with a plain error', done => {
    // A metadata-fetch failure (bad status, wrong content-type, network
    // error) can be a bot-detection artifact a real browser gets past, so
    // this must NOT skip puppeteer — see the resolveGeneric comment.
    const badUrl = 'bad youtube url';
    const customErrorMsg = 'some error';

    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({
      url: `unshortened ${url}`,
      status: 200,
    }));
    fetchAndParseMeta.mockImplementation(url => {
      if (url === `unshortened ${badUrl}`) {
        return Promise.reject(new Error(customErrorMsg));
      }
      return Promise.resolve(scrape.getResult(url));
    });
    scrape.mockImplementation(async url => scrape.getResult(url));

    const urls = ['some youtube url', badUrl, 'the other youtube url'];
    const call = {
      request: {
        urls,
      },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(normalize).toHaveBeenCalledTimes(urls.length);
        expect(unshorten).toHaveBeenCalledTimes(urls.length);
        expect(fetchAndParseMeta).toHaveBeenCalledTimes(urls.length);
        // Only the failed URL needs the puppeteer fallback.
        expect(scrape).toHaveBeenCalledTimes(1);
        expect(scrape).toHaveBeenCalledWith(`unshortened ${badUrl}`);
        expect(call.write).toHaveBeenCalledTimes(urls.length);

        // The URL still resolves successfully via puppeteer, despite the
        // metadata-fetch failure.
        expect(
          call.write.mock.calls.find(
            ([scrapResult]) => scrapResult.url === badUrl
          )
        ).toMatchInlineSnapshot(`
Array [
  Object {
    "canonical": "unshortened bad youtube url",
    "html": undefined,
    "status": undefined,
    "successfully_resolved": true,
    "summary": "s",
    "title": "t",
    "topImageUrl": "t",
    "top_image_url": "t",
    "url": "bad youtube url",
  },
]
`);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('should resolve multiple urls with some invalid ones and error type ResolveError', done => {
    const badUrl = 'bad youtube url';
    normalize.mockImplementation(url => `normalized ${url}`);
    unshorten.mockImplementation(async url => {
      if (url === `normalized ${badUrl}`) {
        throw new ResolveError(ResolveErrorEnum.NOT_REACHABLE);
      }

      return { url, status: 200 };
    });
    fetchAndParseMeta.mockImplementation(url =>
      Promise.resolve(scrape.getResult(url))
    );

    const urls = ['some youtube url', badUrl, 'the other youtube url'];
    const call = {
      request: {
        urls,
      },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(normalize).toHaveBeenCalledTimes(urls.length);
        expect(unshorten).toHaveBeenCalledTimes(urls.length);
        expect(fetchAndParseMeta).toHaveBeenCalledTimes(
          urls.length - 1 /* skips not reachable error */
        );
        expect(call.write).toHaveBeenCalledTimes(urls.length);
        expect(scrape).toHaveBeenCalledTimes(0); // No need to scrape

        // Expect erros populated with ResolveErrorEnum.NOT_REACHABLE,
        // while canonical still showing normalized URL
        // Expect:
        // - "error" key exist with ResolveErrorEnum.NOT_REACHABLE
        // - canonical URL is still updated by normalize()
        expect(
          call.write.mock.calls.find(
            ([scrapResult]) => scrapResult.url === badUrl
          )
        ).toMatchInlineSnapshot(`
Array [
  Object {
    "canonical": "normalized bad youtube url",
    "error": 3,
    "html": undefined,
    "status": undefined,
    "summary": undefined,
    "title": undefined,
    "topImageUrl": undefined,
    "url": "bad youtube url",
  },
]
`);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('should resolve multiple urls with incomplete meta', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));

    // fetchAndParseMeta returning an incomplete result, but with canonical
    fetchAndParseMeta.mockImplementation(() =>
      Promise.resolve(
        new ScrapeResult({ canonical: 'canonical from parseMeta' })
      )
    );

    const emptySummaryUrl = 'url that has no summary';
    const scrapFailUrl = 'url that triggers scrape fail';
    scrape.mockImplementation(async url => {
      switch (url) {
        case emptySummaryUrl:
          return { ...scrape.getResult(url), summary: undefined };
        case scrapFailUrl:
          throw new ResolveError(ResolveErrorEnum.UNKNOWN_SCRAPE_ERROR);
        default:
          return scrape.getResult(url);
      }
    });

    const urls = ['some url', emptySummaryUrl, scrapFailUrl];
    const call = {
      request: {
        urls,
      },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(normalize).toHaveBeenCalledTimes(urls.length);
        expect(unshorten).toHaveBeenCalledTimes(urls.length);
        expect(fetchAndParseMeta).toHaveBeenCalledTimes(urls.length);
        expect(scrape).toHaveBeenCalledTimes(urls.length);
        expect(call.write).toHaveBeenCalledTimes(urls.length);

        expect(
          call.write.mock.calls.find(
            ([scrapResult]) => scrapResult.url === emptySummaryUrl
          )
        ).toMatchInlineSnapshot(`
Array [
  Object {
    "canonical": "canonical from parseMeta",
    "html": undefined,
    "status": undefined,
    "successfully_resolved": true,
    "summary": undefined,
    "title": "t",
    "topImageUrl": "t",
    "top_image_url": "t",
    "url": "url that has no summary",
  },
]
`);

        // Expects failed scrapResult still contain data fetched from
        // fetchAndParseMeta mock
        expect(
          call.write.mock.calls.find(
            ([scrapResult]) => scrapResult.url === scrapFailUrl
          )
        ).toMatchInlineSnapshot(`
Array [
  Object {
    "canonical": "canonical from parseMeta",
    "error": 6,
    "html": undefined,
    "status": undefined,
    "summary": undefined,
    "title": undefined,
    "topImageUrl": undefined,
    "url": "url that triggers scrape fail",
  },
]
`);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('caps concurrent scrape() at SCRAPE_MAX_CONCURRENCY without limiting fetchAndParseMeta', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));

    let fetchActive = 0;
    let fetchMax = 0;
    fetchAndParseMeta.mockImplementation(async () => {
      fetchActive++;
      if (fetchActive > fetchMax) fetchMax = fetchActive;
      await new Promise(r => setImmediate(r));
      fetchActive--;
      return new ScrapeResult({ canonical: 'partial' });
    });

    let scrapActive = 0;
    let scrapMax = 0;
    scrape.mockImplementation(async url => {
      scrapActive++;
      if (scrapActive > scrapMax) scrapMax = scrapActive;
      await new Promise(r => setImmediate(r));
      await new Promise(r => setImmediate(r));
      scrapActive--;
      return scrape.getResult(url);
    });

    const urls = ['u1', 'u2', 'u3', 'u4', 'u5'];
    const call = {
      request: { urls },
      write: jest.fn(),
      end: jest.fn(),
    };

    resolveUrls(call)
      .then(() => {
        expect(scrapMax).toBe(3);
        expect(fetchMax).toBe(urls.length);
        expect(scrape).toHaveBeenCalledTimes(urls.length);
        expect(call.write).toHaveBeenCalledTimes(urls.length);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('falls through to puppeteer when the generic parseMeta result is incomplete', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    fetchAndParseMeta.mockImplementation(
      async () => new ScrapeResult({ canonical: 'canonical from parseMeta' })
    );
    scrape.mockImplementation(async url => scrape.getResult(url));

    const call = {
      request: { urls: ['generic-incomplete'] },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(scrape).toHaveBeenCalledTimes(1);
        const written = call.write.mock.calls[0][0];
        expect(written.successfully_resolved).toBe(true);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('uses the shared metadata path for Threads', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    fetchAndParseMeta.mockImplementation(
      async url =>
        new ScrapeResult({
          canonical: url,
          title: '颱風今日動態',
          summary: '颱風今日動態：侵襲本島機率不足一成',
          topImageUrl: 'https://cdn.example/img.jpg',
          status: 200,
        })
    );

    const call = {
      request: {
        urls: ['https://www.threads.com/@nownews/post/DW72xFwE7p6'],
      },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(fetchAndParseMeta).toHaveBeenCalledTimes(1);
        expect(scrape).toHaveBeenCalledTimes(0);
        const written = call.write.mock.calls[0][0];
        expect(written.title).toBe('颱風今日動態');
        expect(written.successfully_resolved).toBe(true);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('skips puppeteer only when platform extraction reports 410 Gone', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    fetchAndParseMeta.mockImplementation(
      async url => new ScrapeResult({ canonical: url, status: 410 })
    );

    const call = {
      request: { urls: ['https://www.threads.com/@user/post/CODE'] },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(scrape).toHaveBeenCalledTimes(0);
        const written = call.write.mock.calls[0][0];
        expect(written.status).toBe(410);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('falls through to puppeteer on 403/5xx from platform extraction', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    fetchAndParseMeta.mockImplementation(
      // A CofactsBot-blocked or rate-limited GET (403/5xx) is not terminal:
      // a real browser may still succeed, so puppeteer must be tried.
      async url => new ScrapeResult({ canonical: url, status: 403 })
    );
    scrape.mockImplementation(async url => scrape.getResult(url));

    const call = {
      request: { urls: ['https://www.threads.com/@user/post/CODE'] },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(scrape).toHaveBeenCalledTimes(1);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('falls through to puppeteer when platform extraction throws (status unknown)', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    fetchAndParseMeta.mockImplementation(async () => {
      throw new ResolveError(ResolveErrorEnum.NOT_REACHABLE);
    });
    scrape.mockImplementation(async url => scrape.getResult(url));

    const call = {
      request: { urls: ['https://www.threads.com/@user/post/CODE2'] },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(scrape).toHaveBeenCalledTimes(1);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('falls through to puppeteer on filtered Threads login metadata', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    // Filtered metadata is incomplete and must allow browser fallback.
    fetchAndParseMeta.mockImplementation(
      async url =>
        new ScrapeResult({
          canonical: url,
          status: 200,
          title: undefined,
          summary: undefined,
          topImageUrl: undefined,
        })
    );

    scrape.mockImplementation(async url => scrape.getResult(url));
    const call = {
      request: { urls: ['https://www.threads.com/@user/post/CODE3'] },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(scrape).toHaveBeenCalledTimes(1);
        done();
      })
      .catch(err => done.fail(err));
  });
});

describe('target resolution through resolveUrls', () => {
  const share = 'https://www.facebook.com/share/example/';
  const login =
    'https://www.facebook.com/login/?next=%2Fphoto.php%3Ffbid%3D123';
  const post = 'https://www.facebook.com/example/posts/456';
  const makeCall = url => ({
    request: { urls: [url] },
    write: jest.fn(),
    end: jest.fn(),
  });

  beforeEach(() => {
    normalize.mockReset().mockImplementation(url => url);
    unshorten.mockReset();
    resolveFacebookUrl.mockReset();
    fetchAndParseMeta.mockReset().mockImplementation(
      async url =>
        new ScrapeResult({
          canonical: url,
          title: 'title',
          summary: 'summary',
          topImageUrl: 'image',
        })
    );
    scrape.mockReset().mockImplementation(async url => scrape.getResult(url));
  });

  it.each([share, 'https://bit.ly/example', 'https://fb.me/example'])(
    'recovers a Facebook target reached through %s',
    async input => {
      const normalized = input + '?normalized=1';
      normalize.mockReturnValue(normalized);
      unshorten.mockResolvedValue({ url: login, status: 200 });
      resolveFacebookUrl.mockResolvedValue(post);
      const call = makeCall(input);
      await resolveUrls(call);
      expect(unshorten).toHaveBeenCalledTimes(1);
      expect(unshorten).toHaveBeenCalledWith(normalized);
      expect(resolveFacebookUrl).toHaveBeenCalledWith(login, normalized);
      expect(fetchAndParseMeta).toHaveBeenCalledWith(post);
      expect(scrape).not.toHaveBeenCalled();
      expect(call.write).toHaveBeenCalledWith(
        expect.objectContaining({
          url: input,
          canonical: post,
          successfully_resolved: true,
        })
      );
    }
  );

  it('uses non-Facebook redirect targets without Facebook recovery', async () => {
    const target = 'https://www.threads.com/@user/post/CODE';
    unshorten.mockResolvedValue({ url: target, status: 200 });
    const call = makeCall('https://example.com/short');
    await resolveUrls(call);
    expect(resolveFacebookUrl).not.toHaveBeenCalled();
    expect(fetchAndParseMeta).toHaveBeenCalledWith(target);
    expect(call.write).toHaveBeenCalledWith(
      expect.objectContaining({
        canonical: target,
        successfully_resolved: true,
      })
    );
  });

  it('continues with the original short URL when Facebook recovery returns it', async () => {
    const input = 'https://bit.ly/example';
    unshorten.mockResolvedValue({ url: login, status: 200 });
    resolveFacebookUrl.mockResolvedValue(input);
    const call = makeCall(input);
    await resolveUrls(call);
    expect(resolveFacebookUrl).toHaveBeenCalledWith(login, input);
    expect(fetchAndParseMeta).toHaveBeenCalledWith(input);
    expect(call.write).toHaveBeenCalledWith(
      expect.objectContaining({
        canonical: input,
        successfully_resolved: true,
      })
    );
  });

  it('reports NOT_REACHABLE for a failed non-Facebook redirect lookup', async () => {
    unshorten.mockRejectedValue(
      new ResolveError(ResolveErrorEnum.NOT_REACHABLE)
    );
    const call = makeCall('https://example.com/short');
    await resolveUrls(call);
    expect(call.write).toHaveBeenCalledWith(
      expect.objectContaining({
        error: ResolveErrorEnum.NOT_REACHABLE,
      })
    );
    expect(fetchAndParseMeta).not.toHaveBeenCalled();
    expect(scrape).not.toHaveBeenCalled();
    expect(resolveFacebookUrl).not.toHaveBeenCalled();
  });

  it('continues metadata and browser fallback for Facebook when unshorten fails', async () => {
    unshorten.mockRejectedValue(
      new ResolveError(ResolveErrorEnum.NOT_REACHABLE)
    );
    resolveFacebookUrl.mockResolvedValue(share);
    fetchAndParseMeta.mockResolvedValue(new ScrapeResult({ canonical: share }));
    const call = makeCall(share);
    await resolveUrls(call);
    expect(resolveFacebookUrl).toHaveBeenCalledWith(share, share);
    expect(fetchAndParseMeta).toHaveBeenCalledWith(share);
    expect(scrape).toHaveBeenCalledWith(share);
    expect(call.write).toHaveBeenCalledWith(
      expect.objectContaining({
        successfully_resolved: true,
      })
    );
  });
});
