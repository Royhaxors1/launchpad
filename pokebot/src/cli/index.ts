import { Command } from 'commander';
import { password } from '@inquirer/prompts';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { registerAccountCommands } from './account.js';

const require = createRequire(import.meta.url);
const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = require(resolve(__dirname, '../../package.json')) as { version: string };

let resolvedMasterPassword: string | null = null;

export async function getMasterPassword(): Promise<string> {
  if (resolvedMasterPassword) return resolvedMasterPassword;

  const envPassword = process.env['POKEBOT_MASTER_PASSWORD'];
  if (envPassword) {
    resolvedMasterPassword = envPassword;
    return resolvedMasterPassword;
  }

  if (!process.stdin.isTTY) {
    console.error('Error: POKEBOT_MASTER_PASSWORD environment variable is required in non-interactive mode.');
    process.exit(1);
  }

  resolvedMasterPassword = await password({
    message: 'Master password:',
    mask: '*',
  });

  return resolvedMasterPassword;
}

const program = new Command();
program
  .name('pokebot')
  .version(pkg.version)
  .description('Automated Pokemon TCG scalping bot for Lazada SG');

registerAccountCommands(program, getMasterPassword);

program.parse();
