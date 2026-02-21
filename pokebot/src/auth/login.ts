import type { Browser } from 'rebrowser-playwright';
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
  onOtp?: () => void;
}): Promise<{ success: boolean; error?: string }> {
  const { browser, account, masterPassword, proxyConfig, onOtp } = options;

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

    // Fill phone number — target the exact placeholder, not the country code area
    const phoneInput = page.locator('input[placeholder*="enter your phone number" i]').first();

    await phoneInput.waitFor({ state: 'visible', timeout: 5000 });
    await phoneInput.click({ force: true });
    await humanDelay(200, 400);

    // Strip country code prefix if present — the form already shows +65
    let phoneDigits = account.loginId.replace(/\s+/g, '');
    if (phoneDigits.startsWith('+65')) phoneDigits = phoneDigits.slice(3);
    if (phoneDigits.startsWith('65') && phoneDigits.length > 8) phoneDigits = phoneDigits.slice(2);

    await page.keyboard.type(phoneDigits, { delay: 50 + Math.random() * 100 });
    await humanDelay(400, 800);

    // Block only WhatsApp deep link navigation — it kills the page.
    // Lazada API calls to send the OTP still go through.
    await page.route(/whatsapp|wa\.me/, (route) => route.abort());

    // Click "Send code via Whatsapp"
    const whatsappBtn = page.locator('text=Send code via Whatsapp').first();
    await whatsappBtn.waitFor({ state: 'visible', timeout: 5000 });
    await whatsappBtn.click();
    await humanDelay(2000, 3000);

    // Remove route handler so subsequent navigations work normally
    await page.unroute(/whatsapp|wa\.me/);

    console.log('OTP sent via WhatsApp — enter the 6-digit code in the browser window');
    onOtp?.();

    // Wait up to 120s for user to enter OTP and complete login
    const result = await Promise.race([
      waitForLoginSuccess(page),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 120000)),
    ]);

    if (result === 'success') {
      await saveSession(context, account.id, masterPassword);
      return { success: true };
    }

    if (result === 'timeout') {
      return { success: false, error: 'OTP timeout — enter the code in the browser within 120s' };
    }

    const errorText = await extractLoginError(page);
    return { success: false, error: errorText ?? 'Login failed — unknown error' };
  } finally {
    await context.close();
  }
}

async function waitForLoginSuccess(
  page: import('rebrowser-playwright').Page,
): Promise<'success' | 'error'> {
  while (true) {
    const url = page.url();

    // Only count as success if on a lazada.sg page that's NOT the login page
    if (
      url.includes('lazada.sg') &&
      !url.includes('/user/login') &&
      !url.includes('member.lazada.sg/user/login')
    ) {
      return 'success';
    }

    // Error message in form
    const errorVisible =
      (await page.locator('.error-message').isVisible().catch(() => false)) ||
      (await page.locator('[class*="error"]:not(input)').isVisible().catch(() => false));

    if (errorVisible) {
      return 'error';
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function extractLoginError(page: import('rebrowser-playwright').Page): Promise<string | null> {
  try {
    const errorEl = page.locator('.error-message, [class*="error"]:not(input)').first();
    const text = await errorEl.textContent({ timeout: 2000 });
    return text?.trim() ?? null;
  } catch {
    return null;
  }
}
