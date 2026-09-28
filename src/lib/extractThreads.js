// Threads (threads.com / threads.net) metadata extraction.
//
// Threads is special-cased only for correctness, not to reshape the title: its
// own og:title (an account label like "Name (@handle) on Threads"),
// og:description (the post body) and og:image are used as-is, the same way
// other social platforms are surfaced. The special handling only covers two
// cases that generic Open Graph parsing would get wrong:
//   - a deleted post 302s to threads.com/?error=invalid_post and must be
//     reported gone, not resolved to the login page;
//   - a login / "Home" shell serves a placeholder title plus a "Join
//     Threads..." boilerplate description that must not be surfaced as the
//     post's content.

const THREADS_HOSTNAME = /(?:^|\.)threads\.(?:com|net)$/i;

// Case-insensitive placeholder og:title values Threads serves on the login /
// Home shell instead of a real post.
const PLACEHOLDER_TITLES = new Set([
  'threads',
  'home',
  'threads • log in',
  'search • threads',
  'instagram',
  '5xx server error',
]);

// og:description boilerplate served with the login wall; not post content.
const LOGIN_WALL_BODY_RE = /^Join Threads to share ideas/i;

/**
 * @param {string} url
 * @returns {boolean} whether the URL points to Threads (threads.com / .net)
 */
function isThreadsUrl(url) {
  try {
    return THREADS_HOSTNAME.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
}

/**
 * A Threads share/post link whose target post no longer resolves 302s to
 * `threads.com/?error=invalid_post`. Match only that known-permanent code:
 * other `?error=` values (should any exist) are left to the normal login-wall
 * path so a live-but-gated post is not wrongly reported as gone.
 * @param {string} finalUrl the URL after redirects
 * @returns {boolean}
 */
function isThreadsUnavailable(finalUrl) {
  try {
    const u = new URL(finalUrl);
    return (
      THREADS_HOSTNAME.test(u.hostname) &&
      u.searchParams.get('error') === 'invalid_post'
    );
  } catch (e) {
    return false;
  }
}

/**
 * @param {{querySelector: Function}} document linkedom/DOM document
 * @param {string} property meta property or name
 * @returns {string}
 */
function metaContent(document, property) {
  const el =
    document.querySelector(`meta[property="${property}"]`) ||
    document.querySelector(`meta[name="${property}"]`);
  return (el && el.getAttribute('content')) || '';
}

/**
 * @param {{querySelector: Function}} document DOM document
 * @param {string} html raw HTML (unused; kept for the platform-extractor interface)
 * @param {string} url the final post URL after redirects (for the gone check)
 * @returns {{title?: string, summary?: string, topImageUrl?: string, isUnavailable?: boolean}}
 */
// eslint-disable-next-line no-unused-vars
function extractThreads(document, html, url) {
  if (isThreadsUnavailable(url)) {
    return { isUnavailable: true };
  }

  const ogTitle = metaContent(document, 'og:title').trim();
  const ogDescription = metaContent(document, 'og:description').trim();
  const ogImage =
    metaContent(document, 'og:image') || metaContent(document, 'og:image:url');

  // Login / "Home" shell: a placeholder title together with the login
  // boilerplate (or no description) means this is not the post. Return no
  // content (rather than surfacing the boilerplate) so the result stays
  // incomplete and the caller falls back to puppeteer.
  const titleIsPlaceholder =
    !ogTitle || PLACEHOLDER_TITLES.has(ogTitle.toLowerCase());
  const bodyIsBoilerplate =
    !ogDescription || LOGIN_WALL_BODY_RE.test(ogDescription);
  if (titleIsPlaceholder && bodyIsBoilerplate) {
    return {};
  }

  let topImageUrl;
  if (ogImage) {
    try {
      topImageUrl = new URL(ogImage, url).href;
    } catch (e) {
      topImageUrl = undefined;
    }
  }

  return {
    title: ogTitle || undefined,
    summary: ogDescription || undefined,
    topImageUrl,
  };
}

module.exports = { isThreadsUrl, extractThreads };
