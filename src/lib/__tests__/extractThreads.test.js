const { parseHTML } = require('linkedom');
const { isThreadsUrl, extractThreads } = require('../extractThreads');

function domOf(html) {
  return parseHTML(`<!DOCTYPE html><html><head>${html}</head></html>`).document;
}

function meta(html, url) {
  return extractThreads(domOf(html), `<html>${html}</html>`, url);
}

describe('isThreadsUrl', () => {
  it.each([
    ['https://www.threads.com/@a/post/CODE', true],
    ['https://threads.com/@a/post/CODE', true],
    ['https://www.threads.net/@a/post/CODE', true],
    ['https://l.threads.net/l/xyz', true],
    ['https://www.threadsapp.com/@a', false],
    ['https://example.com/threads.com', false],
    ['not a url', false],
  ])('classifies %s as %s', (url, expected) => {
    expect(isThreadsUrl(url)).toBe(expected);
  });
});

describe('extractThreads', () => {
  const POST = 'https://www.threads.com/@nownews/post/DW72xFwE7p6';

  it('uses og:title and og:description as-is for a normal post', () => {
    const out = meta(
      `<meta property="og:title" content="NOWnews 今日新聞 (@nownews) on Threads">
       <meta property="og:description" content="辛樂克颱風今凌晨生成！\n強度估達中颱以上">
       <meta property="og:image" content="https://cdn.example/img.jpg">`,
      POST
    );
    expect(out.title).toBe('NOWnews 今日新聞 (@nownews) on Threads');
    expect(out.summary).toBe('辛樂克颱風今凌晨生成！\n強度估達中颱以上');
    expect(out.topImageUrl).toBe('https://cdn.example/img.jpg');
  });

  it('keeps an image post whose og:description is empty', () => {
    const out = meta(
      `<meta property="og:title" content="某人 (@someone) on Threads">
       <meta property="og:image" content="https://cdn.example/x.jpg">`,
      POST
    );
    expect(out.title).toBe('某人 (@someone) on Threads');
    expect(out.summary).toBeUndefined();
    expect(out.topImageUrl).toBe('https://cdn.example/x.jpg');
  });

  it('returns no content for a login wall so the caller falls back to puppeteer', () => {
    const out = meta(
      `<meta property="og:title" content="Threads • Log in">`,
      POST
    );
    expect(out.title).toBeUndefined();
    expect(out.summary).toBeUndefined();
    expect(out.topImageUrl).toBeUndefined();
    expect(out.isUnavailable).toBeFalsy();
  });

  it('flags the post as unavailable when the link lands on ?error=invalid_post', () => {
    const html = `<title>Threads</title>
       <meta property="og:title" content="Threads • Log in">
       <meta property="og:description" content="Join Threads to share ideas, ask questions, post random thoughts, find your people and more. Log in with your Instagram.">`;
    const out = extractThreads(
      domOf(html),
      `<html>${html}</html>`,
      'https://www.threads.com/?error=invalid_post'
    );
    expect(out.isUnavailable).toBe(true);
    expect(out.title).toBeUndefined();
    expect(out.summary).toBeUndefined();
    expect(out.topImageUrl).toBeUndefined();
  });

  it('does not flag unknown ?error= values as unavailable (only invalid_post)', () => {
    const html = `<title>Threads</title>
       <meta property="og:title" content="Threads • Log in">`;
    const out = extractThreads(
      domOf(html),
      `<html>${html}</html>`,
      'https://www.threads.com/?error=rate_limited'
    );
    expect(out.isUnavailable).toBeFalsy();
    expect(out.title).toBeUndefined();
    expect(out.summary).toBeUndefined();
  });

  it('does not surface the login-wall boilerplate description as post content', () => {
    const out = meta(
      `<title>Threads</title>
       <meta property="og:title" content="Threads • Log in">
       <meta property="og:description" content="Join Threads to share ideas, ask questions, post random thoughts, find your people and more. Log in with your Instagram.">`,
      POST
    );
    expect(out.summary).toBeUndefined();
    expect(out.title).toBeUndefined();
  });
});
