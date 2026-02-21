import { Command } from 'commander';
import { input, password, confirm, select } from '@inquirer/prompts';
import Table from 'cli-table3';
import { AccountStore } from '../account/store.js';
import type { Account } from '../account/types.js';

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

      const loginType = await select({
        message: 'Login method:',
        choices: [
          { name: 'Email', value: 'email' as const },
          { name: 'Phone', value: 'phone' as const },
        ],
      });

      const loginId = await input({
        message: loginType === 'email' ? 'Email address:' : 'Phone number:',
        validate: (v) => v.trim().length > 0 || 'Required',
      });

      const accountPassword = await password({
        message: 'Password:',
        mask: '*',
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
        loginType,
        password: accountPassword,
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
        head: ['#', 'Login ID', 'Type', 'Proxy', 'Payment', 'Last Login'],
        style: { head: ['cyan'] },
      });

      accounts.forEach((account, i) => {
        table.push([
          String(i + 1),
          account.loginId,
          account.loginType,
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

      const newLoginType = await select({
        message: 'Login method:',
        choices: [
          { name: 'Email', value: 'email' as const },
          { name: 'Phone', value: 'phone' as const },
        ],
        default: account.loginType,
      });

      const newLoginId = await input({
        message: newLoginType === 'email' ? 'Email address:' : 'Phone number:',
        default: account.loginId,
      });

      const newPassword = await password({
        message: 'Password (press Enter to keep existing):',
        mask: '*',
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

      const updates: Parameters<typeof store.update>[1] = {
        loginId: newLoginId.trim(),
        loginType: newLoginType,
        proxy: newProxy,
        paymentLabel: newPaymentLabel.trim(),
      };

      if (newPassword) {
        updates.password = newPassword;
      }

      store.update(account.id, updates);
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
}
