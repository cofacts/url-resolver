/* eslint-env browser */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');

const TIMEOUT = 5000;

const browserPromise = puppeteer.launch({
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});
browserPromise.then(() => {
  // eslint-disable-next-line no-console
  console.log(`Browser launched successfully.`);
});

const readabilityJsStr = fs.readFileSync(
  path.join(__dirname, '../vendor/Readability.js'),
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
 * @property {string} error
 */

/**
 * Fetches the given url
 * @param {string} url - The URL to scrap
 * @return {Promise<ScrapResult | null>}
 */
async function scrap(url) {
  const browser = await browserPromise;
  const page = await browser.newPage();

  // Automaticaly accept all alert() or confirm()
  page.on('dialog', async dialog => {
    // eslint-disable-next-line no-console
    console.info(`[Dialog(${dialog.type()})]`, dialog.message());
    await dialog.accept();
  });

  page.setDefaultNavigationTimeout(TIMEOUT);
  let response;

  const startTime = Date.now();
  try {
    response = await page.goto(url);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[scrap] ${url} - ${e}`);

    const errorStr = e.toString();

    switch (true) {
      case errorStr.startsWith('Error: Navigation Timeout Exceeded'):
        break; // Navigation is not a big deal, keep processing

      case errorStr.startsWith('Error: net::ERR_NAME_NOT_RESOLVED'):
        return {
          url,
          error: 'NAME_NOT_RESOLVED',
        };

      default:
        // unkown error, directly return
        return {
          url,
          error: 'UNKNOWN_SCRAP_ERROR',
        };
    }
  }
  const msSpent = Date.now() - startTime;

  const html = await page.content();

  // eslint-disable-next-line no-console
  console.info(`[GET] ${url} - ${html.length} - ${msSpent}ms`);

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

  // Don't instrument page.evaluate callbacks, or instrumented vars cov_xxxx will cause error!
  /* istanbul ignore next */
  const topImageUrl = await page.evaluate(() => {
    const ogImageMeta = document.querySelector(
      'meta[property="og:image"], meta[property="og:image:url"]'
    );
    if (ogImageMeta) return ogImageMeta.content;

    const contentImgs = Array.from(document.querySelectorAll('img'));
    if (contentImgs.length === 0) return '';

    const largestImg = contentImgs.slice(1).reduce((largestImage, img) => {
      return largestImage.width * largestImage.height >= img.width * img.height
        ? largestImage
        : img;
    }, contentImgs[0]);

    // src may be relative URL, resolve with current location.
    return new URL(largestImg.src, location.href).href;
  });

  // Returns article object by readibility.parse()
  // https://github.com/mozilla/readability#usage
  const resultArticle = await page.evaluate(`
    (function(){
      ${readabilityJsStr}
      ${executor}
      try {
        return executor();
      } catch (e) {
        console.error(e);

        // Returns simple rule data if readability.js fails
        const meta = document.querySelector('meta[name=description]');
        return {
          title: document.title,
          textContent: meta && meta.content,
        }
      }
    }())
  `);

  // If the whole page is empty due to any error, just return null
  if (!resultArticle)
    return {
      url,
      error: 'UNKNOWN_SCRAP_ERROR',
    };

  await page.close();

  return {
    url,
    canonical,
    title: resultArticle.title,
    summary: resultArticle.textContent ? resultArticle.textContent.trim() : '',
    topImageUrl,
    html,
    status: response ? response.status() : 0, // when timeout, response would be undefined
  };
}

module.exports = scrap;

// Exported for unit test to teardown
scrap.closeBrowser = async function closeBrowser() {
  const browser = await browserPromise;
  await browser.close();
};
