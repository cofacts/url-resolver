const ResolveError = require('./ResolveError');
// eslint-disable-next-line node/no-unpublished-require
const { ResolveError: ResolveErrorEnum } = require('./resolve_error_pb');

/**
 * @param {string} url
 * @returns {string} Normalized url with protocol, etc
 */
function normalize(url) {
  let normalized = url;

  // Protocol normalization
  if (!normalized.match(/^[^:]+:\/\//)) {
    normalized = `http://${normalized}`;
  }

  try {
    const parsed = new URL(normalized);
    // Delete query parameters structurally, preserving separators and fragments.
    // Avoid reserializing the query at all when there is no click ID to remove.
    if (parsed.searchParams.has('fbclid')) parsed.searchParams.delete('fbclid');
    normalized = parsed.toString();
  } catch (e) {
    throw new ResolveError(ResolveErrorEnum.INVALID_URL, e);
  }

  return normalized;
}

module.exports = normalize;
