import crypto from 'node:crypto';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { launchStealthBrowser } from './browser/stealth.js';
import { createStealthContext } from './browser/context.js';
import { humanDelay, randomScroll } from './timing/human.js';
import { checkDetection } from './browser/detection.js';
import { extractProductData } from './scraper/product.js';
import { createProxyProvider, type ProxyProvider, type ProxyConfig } from './proxy/provider.js';
import type { Browser, BrowserContext, Page } from 'rebrowser-playwright';

const configPath = process.argv.includes('--config')
  ? process.argv[process.argv.indexOf('--config') + 1]
  : undefined;

const config = loadConfig(configPath);
const log = createLogger(config.logging);

if (config.urls.length === 0) {
  log.error('No URLs configured — add product URLs to config.json');
  process.exit(1);
}

let browser: Browser | null = null;
let running = true;

async function shutdown() {
  running = false;
  log.info('Shutting down...');
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

async function main() {
  log.info({ urls: config.urls.length, headless: config.browser.headless, proxyEnabled: config.proxy.enabled }, 'PokeBot starting');

  // Set up proxy provider if enabled
  let proxyProvider: ProxyProvider | null = null;
  if (config.proxy.enabled) {
    proxyProvider = createProxyProvider(config.proxy);
    log.info({ provider: proxyProvider.name }, 'Proxy provider initialized');
  }

  log.info('Launching stealth browser');
  browser = await launchStealthBrowser(config.browser.headless);
  log.info('Stealth browser launched');

  let sessionId = crypto.randomUUID();
  let retries = 0;

  // Get proxy config for current session
  function getProxyConfig(): ProxyConfig | undefined {
    if (!proxyProvider) return undefined;
    return proxyProvider.getProxy(sessionId);
  }

  // Create a fresh context and page
  async function freshContext(): Promise<{ context: BrowserContext; page: Page }> {
    log.info('Creating fingerprint-injected context');
    const proxy = getProxyConfig();
    if (proxy) {
      log.info({ server: proxy.server, sessionId }, 'Routing through proxy');
    }
    const context = await createStealthContext(browser!, proxy);
    const page = await context.newPage();
    log.info('Stealth context created with unique fingerprint');
    return { context, page };
  }

  let { context, page } = await freshContext();

  // Main browsing loop
  while (running) {
    for (const url of config.urls) {
      if (!running) break;

      log.info({ url }, 'Navigating to URL');

      // Human-like delay before navigation
      await humanDelay(config.timing.minPageDelay, config.timing.maxPageDelay);

      let response;
      try {
        response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (err) {
        log.warn({ url, err: (err as Error).message }, 'Navigation failed — treating as detection event');
        // Treat timeout/navigation error as detection
        await context.close().catch(() => {});

        if (retries < config.detection.maxRetries) {
          retries++;
          log.warn({ retries, maxRetries: config.detection.maxRetries, cooldownMs: config.detection.cooldownMs }, 'Detection: cooling down');
          await new Promise(resolve => setTimeout(resolve, config.detection.cooldownMs));

          if (proxyProvider) {
            proxyProvider.reportFailure(sessionId);
            sessionId = crypto.randomUUID();
          }

          ({ context, page } = await freshContext());
          break; // Restart URL loop
        } else {
          log.error('Max retries exceeded, shutting down');
          running = false;
          break;
        }
      }

      const detection = await checkDetection(page, response);

      if (detection.detected) {
        log.warn({ signal: detection.signal, details: detection.details }, 'Detection signal identified');
        await context.close().catch(() => {});

        if (retries < config.detection.maxRetries) {
          retries++;
          log.warn({ retries, maxRetries: config.detection.maxRetries, cooldownMs: config.detection.cooldownMs }, 'Detection: cooling down');
          await new Promise(resolve => setTimeout(resolve, config.detection.cooldownMs));

          if (proxyProvider) {
            proxyProvider.reportFailure(sessionId);
            sessionId = crypto.randomUUID();
          }

          ({ context, page } = await freshContext());
          break; // Restart URL loop with fresh context
        } else {
          log.error('Max retries exceeded, shutting down');
          running = false;
          break;
        }
      }

      // No detection — reset retry counter
      retries = 0;

      // Simulate reading the page
      await randomScroll(page);

      // Extract product data
      const data = await extractProductData(page);
      log.info({ title: data.title, price: data.price, stockStatus: data.stockStatus, url: data.url }, 'Product data extracted');
    }

    if (running) {
      log.info('Completed URL cycle — looping back');
    }
  }

  // Cleanup
  await context.close().catch(() => {});
  if (browser) {
    await browser.close().catch(() => {});
    browser = null;
  }
  log.info('Done');
}

main().catch(err => {
  log.error({ err }, 'Fatal error');
  shutdown();
});
