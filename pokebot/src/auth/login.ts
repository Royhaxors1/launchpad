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
  onCaptcha?: () => void;
}): Promise<{ success: boolean; error?: string }> {
  const { browser, account, masterPassword, proxyConfig, onCaptcha } = options;

  // --- Try session restore first ---
  const savedSessionJson = loadSession(account.id, masterPassword);
  if (savedSessionJson) {
    const context = await createStealthContext(browser, proxyConfig);
    try {
      // storageState JSON includes { cookies, origins } — we restore cookies into the context
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
          // Refresh the saved session with the current cookies
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

  // --- Fresh login flow ---
  const context = await createStealthContext(browser, proxyConfig);
  try {
    const page = await context.newPage();

    await page.goto('https://member.lazada.sg/user/login', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });
    await humanDelay(800, 1500);

    // Fill login ID (email or phone)
    // Lazada SG login uses a single text input for both email and phone.
    // Use CSS union selector as fallback chain — Playwright locators are always truthy objects
    // so || chaining doesn't work; union selectors do.
    const loginInput = page
      .locator('input[placeholder*="email" i], input[placeholder*="phone" i], input[placeholder*="mobile" i], input[name="loginId"], input[type="text"]')
      .first();

    await loginInput.click();
    await humanDelay(200, 400);
    // Type with human-like delays (50-150ms per character)
    await page.keyboard.type(account.loginId, { delay: 50 + Math.random() * 100 });
    await humanDelay(400, 800);

    // Fill password — Lazada password field uses type="password"
    const passwordInput = page
      .locator('input[placeholder*="password" i], input[type="password"]')
      .first();

    await passwordInput.click();
    await humanDelay(200, 400);
    await page.keyboard.type(account.password, { delay: 50 + Math.random() * 100 });
    await humanDelay(400, 800);

    // Click login/submit button
    // Lazada uses a button with text "Log In" or a submit button inside the form.
    // getByRole is preferred but falls back to submit button type.
    const submitBtn = page
      .locator('button[type="submit"], button:text-matches("log.?in|sign.?in", "i")')
      .first();

    await submitBtn.click();
    await humanDelay(500, 1000);

    // Wait up to 30s for navigation result
    const loginResult = await Promise.race([
      waitForLoginOutcome(page),
      new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 30000)),
    ]);

    if (loginResult === 'success') {
      await saveSession(context, account.id, masterPassword);
      return { success: true };
    }

    if (loginResult === 'captcha' || loginResult === 'otp') {
      console.warn(
        `[PokeBot] ${loginResult === 'captcha' ? 'CAPTCHA' : 'OTP'} detected for ${account.loginId} — waiting up to 60s for manual resolution`,
      );
      onCaptcha?.();

      // Wait up to 60s for the user to resolve
      const resolveResult = await Promise.race([
        waitForLoginOutcome(page),
        new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), 60000)),
      ]);

      if (resolveResult === 'success') {
        await saveSession(context, account.id, masterPassword);
        return { success: true };
      }

      return {
        success: false,
        error: 'CAPTCHA/OTP timeout — manual resolution required',
      };
    }

    if (loginResult === 'timeout') {
      return { success: false, error: 'Login timed out waiting for redirect' };
    }

    // loginResult === 'error'
    const errorText = await extractLoginError(page);
    return { success: false, error: errorText ?? 'Login failed — unknown error' };
  } finally {
    // Always close the context — caller creates their own for actual work
    await context.close();
  }
}

async function waitForLoginOutcome(
  page: import('rebrowser-playwright').Page,
): Promise<'success' | 'captcha' | 'otp' | 'error'> {
  while (true) {
    const url = page.url();

    // Success: redirected away from login page
    if (!url.includes('/user/login') && !url.includes('member.lazada.sg/user/login')) {
      return 'success';
    }

    // CAPTCHA: Baxia slider or verification challenge
    // Lazada uses Alibaba Baxia captcha — look for nc_wrapper (non-continuous drag captcha)
    const captchaVisible =
      (await page.locator('#nc_wrapper').isVisible().catch(() => false)) ||
      (await page.locator('.baxia-dialog').isVisible().catch(() => false)) ||
      (await page.locator('[class*="captcha"]').isVisible().catch(() => false));

    if (captchaVisible) {
      return 'captcha';
    }

    // OTP: phone verification input
    const otpVisible =
      (await page.locator('input[placeholder*="OTP"]').isVisible().catch(() => false)) ||
      (await page.locator('input[placeholder*="verification code"]').isVisible().catch(() => false)) ||
      (await page.locator('[class*="otp"]').isVisible().catch(() => false));

    if (otpVisible) {
      return 'otp';
    }

    // Error message in form
    const errorVisible =
      (await page.locator('.error-message').isVisible().catch(() => false)) ||
      (await page.locator('[class*="error"]').isVisible().catch(() => false));

    if (errorVisible) {
      return 'error';
    }

    // Still on login page loading — wait a bit then re-check
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}

async function extractLoginError(page: import('rebrowser-playwright').Page): Promise<string | null> {
  try {
    const errorEl = page.locator('.error-message, [class*="error"]').first();
    const text = await errorEl.textContent({ timeout: 2000 });
    return text?.trim() ?? null;
  } catch {
    return null;
  }
}
