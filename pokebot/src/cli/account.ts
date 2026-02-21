import { Command } from 'commander';
import { input, password, confirm } from '@inquirer/prompts';
import Table from 'cli-table3';
import { AccountStore } from '../account/store.js';
import type { Account } from '../account/types.js';
import { launchStealthBrowser } from '../browser/stealth.js';
import { createStealthContext } from '../browser/context.js';
import { loginToLazada } from '../auth/login.js';
import { loadSession, isSessionValid } from '../auth/session.js';
import type { ProxyConfig } from '../proxy/provider.js';

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return 'Never';
  const diff = Date.now() - new Date(isoString).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatProxy(account: Account): string {
  if (!account.proxy) return 'None';
  return `${account.proxy.host}:${account.proxy.port}`;
}

export function registerAccountCommands(program: Command, getMasterPassword: () => Promise<string>): void {
  const accountCmd = program.command('account').description('Manage Lazada accounts');

  accountCmd
    .command('add')
    .description('Add a new Lazada account')
    .action(async () => {
      const masterPassword = await getMasterPassword();
      const store = new AccountStore(masterPassword);

      const loginId = await input({
        message: 'Phone number:',
        validate: (v) => v.trim().length > 0 || 'Required',
      });

      const proxyHost = await input({
        message: 'Proxy host (leave empty to skip):',
      });

      let proxy: Account['proxy'] = null;
      if (proxyHost.trim()) {
        const proxyPortStr = await input({
          message: 'Proxy port:',
          validate: (v) => /^\d+$/.test(v.trim()) || 'Must be a number',
        });
        const proxyUsername = await input({ message: 'Proxy username:' });
        const proxyPassword = await password({ message: 'Proxy password:', mask: '*' });
        proxy = {
          host: proxyHost.trim(),
          port: parseInt(proxyPortStr.trim(), 10),
          username: proxyUsername.trim(),
          password: proxyPassword,
        };
      }

      const paymentLabel = await input({
        message: 'Payment method label (e.g. "Visa ending 1234"):',
      });

      const account = store.add({
        loginId: loginId.trim(),
        loginType: 'phone',
        proxy,
        paymentLabel: paymentLabel.trim(),
      });

      const accounts = store.list();
      const index = accounts.findIndex((a) => a.id === account.id) + 1;
      console.log(`\nAccount #${index} added: ${account.loginId}`);
    });

  accountCmd
    .command('list')
    .description('List all configured accounts')
    .action(async () => {
      const masterPassword = await getMasterPassword();
      const store = new AccountStore(masterPassword);
      const accounts = store.list();

      if (accounts.length === 0) {
        console.log('No accounts configured. Run `pokebot account add` to get started.');
        return;
      }

      const table = new Table({
        head: ['#', 'Phone', 'Proxy', 'Payment', 'Last Login'],
        style: { head: ['cyan'] },
      });

      accounts.forEach((account, i) => {
        table.push([
          String(i + 1),
          account.loginId,
          formatProxy(account),
          account.paymentLabel || '(none)',
          formatRelativeTime(account.lastLoginAt),
        ]);
      });

      console.log(table.toString());
    });

  accountCmd
    .command('edit <identifier>')
    .description('Edit an account by email/phone or index number')
    .action(async (identifier: string) => {
      const masterPassword = await getMasterPassword();
      const store = new AccountStore(masterPassword);
      const account = store.findByIdentifier(identifier);

      if (!account) {
        console.error(`No account found matching: ${identifier}`);
        process.exit(1);
      }

      const newLoginId = await input({
        message: 'Phone number:',
        default: account.loginId,
      });

      const currentProxyHost = account.proxy?.host ?? '';
      const newProxyHost = await input({
        message: 'Proxy host (leave empty to remove):',
        default: currentProxyHost,
      });

      let newProxy: Account['proxy'] = null;
      if (newProxyHost.trim()) {
        const proxyPortStr = await input({
          message: 'Proxy port:',
          default: String(account.proxy?.port ?? ''),
          validate: (v) => /^\d+$/.test(v.trim()) || 'Must be a number',
        });
        const proxyUsername = await input({
          message: 'Proxy username:',
          default: account.proxy?.username ?? '',
        });
        const proxyPassword = await password({ message: 'Proxy password:', mask: '*' });
        newProxy = {
          host: newProxyHost.trim(),
          port: parseInt(proxyPortStr.trim(), 10),
          username: proxyUsername.trim(),
          password: proxyPassword || (account.proxy?.password ?? ''),
        };
      }

      const newPaymentLabel = await input({
        message: 'Payment method label:',
        default: account.paymentLabel,
      });

      store.update(account.id, {
        loginId: newLoginId.trim(),
        loginType: 'phone',
        proxy: newProxy,
        paymentLabel: newPaymentLabel.trim(),
      });
      console.log(`\nAccount updated: ${newLoginId.trim()}`);
    });

  accountCmd
    .command('remove <identifier>')
    .description('Remove an account by email/phone or index number')
    .action(async (identifier: string) => {
      const masterPassword = await getMasterPassword();
      const store = new AccountStore(masterPassword);
      const account = store.findByIdentifier(identifier);

      if (!account) {
        console.error(`No account found matching: ${identifier}`);
        process.exit(1);
      }

      const confirmed = await confirm({
        message: `Delete account ${account.loginId}?`,
        default: false,
      });

      if (confirmed) {
        store.remove(account.id);
        console.log(`Account removed: ${account.loginId}`);
      } else {
        console.log('Cancelled');
      }
    });

  accountCmd
    .command('login <identifier>')
    .description('Log in to a Lazada account (opens browser window)')
    .action(async (identifier: string) => {
      const masterPassword = await getMasterPassword();
      const store = new AccountStore(masterPassword);
      const account = store.findByIdentifier(identifier);

      if (!account) {
        console.error(`No account found matching: ${identifier}`);
        process.exit(1);
      }

      // Build proxy config from account's stored proxy settings
      let proxyConfig: ProxyConfig | undefined;
      if (account.proxy) {
        proxyConfig = {
          server: `http://${account.proxy.host}:${account.proxy.port}`,
          username: account.proxy.username,
          password: account.proxy.password,
        };
      }

      console.log(`Logging in to ${account.loginId}...`);
      // headless: false so the user can see the browser and resolve CAPTCHA manually
      const browser = await launchStealthBrowser(false);
      try {
        const result = await loginToLazada({
          browser,
          account,
          masterPassword,
          proxyConfig,
        });

        if (result.success) {
          const accounts = store.list();
          const idx = accounts.findIndex((a) => a.id === account.id);
          if (idx !== -1) {
            accounts[idx].lastLoginAt = new Date().toISOString();
            store.save(accounts);
          }
          console.log(`Login successful: ${account.loginId}`);
        } else {
          console.error(`Login failed: ${result.error ?? 'Unknown error'}`);
          process.exitCode = 1;
        }
      } catch (err) {
        console.error('Login error:', err instanceof Error ? err.message : err);
        process.exitCode = 1;
      } finally {
        await browser.close();
      }
    });

  accountCmd
    .command('test-session <identifier>')
    .description('Validate the saved session for an account without re-logging in')
    .action(async (identifier: string) => {
      const masterPassword = await getMasterPassword();
      const store = new AccountStore(masterPassword);
      const account = store.findByIdentifier(identifier);

      if (!account) {
        console.error(`No account found matching: ${identifier}`);
        process.exit(1);
      }

      const sessionJson = loadSession(account.id, masterPassword);
      if (!sessionJson) {
        console.log('No saved session. Run `pokebot account login` first.');
        return;
      }

      console.log(`Validating session for ${account.loginId}...`);
      const browser = await launchStealthBrowser(true);
      try {
        const state = JSON.parse(sessionJson) as {
          cookies: { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None' }[];
          origins: object[];
        };

        let proxyConfig: ProxyConfig | undefined;
        if (account.proxy) {
          proxyConfig = {
            server: `http://${account.proxy.host}:${account.proxy.port}`,
            username: account.proxy.username,
            password: account.proxy.password,
          };
        }

        const context = await createStealthContext(browser, proxyConfig);
        try {
          if (state.cookies && state.cookies.length > 0) {
            await context.addCookies(state.cookies);
          }
          const page = await context.newPage();
          try {
            const valid = await isSessionValid(page);
            if (valid) {
              console.log('Session valid');
            } else {
              console.log('Session expired — re-login needed');
              process.exitCode = 1;
            }
          } finally {
            await page.close();
          }
        } finally {
          await context.close();
        }
      } finally {
        await browser.close();
      }
    });
}
