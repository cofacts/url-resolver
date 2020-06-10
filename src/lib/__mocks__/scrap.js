const ScrapResult = require('../ScrapResult');

const getResult = url =>
  new ScrapResult({
    title: 't',
    summary: 's',
    canonical: url,
    topImageUrl: 't',
  });

const mod = jest
  .fn()
  .mockImplementation(obj => Promise.resolve(getResult(obj.id)));

const PAGE_COUNT = 3;

const pages = () =>
  Promise.resolve(
    [...Array(PAGE_COUNT)].map((_, idx) => ({
      title: () => Promise.resolve(`Page ${idx}`),
      url: () => `url ${idx}`,
      metrics: () =>
        Promise.resolve({
          timestamp: 123456789,
          documents: idx,
          frames: idx,
          js_event_listeners: idx,
          nodes: idx,
          js_heap_used_size: 512384,
          js_heap_total_size: 1024768,
        }),
    }))
  );

const getBrowserPromise = () =>
  Promise.resolve({
    pages,
    version: () => Promise.resolve('browser version'),
  });

module.exports = mod;
mod.getResult = getResult;

mod.getBrowserPromise = getBrowserPromise;
mod.pageCount = PAGE_COUNT; // Only in this mocked module;
