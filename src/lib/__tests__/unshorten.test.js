jest.mock('node-fetch');

const unshorten = require('../unshorten');
const ResolveError = require('../ResolveError');

const url = 'some url';

describe('unshorten', () => {
  it('should return location in headers if it exists', async () => {
    const location = 'some location';
    require('node-fetch').__setupFetch({
      headers: {
        get: jest.fn().mockReturnValue(location),
      },
    });
    const expected = location;
    expect(await unshorten(url)).toBe(expected);
  });

  it('should return the url itself if location does not exist in headers', async () => {
    require('node-fetch').__setupFetch({
      headers: {
        get: jest.fn(),
      },
    });
    const expected = url;
    expect(await unshorten(url)).toBe(expected);
  });

  it('should throw an error if network timeout happened', async () => {
    require('node-fetch').__setupFetch(undefined, () => {
      const err = new Error('network timeout at:');
      err.name = 'FetchError';
      throw err;
    });
    const test = async () => await unshorten(url);
    await expect(test()).rejects.toThrow(ResolveError);
  });

  it('should throw an error if the socket hung up', async () => {
    require('node-fetch').__setupFetch(undefined, () => {
      throw new Error('reason: socket hang up');
    });
    const test = async () => await unshorten(url);
    await expect(test()).rejects.toThrow(ResolveError);
  });

  it('should throw an error if ECONNREFUSED was received', async () => {
    require('node-fetch').__setupFetch(undefined, () => {
      throw new Error('reason: connect ECONNREFUSED');
    });
    const test = async () => await unshorten(url);
    await expect(test()).rejects.toThrow(ResolveError);
  });

  it('should throw an error if hostname did not match altname in request', async () => {
    require('node-fetch').__setupFetch(undefined, () => {
      throw new Error(
        "reason: Hostname/IP doesn't match certificate's altnames"
      );
    });
    const test = async () => await unshorten(url);
    await expect(test()).rejects.toThrow(ResolveError);
  });

  it('should return the url itself if some other error happened', async () => {
    require('node-fetch').__setupFetch(undefined, () => {
      throw new Error('some other error');
    });
    const expected = url;
    expect(await unshorten(url)).toBe(expected);
  });
});
