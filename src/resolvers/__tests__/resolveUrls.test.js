jest.mock('get-video-id');
jest.mock('../../lib/unshorten');
jest.mock('../../lib/normalize');
jest.mock('../../lib/scrap');

const unshorten = require('../../lib/unshorten');
const normalize = require('../../lib/normalize');
const scrap = require('../../lib/scrap');
const { resolveUrls } = require('../resolveUrls');

const {
  ResolveError: ResolveErrorEnum,
  // eslint-disable-next-line node/no-unpublished-require
} = require('../../lib/resolve_error_pb');

describe('resolveUrls', () => {
  it('should resolve multiple valid urls', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => url);

    const urls = [
      'some youtube url',
      'another youtube url',
      'the other youtube url',
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
        expect(call.write).toHaveBeenCalledTimes(urls.length);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('should resolve multiple urls with some invalid ones', done => {
    const badUrl = 'bad youtube url';
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => url);

    const errors = [];
    const urls = ['some youtube url', badUrl, 'the other youtube url'];
    const call = {
      request: {
        urls,
      },
      write: jest.fn().mockImplementation(res => {
        if (res.hasOwnProperty('error')) {
          errors.push(res.error);
        }
      }),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(normalize).toHaveBeenCalledTimes(urls.length);
        expect(unshorten).toHaveBeenCalledTimes(urls.length);
        expect(call.write).toHaveBeenCalledTimes(urls.length);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBe(undefined); // since this error is not a `ResolveError`
        done();
      })
      .catch(err => done.fail(err));
  });

  it('should resolve multiple urls with some invalid ones and error type ResolveError', done => {
    const badUrl = 'bad youtube url';
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => url);

    const errors = [];
    const urls = ['some youtube url', badUrl, 'the other youtube url'];
    const call = {
      request: {
        urls,
      },
      write: jest.fn().mockImplementation(res => {
        if (res.hasOwnProperty('error')) {
          errors.push(res.error);
        }
      }),
      end: jest.fn(),
    };
    resolveUrls(call)
      .then(() => {
        expect(normalize).toHaveBeenCalledTimes(urls.length);
        expect(unshorten).toHaveBeenCalledTimes(urls.length);
        expect(call.write).toHaveBeenCalledTimes(urls.length);
        expect(errors).toHaveLength(1);
        expect(errors[0]).toBe(ResolveErrorEnum.UNKNOWN_YOUTUBE_ERROR);
        done();
      })
      .catch(err => done.fail(err));
  });

  it('should resolve multiple non-youtube urls', done => {
    normalize.mockImplementation(url => url);
    unshorten.mockImplementation(async url => url);

    const urls = ['some url', 'another url', 'the other url'];
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
        expect(scrap).toHaveBeenCalledTimes(urls.length);
        expect(call.write).toHaveBeenCalledTimes(urls.length);
        done();
      })
      .catch(err => done.fail(err));
  });
});
