import crypto from 'node:crypto';
import cron from 'node-cron';
import Table from 'cli-table3';
import type { BotConfig } from '../config.js';
import { createLogger } from '../logger.js';
import { launchStealthBrowser } from '../browser/stealth.js';
import { createStealthContext } from '../browser/context.js';
import { checkDetection } from '../browser/detection.js';
import { extractProductData } from '../scraper/product.js';
import { humanDelay } from '../timing/human.js';
import { sendTelegramMessage, formatRestockAlert, formatDigest } from '../notify/telegram.js';
import { detectTransition, isAvailable, type StockState, type StockStatus } from './state.js';
import { logStockEvent } from './history.js';
import type { Browser, BrowserContext, Page } from 'rebrowser-playwright';

export async function startMonitoring(config: BotConfig): Promise<void> {
  const monitoring = config.monitoring!;
  const telegram = config.telegram!;
  const log = createLogger(config.logging);

  // Validate prerequisites
  if (monitoring.urls.length === 0) {
    console.error('No URLs to monitor. Add URLs with: pokebot watch add');
    process.exit(1);
  }
  if (!telegram.botToken || !telegram.chatId) {
    console.error('Telegram not configured. Run: pokebot telegram setup');
    process.exit(1);
  }

  let running = true;
  let browser: Browser | null = null;
  let context: BrowserContext | null = null;
  let page: Page | null = null;
  let cronTask: cron.ScheduledTask | null = null;

  // State tracking
  const stateMap = new Map<string, StockState>();
  const alertCooldowns = new Map<string, number>();

  // Daily digest counters
  let dailyRestocks = 0;
  let dailySoldOuts = 0;
  let dailyErrors = 0;
  const startTime = Date.now();

  // Graceful shutdown
  async function shutdown() {
    running = false;
    log.info('Monitoring stopped');
    if (cronTask) cronTask.stop();
    if (page) await page.close().catch(() => {});
    if (context) await context.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    process.exit(0);
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Launch browser
  log.info({ urls: monitoring.urls.length, headless: config.browser.headless }, 'Starting monitor');
  browser = await launchStealthBrowser(config.browser.headless);

  let sessionId = crypto.randomUUID();

  async function freshContext(): Promise<{ ctx: BrowserContext; pg: Page }> {
    log.info('Creating fresh stealth context');
    const ctx = await createStealthContext(browser!);
    const pg = await ctx.newPage();
    return { ctx, pg };
  }

  ({ ctx: context, pg: page } = await freshContext());

  // Initial status report
  console.log('\nChecking initial stock status...\n');
  const initTable = new Table({
    head: ['URL', 'Title', 'Status', 'Price'],
    style: { head: ['cyan'] },
    colWidths: [45, 30, 15, 15],
  });

  for (const url of monitoring.urls) {
    if (!running) break;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const data = await extractProductData(page);
      const status: StockStatus = data.stockStatus as StockStatus;
      const state: StockState = {
        url,
        status,
        price: data.price,
        title: data.title,
        lastChecked: new Date().toISOString(),
        lastTransition: null,
      };
      stateMap.set(url, state);
      initTable.push([
        url.length > 42 ? url.slice(0, 39) + '...' : url,
        (data.title ?? '(unknown)').slice(0, 27),
        status,
        data.price ?? '-',
      ]);
    } catch (err) {
      initTable.push([
        url.length > 42 ? url.slice(0, 39) + '...' : url,
        '(error)',
        'unknown',
        '-',
      ]);
      log.warn({ url, err: (err as Error).message }, 'Initial check failed');
    }
  }
  console.log(initTable.toString());
  console.log(`\nMonitoring ${monitoring.urls.length} URLs. Press Ctrl+C to stop.\n`);

  // Send startup notification
  await sendTelegramMessage(
    { botToken: telegram.botToken, chatId: telegram.chatId },
    `<b>PokeBot Monitor Started</b>\nWatching ${monitoring.urls.length} URLs`,
  );

  // Daily digest cron
  const digestHour = telegram.dailyDigestHour;
  cronTask = cron.schedule(`0 ${digestHour} * * *`, async () => {
    const uptime = formatUptime(Date.now() - startTime);
    const message = formatDigest({
      urlsMonitored: monitoring.urls.length,
      restocksDetected: dailyRestocks,
      soldOuts: dailySoldOuts,
      errorsEncountered: dailyErrors,
      uptime,
    });
    await sendTelegramMessage(
      { botToken: telegram.botToken, chatId: telegram.chatId },
      message,
    );
    // Reset daily counters
    dailyRestocks = 0;
    dailySoldOuts = 0;
    dailyErrors = 0;
  }, { timezone: 'Asia/Singapore' });

  // Polling loop
  let cycleCount = 0;
  let consecutiveFailures = 0;
  let currentCooldownMs = config.detection.cooldownMs;

  async function pollCycle() {
    if (!running) return;

    cycleCount++;

    // Proactive context rotation
    if (cycleCount % monitoring.contextRotationCycles === 0) {
      log.info({ cycle: cycleCount }, 'Proactive context rotation');
      await page!.close().catch(() => {});
      await context!.close().catch(() => {});
      sessionId = crypto.randomUUID();
      ({ ctx: context, pg: page } = await freshContext());
    }

    for (const url of monitoring.urls) {
      if (!running) break;

      // Poll interval with jitter
      const baseMs = monitoring.basePollIntervalMs;
      const jitter = (Math.random() * 2 - 1) * monitoring.jitterMs;
      const delay = Math.max(5000, baseMs + jitter);
      await new Promise(resolve => setTimeout(resolve, delay));

      if (!running) break;

      // Navigate and extract
      let response;
      try {
        response = await page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      } catch (err) {
        log.warn({ url, err: (err as Error).message }, 'Navigation error');
        await handleDetectionEvent(url, (err as Error).message);
        break;
      }

      const detection = await checkDetection(page!, response);
      if (detection.detected) {
        log.warn({ url, signal: detection.signal }, 'Detection event');
        await handleDetectionEvent(url, detection.details ?? detection.signal);
        break;
      }

      // Success - reset failure tracking
      consecutiveFailures = 0;
      currentCooldownMs = config.detection.cooldownMs;

      const data = await extractProductData(page!);
      const newStatus: StockStatus = data.stockStatus as StockStatus;
      const previous = stateMap.get(url) ?? null;

      const newState: StockState = {
        url,
        status: newStatus,
        price: data.price,
        title: data.title,
        lastChecked: new Date().toISOString(),
        lastTransition: previous?.lastTransition ?? null,
      };

      const transition = detectTransition(previous, newState);

      if (transition === 'restock') {
        newState.lastTransition = new Date().toISOString();
        log.info({ url, title: data.title, price: data.price }, 'RESTOCK DETECTED');
        dailyRestocks++;

        logStockEvent({
          timestamp: new Date().toISOString(),
          url,
          title: data.title,
          previousStatus: previous?.status ?? null,
          newStatus,
          price: data.price,
          transition,
        }, monitoring.historyFile);

        // Alert with cooldown
        const lastAlert = alertCooldowns.get(url) ?? 0;
        if (Date.now() - lastAlert > telegram.alertCooldownMs) {
          alertCooldowns.set(url, Date.now());
          await sendTelegramMessage(
            { botToken: telegram.botToken, chatId: telegram.chatId },
            formatRestockAlert({
              title: data.title ?? url,
              price: data.price ?? 'Unknown',
              url,
              detectedAt: new Date(),
            }),
          );
        }
      } else if (transition === 'sold_out') {
        newState.lastTransition = new Date().toISOString();
        log.info({ url, title: data.title }, 'Sold out');
        dailySoldOuts++;

        logStockEvent({
          timestamp: new Date().toISOString(),
          url,
          title: data.title,
          previousStatus: previous?.status ?? null,
          newStatus,
          price: data.price,
          transition,
        }, monitoring.historyFile);
      }

      stateMap.set(url, newState);
    }

    // Schedule next cycle
    if (running) {
      setTimeout(pollCycle, 0);
    }
  }

  async function handleDetectionEvent(url: string, details: string) {
    consecutiveFailures++;
    dailyErrors++;

    await page!.close().catch(() => {});
    await context!.close().catch(() => {});

    // Exponential backoff after consecutive failures, cap at 30 min
    if (consecutiveFailures > config.detection.maxRetries) {
      currentCooldownMs = Math.min(currentCooldownMs * 2, 30 * 60 * 1000);
    }

    const cooldownSec = Math.round(currentCooldownMs / 1000);
    log.warn({ url, consecutiveFailures, cooldownSec }, 'Detection: cooling down');

    await sendTelegramMessage(
      { botToken: telegram.botToken, chatId: telegram.chatId },
      `Monitoring paused \u2014 detection event on ${url}. Retrying in ${cooldownSec}s.`,
    );

    await new Promise(resolve => setTimeout(resolve, currentCooldownMs));

    sessionId = crypto.randomUUID();
    ({ ctx: context, pg: page } = await freshContext());
  }

  // Start polling
  pollCycle();
}

function formatUptime(ms: number): string {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}
