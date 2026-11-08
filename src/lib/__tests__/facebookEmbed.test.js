jest.mock('node-fetch', () => jest.fn());

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { resolveFacebookUrl } = require('../resolveFacebookUrl');
const { readFacebookEmbed } = require('../facebookEmbed');

// Body of the live embed response for a deleted post (locale zh_TW).
const UNAVAILABLE_EMBED =
  '<body dir="ltr" class="plugin x1 Locale_zh_TW"><div class="_li"><div class="pluginSkinLight pluginFontHelvetica"><div class="_5pcb _5tmf _50f3" data-testid="newsFeedStream"><div role="feed"><div class="pam uiBoxWhite"><p class="_1q3v">這則 Facebook 貼文已無法取得使用。很有可能貼文已被移除，或是貼文的隱私設定已更改。</p><div class="_1q3w"><a href="https://developers.facebook.com/docs/plugins/embedded-posts/?ref=embed_post" target="_blank">使用說明</a></div></div></div></div></div></div></body>';
const EMPTY_EMBED =
  '<body dir="ltr" class="plugin x1 Locale_zh_TW"><div class="_li"><span></span></div></body>';

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

describe('readFacebookEmbed', () => {
  beforeEach(() => fetch.mockReset());

  it('reports the unavailable notice, for any Facebook URL', async () => {
    for (const url of [
      'https://www.facebook.com/a/posts/1',
      'https://www.facebook.com/chunyileefans/',
      'https://www.facebook.com/groups/1/posts/2/',
    ]) {
      fetch.mockResolvedValueOnce(makeEmbedRes({ text: UNAVAILABLE_EMBED }));
      expect(await readFacebookEmbed(url)).toEqual({
        unavailable: true,
        post: null,
      });
    }
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('reports an fb.watch link whose embed is an empty plugin', async () => {
    fetch.mockResolvedValueOnce(makeEmbedRes({ text: EMPTY_EMBED }));
    expect(await readFacebookEmbed('https://fb.watch/mkr5-XxzG8/')).toEqual({
      unavailable: true,
      post: null,
    });
  });

  it('is neither unavailable nor a post for an empty plugin elsewhere, a page without a post, or a failed embed', async () => {
    fetch
      .mockResolvedValueOnce(makeEmbedRes({ text: EMPTY_EMBED }))
      .mockResolvedValueOnce(makeEmbedRes({ text: '<div>no post</div>' }))
      .mockRejectedValueOnce(new Error('network'));
    for (let i = 0; i < 3; i++) {
      expect(
        await readFacebookEmbed('https://www.facebook.com/a/posts/1')
      ).toEqual({ unavailable: false, post: null });
    }
  });

  it('lets resolveFacebookUrl keep the photo URL when the embed shows the notice', async () => {
    fetch.mockResolvedValueOnce(makeEmbedRes({ text: UNAVAILABLE_EMBED }));
    expect(await resolveFacebookUrl(loginWall(PHOTO), SHARE)).toBe(PHOTO);
  });
});

describe('readFacebookEmbed post content', () => {
  beforeEach(() => fetch.mockReset());

  // Live embed bodies (scripts stripped) for posts with no crawlable URL.
  const fixture = name =>
    fs.readFileSync(
      path.join(__dirname, '../__fixtures__', `${name}.html`),
      'utf8'
    );

  it('reads author, message and photo of a single-photo page post', async () => {
    const url =
      'https://www.facebook.com/rumorbreaker/photos/pb.132399010115578.-2207520000.1458453569./1022873294401474/?type=3';
    fetch.mockResolvedValueOnce(
      makeEmbedRes({ text: fixture('facebookEmbedPagePhoto') })
    );
    const { post } = await readFacebookEmbed(url);
    expect(post.canonical).toBe(url);
    expect(post.title).toBe('網路追追追');
    expect(post.summary).toMatch(/^因為網站還在維修～\n但還是要發稿！/);
    expect(post.summary).toMatch(/迷香類謠言/);
    expect(post.summary).not.toMatch(/查看更多|⋯⋯|</);
    expect(post.summary).toMatch(/自己推測的！】\n迷香類謠言/);
    expect(post.topImageUrl).toMatch(
      /^https:\/\/scontent[^"]*fbcdn\.net\/v\/t39\.30808-6\/514875235/
    );
    expect(post.topImageUrl).not.toMatch(/&amp;/);
    expect(post.isIncomplete).toBe(false);
  });

  it('reads a post whose text links the Embedded Posts docs', async () => {
    const html = fixture('facebookEmbedPagePhoto').replace(
      '＃迷香</a>',
      '＃迷香</a> <a href="https://developers.facebook.com/docs/plugins/embedded-posts/">docs</a>'
    );
    fetch.mockResolvedValueOnce(makeEmbedRes({ text: html }));
    const result = await readFacebookEmbed(
      'https://www.facebook.com/a/posts/1'
    );
    expect(result.unavailable).toBe(false);
    expect(result.post.title).toBe('網路追追追');
  });

  it('reads a photo-only post as complete with an empty summary', async () => {
    fetch.mockResolvedValueOnce(
      makeEmbedRes({ text: fixture('facebookEmbedProfilePhoto') })
    );
    const { post } = await readFacebookEmbed(
      'https://www.facebook.com/photo/?fbid=4153654254961015&set=p.4153654254961015'
    );
    expect(post.title).toBe('林迪');
    expect(post.summary).toBe('');
    expect(post.topImageUrl).toMatch(/fbcdn\.net\/v\/t39\.30808-6\/509690499/);
    expect(post.isIncomplete).toBe(false);
  });
});
