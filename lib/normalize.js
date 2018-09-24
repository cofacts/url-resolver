/**
 * @param {string} url
 * @returns {string} Normalized url with protocol, etc
 */
function normalize(url) {
  // Return if contains protocol
  if (url.match(/^[^:]+:\/\//)) {
    return url;
  }

  // Prefix with http:// if protocol is missing
  return `http://${url}`;
}

module.exports = normalize;
