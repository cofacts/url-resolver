jest.mock('../../lib/scrape');
const scrape = require('../../lib/scrape');
const { getBrowserStats } = require('../browser');
const { pageCount } = require('../../lib/scrape');
// pageCount is only for testing; it doesn't exist in the real module.

describe('browser', () => {
  const originalGetBrowserPromise = scrape.getBrowserPromise;
  afterEach(() => {
    scrape.getBrowserPromise = originalGetBrowserPromise;
  });

  it('should get browser stats', done => {
    const callback = (_, res) => {
      expect(res).toHaveProperty('version');
      expect(res).toHaveProperty('pages');
      expect(res.page_count).toBe(pageCount);
      expect(res.pages[0]).toHaveProperty('title');
      expect(res.pages[0]).toHaveProperty('url');
      expect(res.pages[0]).toHaveProperty('metrics');
      const metrics = res.pages[0].metrics;
      const metricsProperties = [
        'timestamp',
        'documents',
        'frames',
        'js_event_listeners',
        'nodes',
        'js_heap_used_size',
        'js_heap_total_size',
      ];
      metricsProperties.map(property =>
        expect(metrics).toHaveProperty(property)
      );
      done();
    };
    getBrowserStats(undefined, callback);
  });

  it('returns empty stats when no browser session is active', done => {
    scrape.getBrowserPromise = () => Promise.resolve(undefined);
    const callback = (err, res) => {
      expect(err).toBeNull();
      expect(res.page_count).toBe(0);
      expect(res.pages).toEqual([]);
      expect(res).toHaveProperty('version');
      done();
    };
    getBrowserStats(undefined, callback);
  });
});
