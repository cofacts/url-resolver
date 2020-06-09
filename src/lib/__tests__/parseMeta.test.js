jest.mock('unfurl.js');
const { unfurl } = require('unfurl.js');
const parseMeta = require('../parseMeta');
const ResolveError = require('../ResolveError');
const { META_MAP } = require('../__fixtures__/parseMeta');

describe('parseMeta', () => {
  afterEach(() => {
    unfurl.mockClear();
  });

  it('emits ResolveError', () => {
    unfurl.mockImplementationOnce(() => Promise.reject('Some error'));

    expect(parseMeta('some url')).rejects.toThrow(ResolveError);
    expect(unfurl).toHaveBeenCalledTimes(1);
  });

  it('parses metadata', async () => {
    unfurl.mockImplementation(url => Promise.resolve(META_MAP[url]));

    const urls = Object.keys(META_MAP);
    for (const url of urls) {
      const result = await parseMeta(url);
      expect(result).toMatchSnapshot(url);
      expect(result.isIncomplete).toMatchSnapshot(`${url} incomplete?`);
    }

    expect(unfurl).toHaveBeenCalledTimes(urls.length);
  });
});
