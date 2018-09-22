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
});

afterAll(async () => {
  await closeBrowser();

  // eslint-disable-next-line no-console
  console.log('browser closed.');
});