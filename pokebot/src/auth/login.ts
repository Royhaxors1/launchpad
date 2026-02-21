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
    let page = await context.newPage();

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

    // Prevent the WhatsApp deep link from killing the page.
    // The button triggers whatsapp:// protocol navigation which Playwright can't handle.
    // Override window.open and intercept link clicks to swallow non-HTTP navigations.
    await page.evaluate(() => {
      window.open = (() => null) as any;

      // Intercept anchor clicks that use whatsapp:// or similar protocols
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

    const whatsappBtn = page.locator('text=Send code via Whatsapp').first();
    await whatsappBtn.waitFor({ state: 'visible', timeout: 5000 });
    await whatsappBtn.click();
    await humanDelay(2000, 3000);

    // Check if the page survived. If it died (about:blank or disconnected),
    // create a new page and navigate back — the OTP was already sent.
    let pageAlive = true;
    try {
      const currentUrl = page.url();
      if (!currentUrl.includes('lazada')) {
        pageAlive = false;
      }
    } catch {
      pageAlive = false;
    }

    if (!pageAlive) {
      // Page died from the deep link — create new page and go back to login.
      // Lazada should show the OTP form since it was already sent for this phone.
      try { await page.close(); } catch {}
      page = await context.newPage();
      await page.goto('https://member.lazada.sg/user/login', {
        waitUntil: 'networkidle',
        timeout: 15000,
      });
      await humanDelay(1000, 2000);

      // Re-select Phone Number tab and re-enter phone to get back to OTP screen
      const phoneTab2 = page.locator('text=Phone Number').first();
      await phoneTab2.waitFor({ state: 'visible', timeout: 10000 });
      await phoneTab2.click();
      await humanDelay(400, 800);

      const phoneInput2 = page.locator('input[placeholder*="enter your phone number" i]').first();
      await phoneInput2.waitFor({ state: 'visible', timeout: 5000 });
      await phoneInput2.click({ force: true });
      await humanDelay(200, 400);
      await page.keyboard.type(phoneDigits, { delay: 50 + Math.random() * 100 });
      await humanDelay(400, 800);

      // Click WhatsApp again — Lazada should show "Resend OTP in Xs" or the OTP form directly
      const whatsappBtn2 = page.locator('text=Send code via Whatsapp').first();
      const hasWhatsappBtn = await whatsappBtn2.isVisible().catch(() => false);
      if (hasWhatsappBtn) {
        await page.evaluate(() => { window.open = (() => null) as any; });
        await whatsappBtn2.click();
        await humanDelay(2000, 3000);
      }
    }

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

    return { success: false, error: 'OTP timeout — enter the code in the browser within 120s' };
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

      // Success: on lazada.sg AND pathname has no "login" in it.
      // Login pages: /user/login, /wow/gcp/sg/member/login-signup, etc.
      // Logged-in pages: /, /account/, /wow/..., etc.
      if (parsed.hostname.includes('lazada.sg') && !parsed.pathname.includes('login')) {
        return 'success';
      }
    } catch {
      // Page might be disconnected or URL invalid — keep polling
    }

    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
