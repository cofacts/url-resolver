const fetch = require('node-fetch');
const unshorten = require('./unshorten');

const FETCH_TIMEOUT = 5000; // ms
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MiB cap on HTML body
const USER_AGENT =
  process.env.URL_RESOLVER_USER_AGENT ||
  'CofactsBot/1.0 (+https://cofacts.tw/bot)';

// Hosts handled here. m.facebook.com, www.facebook.com, fb.watch and fb.com all
// match via the subdomain-tolerant pattern.
const FACEBOOK_HOSTNAME = /(?:^|\.)(?:facebook\.com|fb\.watch|fb\.com)$/i;

// The embedded-post render links the post as /<page-slug>/posts/<id>. The slug
// can contain dots (e.g. "hungwei.org"); the id is numeric or a pfbid token.
const POST_LINK_RE = /href="\/([^"/]+)\/posts\/([^"?#]+)/;

/**
 * @param {string} url
 * @returns {boolean} whether the URL points to Facebook
 */
function isFacebookUrl(url) {
  try {
    return FACEBOOK_HOSTNAME.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
}

/**
 * @param {string} url
 * @returns {boolean} whether the URL is a Facebook login page
 */
function isLoginUrl(url) {
  try {
    return /\/login(?:\.php)?\/?$/.test(new URL(url).pathname);
  } catch (e) {
    return false;
  }
}

/**
 * A Facebook `/share/...` link fetched with a non-browser UA 302s to
 * `/login/?next=<real target>`. The real target (e.g. a `photo.php` URL) is
 * URL-encoded in the `next` query param. Returns it, or null when `url` is not
 * a login wall (or carries no `next`).
 *
 * @param {string} url
 * @returns {?string}
 */
function loginWallTarget(url) {
  if (!isLoginUrl(url)) return null;
  try {
    return new URL(url).searchParams.get('next') || null;
  } catch (e) {
    return null;
  }
}

/**
 * `photo.php` (and the bare `/photo` route) expose only a photo attachment id
 * and album id — no page slug — so they cannot be fetched directly: Facebook
 * hard-redirects them to the login wall for every User-Agent. The Embedded Post
 * endpoint, however, renders the post for anonymous clients and exposes the real
 * `/<page>/posts/<id>` URL, which IS crawlable with the CofactsBot UA.
 *
 * @param {string} url
 * @returns {boolean}
 */
function isSluglessPhoto(url) {
  try {
    return /\/photo(?:\.php)?\/?$/.test(new URL(url).pathname);
  } catch (e) {
    return false;
  }
}

/**
 * Call Facebook's Embedded Post endpoint for `target` and read the real
 * `/<page>/posts/<id>` URL out of the rendered HTML. This endpoint returns the
 * public post to anonymous crawlers (including the CofactsBot UA) and is not
 * subject to the `photo.php` login redirect.
 *
 * @param {string} target the photo.php (or similar) URL to resolve
 * @returns {Promise<?string>} absolute post URL, or null when it cannot be read
 */
async function recoverPostUrlViaEmbed(target) {
  const embed =
    'https://www.facebook.com/plugins/post.php?' +
    new URLSearchParams({ href: target, show_text: 'true' }).toString();

  let res;
  try {
    res = await fetch(embed, {
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
    return null;
  }

  if (!res.ok) {
    if (res.body) res.body.resume();
    return null;
  }

  let html;
  try {
    html = await res.text();
  } catch (e) {
    return null;
  }

  const m = html.match(POST_LINK_RE);
  if (!m) return null;
  return `https://www.facebook.com/${m[1]}/posts/${m[2]}`;
}

/**
 * Resolve a Facebook URL to one that serves Open Graph metadata to the
 * CofactsBot User-Agent, so the generic `fetchAndParseMeta` path can read it
 * without impersonating a crawler UA or booting a browser.
 *
 * Why this is needed (and replaces `unshorten` for Facebook):
 *   - `/share/...` links 302 to `/login/?next=...` under a non-browser UA, so
 *     plain `unshorten` lands on the login page.
 *   - The `next` target for a photo post is a `photo.php` URL that has no page
 *     slug and itself only ever redirects to login, so it is never crawlable.
 *   - The Embedded Post endpoint maps that `photo.php` to the real
 *     `/<page>/posts/<id>` URL, which returns full Open Graph metadata (title,
 *     description, image) to CofactsBot.
 *   - Reels/videos/regular posts resolve straight through the redirect to a
 *     crawlable URL and need no embed lookup.
 *
 * @param {string} url a Facebook URL (caller should gate on isFacebookUrl)
 * @returns {Promise<string>} the resolved URL, or the input URL when no better
 *   URL can be found (so the caller still falls back to the generic path).
 */
async function resolveFacebookUrl(url) {
  let resolved;
  try {
    ({ url: resolved } = await unshorten(url));
  } catch (e) {
    resolved = url;
  }

  const next = loginWallTarget(resolved);
  const target = next || resolved;

  if (isSluglessPhoto(target)) {
    const recovered = await recoverPostUrlViaEmbed(target);
    if (recovered) return recovered;
  }

  // No crawlable URL found (login wall with no recoverable target, or a
  // photo.php the embed could not map): return the original so the caller's
  // generic + puppeteer path still tries instead of a dead login / photo URL.
  if (isLoginUrl(target) || isSluglessPhoto(target)) return url;

  return target;
}

module.exports = { isFacebookUrl, resolveFacebookUrl };
