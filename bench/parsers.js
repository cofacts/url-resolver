/**
 * Parse-only helpers for the benchmark.
 *
 * These wrap the DOM-creation + Readability + metadata extraction that
 * src/lib/extractStatic.js and src/lib/extractStaticJsdom.js also run on
 * a live HTTP response, without the fetch step. This lets bench/parse.js
 * measure only the DOM + Readability cost on cached HTML.
 *
 * The post-DOM logic MUST stay structurally identical to the two
 * extractors' post-DOM logic. bench/parity.js compares the outputs to
 * detect drift.
 */

const { parseHTML } = require('linkedom');
const { JSDOM } = require('jsdom');
const { Readability } = require('@mozilla/readability');

function pickMeta(document, ...selectors) {
  for (const selector of selectors) {
    const el = document.querySelector(selector);
    if (el && el.getAttribute('content')) return el.getAttribute('content');
  }
  return '';
}

function extractFromDocument(document, finalUrl) {
  const canonicalEl = document.querySelector('link[rel=canonical]');
  let canonical =
    (canonicalEl && canonicalEl.getAttribute('href')) ||
    pickMeta(document, 'meta[property="og:url"]') ||
    finalUrl;
  try {
    canonical = new URL(canonical, finalUrl).href;
  } catch (e) {
    canonical = finalUrl;
  }

  let topImageUrl = '';
  const ogImage = pickMeta(
    document,
    'meta[property="og:image"]',
    'meta[property="og:image:url"]',
    'meta[name="twitter:image"]'
  );
  if (ogImage) {
    try {
      topImageUrl = new URL(ogImage, canonical).href;
    } catch (e) {
      topImageUrl = '';
    }
  }

  let article = null;
  try {
    article = new Readability(document).parse();
  } catch (e) {
    article = null;
  }

  const title =
    (article && article.title && article.title.trim()) ||
    pickMeta(document, 'meta[property="og:title"]') ||
    (document.title || '').trim();

  const summary =
    (article && article.textContent && article.textContent.trim()) ||
    pickMeta(
      document,
      'meta[property="og:description"]',
      'meta[name=description]'
    );

  return {
    title: title || null,
    summary: summary || null,
    canonical,
    topImageUrl: topImageUrl || null,
  };
}

function parseLinkedom(html, finalUrl) {
  const { document } = parseHTML(html);
  return extractFromDocument(document, finalUrl);
}

function parseJsdom(html, finalUrl) {
  const dom = new JSDOM(html, { url: finalUrl });
  try {
    return extractFromDocument(dom.window.document, finalUrl);
  } finally {
    dom.window.close();
  }
}

module.exports = { parseLinkedom, parseJsdom };
