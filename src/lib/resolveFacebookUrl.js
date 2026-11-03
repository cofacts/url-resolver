const fetch = require('node-fetch');
const { AbortController } = global;

const FETCH_TIMEOUT = 5000; // ms
const MAX_BODY_BYTES = 5 * 1024 * 1024; // 5 MiB cap on HTML body
const { USER_AGENT } = require('./cofactsBotFetch');

// Why this module exists: the same Facebook content can respond differently
// depending on which endpoint serves it to an anonymous request. We observed
// the photo endpoint redirect anonymous (non-browser-UA) requests to a login
// wall, while the real post URL recovered through the Embedded Post endpoint
// (/<page>/posts/<id>) returns Open Graph metadata to the CofactsBot UA. So
// this module's only job is swapping the input URL for one the shared
// metadata parser (fetchAndParseMeta) can actually fetch — it does not parse
// metadata itself.
//
// Every pattern used to do that swap (the /login/?next= redirect, the
// photo.php slugless-URL case, and the Embedded Post HTML shape matched by
// POST_LINK_RE) was reverse-engineered from how facebook.com actually
// behaved when this file was written (Oct 2026), not from a documented API.
// If Facebook changes the login redirect shape, retires the Embedded Post
// endpoint, or alters its markup, this module does NOT reliably fall back to
// Puppeteer: resolveFacebookUrl() returns the original URL in that case (see
// its bottom), and the caller (resolveTargetUrl → fetchAndParseMeta) only
// invokes Puppeteer when the resulting metadata is missing fields or the
// fetch itself fails. If a future login/placeholder page happens to expose
// complete-looking title/summary/image to the CofactsBot UA, this chain will
// report it as a successful result — Puppeteer will NOT be invoked to catch
// it. Update the regexes/endpoint here whenever that mismatch is observed;
// that's expected maintenance, but verify the new behavior first rather than
// assuming the fallback saves you.
//
// Verification status: this file's login/next -> photo.php -> embed
// recovery path is covered only by mocked unit tests
// (`__tests__/resolveFacebookUrl.test.js`) — it was not exercised against
// live Facebook traffic by the PR that introduced it (see the PR
// description's "Validation" section for what real URLs were actually
// checked). Validate this path against real login-wall / photo-share URLs
// before relying on it further; don't assume the mocks prove live behavior.

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
    const next = new URL(url).searchParams.get('next');
    if (!next) return null;
    const target = new URL(next, url);
    return /^https?:$/.test(target.protocol) ? target.toString() : null;
  } catch (e) {
    return null;
  }
}

/**
 * Facebook wraps outbound links in `l.php?u=<target>` (also served from
 * `l.` / `lm.` subdomains), which redirects anonymous clients to the
 * `flx/warn/?u=<target>` interstitial behind the login wall. The external
 * target is right there in `u`, so read it instead of requesting Facebook.
 * Some shares encode `u` twice, so decode once more when needed. Also accepts
 * a login wall whose `next` is such a wrapper.
 *
 * @param {string} url
 * @returns {?string} the external http(s) target, or null when `url` is not
 *   a Facebook outbound wrapper with a usable `u`
 */
function outboundLinkTarget(url) {
  if (!isFacebookUrl(url)) return null;
  const wrapper = loginWallTarget(url) || url;
  let parsed;
  try {
    parsed = new URL(wrapper);
  } catch (e) {
    return null;
  }
  if (!/^\/(?:l\.php|flx\/warn\/?)$/.test(parsed.pathname)) return null;

  let target = parsed.searchParams.get('u');
  if (target && !/^https?:\/\//i.test(target)) {
    try {
      target = decodeURIComponent(target);
    } catch (e) {
      return null;
    }
  }
  try {
    const result = new URL(target);
    return /^https?:$/.test(result.protocol) ? result.toString() : null;
  } catch (e) {
    return null;
  }
}

/**
 * `story.php` / `permalink.php?story_fbid=<post>&id=<owner>` redirect
 * anonymous clients to the login wall, but `/<owner>/posts/<post>` serves Open
 * Graph metadata to CofactsBot (and redirects to `/reel/<id>` for video
 * posts). Observed on live Facebook in Nov 2026, including a story.php that a
 * `/share/v/` link resolved to from a GCP IP.
 *
 * @param {string} url
 * @returns {?string} the `/<owner>/posts/<post>` URL, or null
 */
function storyPostUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (e) {
    return null;
  }
  if (!/^\/(?:story|permalink)\.php$/.test(parsed.pathname)) return null;
  // Pasted links often carry trailing text ("&id=123，聽完之後" or
  // "&id=123?sfnsn=mo"), so keep only the leading id characters.
  const post = (parsed.searchParams.get('story_fbid') || '').match(/^\w+/);
  const owner = (parsed.searchParams.get('id') || '').match(/^\d+/);
  if (!post || !owner) return null;
  return `https://www.facebook.com/${owner[0]}/posts/${post[0]}`;
}

