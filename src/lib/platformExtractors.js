const { isThreadsUrl, extractThreads } = require('./extractThreads');

// Host-specific extractors. Each entry maps a URL predicate to an extractor
// that reads an already-parsed DOM (+ raw html + url) and returns the
// platform-corrected { title, summary, topImageUrl }. Adding a platform is a
// single append here — it costs no extra network fetch or DOM parse because the
// caller fetches and parses once, then dispatches.
const PLATFORM_EXTRACTORS = [{ match: isThreadsUrl, extract: extractThreads }];

/**
 * @param {string} url
 * @returns {?Function} the matching platform extractor, or null for generic URLs
 */
function platformExtractorFor(url) {
  const entry = PLATFORM_EXTRACTORS.find(candidate => candidate.match(url));
  return entry ? entry.extract : null;
}

module.exports = { platformExtractorFor };
