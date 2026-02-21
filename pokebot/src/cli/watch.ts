import { Command } from 'commander';
import { input } from '@inquirer/prompts';
import Table from 'cli-table3';
import { loadConfig, saveConfig } from '../config.js';

const MAX_URLS = 5;

export function registerWatchCommands(program: Command): void {
  const watchCmd = program.command('watch').description('Manage monitored URLs');

  watchCmd
    .command('add [url]')
    .description('Add a Lazada product URL to monitor')
    .action(async (urlArg?: string) => {
      let url = urlArg;

      if (!url) {
        url = await input({
          message: 'Lazada product URL:',
          validate: (v) => v.trim().length > 0 || 'Required',
        });
      }

      url = url.trim();

      if (!url.startsWith('http') || !url.includes('lazada')) {
        console.error('Invalid URL. Must be a Lazada product URL (e.g. https://www.lazada.sg/...)');
        process.exitCode = 1;
        return;
      }

      const config = loadConfig();
      const urls = config.monitoring!.urls;

      if (urls.includes(url)) {
        console.error('URL already being monitored.');
        return;
      }

      if (urls.length >= MAX_URLS) {
        console.error(`Maximum ${MAX_URLS} URLs allowed. Remove one first with: pokebot watch remove <index>`);
        process.exitCode = 1;
        return;
      }

      urls.push(url);
      saveConfig(config);
      console.log(`Added: ${url}`);
      console.log(`Watching ${urls.length} URLs`);
    });

  watchCmd
    .command('remove <index>')
    .description('Remove a URL by index (from watch list)')
    .action(async (indexStr: string) => {
      const index = parseInt(indexStr, 10);
      const config = loadConfig();
      const urls = config.monitoring!.urls;

      if (isNaN(index) || index < 1 || index > urls.length) {
        console.error(`Invalid index. Must be between 1 and ${urls.length}.`);
        process.exitCode = 1;
        return;
      }

      const removed = urls.splice(index - 1, 1)[0];
      saveConfig(config);
      console.log(`Removed: ${removed}`);
      console.log(`Watching ${urls.length} URLs`);
    });

  watchCmd
    .command('list')
    .description('List all monitored URLs')
    .action(async () => {
      const config = loadConfig();
      const urls = config.monitoring!.urls;

      if (urls.length === 0) {
        console.log('No URLs being monitored. Add one with: pokebot watch add');
        return;
      }

      const table = new Table({
        head: ['#', 'URL'],
        style: { head: ['cyan'] },
      });

      urls.forEach((url, i) => {
        table.push([
          String(i + 1),
          url.length > 60 ? url.slice(0, 57) + '...' : url,
        ]);
      });

      console.log(table.toString());

      const m = config.monitoring!;
      const minInterval = Math.max(5, (m.basePollIntervalMs - m.jitterMs) / 1000);
      const maxInterval = (m.basePollIntervalMs + m.jitterMs) / 1000;
      console.log(`\nPolling: ${minInterval}s - ${maxInterval}s interval`);
      console.log(`Context rotation: every ${m.contextRotationCycles} cycles`);
      console.log(`History: ${m.historyFile}`);
    });
}
