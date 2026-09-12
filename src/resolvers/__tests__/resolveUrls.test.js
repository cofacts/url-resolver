jest.mock('../../lib/unshorten');
jest.mock('../../lib/normalize');
jest.mock('../../lib/parseMeta');
jest.mock('../../lib/scrape');
jest.mock('../../lib/extractStatic', () => jest.fn());

const ScrapeResult = require('../../lib/ScrapeResult');
const unshorten = require('../../lib/unshorten');
const normalize = require('../../lib/normalize');
const parseMeta = require('../../lib/parseMeta');

const scrape = require('../../lib/scrape');
const { resolveUrls } = require('../resolveUrls');
const ResolveError = require('../../lib/ResolveError');
const {
  ResolveError: ResolveErrorEnum,
  // eslint-disable-next-line node/no-unpublished-require
} = require('../../lib/resolve_error_pb');

describe('resolveUrls', () => {
  afterEach(() => {
    normalize.mockClear();
    unshorten.mockClear();
    parseMeta.mockClear();
    scrape.mockClear();
  });

  it('should resolve multiple valid urls', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    parseMeta.mockImplementation(url => Promise.resolve(scrape.getResult(url)));

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
        expect(parseMeta).toHaveBeenCalledTimes(urls.length);
        expect(scrape).toHaveBeenCalledTimes(0); // No need to scrape
        expect(call.write).toHaveBeenCalledTimes(urls.length);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('should resolve multiple urls with some invalid ones', done => {
    const badUrl = 'bad youtube url';
    const customErrorMsg = 'some error';

    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({
      url: `unshortened ${url}`,
      status: 200,
    }));
    parseMeta.mockImplementation(url => {
      if (url === `unshortened ${badUrl}`) {
        return Promise.reject(new Error(customErrorMsg));
      }
      return Promise.resolve(scrape.getResult(url));
    });

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
        expect(parseMeta).toHaveBeenCalledTimes(urls.length);
        expect(scrape).toHaveBeenCalledTimes(0); // No need to scrape
        expect(call.write).toHaveBeenCalledTimes(urls.length);

        // Expect:
        // - "error" key exist with "undefined", since it is not a ResolveError
        // - canonical URL is still updated by unshortened
        expect(
          call.write.mock.calls.find(
            ([scrapResult]) => scrapResult.url === badUrl
          )
        ).toMatchInlineSnapshot(`
Array [
  Object {
    "canonical": "unshortened bad youtube url",
    "error": undefined,
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

  it('should resolve multiple urls with some invalid ones and error type ResolveError', done => {
    const badUrl = 'bad youtube url';
    normalize.mockImplementation(url => `normalized ${url}`);
    unshorten.mockImplementation(async url => {
      if (url === `normalized ${badUrl}`) {
        throw new ResolveError(ResolveErrorEnum.NOT_REACHABLE);
      }

      return { url, status: 200 };
    });
    parseMeta.mockImplementation(url => Promise.resolve(scrape.getResult(url)));

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
        expect(parseMeta).toHaveBeenCalledTimes(
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

    // parseMeta returning incomplete result, but with canonical
    parseMeta.mockImplementation(() =>
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
        expect(parseMeta).toHaveBeenCalledTimes(urls.length);
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
        // parseMeta mock
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

  it('caps concurrent scrape() at SCRAPE_MAX_CONCURRENCY without limiting parseMeta', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));

    let parseMetaActive = 0;
    let parseMetaMax = 0;
    parseMeta.mockImplementation(async () => {
      parseMetaActive++;
      if (parseMetaActive > parseMetaMax) parseMetaMax = parseMetaActive;
      await new Promise(r => setImmediate(r));
      parseMetaActive--;
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
        expect(parseMetaMax).toBe(urls.length);
        expect(scrape).toHaveBeenCalledTimes(urls.length);
        expect(call.write).toHaveBeenCalledTimes(urls.length);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('trusts extractStatic GET status over unshorten HEAD status', done => {
    // Site that rejects HEAD with 403 but responds 200 to GET (common with
    // Cloudflare / WordPress / CDNs). Before the fix, this was misclassified
    // as terminal and skipped puppeteer + extractStatic entirely.
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 403 }));
    parseMeta.mockImplementation(() =>
      Promise.resolve(
        new ScrapeResult({ canonical: 'canonical from parseMeta' })
      )
    );
    // eslint-disable-next-line global-require
    const extractStatic = require('../../lib/extractStatic');
    extractStatic.mockImplementation(
      async url =>
        new ScrapeResult({
          canonical: url,
          title: 'title from static',
          summary: 'summary from static',
          topImageUrl: 'https://cdn/cover.jpg',
          status: 200,
        })
    );

    const call = {
      request: { urls: ['head-403-get-200'] },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(extractStatic).toHaveBeenCalledWith('head-403-get-200');
        // Static result completed the fetch: no puppeteer fallback.
        expect(scrape).toHaveBeenCalledTimes(0);
        const written = call.write.mock.calls[0][0];
        expect(written.title).toBe('title from static');
        expect(written.summary).toBe('summary from static');
        expect(written.status).toBe(200);
        expect(written.successfully_resolved).toBe(true);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('skips puppeteer when extractStatic GET confirms terminal status', done => {
    // HEAD reports 200 but the actual GET returns a terminal 500. Puppeteer
    // cannot recover from a server-error response, so skip the render.
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    parseMeta.mockImplementation(() =>
      Promise.resolve(
        new ScrapeResult({ canonical: 'canonical from parseMeta' })
      )
    );
    // eslint-disable-next-line global-require
    const extractStatic = require('../../lib/extractStatic');
    extractStatic.mockImplementation(
      async url => new ScrapeResult({ canonical: url, status: 500 })
    );

    const call = {
      request: { urls: ['get-500'] },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(extractStatic).toHaveBeenCalledWith('get-500');
        expect(scrape).toHaveBeenCalledTimes(0);
        const written = call.write.mock.calls[0][0];
        expect(written.status).toBe(500);
        expect(written.successfully_resolved).toBe(true);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('falls through to puppeteer when extractStatic throws (HEAD status ignored)', done => {
    // HEAD 403 must not short-circuit puppeteer when GET could not
    // confirm the terminal status (extractStatic threw a network error).
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 403 }));
    parseMeta.mockImplementation(() =>
      Promise.resolve(
        new ScrapeResult({ canonical: 'canonical from parseMeta' })
      )
    );
    // eslint-disable-next-line global-require
    const extractStatic = require('../../lib/extractStatic');
    extractStatic.mockImplementation(async () => {
      throw new ResolveError(ResolveErrorEnum.NOT_REACHABLE);
    });
    scrape.mockImplementation(async url => scrape.getResult(url));

    const call = {
      request: { urls: ['head-403-static-throws'] },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(extractStatic).toHaveBeenCalledWith('head-403-static-throws');
        expect(scrape).toHaveBeenCalledTimes(1);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('falls through to puppeteer when extractStatic returns null (non-HTML, HEAD status ignored)', done => {
    // HEAD 403 must not short-circuit puppeteer when GET responded but
    // extractStatic returned null (non-HTML content type). We still do
    // not know whether the URL is renderable.
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 403 }));
    parseMeta.mockImplementation(() =>
      Promise.resolve(
        new ScrapeResult({ canonical: 'canonical from parseMeta' })
      )
    );
    // eslint-disable-next-line global-require
    const extractStatic = require('../../lib/extractStatic');
    extractStatic.mockImplementation(async () => null);
    scrape.mockImplementation(async url => scrape.getResult(url));

    const call = {
      request: { urls: ['head-403-static-null'] },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(extractStatic).toHaveBeenCalledWith('head-403-static-null');
        expect(scrape).toHaveBeenCalledTimes(1);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('routes platform URLs (Threads) straight to extractStatic, skipping parseMeta', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    // eslint-disable-next-line global-require
    const extractStatic = require('../../lib/extractStatic');
    extractStatic.mockImplementation(
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
        expect(parseMeta).toHaveBeenCalledTimes(0);
        expect(extractStatic).toHaveBeenCalledTimes(1);
        expect(scrape).toHaveBeenCalledTimes(0);
        const written = call.write.mock.calls[0][0];
        expect(written.title).toBe('颱風今日動態');
        expect(written.successfully_resolved).toBe(true);
        done();
      })
      .catch(err => done.fail(err));
  });
});
