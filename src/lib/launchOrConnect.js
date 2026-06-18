const puppeteer = require('puppeteer');
const puppeteerCore = require('puppeteer-core');

const LOCAL_LAUNCH_OPTIONS = {
  acceptInsecureCerts: true,
  executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
};

function buildCloudflareConnectOptions() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    throw new Error(
      'BROWSER_BACKEND=cloudflare requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN'
    );
  }
  // keep_alive sets the inactivity window before Cloudflare closes the remote
  // session. Default 60000 ms (matches CF default); cap is 600000 ms (10 min).
  // Wider window = more session reuse across scrapes but longer billed idle
  // tail after the last request, since the open session keeps consuming
  // browser-hours until it times out.
  // https://developers.cloudflare.com/browser-run/limits/
  const keepAliveMs = process.env.CLOUDFLARE_KEEP_ALIVE_MS || '60000';
  return {
    browserWSEndpoint:
      `wss://api.cloudflare.com/client/v4/accounts/${accountId}` +
      `/browser-rendering/devtools/browser?keep_alive=${keepAliveMs}`,
    headers: { Authorization: `Bearer ${token}` },
    acceptInsecureCerts: true,
  };
}

function launchOrConnect() {
  const backend = process.env.BROWSER_BACKEND || 'local';
  switch (backend) {
    case 'local':
      return puppeteer.launch(LOCAL_LAUNCH_OPTIONS);
    case 'cloudflare':
      return puppeteerCore.connect(buildCloudflareConnectOptions());
    default:
      throw new Error(`unknown BROWSER_BACKEND: ${backend}`);
  }
}

module.exports = launchOrConnect;
