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

  // Facebook --> mobile facebook or better webpage loading performance
  normalized = normalized.replace(
    /^https?:\/\/www.facebook.com/i,
    'https://m.facebook.com'
  );

  return normalized;
}

module.exports = normalize;
