/* eslint-env browser */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { TimeoutError } = require('puppeteer/Errors');
const ResolveError = require('./ResolveError');

const FETCHING_TIMEOUT = 5000;
const PROCESSING_TIMEOUT = 1000;

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
  const fetchingPage = await browser.newPage();

  // Automaticaly accept all alert() or confirm()
  fetchingPage.on('dialog', async dialog => {
    // eslint-disable-next-line no-console
    console.info(`[Dialog(${dialog.type()})]`, dialog.message());
    await dialog.accept();
  });

  fetchingPage.setDefaultNavigationTimeout(FETCHING_TIMEOUT);
  let response;

  const startTime = Date.now();
  try {
    response = await fetchingPage.goto(url, { waitUntil: 'networkidle0' });
  } catch (e) {
    const errorStr = e.toString();

    switch (true) {
      case e instanceof TimeoutError:
        break; // Timeout is not a big deal, keep processing

      case errorStr.startsWith('Error: Protocol error'):
        await fetchingPage.close();
        throw new ResolveError('INVALID_URL', e);

      case errorStr.startsWith('Error: net::ERR_NAME_NOT_RESOLVED'):
        await fetchingPage.close();
        throw new ResolveError('NAME_NOT_RESOLVED', e);

      case errorStr.startsWith('Error: net::ERR_ABORTED'):
        // See: https://github.com/GoogleChrome/puppeteer/issues/2794#issuecomment-400512765
        await fetchingPage.close();
        throw new ResolveError('UNSUPPORTED', e);

      default:
        // eslint-disable-next-line no-console
        console.error(`[scrap][goto] ${url} - ${e}`);

        // unkown error, directly return
        await fetchingPage.close();
        throw new ResolveError('UNKNOWN_SCRAP_ERROR', e);
    }
  }
  const msSpent = Date.now() - startTime;

  let html;
  let canonical;
  try {
    html = await fetchingPage.content();

    // eslint-disable-next-line no-console
    console.info(`[GET] ${url} - ${html.length} - ${msSpent}ms`);

    // Don't instrument page.evaluate callbacks, or instrumented vars cov_xxxx will cause error!
    /* istanbul ignore next */
    canonical = await fetchingPage.evaluate(() => {
      const canonicalLink = document.querySelector('link[rel=canonical]');
      if (canonicalLink) return canonicalLink.href;

      const ogType = document.querySelector('meta[property="og:type"]');
      const isVideo = ogType && ogType.content.startsWith('video');
      const ogUrlMeta = document.querySelector('meta[property="og:url"]');
      if (!isVideo && ogUrlMeta) return ogUrlMeta.content;

      return window.location.href;
    });
  } catch (e) {
    // Maybe context destroyed error (caused by JS / HTML redirects)
    await fetchingPage.close();
    throw new ResolveError('UNKNOWN_SCRAP_ERROR', e);
  }

  // For URLs that cannot navigate properly
  if (canonical === 'about:blank') {
    await fetchingPage.close();
    throw new ResolveError(
      'UNSUPPORTED',
      new Error(`Cannot navigate to ${url}`)
    );
  }
  let topImageUrl = '';
  try {
    // Don't instrument page.evaluate callbacks, or instrumented vars cov_xxxx will cause error!
    /* istanbul ignore next */
    topImageUrl = await fetchingPage.evaluate(() => {
      const ogImageMeta = document.querySelector(
        'meta[property="og:image"], meta[property="og:image:url"]'
      );
      if (ogImageMeta) return ogImageMeta.content;

      const contentImgs = Array.from(document.querySelectorAll('img'));
      if (contentImgs.length === 0) return '';

      const largestImg = contentImgs.slice(1).reduce((largestImage, img) => {
        return largestImage.width * largestImage.height >=
          img.width * img.height
          ? largestImage
          : img;
      }, contentImgs[0]);

      // src may be relative URL, resolve with current location.
      return new URL(largestImg.src, location.href).href;
    });
  } catch (e) {
    // Cannot get top image URL is not a big deal, just log error

    // eslint-disable-next-line no-console
    console.error(`[scrap][topImageUrl] ${url} - ${e}`);
  }

  await fetchingPage.close();

  // Restart a fresh page with the same URL but no Javascript enabled,
  // so that readability.js can be run under a polyfill-free environment.
  //
  // Ref: https://github.com/cofacts/url-resolver/issues/4
  //

  const processingPage = await browser.newPage();
  await processingPage.setDefaultNavigationTimeout(PROCESSING_TIMEOUT);
  await processingPage.setJavaScriptEnabled(false);

  try {
    await processingPage.setContent(html);
    await processingPage.waitForNavigation({ waitUntil: 'networkidle2' });
  } catch (e) {
    if (!(e instanceof TimeoutError)) {
      await processingPage.close();
      throw new ResolveError('UNKNOWN_SCRAP_ERROR', e);
    }
  }

  // Returns article object by readibility.parse()
  // https://github.com/mozilla/readability#usage
  let resultArticle;
  try {
    resultArticle = await processingPage.evaluate(`
      (function(){
        ${readabilityJsStr}
        ${executor}
        return executor();
      }())
    `);
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error(`[scrap][executor] ${url} - ${e}`);
  }

  // Try a second time, using simpler approach
  if (!resultArticle) {
    try {
      // Returns simple rule data if readability.js fails
      /* istanbul ignore next */
      resultArticle = await processingPage.evaluate(() => {
        const meta = document.querySelector('meta[name=description]');
        return {
          title: document.title,
          textContent: meta && meta.content,
        };
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[scrap][executor-fallback] ${url} - ${e}`);
    }
  }

  await processingPage.close();

  // If we still cannot get resultArticle, throw
  if (!resultArticle) {
    throw new ResolveError('UNKNOWN_SCRAP_ERROR');
  }

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

scrap.getBrowserPromise = () => browserPromise;
