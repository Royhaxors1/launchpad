import type { Browser, BrowserContext } from 'rebrowser-playwright';
import { FingerprintGenerator } from 'fingerprint-generator';
import { FingerprintInjector } from 'fingerprint-injector';

interface ProxyConfig {
  server: string;
  username: string;
  password: string;
}

export async function createStealthContext(
  browser: Browser,
  proxy?: ProxyConfig,
): Promise<BrowserContext> {
  // Try newInjectedContext first (preferred — handles viewport/screen consistency)
  try {
    const { newInjectedContext } = await import('fingerprint-injector');
    const ctx = await newInjectedContext(browser as any, {
      fingerprintOptions: {
        devices: ['desktop'],
        operatingSystems: ['windows', 'macos'],
        browsers: [{ name: 'chrome' }],
        locales: ['en-SG', 'en-US'],
      },
      newContextOptions: {
        locale: 'en-SG',
        timezoneId: 'Asia/Singapore',
        proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
      },
    });
    // Cast needed: playwright vs rebrowser-playwright types differ but share the same runtime API
    return ctx as unknown as BrowserContext;
  } catch {
    // Fallback: manual fingerprint generation + injection
    const generator = new FingerprintGenerator();
    const fingerprintData = generator.getFingerprint({
      devices: ['desktop'],
      operatingSystems: ['windows', 'macos'],
      browsers: [{ name: 'chrome' }],
      locales: ['en-SG', 'en-US'],
    });

    const context = await browser.newContext({
      userAgent: fingerprintData.fingerprint.navigator.userAgent,
      locale: 'en-SG',
      timezoneId: 'Asia/Singapore',
      screen: fingerprintData.fingerprint.screen,
      viewport: {
        width: fingerprintData.fingerprint.screen.width,
        height: fingerprintData.fingerprint.screen.height,
      },
      proxy: proxy ? { server: proxy.server, username: proxy.username, password: proxy.password } : undefined,
    });

    const injector = new FingerprintInjector();
    await injector.attachFingerprintToPlaywright(context as any, fingerprintData);
    return context;
  }
}
