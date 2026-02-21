import { readFileSync, writeFileSync, mkdirSync, chmodSync, existsSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { encrypt, decrypt } from '../crypto/vault.js';
import type { Account } from './types.js';

export class AccountStore {
  private masterPassword: string;
  private storePath: string;

  constructor(masterPassword: string, storePath?: string) {
    this.masterPassword = masterPassword;
    this.storePath = storePath ?? resolve(homedir(), '.pokebot', 'accounts.enc');
  }

  load(): Account[] {
    if (!existsSync(this.storePath)) {
      return [];
    }
    const encoded = readFileSync(this.storePath, 'utf-8');
    const json = decrypt(encoded, this.masterPassword);
    return JSON.parse(json) as Account[];
  }

  save(accounts: Account[]): void {
    const dir = dirname(this.storePath);
    mkdirSync(dir, { recursive: true });
    const json = JSON.stringify(accounts, null, 2);
    const encoded = encrypt(json, this.masterPassword);
    writeFileSync(this.storePath, encoded, 'utf-8');
    chmodSync(this.storePath, 0o600);
  }

  add(account: Omit<Account, 'id' | 'createdAt' | 'lastLoginAt' | 'sessionFile'>): Account {
    const accounts = this.load();
    const newAccount: Account = {
      ...account,
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      lastLoginAt: null,
      sessionFile: null,
    };
    accounts.push(newAccount);
    this.save(accounts);
    return newAccount;
  }

  findByIdentifier(identifier: string): Account | undefined {
    const accounts = this.load();
    const index = parseInt(identifier, 10);
    if (!isNaN(index) && index >= 1 && index <= accounts.length) {
      return accounts[index - 1];
    }
    return accounts.find((a) => a.loginId === identifier);
  }

  update(
    id: string,
    updates: Partial<Pick<Account, 'loginId' | 'loginType' | 'proxy' | 'paymentLabel'>>,
  ): Account {
    const accounts = this.load();
    const idx = accounts.findIndex((a) => a.id === id);
    if (idx === -1) {
      throw new Error(`Account not found: ${id}`);
    }
    accounts[idx] = { ...accounts[idx], ...updates };
    this.save(accounts);
    return accounts[idx];
  }

  remove(id: string): void {
    const accounts = this.load();
    const account = accounts.find((a) => a.id === id);
    if (account?.sessionFile && existsSync(account.sessionFile)) {
      unlinkSync(account.sessionFile);
    }
    const filtered = accounts.filter((a) => a.id !== id);
    this.save(filtered);
  }

  list(): Account[] {
    return this.load();
  }
}
