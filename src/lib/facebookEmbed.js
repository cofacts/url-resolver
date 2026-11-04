const fetch = require('node-fetch');
const { AbortController } = global;

const FETCH_TIMEOUT = 5000; // ms
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MiB cap on HTML body
const { USER_AGENT } = require('./cofactsBotFetch');
const ScrapeResult = require('./ScrapeResult');

// Facebook's Embedded Post endpoint (plugins/post.php) renders a post for
// anonymous clients that the post page itself hides behind the login wall.
// This module reads that render: whether the post still exists, and its
// author / text / image. The markup is undocumented and was reverse-engineered
// from live facebook.com in Nov 2026; resolveFacebookUrl.js also uses it to
// find crawlable post links.

/**
 * `fb.watch/<code>` links 302 the CofactsBot UA to a login wall on
 * `www.fb.watch` whose `next` nests another login wall on every hop, so they
 * never reach the video. The Embedded Post endpoint accepts the fb.watch URL
 * and links the real `/<page>/videos/<id>`.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isFbWatch(url) {
  try {
    return /(?:^|\.)fb\.watch$/i.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
}

/**
 * @param {string} target URL to render through the Embedded Post endpoint
 * @returns {Promise<?string>} the embed HTML, or null when it cannot be read
 */
async function fetchEmbedHtml(target) {
  const embed =
    'https://www.facebook.com/plugins/post.php?' +
    new URLSearchParams({ href: target, show_text: 'true' }).toString();

  let res;
  const controller = new AbortController();
  try {
    res = await fetch(embed, {
      signal: controller.signal,
      method: 'GET',
      timeout: FETCH_TIMEOUT,
      size: MAX_BODY_BYTES,
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
      },
      redirect: 'follow',
    });
  } catch (e) {
    controller.abort();
    return null;
  }

  if (!res.ok) {
    if (res.body) res.body.destroy();
    controller.abort();
    return null;
  }

  try {
    return await res.text();
  } catch (e) {
    return null;
  } finally {
    controller.abort();
  }
}

// When the embed has nothing to show, it renders a notice ("This Facebook
// post is no longer available...") ending in a link to the Embedded Posts
// docs; a dead fb.watch link renders an empty plugin shell instead.
//
// - Why the docs link: the notice text is localized and its class names are
//   generated, while the link is a fixed URL path.
// - Post markers win: a post could itself link to that docs page, so any
//   rendered post (author avatar <img> with aria-label, or a post message)
//   means the embed is not unavailable.
// - These are rules for the markup observed in Nov 2026, not a documented
//   contract; the samples they were checked against are listed in PR #80.
const UNAVAILABLE_NOTICE_RE = /href="https:\/\/developers\.facebook\.com\/docs\/plugins\/embedded-posts\//;
const EMPTY_PLUGIN_RE = /<div class="_li"><span><\/span><\/div>/;

/**
 * Whether the embed renders the "unavailable" notice (or, for fb.watch, an
 * empty plugin shell). The same notice is shown for a removed or non-public
 * post and for any URL the endpoint does not support (page, profile, group),
 * so it only means the embed has nothing to show; the caller decides what that
 * implies.
 *
 * @param {string} html Embedded Post HTML rendered for `target`
 * @param {string} target
 * @returns {boolean}
 */
function isUnavailable(html, target) {
  const rendersPost =
    /<img\b[^>]*\baria-label="[^"]+"/.test(html) ||
    html.includes('data-testid="post_message"');
  if (rendersPost) return false;
  return (
    UNAVAILABLE_NOTICE_RE.test(html) ||
    (isFbWatch(target) && EMPTY_PLUGIN_RE.test(html))
  );
}

const ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/**
 * @param {string} text HTML text with character references
 * @returns {string}
 */
function decodeEntities(text) {
  return text.replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (ref, name) => {
    if (name[0] !== '#') return ENTITIES[name.toLowerCase()] || ref;
    const code =
      name[1].toLowerCase() === 'x'
        ? parseInt(name.slice(2), 16)
        : parseInt(name.slice(1), 10);
    return String.fromCodePoint(code);
  });
}

/**
 * @param {string} html
 * @param {number} start index of an opening `<tag` element
 * @param {string} tag element name, e.g. 'div'
 * @returns {{ innerStart: number, innerEnd: number, end: number }} offsets of
 *   the element's content and of the end of its closing tag, counting nested
 *   elements of the same name
 */
