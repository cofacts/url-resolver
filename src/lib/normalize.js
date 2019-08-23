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

  normalized = normalized
    // Facebook --> mobile facebook or better webpage loading performance
    .replace(/^https?:\/\/www.facebook.com/i, 'https://m.facebook.com')
    // Remove facebook click id
    .replace(/[?&]fbclid=[^&]*&?/, '');

  return normalized;
}

module.exports = normalize;
