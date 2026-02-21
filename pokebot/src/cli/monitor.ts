import { Command } from 'commander';
import { loadConfig } from '../config.js';
import { startMonitoring } from '../monitor/poller.js';

export function registerMonitorCommand(program: Command): void {
  program
    .command('monitor')
    .description('Start monitoring watched URLs for restocks')
    .option('--headless', 'Run browser in headless mode')
    .option('--no-headless', 'Run browser in visible mode')
    .option('--config <path>', 'Custom config file path')
    .action(async (opts: { headless?: boolean; config?: string }) => {
      const config = loadConfig(opts.config);

      if (opts.headless !== undefined) {
        config.browser.headless = opts.headless;
      }

      if (!config.monitoring?.urls.length) {
        console.error('No URLs to monitor. Add URLs with: pokebot watch add');
        process.exitCode = 1;
        return;
      }

      if (!config.telegram?.botToken || !config.telegram?.chatId) {
        console.error('Telegram not configured. Run: pokebot telegram setup');
        process.exitCode = 1;
        return;
      }

      await startMonitoring(config);
    });
}
