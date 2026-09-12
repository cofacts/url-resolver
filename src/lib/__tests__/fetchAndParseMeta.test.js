jest.mock('../parseMeta');

const parseMeta = require('../parseMeta');
const { cofactsBotFetch } = require('../cofactsBotFetch');
const fetchAndParseMeta = require('../fetchAndParseMeta');
const ScrapeResult = require('../ScrapeResult');

describe('fetchAndParseMeta', () => {
  afterEach(() => {
    parseMeta.mockClear();
  });

  it('calls parseMeta with the CofactsBot fetch and returns its result', async () => {
    const expectedResult = new ScrapeResult({
      canonical: 'https://example.com',
    });
    parseMeta.mockResolvedValue(expectedResult);

    const result = await fetchAndParseMeta('https://example.com');

    expect(result).toBe(expectedResult);
    expect(parseMeta).toHaveBeenCalledWith(
      'https://example.com',
      cofactsBotFetch
    );
  });

  it('propagates parseMeta rejections', async () => {
    parseMeta.mockRejectedValue(new Error('boom'));

    await expect(fetchAndParseMeta('https://example.com')).rejects.toThrow(
      'boom'
    );
  });
});
