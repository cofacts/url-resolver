const ScrapeResult = require('./ScrapeResult');

// Why this module exists: the shared metadata parser (fetchAndParseMeta)
// already reads Threads' Open Graph tags like any other site, so this module
// adds no separate fetch or DOM parser. It only layers on two Threads-specific
// judgments the generic parser can't make on its own: recognizing placeholder
// responses that aren't real post content, and recognizing confirmed-gone
// responses that should skip Puppeteer entirely.
//
// Threads has no documented API for either of those signals. Both judgments
// below were reverse-engineered from observed responses when this file was
// written (Oct 2026) and are not stable contracts — Meta can change page
// titles, add new locales, or alter wording at any time without notice.
// These two judgments carry different risk and should not be edited under
// one blanket rule:
//
// 1. Placeholder detection (PLACEHOLDERS, used below) clears metadata fields
//    so isIncomplete is true and Puppeteer gets a chance to try rendering the
//    page properly — but if that clearing is wrong (real content wiped) and
//    Puppeteer then fails or also can't extract the content, that real
//    content is lost, not just re-fetched at extra cost. Under-matching
//    (missing a new placeholder string) means a login/placeholder response
//    leaks through as if it were real content instead. Over-matching (e.g. a
//    real post titled "Home") only clears when the summary is ALSO empty or
//    matches the login-wall pattern below — a real post titled "Home" with
//    real body text is not affected.
//
// 2. isThreadsGone() is high-risk: a positive match returns HTTP 410 and
//    SKIPS Puppeteer entirely, so there's no second chance to recover real
//    content. Before adding a new "gone" condition, confirm it's a genuine,
//    stable deletion signal — not a transient error, a region/login
//    restriction, or a soft-block that a browser render could still get past.
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