function elementRange(html, start, tag) {
  const re = new RegExp(`<(\\/?)${tag}\\b[^>]*>`, 'g');
  re.lastIndex = start;
  const open = re.exec(html);
  const innerStart = open.index + open[0].length;
  let depth = 1;
  let m;
  while ((m = re.exec(html))) {
    depth += m[1] ? -1 : 1;
    if (depth === 0) {
      return { innerStart, innerEnd: m.index, end: m.index + m[0].length };
    }
  }
  return { innerStart, innerEnd: html.length, end: html.length };
}

/**
 * @param {string} html
 * @returns {string} `html` without its `text_exposed_hide` spans
 */
function withoutCollapsedMarkers(html) {
  let out = html;
  let at;
  while ((at = out.indexOf('<span class="text_exposed_hide"')) >= 0) {
    out = out.slice(0, at) + out.slice(elementRange(out, at, 'span').end);
  }
  return out;
}

/**
 * @param {string} html
 * @returns {string} the post text, or '' when the post has none
 */
function postMessageText(html) {
  const at = html.indexOf('data-testid="post_message"');
  if (at < 0) return '';
  const div = html.lastIndexOf('<div', at);
  const { innerStart, innerEnd } = elementRange(html, div, 'div');
  // A long message is rendered collapsed, but the embed still ships the full
  // text: the part after the fold sits in `text_exposed_show`, and only the
  // "⋯⋯" ellipsis and the "See more" link sit in `text_exposed_hide` spans.
  // Dropping those spans and the tags therefore yields the whole message
  // without a click. This holds for the observed embeds (Nov 2026); text the
  // embed truncates server-side is not in the HTML and cannot be recovered.
  const inner = withoutCollapsedMarkers(html.slice(innerStart, innerEnd))
    .replace(/<\/p>|<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(inner)
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

/**
 * Read a post rendered by the Embedded Post endpoint. Used when no crawlable
 * URL can be built (single-photo, group and profile photo posts), as this
 * markup is undocumented and less stable than Open Graph tags. Anchors on
 * data-testid / aria-label rather than generated class names; observed on
 * live Facebook in Nov 2026.
 *
 * @param {string} html Embedded Post HTML
 * @param {string} url the URL the embed rendered
 * @returns {?ScrapeResult} null when the HTML holds no recognizable post
 */
function parseEmbedPost(html, url) {
  // An embed renders, in document order: the author's avatar, the post's
  // attachment image(s), and a Facebook app icon. In the observed embeds
  // (Nov 2026) they are told apart by heuristics, not by a documented API:
  //   - avatar: the only <img> with an aria-label, which is the author's
  //     name, so it doubles as the title;
  //   - attachment: served from a content CDN path (`*.fbcdn.net/v/...`),
  //     while the app icon comes from `static.xx.fbcdn.net/rsrc.php/...`;
  //   - the first attachment is used: a multi-photo post renders a grid and
  //     this picks its first tile, not necessarily the cover photo. Posts
  //     whose attachment is a video or link preview may yield no image.
  const imgs = html.match(/<img\b[^>]*>/g) || [];
  const avatar = imgs.find(img => /\baria-label="[^"]+"/.test(img));
  const title = avatar
    ? decodeEntities(avatar.match(/\baria-label="([^"]+)"/)[1])
    : '';
  const attachment = imgs.find(
    img =>
      img !== avatar &&
      !/\baria-label=/.test(img) &&
      /\bsrc="https:\/\/[^"]*\.fbcdn\.net\/v\//.test(img)
  );
  const summary = postMessageText(html);
  if (!title && !summary) return null;

  return new ScrapeResult({
    canonical: url,
    title,
    // An empty string still counts as complete: a photo-only post has no
    // text, and the browser fallback only reaches the login wall.
    summary,
    topImageUrl: attachment
      ? decodeEntities(attachment.match(/\bsrc="([^"]+)"/)[1])
      : undefined,
  });
}

/**
 * Ask the Embedded Post endpoint about a Facebook URL whose page metadata is
 * incomplete: whether it shows the "unavailable" notice, and otherwise what
 * post it renders.
 *
 * @param {string} url
 * @returns {Promise<{ unavailable: boolean, post: ?ScrapeResult }>} `post` is
 *   null when the embed failed, is unavailable, or holds no recognizable post
 */
async function readFacebookEmbed(url) {
  const html = await fetchEmbedHtml(url);
  if (!html) return { unavailable: false, post: null };
  if (isUnavailable(html, url)) return { unavailable: true, post: null };
  return { unavailable: false, post: parseEmbedPost(html, url) };
}

module.exports = {
  fetchEmbedHtml,
  isFbWatch,
  readFacebookEmbed,
};