/**
 * `photo.php` (and the bare `/photo` route) expose only a photo attachment id
 * and album id — no page slug. In the samples observed when this file was
 * written, Facebook redirected these to the login wall regardless of
 * User-Agent, so they could not be fetched directly. The Embedded Post
 * endpoint, however, rendered the post for anonymous clients in those same
 * samples and exposed the real `/<page>/posts/<id>` URL, which was crawlable
 * with the CofactsBot UA.
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
 * `/<page>/posts/<id>` URL out of the rendered HTML. In observed samples
 * this endpoint returned the public post to anonymous crawlers (including
 * the CofactsBot UA) without the `photo.php` login redirect.
 *
 * @param {string} target the photo.php (or similar) URL to resolve
 * @returns {Promise<?string>} absolute post URL, or null when it cannot be read
 */
async function recoverPostUrlViaEmbed(target) {
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

  let html;
  try {
    html = await res.text();
  } catch (e) {
    return null;
  } finally {
    controller.abort();
  }

  const m = html.match(POST_LINK_RE);
  if (!m) return null;
  return `https://www.facebook.com/${m[1]}/posts/${m[2]}`;
}

/**
 * Older group links use `/groups/<group>?view=permalink&id=<post>`, which stays
 * behind the login wall, while `/groups/<group>/posts/<post>` serves Open
 * Graph metadata for public groups (observed Nov 2026).
 *
 * @param {string} url
 * @returns {?string} the `/groups/<group>/posts/<post>/` URL, or null
 */
function groupPostUrl(url) {
  try {
    const { pathname, searchParams } = new URL(url);
    const group = pathname.match(/^\/groups\/([^/]+)\/?$/);
    const post = (searchParams.get('id') || '').match(/^\d+/);
    if (!group || searchParams.get('view') !== 'permalink' || !post) {
      return null;
    }
    return `https://www.facebook.com/groups/${group[1]}/posts/${post[0]}/`;
  } catch (e) {
    return null;
  }
}

// Subdomains that serve the same content as www: the mobile site and locale
// hosts such as zh-tw. / ja-jp. Verified live for m. and ja-jp. (Nov 2026);
// other ll-cc. hosts are assumed to be locale variants of the same site.
// Other subdomains (developers., business., l. / lm. outbound wrappers, ...)
// are different sites or endpoints and are left alone.
const WWW_ALIAS_RE = /^(?:m|[a-z]{2}-[a-z]{2})\.facebook\.com$/i;

/**
 * The mobile and locale hosts serve the login wall to CofactsBot where www
 * serves Open Graph metadata for the same path, e.g. a public group post.
 *
 * @param {string} url
 * @returns {string} `url` on www.facebook.com when it is on a known alias host
 */
function onWwwHost(url) {
  try {
    const parsed = new URL(url);
    if (!WWW_ALIAS_RE.test(parsed.hostname)) return url;
    parsed.hostname = 'www.facebook.com';
    return parsed.toString();
  } catch (e) {
    return url;
  }
}

/**
 * Resolve a Facebook URL to one that serves Open Graph metadata to the
 * CofactsBot User-Agent, so the generic `fetchAndParseMeta` path can read it
 * without impersonating a crawler UA or booting a browser.
 *
 * Why this is needed after the shared `unshorten` step, based on
 * samples observed when this file was written:
 *   - `/share/...` links 302'd to `/login/?next=...` under a non-browser UA, so
 *     plain `unshorten` lands on the login page.
 *   - The `next` target for a photo post is a `photo.php` URL that has no page
 *     slug; in the observed samples it only ever redirected to login, so it
 *     was never crawlable directly.
 *   - The Embedded Post endpoint mapped that `photo.php` to the real
 *     `/<page>/posts/<id>` URL, which returned full Open Graph metadata (title,
 *     description, image) to CofactsBot.
 *   - Reels/videos/regular posts resolve straight through the redirect to a
 *     crawlable URL and need no embed lookup.
 *
 * @param {string} resolved a Facebook redirect target (caller gates on isFacebookUrl)
 * @param {string} originalUrl original input, retained for fallback
 * @returns {Promise<string>} the resolved URL, or the input URL when no better
 *   URL can be found (so the caller still falls back to the generic path).
 */
async function resolveFacebookUrl(resolved, originalUrl = resolved) {
  const next = loginWallTarget(resolved);
  const target = next || resolved;

  const storyPost = storyPostUrl(target);
  if (storyPost) return storyPost;

  if (isSluglessPhoto(target)) {
    const recovered = await recoverPostUrlViaEmbed(target);
    if (recovered) return recovered;
  }

  // No crawlable URL found (login wall with no recoverable target, or a
  // photo.php the embed could not map): return the original so the caller's
  // generic + puppeteer path still tries instead of a dead login / photo URL.
  if (isLoginUrl(target) || isSluglessPhoto(target)) return originalUrl;

  return onWwwHost(groupPostUrl(target) || target);
}

module.exports = { isFacebookUrl, outboundLinkTarget, resolveFacebookUrl };
