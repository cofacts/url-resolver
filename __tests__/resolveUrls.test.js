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

  it('returns fetch error properly', async () => {
    const result = await gql`
      {
        resolvedUrls(
          urls: [
            "https://this-cannot-be-resolved.com"
            "line://ch/1341209850"
            "https://identityredesign.tw/vote-list.html" # has domain, but don't respond
            "http://beingsweetlife.com/archives/04/220087" # socket hang up without response (ERR_EMPTY_RESPONSE)
            "https://www.ey.gov.tw/File/66E9E54960EB958B?A=C" # PDF file, which is not supported
          ]
        ) {
          url
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
        resolvedUrls(
          urls: [
            "https://www.youtube.com/watch?v=jNQXAC9IVRw"
            "https://www.youtube.com/watch?v=not-exist"
          ]
        ) {
          url
          canonical
          title
          summary
          status
          error
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
          url
          canonical
          title
          summary
          topImageUrl
          error
        }
      }
    `();

    expect(result).toMatchSnapshot();
  });

  it('handles URLs without protocol', async () => {
    const result = await gql`
      {
        resolvedUrls(urls: ["example.com"]) {
          url
          canonical
          title
        }
      }
    `();

    // Note that url should be same as input.
    //
    expect(result).toMatchSnapshot();
  });
});

afterAll(async () => {
  await closeBrowser();

  // eslint-disable-next-line no-console
  console.log('browser closed.');
});
