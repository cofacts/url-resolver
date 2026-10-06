const ScrapeResult = require('./ScrapeResult');

const PLACEHOLDERS = new Set([
  'threads',
  'home',
  'threads • log in',
  'search • threads',
  'instagram',
  '5xx server error',
]);

function isThreadsUrl(url) {
  try {
    return /(?:^|\.)threads\.(?:com|net)$/i.test(new URL(url).hostname);
  } catch (e) {
    return false;
  }
}

function isThreadsGone(url, status) {
  return (
    isThreadsUrl(url) &&
    (status === 410 ||
      new URL(url).searchParams.get('error') === 'invalid_post')
  );
}

// Apply platform rules to already-parsed metadata, without another fetch or DOM.
function applyThreadsMetadata(result, finalUrl, status) {
  if (!isThreadsUrl(finalUrl)) return result;
  if (isThreadsGone(finalUrl, status)) {
    return new ScrapeResult({ canonical: finalUrl, status: 410 });
  }
  result.canonical = finalUrl;
  const title = (result.title || '').trim().toLowerCase();
  const summary = (result.summary || '').trim();
  if (
    (!title || PLACEHOLDERS.has(title)) &&
    (!summary || /^Join Threads to share ideas/i.test(summary))
  ) {
    result.title = undefined;
    result.summary = undefined;
    result.topImageUrl = undefined;
  }
  return result;
}

module.exports = { isThreadsUrl, isThreadsGone, applyThreadsMetadata };
