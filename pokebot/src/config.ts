import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface BotConfig {
  urls: string[];
  browser: {
    headless: boolean;
    maxContexts: number;
  };
  proxy: {
    enabled: boolean;
    provider: 'brightdata' | 'oxylabs';
    customerId: string;
    zone: string;
    password: string;
    country: string;
  };
  timing: {
    minPageDelay: number;
    maxPageDelay: number;
    minActionDelay: number;
    maxActionDelay: number;
  };
  detection: {
    cooldownMs: number;
    maxRetries: number;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file: string;
  };
}

const DEFAULT_CONFIG: BotConfig = {
  urls: [],
  browser: {
    headless: false,
    maxContexts: 1,
  },
  proxy: {
    enabled: false,
    provider: 'brightdata',
    customerId: '',
    zone: '',
    password: '',
    country: 'sg',
  },
  timing: {
    minPageDelay: 3000,
    maxPageDelay: 8000,
    minActionDelay: 500,
    maxActionDelay: 1500,
  },
  detection: {
    cooldownMs: 300000,
    maxRetries: 3,
  },
  logging: {
    level: 'info',
    file: 'logs/bot.log',
  },
};

function validateConfig(config: BotConfig): void {
  if (!Array.isArray(config.urls)) {
    throw new Error('Config error: "urls" must be an array');
  }

  if (typeof config.browser?.headless !== 'boolean') {
    throw new Error('Config error: "browser.headless" must be a boolean');
  }

  if (typeof config.browser?.maxContexts !== 'number' || config.browser.maxContexts < 1) {
    throw new Error('Config error: "browser.maxContexts" must be a positive number');
  }

  const timing = config.timing;
  if (!timing || timing.minPageDelay <= 0 || timing.maxPageDelay <= 0 ||
      timing.minActionDelay <= 0 || timing.maxActionDelay <= 0) {
    throw new Error('Config error: all timing values must be positive numbers');
  }

  if (timing.minPageDelay > timing.maxPageDelay) {
    throw new Error('Config error: "timing.minPageDelay" must be <= "timing.maxPageDelay"');
  }

  if (timing.minActionDelay > timing.maxActionDelay) {
    throw new Error('Config error: "timing.minActionDelay" must be <= "timing.maxActionDelay"');
  }

  const detection = config.detection;
  if (!detection || detection.cooldownMs <= 0 || detection.maxRetries < 0) {
    throw new Error('Config error: detection values must be non-negative');
  }

  const validLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(config.logging?.level)) {
    throw new Error(`Config error: "logging.level" must be one of: ${validLevels.join(', ')}`);
  }
}

export function loadConfig(path?: string): BotConfig {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const configPath = path ?? resolve(projectRoot, 'config.json');

  if (!existsSync(configPath)) {
    console.log(`No config found at ${configPath} — generating defaults`);
    writeFileSync(configPath, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    console.log(`Config written to ${configPath}`);
    return { ...DEFAULT_CONFIG };
  }

  const raw = readFileSync(configPath, 'utf-8');
  let config: BotConfig;
  try {
    config = JSON.parse(raw);
  } catch {
    throw new Error(`Config error: invalid JSON in ${configPath}`);
  }

  validateConfig(config);
  console.log(`Config loaded from ${configPath}`);
  return config;
}
