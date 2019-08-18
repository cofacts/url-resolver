const { getBrowserPromise } = require('../lib/scrap');

const getBrowserStats = async (_, callback) => {
  const browser = await getBrowserPromise();
  const rawPages = await browser.pages();
  const pages = [];
  for (let i = 0; i < rawPages.length; i += 1) {
    const page = rawPages[i];
    const rawMetrics = await page.metrics();
    const metrics = {
      timestamp: rawMetrics.TimeStamp,
      documents: rawMetrics.Documents,
      frames: rawMetrics.Frames,
      js_event_listeners: rawMetrics.JSEventListeners,
      nodes: rawMetrics.Nodes,
      js_heap_used_size: rawMetrics.JSHeapUsedSize,
      js_heap_total_size: rawMetrics.JSHeapTotalSize,
    };
    pages.push({
      title: await page.title(),
      url: page.url(),
      metrics,
    });
  }

  callback(null, {
    version: await browser.version(),
    pages,
    page_count: pages.length,
  });
};

module.exports = { getBrowserStats };
