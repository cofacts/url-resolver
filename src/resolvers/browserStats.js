const { getBrowserPromise } = require('../lib/scrap');

module.exports = {
  Query: {
    browserStats: () => getBrowserPromise(),
  },
  BrowserStats: {
    version: browser => browser.version(),
    pageCount: async browser => {
      const pages = await browser.pages();
      return pages.length;
    },
    pages: browser => browser.pages(),
  },
  BrowserPage: {
    title: page => page.title(),
    url: page => page.url(),
    metrics: page => page.metrics(),
  },
};
