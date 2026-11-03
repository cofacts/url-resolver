jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
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

describe('Facebook target resolution', () => {
  beforeEach(() => {
    fetch.mockReset();
  });

  it('recovers the real /<page>/posts/<id> for a shared photo via the embed endpoint', async () => {
    fetch.mockResolvedValueOnce(
      makeEmbedRes({
        text: '<a href="/hungwei.org/posts/789?ref=embed_post">post</a>',
      })
    );

    const result = await resolveFacebookUrl(loginWall(PHOTO), SHARE);

    expect(result).toBe('https://www.facebook.com/hungwei.org/posts/789');
    const embedUrl = fetch.mock.calls[0][0];
    expect(embedUrl).toContain('/plugins/post.php?');
    expect(embedUrl).toContain(encodeURIComponent(PHOTO));
  });

  it('passes a reel URL straight through without an embed lookup', async () => {
    const reel = 'https://www.facebook.com/reel/4186902858188216/?rdid=x';

    const result = await resolveFacebookUrl(
      reel,
      'https://www.facebook.com/share/v/1DhpeqzZLB/'
    );

    expect(result).toBe(reel);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns the original URL when the embed exposes no post link', async () => {
    fetch.mockResolvedValueOnce(makeEmbedRes({ text: '<div>no link</div>' }));

    expect(await resolveFacebookUrl(loginWall(PHOTO), SHARE)).toBe(SHARE);
  });

  it('returns the original URL when the embed fetch fails', async () => {
    fetch.mockRejectedValueOnce(new Error('network'));

    expect(await resolveFacebookUrl(loginWall(PHOTO), SHARE)).toBe(SHARE);
  });

  it('returns the original URL for a login wall with no recoverable next', async () => {
    expect(
      await resolveFacebookUrl('https://www.facebook.com/login/', SHARE)
    ).toBe(SHARE);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('passes a direct /<page>/posts/<id> URL through unchanged', async () => {
    const post = 'https://www.facebook.com/hungwei.org/posts/789';

    expect(await resolveFacebookUrl(post, post)).toBe(post);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('resolves relative next before recovering a photo URL', async () => {
    fetch.mockResolvedValueOnce(
      makeEmbedRes({ text: '<a href="/page/posts/123">post</a>' })
    );
    expect(
      await resolveFacebookUrl(loginWall('/photo.php?fbid=123'), SHARE)
    ).toBe('https://www.facebook.com/page/posts/123');
    expect(new URL(fetch.mock.calls[0][0]).searchParams.get('href')).toBe(
      'https://www.facebook.com/photo.php?fbid=123'
    );
  });

  it('maps story.php behind a login wall to /<owner>/posts/<post>', async () => {
    // Redirect chain observed in prod for /share/v/1FKkYi3c5x/.
    const story =
      'https://www.facebook.com/story.php?story_fbid=1756694823130318&id=100063694510630&mibextid=WC7FNe&rdid=x';

    expect(
      await resolveFacebookUrl(
        loginWall(story),
        'https://www.facebook.com/share/v/1FKkYi3c5x/'
      )
    ).toBe('https://www.facebook.com/100063694510630/posts/1756694823130318');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('maps direct m. story.php and permalink.php, including pfbid ids', async () => {
    expect(
      await resolveFacebookUrl(
        'https://m.facebook.com/story.php?story_fbid=pfbid02cxy5MMHc6vMghJ5hFPW&id=100005655455633'
      )
    ).toBe(
      'https://www.facebook.com/100005655455633/posts/pfbid02cxy5MMHc6vMghJ5hFPW'
    );
    expect(
      await resolveFacebookUrl(
        'https://www.facebook.com/permalink.php?id=307636219707522&story_fbid=1261214907682977'
      )
    ).toBe('https://www.facebook.com/307636219707522/posts/1261214907682977');
  });

  it.each([
    ['&id=276861822357066，聽完之後', '276861822357066'],
    ['&id=100012492390353?sfnsn=mo&extid=a', '100012492390353'],
    ['&id=100000492720842。', '100000492720842'],
  ])('ignores trailing text after the owner id (%s)', async (suffix, owner) => {
    expect(
      await resolveFacebookUrl(
        `https://m.facebook.com/story.php?story_fbid=1482358428474060${suffix}`
      )
    ).toBe(`https://www.facebook.com/${owner}/posts/1482358428474060`);
  });

  it('leaves story.php without an owner id unchanged', async () => {
    const story = 'https://www.facebook.com/story.php?story_fbid=123';
    expect(await resolveFacebookUrl(story)).toBe(story);
  });

  it.each([
    [
      'https://m.facebook.com/login.php?next=https%3A%2F%2Fm.facebook.com%2Fgroups%2F1685234955088705%2Fpermalink%2F3405023863109797%2F',
      'https://www.facebook.com/groups/1685234955088705/permalink/3405023863109797/',
    ],
    [
      'https://zh-tw.facebook.com/help/262314300536014',
      'https://www.facebook.com/help/262314300536014',
    ],
    [
      'https://www.facebook.com/a/posts/1',
      'https://www.facebook.com/a/posts/1',
    ],
    [
      'https://ja-jp.facebook.com/dietician.tw/posts/1',
      'https://www.facebook.com/dietician.tw/posts/1',
    ],
    ['https://fb.watch/abc/', null],
    ['https://developers.facebook.com/docs/plugins/embedded-posts/', null],
    ['https://business.facebook.com/news.ebc/videos/1/', null],
    ['https://web.facebook.com/a/posts/1', null],
  ])(
    'moves %s to the www host only for known aliases',
    async (input, expected) => {
      fetch.mockResolvedValue(makeEmbedRes({ text: '<div></div>' }));
      expect(await resolveFacebookUrl(input)).toBe(expected || input);
    }
  );

  it('maps the old group ?view=permalink link to /groups/<g>/posts/<id>/', async () => {
    expect(
      await resolveFacebookUrl(
        'https://m.facebook.com/groups/1726485900912990?view=permalink&id=2670283996533171'
      )
    ).toBe(
      'https://www.facebook.com/groups/1726485900912990/posts/2670283996533171/'
    );
    const home = 'https://www.facebook.com/groups/1726485900912990/';
    expect(await resolveFacebookUrl(home)).toBe(home);
  });

  it('does not return a non-HTTP next target', async () => {
    expect(
      await resolveFacebookUrl(loginWall('javascript:alert(1)'), SHARE)
    ).toBe(SHARE);
  });

  it('cancels unsuccessful embed bodies without reading them', async () => {
    const response = makeEmbedRes({ ok: false });
    response.body = { destroy: jest.fn() };
    response.text = jest.fn();
    fetch.mockResolvedValueOnce(response);
    expect(await resolveFacebookUrl(PHOTO, SHARE)).toBe(SHARE);
    expect(response.body.destroy).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].signal.aborted).toBe(true);
    expect(response.text).not.toHaveBeenCalled();
  });
});
