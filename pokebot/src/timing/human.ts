import type { Page } from 'rebrowser-playwright';

function gaussianRandom(mean: number, stdDev: number): number {
  // Box-Muller transform
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

export async function humanDelay(minMs: number, maxMs: number): Promise<void> {
  const mean = (minMs + maxMs) / 2;
  const stdDev = (maxMs - minMs) / 6;
  const delay = Math.max(minMs, Math.min(maxMs, gaussianRandom(mean, stdDev)));
  return new Promise(resolve => setTimeout(resolve, delay));
}

export async function randomScroll(page: Page): Promise<void> {
  const scrollDown = 100 + Math.random() * 400;
  await page.mouse.wheel(0, scrollDown);
  await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));

  // 50% chance to scroll back up slightly
  if (Math.random() > 0.5) {
    const scrollUp = 50 + Math.random() * 150;
    await page.mouse.wheel(0, -scrollUp);
    await new Promise(resolve => setTimeout(resolve, 300 + Math.random() * 500));
  }
}
