import { Command } from 'commander';
import { input, password } from '@inquirer/prompts';
import { loadConfig, saveConfig } from '../config.js';
import { sendTelegramMessage, formatRestockAlert } from '../notify/telegram.js';

export function registerTelegramCommands(program: Command): void {
  const telegramCmd = program.command('telegram').description('Manage Telegram notifications');

  telegramCmd
    .command('setup')
    .description('Configure Telegram bot token and chat ID')
    .action(async () => {
      console.log('Configure Telegram notifications for PokeBot.\n');
      console.log('Get your bot token from @BotFather on Telegram.');
      console.log('To find your chat ID, message your bot then visit:');
      console.log('  https://api.telegram.org/bot{TOKEN}/getUpdates\n');

      const botToken = await password({
        message: 'Bot token:',
        mask: '*',
        validate: (v) => v.trim().length > 0 || 'Required',
      });

      const chatId = await input({
        message: 'Chat ID:',
        validate: (v) => v.trim().length > 0 || 'Required',
      });

      console.log('\nSending test message...');
      const result = await sendTelegramMessage(
        { botToken: botToken.trim(), chatId: chatId.trim() },
        'PokeBot connected! Telegram notifications will appear here.',
      );

      if (!result.ok) {
        console.error(`\nSetup failed: ${result.error}`);
        console.error('Credentials were NOT saved. Fix the issue and try again.');
        process.exitCode = 1;
        return;
      }

      const config = loadConfig();
      config.telegram = {
        ...config.telegram!,
        botToken: botToken.trim(),
        chatId: chatId.trim(),
      };
      saveConfig(config);
      console.log('\nTelegram setup complete. Credentials saved to config.json.');
    });

  telegramCmd
    .command('test')
    .description('Send a test restock alert to Telegram')
    .action(async () => {
      const config = loadConfig();

      if (!config.telegram?.botToken || !config.telegram?.chatId) {
        console.error('Telegram not configured. Run `pokebot telegram setup` first.');
        process.exitCode = 1;
        return;
      }

      const message = formatRestockAlert({
        title: 'Test Pokemon TCG Product',
        price: 'S$79.90',
        url: 'https://lazada.sg/test',
        detectedAt: new Date(),
      });

      console.log('Sending test alert...');
      const result = await sendTelegramMessage(
        { botToken: config.telegram.botToken, chatId: config.telegram.chatId },
        message,
      );

      if (result.ok) {
        console.log('Test alert sent successfully! Check your Telegram.');
      } else {
        console.error(`Failed to send: ${result.error}`);
        process.exitCode = 1;
      }
    });
}
