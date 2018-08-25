/* eslint-env browser */

const puppeteer = require('puppeteer');
const path = require('path');
const fs = require('fs');

const readabilityJsStr = fs.readFileSync(
  path.join(__dirname, './node_modules/readability/Readability.js'),
  { encoding: 'utf-8' }
);

/**
 * Executed in puppeteer browser.
 * Don't instrument page.evaluate callbacks, or instrumented vars cov_xxxx will cause error!
 */
/* eslint-disable no-undef */
/* istanbul ignore next */
function executor() {
  return new Readability(document).parse();
}
/* eslint-enable no-undef */

/**
 * Return type for scrapUrls
 * @typedef {Object} ScrapResult
 * @property {string} url The original URL from text
 * @property {string} canonical Canonical URL
 * @property {string} title
 * @property {string} summary
 * @property {string} html
 * @property {string} topImageUrl
 * @property {integer} status fetch status. 0 if no response.
 */

/**
 * Fetches the given url
 * @param {browser} browser - Puppeteer browser instance
 * @param {string} url - The URL to scrap
 * @return {Promise<ScrapResult | null>}
 */
async function scrap(browser, url) {
  const page = await browser.newPage();

  page.setDefaultNavigationTimeout(5000);
  let response;
  try {
    response = await page.goto(url);
  } catch (e) {
    // Something like timeout. Do nothing.
  }

  const html = await page.content();

  // Don't instrument page.evaluate callbacks, or instrumented vars cov_xxxx will cause error!
  /* istanbul ignore next */
  const canonical = await page.evaluate(() => {
    const canonicalLink = document.querySelector('link[rel=canonical]');
    if (canonicalLink) return canonicalLink.href;

    const ogType = document.querySelector('meta[property="og:type"]');
    const isVideo = ogType && ogType.content.startsWith('video');
    const ogUrlMeta = document.querySelector('meta[property="og:url"]');
    if (!isVideo && ogUrlMeta) return ogUrlMeta.content;

    return window.location.href;
  });


  const resultArticle = await page.evaluate(`
    (function(){
      ${readabilityJsStr}
      ${executor}
      return executor();
    }())
  `);

  // If the whole page is empty due to any error, just return null
  if (!resultArticle) return null;

  // Don't instrument page.evaluate callbacks, or instrumented vars cov_xxxx will cause error!
  /* istanbul ignore next */
  const topImageUrl = await page.evaluate(contentHTML => {
    const ogImageMeta = document.querySelector(
      'meta[property="og:image"], meta[property="og:image:url"]'
    );
    if (ogImageMeta) return ogImageMeta.content;

    const containerDiv = document.createElement('div');
    containerDiv.innerHTML = contentHTML;
    const contentImgs = Array.from(containerDiv.querySelectorAll('img'));
    if (contentImgs.length === 0) return '';

    const largestImg = contentImgs.slice(1).reduce((largestImage, img) => {
      return largestImage.width * largestImage.height >= img.width * img.height
        ? largestImage
        : img;
    }, contentImgs[0]);

    // src may be relative URL, resolve with current location.
    return new URL(largestImg.src, location.href).href;
  }, resultArticle.content);

  page.close();

  return {
    url,
    canonical,
    title: resultArticle.title,
    summary: resultArticle.textContent.trim(),
    topImageUrl,
    html,
    status: response ? response.status() : 0,
  };
}

module.exports = scrap;
