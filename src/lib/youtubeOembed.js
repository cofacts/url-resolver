const fetch = require('node-fetch');
const { AbortController } = global;

const FETCH_TIMEOUT = 5000; // ms
const { USER_AGENT } = require('./cofactsBotFetch');

// Since Nov 2026 YouTube serves video pages without Open Graph tags and with
// the title "<blank> - YouTube" to clients outside its crawler allowlist
// (facebookexternalhit, Twitterbot, Googlebot... get them; CofactsBot and a
// desktop Chrome UA do not). Its oEmbed endpoint still answers anyone, for
// watch, shorts, live, music and playlist URLs.

/**
 * @param {string} url
 * @returns {boolean}
 */
function isYouTubeUrl(url) {
  try {
    return /(?:^|\.)(?:youtube\.com|youtu\.be)$/i.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
}

/**
 * A title YouTube serves in place of the video's: "YouTube", " - YouTube".
 *
 * @param {?string} title
 * @returns {boolean}
 */
function isPlaceholderTitle(title) {
  return /^\s*(?:-\s*)?YouTube\s*$/.test(title || '');
}

/**
 * @param {string} url YouTube URL
 * @returns {Promise<?{title: string, topImageUrl: ?string}>} null when the
 *   endpoint fails or rejects the URL (removed, private or not a video)
 */
async function readYouTubeOembed(url) {
  const endpoint =
    'https://www.youtube.com/oembed?' +
    new URLSearchParams({ url, format: 'json' }).toString();

  const controller = new AbortController();
  try {
    const res = await fetch(endpoint, {
      signal: controller.signal,
      timeout: FETCH_TIMEOUT,
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data.title !== 'string' || !data.title) return null;
    return {
      title: data.title,
      topImageUrl: data.thumbnail_url || undefined,
    };
  } catch (e) {
    return null;
  } finally {
    controller.abort();
  }
}

module.exports = { isYouTubeUrl, isPlaceholderTitle, readYouTubeOembed };
