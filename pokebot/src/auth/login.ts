import type { Browser } from 'rebrowser-playwright';
import { input } from '@inquirer/prompts';
import { createStealthContext } from '../browser/context.js';
import type { ProxyConfig } from '../proxy/provider.js';
import type { Account } from '../account/types.js';
import { saveSession, loadSession, isSessionValid } from './session.js';
import { humanDelay } from '../timing/human.js';

export async function loginToLazada(options: {
  browser: Browser;
  account: Account;
  masterPassword: string;
  proxyConfig?: ProxyConfig;
}): Promise<{ success: boolean; error?: string }> {
  const { browser, account, masterPassword, proxyConfig } = options;

  // --- Try session restore first ---
  const savedSessionJson = loadSession(account.id, masterPassword);
  if (savedSessionJson) {
    const context = await createStealthContext(browser, proxyConfig);
    try {
      const state = JSON.parse(savedSessionJson) as {
        cookies: { name: string; value: string; domain: string; path: string; expires: number; httpOnly: boolean; secure: boolean; sameSite: 'Strict' | 'Lax' | 'None' }[];
        origins: object[];
      };

      if (state.cookies && state.cookies.length > 0) {
        await context.addCookies(state.cookies);
      }

      const page = await context.newPage();
      try {
        const valid = await isSessionValid(page);
        if (valid) {
          await saveSession(context, account.id, masterPassword);
          return { success: true };
        }
      } finally {
        await page.close();
      }
    } catch {
      // Session restore failed — fall through to fresh login
    } finally {
      await context.close();
    }
  }

  // --- Fresh login flow (OTP-based) ---
  const context = await createStealthContext(browser, proxyConfig);
  try {
    const page = await context.newPage();

    await page.goto('https://member.lazada.sg/user/login', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    await humanDelay(1000, 2000);

    // Click the "Phone Number" tab — Lazada defaults to the Password tab
    const phoneTab = page.locator('text=Phone Number').first();
    await phoneTab.waitFor({ state: 'visible', timeout: 10000 });
    await phoneTab.click();
    await humanDelay(400, 800);

    // Fill phone number
    const phoneInput = page.locator('input[placeholder*="enter your phone number" i]').first();
    await phoneInput.waitFor({ state: 'visible', timeout: 5000 });
    await phoneInput.click({ force: true });
    await humanDelay(200, 400);

    // Strip country code prefix — the form already shows +65
    let phoneDigits = account.loginId.replace(/\s+/g, '');
    if (phoneDigits.startsWith('+65')) phoneDigits = phoneDigits.slice(3);
    if (phoneDigits.startsWith('65') && phoneDigits.length > 8) phoneDigits = phoneDigits.slice(2);

    await page.keyboard.type(phoneDigits, { delay: 50 + Math.random() * 100 });
    await humanDelay(400, 800);

    // Prevent the WhatsApp deep link from killing the page
    await page.evaluate(() => {
      window.open = (() => null) as any;
      document.addEventListener('click', (e) => {
        const anchor = (e.target as Element).closest('a');
        if (anchor) {
          const href = anchor.getAttribute('href') ?? '';
          if (href && !href.startsWith('http') && !href.startsWith('/') && !href.startsWith('#')) {
            e.preventDefault();
            e.stopPropagation();
          }
        }
      }, true);
    });

    // Click "Send code via Whatsapp"
    const whatsappBtn = page.locator('text=Send code via Whatsapp').first();
    await whatsappBtn.waitFor({ state: 'visible', timeout: 5000 });
    await whatsappBtn.click();
    await humanDelay(2000, 3000);

    // Ask for OTP in the terminal — user checks WhatsApp and types it here
    const otp = await input({
      message: 'Enter 6-digit OTP from WhatsApp:',
      validate: (v) => /^\d{6}$/.test(v.trim()) || 'Must be exactly 6 digits',
    });

    // Type OTP into the browser's input fields
    // Lazada OTP form has individual input boxes — typing digits sequentially fills them
    const otpInputs = page.locator('input[type="tel"], input[type="number"], input[maxlength="1"]');
    const inputCount = await otpInputs.count().catch(() => 0);

    if (inputCount >= 6) {
      // Individual digit boxes — click the first one and type all digits
      await otpInputs.first().click({ force: true });
      await humanDelay(200, 400);
      for (const digit of otp.trim()) {
        await page.keyboard.type(digit, { delay: 80 + Math.random() * 80 });
        await humanDelay(100, 200);
      }
    } else {
      // Single input or other layout — just type the full code
      await page.keyboard.type(otp.trim(), { delay: 80 + Math.random() * 80 });
    }
    await humanDelay(500, 1000);

    // Click Confirm button
    const confirmBtn = page.locator('button:text-matches("confirm|verify|submit", "i")').first();
    const hasConfirm = await confirmBtn.isVisible().catch(() => false);
    if (hasConfirm) {
      await confirmBtn.click();
    }
    await humanDelay(2000, 3000);

    // Wait for redirect away from login page
    const result = await Promise.race([
      waitForLoginSuccess(page),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30000)),
    ]);

    if (result === 'success') {
      await saveSession(context, account.id, masterPassword);
      return { success: true };
    }

    return { success: false, error: 'Login did not complete after OTP — check browser for errors' };
  } finally {
    await context.close();
  }
}

async function waitForLoginSuccess(
  page: import('rebrowser-playwright').Page,
): Promise<'success'> {
  while (true) {
    try {
      const url = page.url();
      const parsed = new URL(url);

      if (parsed.hostname.includes('lazada.sg') && !parsed.pathname.includes('login')) {
        return 'success';
      }
    } catch {
      // Page might be disconnected — keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
