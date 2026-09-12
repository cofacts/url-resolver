jest.mock('../../lib/unshorten');
jest.mock('../../lib/normalize');
jest.mock('../../lib/fetchAndParseMeta');
jest.mock('../../lib/scrape');
jest.mock('../../lib/extractStatic', () => ({
  extractStatic: jest.fn(),
  extractFromHtml: jest.fn(),
}));

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

// Every fetchAndParseMeta mock that resolves an *incomplete* ScrapeResult
// must also supply a page with a real buffer: resolveUrls reads
// `page.buffer.toString()` before handing off to extractFromHtml, mirroring
// the guarantee that a real fetchAndParseMeta success always carries the
// fetched bytes (see lib/capturingFetch.js).
function emptyPage(url) {
  return { buffer: Buffer.from(''), status: 200, finalUrl: url };
}

describe('resolveUrls', () => {
  afterEach(() => {
    normalize.mockClear();
    unshorten.mockClear();
    fetchAndParseMeta.mockClear();
    scrape.mockClear();
  });

  it('should resolve multiple valid urls', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    fetchAndParseMeta.mockImplementation(async url => ({
      result: scrape.getResult(url),
      page: emptyPage(url),
    }));

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
      return Promise.resolve({
        result: scrape.getResult(url),
        page: emptyPage(url),
      });
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
      Promise.resolve({
        result: scrape.getResult(url),
        page: emptyPage(url),
      })
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
    fetchAndParseMeta.mockImplementation(url =>
      Promise.resolve({
        result: new ScrapeResult({ canonical: 'canonical from parseMeta' }),
        page: emptyPage(url),
      })
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
    fetchAndParseMeta.mockImplementation(async url => {
      fetchActive++;
      if (fetchActive > fetchMax) fetchMax = fetchActive;
      await new Promise(r => setImmediate(r));
      fetchActive--;
      return {
        result: new ScrapeResult({ canonical: 'partial' }),
        page: emptyPage(url),
      };
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

  it('reuses the fetchAndParseMeta page bytes for the Readability fallback (no second fetch)', done => {
    // Single-fetch design: the generic path's static fallback runs on the
    // SAME bytes fetchAndParseMeta already retrieved, via extractFromHtml —
    // it never triggers a second network request.
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    const page = {
      buffer: Buffer.from('<html></html>'),
      status: 200,
      contentType: 'text/html',
      finalUrl: 'reused',
    };
    fetchAndParseMeta.mockImplementation(async () => ({
      result: new ScrapeResult({ canonical: 'canonical from parseMeta' }),
      page,
    }));
    // eslint-disable-next-line global-require
    const { extractFromHtml } = require('../../lib/extractStatic');
    extractFromHtml.mockImplementation(
      arg =>
        new ScrapeResult({
          canonical: arg.finalUrl,
          title: 'title from static',
          summary: 'summary from static',
          topImageUrl: 'https://cdn/cover.jpg',
          status: 200,
        })
    );

    const call = {
      request: { urls: ['generic-incomplete'] },
      write: jest.fn(),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(extractFromHtml).toHaveBeenCalledWith({
          html: '<html></html>',
          status: page.status,
          finalUrl: page.finalUrl,
        });
        expect(scrape).toHaveBeenCalledTimes(0);
        const written = call.write.mock.calls[0][0];
        expect(written.title).toBe('title from static');
        expect(written.summary).toBe('summary from static');
        expect(written.successfully_resolved).toBe(true);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('falls through to puppeteer when extractFromHtml cannot complete the result', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    fetchAndParseMeta.mockImplementation(async url => ({
      result: new ScrapeResult({ canonical: 'canonical from parseMeta' }),
      page: emptyPage(url),
    }));
    // eslint-disable-next-line global-require
    const { extractFromHtml } = require('../../lib/extractStatic');
    extractFromHtml.mockReturnValue(null);
    scrape.mockImplementation(async url => scrape.getResult(url));

    const call = {
      request: { urls: ['generic-still-incomplete'] },
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

  it('routes platform URLs (Threads) straight to extractStatic, skipping fetchAndParseMeta', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    // eslint-disable-next-line global-require
    const { extractStatic } = require('../../lib/extractStatic');
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
        expect(fetchAndParseMeta).toHaveBeenCalledTimes(0);
        expect(extractStatic).toHaveBeenCalledTimes(1);
        expect(scrape).toHaveBeenCalledTimes(0);
        const written = call.write.mock.calls[0][0];
        expect(written.title).toBe('颱風今日動態');
        expect(written.successfully_resolved).toBe(true);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('skips puppeteer when platform extraction confirms a terminal status', done => {
    // Platform URLs still go through extractStatic's own fetch (unlike the
    // generic path), so the terminal-status skip still applies there.
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    // eslint-disable-next-line global-require
    const { extractStatic } = require('../../lib/extractStatic');
    extractStatic.mockImplementation(
      async url => new ScrapeResult({ canonical: url, status: 500 })
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
        expect(written.status).toBe(500);
        expect(written.successfully_resolved).toBe(true);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('falls through to puppeteer when platform extraction throws (status unknown)', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => ({ url, status: 200 }));
    // eslint-disable-next-line global-require
    const { extractStatic } = require('../../lib/extractStatic');
    extractStatic.mockImplementation(async () => {
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
});
