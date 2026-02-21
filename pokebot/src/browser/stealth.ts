import { chromium, type Browser } from 'rebrowser-playwright';

export async function launchStealthBrowser(headless: boolean): Promise<Browser> {
  return chromium.launch({
    headless,
    args: [
      '--disable-blink-features=AutomationControlled',
      '--enable-webgl',
      '--enable-accelerated-2d-canvas',
      '--no-first-run',
      '--disable-extensions',
    ],
  });
}
