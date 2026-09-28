jest.mock(
  'puppeteer',
  () => ({
    TimeoutError: class TimeoutError extends Error {},
    launch: jest.fn(),
  }),
  { virtual: true }
);
jest.mock('puppeteer-core', () => ({ connect: jest.fn() }), { virtual: true });
jest.mock('../launchOrConnect', () => jest.fn());
jest.mock('../rollbar', () => ({ warn: jest.fn(), error: jest.fn() }));

describe('scrape request interception', () => {
  const ORIGINAL_ENV = process.env;
  let launchOrConnect;
  let mockPage;
  let mockBrowser;
  let requestHandler;

  function setupMocks() {
    requestHandler = undefined;
    mockPage = {
      setRequestInterception: jest.fn().mockResolvedValue(),
      setUserAgent: jest.fn().mockResolvedValue(),
      on: jest.fn((event, handler) => {
        if (event === 'request') requestHandler = handler;
      }),
      goto: jest.fn().mockResolvedValue({
        headers: () => ({ 'content-type': 'text/html' }),
        status: () => 200,
      }),
      content: jest.fn().mockResolvedValue('<html><body></body></html>'),
      setJavaScriptEnabled: jest.fn().mockResolvedValue(),
      reload: jest.fn().mockResolvedValue(),
      setContent: jest.fn().mockResolvedValue(),
      waitForNavigation: jest.fn().mockResolvedValue(),
      evaluate: jest
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce('https://canonical.test/')
        .mockResolvedValueOnce('https://image.test/img.jpg')
        .mockResolvedValueOnce({ title: 'T', textContent: 'Body' }),
      close: jest.fn().mockResolvedValue(),
    };
    mockBrowser = {
      newPage: jest.fn().mockResolvedValue(mockPage),
      userAgent: jest
        .fn()
        .mockResolvedValue(
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/148.0.0.0 Safari/537.36'
        ),
      on: jest.fn(),
    };
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SCRAPE_BLOCK_RESOURCES;
    setupMocks();
    launchOrConnect = require('../launchOrConnect');
    launchOrConnect.mockReturnValue(Promise.resolve(mockBrowser));
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('blocks image, media, font by default and continues other types', async () => {
    const scrape = require('../scrape');
    await scrape('https://example.test/');

    expect(mockPage.setRequestInterception).toHaveBeenCalledWith(true);
    expect(requestHandler).toBeDefined();

    ['image', 'media', 'font'].forEach(type => {
      const req = {
        resourceType: () => type,
        abort: jest.fn().mockResolvedValue(),
        continue: jest.fn().mockResolvedValue(),
      };
      requestHandler(req);
      expect(req.abort).toHaveBeenCalledTimes(1);
      expect(req.continue).not.toHaveBeenCalled();
    });

    ['document', 'stylesheet', 'script', 'xhr', 'fetch'].forEach(type => {
      const req = {
        resourceType: () => type,
        abort: jest.fn().mockResolvedValue(),
        continue: jest.fn().mockResolvedValue(),
      };
      requestHandler(req);
      expect(req.continue).toHaveBeenCalledTimes(1);
      expect(req.abort).not.toHaveBeenCalled();
    });
  });

  it('honors SCRAPE_BLOCK_RESOURCES override', async () => {
    process.env.SCRAPE_BLOCK_RESOURCES = 'script, xhr';
    const scrape = require('../scrape');
    await scrape('https://example.test/');

    expect(mockPage.setRequestInterception).toHaveBeenCalledWith(true);

    const reqImage = {
      resourceType: () => 'image',
      abort: jest.fn().mockResolvedValue(),
      continue: jest.fn().mockResolvedValue(),
    };
    requestHandler(reqImage);
    expect(reqImage.continue).toHaveBeenCalled();

    const reqScript = {
      resourceType: () => 'script',
      abort: jest.fn().mockResolvedValue(),
      continue: jest.fn().mockResolvedValue(),
    };
    requestHandler(reqScript);
    expect(reqScript.abort).toHaveBeenCalled();
  });

  it('skips interception when SCRAPE_BLOCK_RESOURCES is empty', async () => {
    process.env.SCRAPE_BLOCK_RESOURCES = '';
    const scrape = require('../scrape');
    await scrape('https://example.test/');

    expect(mockPage.setRequestInterception).not.toHaveBeenCalled();
    expect(requestHandler).toBeUndefined();
  });

  it('swallows abort/continue rejection when page closes mid-flight', async () => {
    const scrape = require('../scrape');
    await scrape('https://example.test/');

    const rejectedAbort = {
      resourceType: () => 'image',
      abort: jest.fn().mockRejectedValue(new Error('Target closed')),
      continue: jest.fn().mockResolvedValue(),
    };
    const rejectedContinue = {
      resourceType: () => 'document',
      abort: jest.fn().mockResolvedValue(),
      continue: jest.fn().mockRejectedValue(new Error('Target closed')),
    };

    expect(() => requestHandler(rejectedAbort)).not.toThrow();
    expect(() => requestHandler(rejectedContinue)).not.toThrow();

    await new Promise(r => setImmediate(r));
  });

  it('sets a desktop Chrome UA with the Headless token stripped', async () => {
    const scrape = require('../scrape');
    await scrape('https://example.test/');

    expect(mockPage.setUserAgent).toHaveBeenCalledTimes(1);
    const ua = mockPage.setUserAgent.mock.calls[0][0];
    expect(ua).toContain('Chrome/148.0.0.0');
    expect(ua).not.toContain('HeadlessChrome');
  });

  it('honors SCRAPE_USER_AGENT override', async () => {
    process.env.SCRAPE_USER_AGENT = 'MyBot/9.9';
    const scrape = require('../scrape');
    await scrape('https://example.test/');

    expect(mockPage.setUserAgent).toHaveBeenCalledWith('MyBot/9.9');
    expect(mockBrowser.userAgent).not.toHaveBeenCalled();
  });

  it('reloads the SSR DOM and extracts it when setContent fails (Trusted-Types CSP)', async () => {
    // setContent's document.open() empties the DOM before document.write() is
    // rejected, so the earlier reloaded DOM is gone. scrape must reload once
    // more to restore the SSR DOM (the first reload is the JS-disabled one).
    mockPage.setContent.mockRejectedValueOnce(
      new Error("Failed to execute 'write' on 'Document': requires TrustedHTML")
    );
    const scrape = require('../scrape');
    const result = await scrape('https://example.test/');

    expect(mockPage.reload).toHaveBeenCalledTimes(2);
    expect(result.title).toBe('T');
    expect(result.canonical).toBe('https://canonical.test/');
    expect(mockPage.close).toHaveBeenCalledTimes(1);
  });

  it('throws when setContent fails and the restored DOM is empty (no phantom success)', async () => {
    mockPage.setContent.mockRejectedValueOnce(
      new Error("Failed to execute 'write' on 'Document': requires TrustedHTML")
    );
    mockPage.evaluate = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('https://example.test/')
      .mockResolvedValueOnce('')
      .mockResolvedValueOnce({ title: '', textContent: '' });
    const scrape = require('../scrape');
    const ResolveError = require('../ResolveError');

    await expect(scrape('https://example.test/')).rejects.toBeInstanceOf(
      ResolveError
    );
    expect(mockPage.reload).toHaveBeenCalledTimes(2);
  });

  it('throws when the restore lands on a Chromium internal error page', async () => {
    mockPage.setContent.mockRejectedValueOnce(
      new Error("Failed to execute 'write' on 'Document': requires TrustedHTML")
    );
    // The restore reload disconnects and Chrome shows chrome-error://, whose
    // title is the bare host name (non-empty) — must not become a success.
    mockPage.evaluate = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce('chrome-error://chromewebdata/');
    const scrape = require('../scrape');
    const ResolveError = require('../ResolveError');

    await expect(scrape('https://example.test/')).rejects.toBeInstanceOf(
      ResolveError
    );
  });
});

describe('scrape backend lifecycle', () => {
  const ORIGINAL_ENV = process.env;
  let launchOrConnect;
  let mockBrowser;

  function buildMockBrowser() {
    return {
      newPage: jest.fn().mockResolvedValue({
        setRequestInterception: jest.fn().mockResolvedValue(),
        setUserAgent: jest.fn().mockResolvedValue(),
        on: jest.fn(),
        goto: jest.fn().mockResolvedValue({
          headers: () => ({ 'content-type': 'text/html' }),
          status: () => 200,
        }),
        content: jest.fn().mockResolvedValue('<html><body></body></html>'),
        setJavaScriptEnabled: jest.fn().mockResolvedValue(),
        reload: jest.fn().mockResolvedValue(),
        setContent: jest.fn().mockResolvedValue(),
        waitForNavigation: jest.fn().mockResolvedValue(),
        evaluate: jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce('https://canonical.test/')
          .mockResolvedValueOnce('https://image.test/img.jpg')
          .mockResolvedValueOnce({ title: 'T', textContent: 'Body' }),
        close: jest.fn().mockResolvedValue(),
      }),
      userAgent: jest
        .fn()
        .mockResolvedValue(
          'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/148.0.0.0 Safari/537.36'
        ),
      on: jest.fn(),
    };
  }

  function getDisconnectHandler(browser) {
    const call = browser.on.mock.calls.find(
      ([event]) => event === 'disconnected'
    );
    return call && call[1];
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.BROWSER_BACKEND;
    delete process.env.SCRAPE_BLOCK_RESOURCES;
    mockBrowser = buildMockBrowser();
    launchOrConnect = require('../launchOrConnect');
    launchOrConnect.mockReturnValue(Promise.resolve(mockBrowser));
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('eagerly launches at module load when BROWSER_BACKEND is local (default)', () => {
    require('../scrape');
    expect(launchOrConnect).toHaveBeenCalledTimes(1);
  });

  it('does not launch at module load when BROWSER_BACKEND=cloudflare', () => {
    process.env.BROWSER_BACKEND = 'cloudflare';
    require('../scrape');
    expect(launchOrConnect).not.toHaveBeenCalled();
  });

  it('lazily connects on first scrape() when BROWSER_BACKEND=cloudflare', async () => {
    process.env.BROWSER_BACKEND = 'cloudflare';
    const scrape = require('../scrape');
    expect(launchOrConnect).not.toHaveBeenCalled();

    await scrape('https://example.test/');
    expect(launchOrConnect).toHaveBeenCalledTimes(1);
  });

  it('does not reconnect on disconnect when BROWSER_BACKEND=cloudflare', async () => {
    process.env.BROWSER_BACKEND = 'cloudflare';
    const scrape = require('../scrape');
    await scrape('https://example.test/');
    expect(launchOrConnect).toHaveBeenCalledTimes(1);

    const disconnect = getDisconnectHandler(mockBrowser);
    expect(disconnect).toBeDefined();
    disconnect();

    expect(launchOrConnect).toHaveBeenCalledTimes(1);
    expect(scrape.getBrowserPromise()).toBeUndefined();
  });

  it('reconnects on demand after cloudflare disconnect', async () => {
    process.env.BROWSER_BACKEND = 'cloudflare';
    const scrape = require('../scrape');
    await scrape('https://example.test/');

    getDisconnectHandler(mockBrowser)();
    expect(scrape.getBrowserPromise()).toBeUndefined();

    mockBrowser = buildMockBrowser();
    launchOrConnect.mockReturnValue(Promise.resolve(mockBrowser));

    await scrape('https://example.test/');
    expect(launchOrConnect).toHaveBeenCalledTimes(2);
  });

  it('reconnects immediately on disconnect when BROWSER_BACKEND=local', async () => {
    const scrape = require('../scrape');
    await scrape('https://example.test/');
    expect(launchOrConnect).toHaveBeenCalledTimes(1);

    getDisconnectHandler(mockBrowser)();

    expect(launchOrConnect).toHaveBeenCalledTimes(2);
  });
});
