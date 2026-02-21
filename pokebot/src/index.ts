import { loadConfig } from './config.js';
import { createLogger } from './logger.js';

const configPath = process.argv.includes('--config')
  ? process.argv[process.argv.indexOf('--config') + 1]
  : undefined;

const config = loadConfig(configPath);
const log = createLogger(config.logging);

log.info({ urls: config.urls.length, headless: config.browser.headless }, 'PokeBot starting');
log.info('Browser launch not yet implemented');
log.info('Exiting');
