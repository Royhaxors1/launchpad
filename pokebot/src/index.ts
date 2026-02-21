import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { launchStealthBrowser } from './browser/stealth.js';
import { createStealthContext } from './browser/context.js';
import type { Browser } from 'rebrowser-playwright';

const configPath = process.argv.includes('--config')
  ? process.argv[process.argv.indexOf('--config') + 1]
  : undefined;

const config = loadConfig(configPath);
const log = createLogger(config.logging);

let browser: Browser | null = null;

async function shutdown() {
  if (browser) {
    log.info('Shutting down browser');
    await browser.close().catch(() => {});
    browser = null;
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  log.info({ urls: config.urls.length, headless: config.browser.headless }, 'PokeBot starting');

  log.info('Launching stealth browser');
  browser = await launchStealthBrowser(config.browser.headless);
  log.info('Stealth browser launched');

  log.info('Creating fingerprint-injected context');
  const context = await createStealthContext(browser);
  log.info('Stealth context created with unique fingerprint');

  const page = await context.newPage();
  log.info('Navigating to bot-detector.rebrowser.net for stealth validation');
  await page.goto('https://bot-detector.rebrowser.net/', { waitUntil: 'networkidle' });
  log.info({ url: page.url() }, 'Bot detector page loaded');

  // Wait 5 seconds to let the user see results
  await new Promise(resolve => setTimeout(resolve, 5000));

  log.info('Closing browser');
  await context.close();
  await browser.close();
  browser = null;
  log.info('Done');
}

main().catch(err => {
  log.error({ err }, 'Fatal error');
  shutdown();
});
