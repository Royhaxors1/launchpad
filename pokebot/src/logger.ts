import pino from 'pino';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function createLogger(config: { level: string; file: string }): pino.Logger {
  mkdirSync(dirname(config.file), { recursive: true });

  return pino({
    level: config.level,
    transport: {
      targets: [
        {
          target: 'pino-pretty',
          options: { colorize: true },
          level: config.level,
        },
        {
          target: 'pino/file',
          options: { destination: config.file, mkdir: true },
          level: config.level,
        },
      ],
    },
  });
}
