jest.mock('node-fetch', () => jest.fn());
jest.mock('../unshorten', () => jest.fn());

const fetch = require('node-fetch');
const unshorten = require('../unshorten');
const resolveTargetUrl = require('../resolveTargetUrl');

describe('resolveTargetUrl', () => {
  beforeEach(() => {
    fetch.mockReset();
    unshorten.mockReset();
  });

  it('recovers a Facebook post target instead of returning its login redirect', async () => {
    const share = 'https://www.facebook.com/share/example/';
    const photo = 'https://www.facebook.com/photo.php?fbid=123';
    unshorten.mockResolvedValueOnce({
      url: `https://www.facebook.com/login/?next=${encodeURIComponent(photo)}`,
      status: 200,
    });
    fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => '<a href="/example/posts/456">post</a>',
    });

    expect(await resolveTargetUrl(share)).toBe(
      'https://www.facebook.com/example/posts/456'
    );
    expect(unshorten).toHaveBeenCalledTimes(1);
    expect(unshorten).toHaveBeenCalledWith(share);
  });

  it('returns the redirect target for non-Facebook URLs', async () => {
    const target = 'https://www.threads.com/@user/post/CODE';
    unshorten.mockResolvedValueOnce({ url: target, status: 200 });

    expect(await resolveTargetUrl('https://example.com/short')).toBe(target);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('preserves the different error behavior of generic and Facebook resolution', async () => {
    const error = new Error('timeout');
    unshorten.mockRejectedValue(error);

    await expect(resolveTargetUrl('https://example.com/')).rejects.toBe(error);
    const share = 'https://www.facebook.com/share/example/';
    expect(await resolveTargetUrl(share)).toBe(share);
  });
});
