/* eslint-env browser */
const path = require('path');
const fs = require('fs');
const puppeteer = require('puppeteer');
const { TimeoutError } = require('puppeteer/Errors');
const ResolveError = require('./ResolveError');
const rollbar = require('./rollbar');

const FETCHING_TIMEOUT = 5000;
const PROCESSING_TIMEOUT = 1000;

let browserPromise;
let isBrowserClosing = false;

/**
 * Launch Google Chrome and sets browserPromise
 */
function launchBrowser() {
  browserPromise = puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    // devtools: true,
  });
  browserPromise.then(browser => {
    // eslint-disable-next-line no-console
    console.log(`Browser launched successfully.`);

    // Some page may use window.open() to open extra pages.
    // We should close them when such page is detected.
    //
    browser.on('targetcreated', async target => {
      const opener = target.opener();
      if (opener) {
        // eslint-disable-next-line no-console
        console.info(
          `[targetcreated] Extra page "${target.url()}" opened by "${opener.url()}". Closing.`
        );

        const page = await target.page();
        if (page) page.close();
      }
    });

    // Google Chrome sometimes crashes, needs re-launch
    // https://github.com/cofacts/url-resolver/issues/9
    //
    browser.on('disconnected', () => {
      // Ignore the case when close() is invoked
      if (isBrowserClosing) return;

      rollbar.warn('Puppeteer disconnected from Chrome');
      launchBrowser();
    });
  });
}

launchBrowser();

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
 * Stops page navigation; equal to pressing "stop" button in browser.
 * We put this to prevent other evaluation throws "context was destroyed, most likely because of a navigation"
 *
 * @param {Page} page
 */
async function stop(page) {
  try {
    /* istanbul ignore next */
    await page.evaluate(() => {
      window.stop();
    });
  } catch (e) {
    // Probably "Execution context was destroyed, most likely because of a navigation"
    // but window.stop() will still do its job. Don't throw here.
  }
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
  const page = await browser.newPage();

  // Automaticaly accept all alert() or confirm()
  page.on('dialog', async dialog => {
    // eslint-disable-next-line no-console
    console.info(`[Dialog(${dialog.type()})]`, dialog.message());
    await dialog.accept();
  });

  let response;

  const startTime = Date.now();
  try {
    response = await page.goto(url, {
      waitUntil: 'networkidle0',
      timeout: FETCHING_TIMEOUT,
    });
  } catch (e) {
    const errorStr = e.toString();

    switch (true) {
      case e instanceof TimeoutError:
        break; // Timeout is not a big deal, keep processing

      case errorStr.startsWith('Error: Protocol error'):
        await page.close();
        throw new ResolveError('INVALID_URL', e);

      case errorStr.startsWith('Error: net::ERR_NAME_NOT_RESOLVED'):
        await page.close();
        throw new ResolveError('NAME_NOT_RESOLVED', e);

      case errorStr.startsWith('Error: net::ERR_ABORTED'):
        // See: https://github.com/GoogleChrome/puppeteer/issues/2794#issuecomment-400512765
        await page.close();
        throw new ResolveError('UNSUPPORTED', e);

      default:
        rollbar.error(e, '[scrap] page.goto() Error', { url });

        // unkown error, directly return
        await page.close();
        throw new ResolveError('UNKNOWN_SCRAP_ERROR', e);
    }
  }
  if (response) {
    const contentType = response.headers()['content-type'];
    if (contentType && !contentType.toLowerCase().startsWith('text/html')) {
      // Fixes: https://rollbar.com/mrorz/url-resolver/items/16/
      await page.close();
      throw new ResolveError(
        'UNSUPPORTED',
        new Error(`Unsupported content type: ${contentType}`)
      );
    }
  }

  const msSpent = Date.now() - startTime;

  let html;

  await stop(page);

  try {
    html = await page.content();
  } catch (e) {
    // Maybe context destroyed error (caused by JS / HTML redirects)
    await page.close();
    throw new ResolveError('UNKNOWN_SCRAP_ERROR', e);
  }

  // eslint-disable-next-line no-console
  console.info(`[GET] ${url} - ${html.length} - ${msSpent}ms`);

  // Reload the page with Javascript disabled to provide a clear JS environment under the current
  // location, so that readability.js can be run under a polyfill-free environment.
  //
  // Ref: https://github.com/cofacts/url-resolver/issues/4
  //
  await page.setJavaScriptEnabled(false);
  try {
    await page.reload({
      waitUntil: 'networkidle0',
      timeout: PROCESSING_TIMEOUT,
    });
  } catch (e) {
    if (!(e instanceof TimeoutError)) {
      await page.close();
      throw new ResolveError('UNKNOWN_SCRAP_ERROR', e);
    }
  }

  await stop(page);

  // Set content to the HTML that was loaded by JS before
  //
  try {
    await page.setContent(html);
    await page.waitForNavigation({
      waitUntil: 'networkidle2',
      timeout: PROCESSING_TIMEOUT,
    });
  } catch (e) {
    if (!(e instanceof TimeoutError)) {
      await page.close();
      throw new ResolveError('UNKNOWN_SCRAP_ERROR', e);
    }
  }

  await stop(page);

  let canonical;
  try {
    // Don't instrument page.evaluate callbacks, or instrumented vars cov_xxxx will cause error!
    /* istanbul ignore next */
    canonical = await page.evaluate(() => {
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
    await page.close();
    throw new ResolveError('UNKNOWN_SCRAP_ERROR', e);
  }

  // For URLs that cannot navigate properly
  if (canonical === 'about:blank') {
    await page.close();
    throw new ResolveError(
      'UNSUPPORTED',
      new Error(`Cannot navigate to ${url}`)
    );
  }

  let topImageUrl = '';
  try {
    // Don't instrument page.evaluate callbacks, or instrumented vars cov_xxxx will cause error!
    /* istanbul ignore next */
    topImageUrl = await page.evaluate(() => {
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

    rollbar.error(e, '[scrap] topImageUrl error', { url });
  }

  // Returns article object by readibility.parse()
  // https://github.com/mozilla/readability#usage
  let resultArticle;
  try {
    resultArticle = await page.evaluate(`
      (function(){
        ${readabilityJsStr}
        ${executor}
        return executor();
      }())
    `);
  } catch (e) {
    rollbar.error(e, '[scrap] executor error', { url });
  }

  // Try a second time, using simpler approach
  if (!resultArticle) {
    try {
      // Returns simple rule data if readability.js fails
      /* istanbul ignore next */
      resultArticle = await page.evaluate(() => {
        const meta = document.querySelector('meta[name=description]');
        return {
          title: document.title,
          textContent: meta && meta.content,
        };
      });
    } catch (e) {
      rollbar.error(e, '[scrap] executor-fallback', { url });
    }
  }

  await page.close();

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

/**
 * Closing browser. After closing, the url-resolver can never be used again.
 * Should only use after unit tests.
 */
scrap.closeBrowser = async () => {
  isBrowserClosing = true;
  const browser = await browserPromise;
  browser.close();
};
