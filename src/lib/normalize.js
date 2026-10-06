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
    normalized = new URL(normalized).toString();
  } catch (e) {
    throw new ResolveError(ResolveErrorEnum.INVALID_URL, e);
  }

  normalized = normalized
    // Remove facebook click id
    .replace(/[?&]fbclid=[^&]*&?/, '');

  return normalized;
}

module.exports = normalize;
