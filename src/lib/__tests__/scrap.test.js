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

describe('scrap request interception', () => {
  const ORIGINAL_ENV = process.env;
  let launchOrConnect;
  let mockPage;
  let mockBrowser;
  let requestHandler;

  function setupMocks() {
    requestHandler = undefined;
    mockPage = {
      setRequestInterception: jest.fn().mockResolvedValue(),
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
      on: jest.fn(),
    };
  }

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.SCRAP_BLOCK_RESOURCES;
    setupMocks();
    launchOrConnect = require('../launchOrConnect');
    launchOrConnect.mockReturnValue(Promise.resolve(mockBrowser));
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('blocks image, media, font by default and continues other types', async () => {
    const scrap = require('../scrap');
    await scrap('https://example.test/');

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

  it('honors SCRAP_BLOCK_RESOURCES override', async () => {
    process.env.SCRAP_BLOCK_RESOURCES = 'script, xhr';
    const scrap = require('../scrap');
    await scrap('https://example.test/');

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

  it('skips interception when SCRAP_BLOCK_RESOURCES is empty', async () => {
    process.env.SCRAP_BLOCK_RESOURCES = '';
    const scrap = require('../scrap');
    await scrap('https://example.test/');

    expect(mockPage.setRequestInterception).not.toHaveBeenCalled();
    expect(requestHandler).toBeUndefined();
  });

  it('swallows abort/continue rejection when page closes mid-flight', async () => {
    const scrap = require('../scrap');
    await scrap('https://example.test/');

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
});
