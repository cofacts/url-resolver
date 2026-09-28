jest.mock('../parseMeta');
jest.mock('../capturingFetch');

const parseMeta = require('../parseMeta');
const { createCapturingFetch } = require('../capturingFetch');
const fetchAndParseMeta = require('../fetchAndParseMeta');
const ScrapeResult = require('../ScrapeResult');

describe('fetchAndParseMeta', () => {
  afterEach(() => {
    parseMeta.mockClear();
    createCapturingFetch.mockClear();
  });

  it('calls parseMeta with a capturing fetch and returns both the result and the page', async () => {
    const fakeFetchOverride = jest.fn();
    createCapturingFetch.mockReturnValue(fakeFetchOverride);
    const expectedResult = new ScrapeResult({
      canonical: 'https://example.com',
    });
    parseMeta.mockResolvedValue(expectedResult);

    const { result, page } = await fetchAndParseMeta('https://example.com');

    expect(result).toBe(expectedResult);
    expect(page).toEqual({});
    // page is the SAME object createCapturingFetch received, so a caller
    // (e.g. resolveUrls) can read fields capturingFetch sets on it later.
    expect(createCapturingFetch.mock.calls[0][0]).toBe(page);
    expect(parseMeta).toHaveBeenCalledWith(
      'https://example.com',
      fakeFetchOverride
    );
  });

  it('propagates parseMeta rejections', async () => {
    createCapturingFetch.mockReturnValue(jest.fn());
    const error = new Error('boom');
    parseMeta.mockRejectedValue(error);

    await expect(fetchAndParseMeta('https://example.com')).rejects.toThrow(
      'boom'
    );
  });
});
