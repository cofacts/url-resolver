const { gql } = require('../test-util');
const { closeBrowser } = require('../lib/scrap');

describe('resolveUrls', () => {
  it('resolves normal URLs', async () => {
    const result = await gql`
      {
        resolvedUrls(urls: ["https://example.com"]) {
          url
          canonical
          title
          summary
          html
          topImageUrl
          status
          error
        }
      }
    `();

    expect(result).toMatchSnapshot();
  });

  it.skip('resolves alert boxes', async () => {});

  it.skip('resolves redirects', async () => {});

  it('handles youtube URL', async () => {
    const result = await gql`
      {
        resolvedUrls(urls: ["https://www.youtube.com/watch?v=jNQXAC9IVRw"]) {
          canonical
          title
          summary
        }
      }
    `();

    expect(result).toMatchSnapshot();
  });

  it('returns minimal data on error', async () => {
    const result = await gql`
      {
        resolvedUrls(
          urls: [
            "http://blog.udn.com/watercmd/1066441" # https://github.com/cofacts/url-resolver/issues/2
          ]
        ) {
          canonical
          title
          summary
          topImageUrl
        }
      }
    `();

    expect(result).toMatchSnapshot();
  });
});

afterAll(async () => {
  await closeBrowser();

  // eslint-disable-next-line no-console
  console.log('browser closed.');
});
