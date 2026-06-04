jest.mock('puppeteer', () => ({ launch: jest.fn() }), { virtual: true });
jest.mock('puppeteer-core', () => ({ connect: jest.fn() }), { virtual: true });

describe('launchOrConnect', () => {
  let launchOrConnect;
  let puppeteer;
  let puppeteerCore;
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...ORIGINAL_ENV };
    delete process.env.BROWSER_BACKEND;
    delete process.env.CLOUDFLARE_ACCOUNT_ID;
    delete process.env.CLOUDFLARE_API_TOKEN;
    delete process.env.CLOUDFLARE_KEEP_ALIVE_MS;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    puppeteer = require('puppeteer');
    puppeteerCore = require('puppeteer-core');
    launchOrConnect = require('../launchOrConnect');
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('uses puppeteer.launch when BROWSER_BACKEND is unset', () => {
    puppeteer.launch.mockReturnValue('local-browser');
    const result = launchOrConnect();
    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
    expect(puppeteerCore.connect).not.toHaveBeenCalled();
    expect(result).toBe('local-browser');
  });

  it('uses puppeteer.launch when BROWSER_BACKEND=local', () => {
    process.env.BROWSER_BACKEND = 'local';
    puppeteer.launch.mockReturnValue('local-browser');
    launchOrConnect();
    expect(puppeteer.launch).toHaveBeenCalledTimes(1);
    expect(puppeteerCore.connect).not.toHaveBeenCalled();
  });

  it('uses puppeteer-core.connect when BROWSER_BACKEND=cloudflare', () => {
    process.env.BROWSER_BACKEND = 'cloudflare';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc123';
    process.env.CLOUDFLARE_API_TOKEN = 'token456';
    puppeteerCore.connect.mockReturnValue('remote-browser');

    const result = launchOrConnect();

    expect(puppeteerCore.connect).toHaveBeenCalledTimes(1);
    const arg = puppeteerCore.connect.mock.calls[0][0];
    expect(arg.browserWSEndpoint).toBe(
      'wss://api.cloudflare.com/client/v4/accounts/acc123/browser-rendering/devtools/browser?keep_alive=600000'
    );
    expect(arg.headers).toEqual({ Authorization: 'Bearer token456' });
    expect(puppeteer.launch).not.toHaveBeenCalled();
    expect(result).toBe('remote-browser');
  });

  it('honors CLOUDFLARE_KEEP_ALIVE_MS override', () => {
    process.env.BROWSER_BACKEND = 'cloudflare';
    process.env.CLOUDFLARE_ACCOUNT_ID = 'acc';
    process.env.CLOUDFLARE_API_TOKEN = 'tok';
    process.env.CLOUDFLARE_KEEP_ALIVE_MS = '60000';
    puppeteerCore.connect.mockReturnValue('remote-browser');

    launchOrConnect();

    const arg = puppeteerCore.connect.mock.calls[0][0];
    expect(arg.browserWSEndpoint).toContain('keep_alive=60000');
  });

  it('throws if BROWSER_BACKEND=cloudflare but credentials missing', () => {
    process.env.BROWSER_BACKEND = 'cloudflare';
    expect(() => launchOrConnect()).toThrow(/CLOUDFLARE_ACCOUNT_ID/);
  });

  it('throws on unknown BROWSER_BACKEND value', () => {
    process.env.BROWSER_BACKEND = 'banana';
    expect(() => launchOrConnect()).toThrow(/banana/);
  });
});
