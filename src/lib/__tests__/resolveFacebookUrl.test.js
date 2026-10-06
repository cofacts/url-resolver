jest.mock('node-fetch', () => jest.fn());
jest.mock('../unshorten', () => jest.fn());

const fetch = require('node-fetch');
const unshorten = require('../unshorten');
const { isFacebookUrl, resolveFacebookUrl } = require('../resolveFacebookUrl');

const SHARE = 'https://www.facebook.com/share/1JE8JoeFQP/';
const PHOTO = 'https://www.facebook.com/photo.php?fbid=123&set=a.456';
const loginWall = next =>
  `https://www.facebook.com/login/?next=${encodeURIComponent(next)}`;

const makeEmbedRes = ({ ok = true, text = '' } = {}) => ({
  ok,
  status: ok ? 200 : 400,
  body: null,
  text: async () => text,
});

describe('isFacebookUrl', () => {
  it('matches facebook hosts and subdomains', () => {
    expect(isFacebookUrl('https://www.facebook.com/share/x/')).toBe(true);
    expect(isFacebookUrl('https://m.facebook.com/x')).toBe(true);
    expect(isFacebookUrl('https://facebook.com/x')).toBe(true);
    expect(isFacebookUrl('https://fb.watch/abc/')).toBe(true);
    expect(isFacebookUrl('https://fb.com/abc')).toBe(true);
  });

  it('rejects non-facebook and malformed URLs', () => {
    expect(isFacebookUrl('https://www.threads.com/@a/post/x')).toBe(false);
    expect(isFacebookUrl('https://notfacebook.com.evil.com/x')).toBe(false);
    expect(isFacebookUrl('not a url')).toBe(false);
  });
});

describe('resolveFacebookUrl', () => {
  beforeEach(() => {
    fetch.mockReset();
    unshorten.mockReset();
  });

  it('recovers the real /<page>/posts/<id> for a shared photo via the embed endpoint', async () => {
    unshorten.mockResolvedValueOnce({ url: loginWall(PHOTO), status: 200 });
    fetch.mockResolvedValueOnce(
      makeEmbedRes({
        text: '<a href="/hungwei.org/posts/789?ref=embed_post">post</a>',
      })
    );

    const result = await resolveFacebookUrl(SHARE);

    expect(result).toBe('https://www.facebook.com/hungwei.org/posts/789');
    const embedUrl = fetch.mock.calls[0][0];
    expect(embedUrl).toContain('/plugins/post.php?');
    expect(embedUrl).toContain(encodeURIComponent(PHOTO));
  });

  it('passes a reel URL straight through without an embed lookup', async () => {
    const reel = 'https://www.facebook.com/reel/4186902858188216/?rdid=x';
    unshorten.mockResolvedValueOnce({ url: reel, status: 200 });

    const result = await resolveFacebookUrl(
      'https://www.facebook.com/share/v/1DhpeqzZLB/'
    );

    expect(result).toBe(reel);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the original URL when the embed exposes no post link', async () => {
    unshorten.mockResolvedValueOnce({ url: loginWall(PHOTO), status: 200 });
    fetch.mockResolvedValueOnce(makeEmbedRes({ text: '<div>no link</div>' }));

    expect(await resolveFacebookUrl(SHARE)).toBe(SHARE);
  });

  it('returns the original URL when the embed fetch fails', async () => {
    unshorten.mockResolvedValueOnce({ url: loginWall(PHOTO), status: 200 });
    fetch.mockRejectedValueOnce(new Error('network'));

    expect(await resolveFacebookUrl(SHARE)).toBe(SHARE);
  });

  it('returns the original URL for a login wall with no recoverable next', async () => {
    unshorten.mockResolvedValueOnce({
      url: 'https://www.facebook.com/login/',
      status: 200,
    });

    expect(await resolveFacebookUrl(SHARE)).toBe(SHARE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes a direct /<page>/posts/<id> URL through unchanged', async () => {
    const post = 'https://www.facebook.com/hungwei.org/posts/789';
    unshorten.mockResolvedValueOnce({ url: post, status: 200 });

    expect(await resolveFacebookUrl(post)).toBe(post);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('falls back to the input URL when unshorten throws', async () => {
    unshorten.mockRejectedValueOnce(new Error('timeout'));

    expect(await resolveFacebookUrl(SHARE)).toBe(SHARE);
  });
});
