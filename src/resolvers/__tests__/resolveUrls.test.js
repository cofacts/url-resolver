jest.mock('../../lib/unshorten');
jest.mock('../../lib/normalize');
jest.mock('../../lib/parseMeta');
jest.mock('../../lib/scrap');

const ScrapResult = require('../../lib/ScrapResult');
const unshorten = require('../../lib/unshorten');
const normalize = require('../../lib/normalize');
const parseMeta = require('../../lib/parseMeta');

const scrap = require('../../lib/scrap');
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
    scrap.mockClear();
  });

  it('should resolve multiple valid urls', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => url);
    parseMeta.mockImplementation(url => Promise.resolve(scrap.getResult(url)));

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
        expect(scrap).toHaveBeenCalledTimes(0); // No need to scrap
        expect(call.write).toHaveBeenCalledTimes(urls.length);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('should resolve multiple urls with some invalid ones', done => {
    const badUrl = 'bad youtube url';
    const customErrorMsg = 'some error';

    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => `unshortened ${url}`);
    parseMeta.mockImplementation(url => {
      if (url === `unshortened ${badUrl}`) {
        return Promise.reject(new Error(customErrorMsg));
      }
      return Promise.resolve(scrap.getResult(url));
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
        expect(scrap).toHaveBeenCalledTimes(0); // No need to scrap
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

      return url;
    });
    parseMeta.mockImplementation(url => Promise.resolve(scrap.getResult(url)));

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
        expect(scrap).toHaveBeenCalledTimes(0); // No need to scrap

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
    unshorten.mockImplementation(async url => url);

    // parseMeta returning incomplete result, but with canonical
    parseMeta.mockImplementation(() =>
      Promise.resolve(
        new ScrapResult({ canonical: 'canonical from parseMeta' })
      )
    );

    const emptySummaryUrl = 'url that has no summary';
    const scrapFailUrl = 'url that triggers scrap fail';
    scrap.mockImplementation(async url => {
      switch (url) {
        case emptySummaryUrl:
          return { ...scrap.getResult(url), summary: undefined };
        case scrapFailUrl:
          throw new ResolveError(ResolveErrorEnum.UNKNOWN_SCRAP_ERROR);
        default:
          return scrap.getResult(url);
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
        expect(scrap).toHaveBeenCalledTimes(urls.length);
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
    "url": "url that triggers scrap fail",
  },
]
`);
        done();
      })
      .catch(err => done.fail(err));
  });
});
