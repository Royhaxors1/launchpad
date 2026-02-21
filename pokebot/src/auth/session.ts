import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { BrowserContext, Page } from 'rebrowser-playwright';
import { encrypt, decrypt } from '../crypto/vault.js';

const DEFAULT_SESSION_DIR = resolve(homedir(), '.pokebot', 'sessions');

export async function saveSession(
  context: BrowserContext,
  accountId: string,
  masterPassword: string,
  sessionDir?: string,
): Promise<string> {
  const dir = sessionDir ?? DEFAULT_SESSION_DIR;
  mkdirSync(dir, { recursive: true });

  const state = await context.storageState();
  const json = JSON.stringify(state);
  const encrypted = encrypt(json, masterPassword);

  const filePath = resolve(dir, `${accountId}.session`);
  writeFileSync(filePath, encrypted, 'utf-8');
  chmodSync(filePath, 0o600);

  return filePath;
}

export function loadSession(
  accountId: string,
  masterPassword: string,
  sessionDir?: string,
): string | null {
  const dir = sessionDir ?? DEFAULT_SESSION_DIR;
  const filePath = resolve(dir, `${accountId}.session`);

  if (!existsSync(filePath)) {
    return null;
  }

  const encrypted = readFileSync(filePath, 'utf-8');
  return decrypt(encrypted, masterPassword);
}

export async function isSessionValid(page: Page): Promise<boolean> {
  try {
    await page.goto('https://member.lazada.sg/user/login', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });
    // If Lazada redirects away from /user/login the session is valid
    return !page.url().includes('/user/login');
  } catch {
    return false;
  }
}
