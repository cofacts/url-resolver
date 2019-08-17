jest.mock('node-fetch');

// const testCases is only for testing; it doesn't exist in the real module.
const { testCases, location } = require('node-fetch');

const unshorten = require('../unshorten');
const ResolveError = require('../ResolveError');

describe('unshorten', () => {
  it('should return location in headers if it exists', async () => {
    const url = 'some url';
    const expected = location;
    expect(await unshorten(url)).toBe(expected);
  });

  it('should return the url itself if location does not exist in headers', async () => {
    const url = testCases.NO_LOCATION;
    const expected = url;
    expect(await unshorten(url)).toBe(expected);
  });

  it('should throw an error if network timeout happened', async () => {
    const url = testCases.NETWORK_TIMEOUT;
    const test = async () => await unshorten(url);
    await expect(test()).rejects.toThrow(ResolveError);
  });

  it('should throw an error if the socket hung up', async () => {
    const url = testCases.SOCKET_HANG_UP;
    const test = async () => await unshorten(url);
    await expect(test()).rejects.toThrow(ResolveError);
  });

  it('should throw an error if ECONNREFUSED was received', async () => {
    const url = testCases.ECONNREFUSED;
    const test = async () => await unshorten(url);
    await expect(test()).rejects.toThrow(ResolveError);
  });

  it('should throw an error if hostname did not match altname in request', async () => {
    const url = testCases.HOSTNAME_MISMATCH;
    const test = async () => await unshorten(url);
    await expect(test()).rejects.toThrow(ResolveError);
  });

  it('should return the url itself if some other error happened', async () => {
    const url = testCases.SOME_OTHER_ERROR;
    const expected = url;
    expect(await unshorten(url)).toBe(expected);
  });
});
