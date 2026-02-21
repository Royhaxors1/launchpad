import type { Page } from 'rebrowser-playwright';

export interface ProductData {
  url: string;
  title: string | null;
  price: string | null;
  stockStatus: 'in_stock' | 'out_of_stock' | 'unknown';
  scrapedAt: string;
}

export async function extractProductData(page: Page): Promise<ProductData> {
  // Wait for page to settle
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});

  const title = await page.textContent('h1').catch(() => null);
  if (!title) {
    console.warn('[scraper] Title extraction failed — h1 selector may need updating for this page');
  }

  const price = await page.textContent('[class*="price"]').catch(() => null);

  // Determine stock status
  let stockStatus: ProductData['stockStatus'] = 'unknown';
  const bodyText = await page.textContent('body').catch(() => '') ?? '';
  const hasOutOfStock = /out of stock|sold out/i.test(bodyText);
  const disabledCart = await page.$('button[disabled][class*="cart"], button[disabled][class*="buy"]').catch(() => null);

  if (hasOutOfStock || disabledCart) {
    stockStatus = 'out_of_stock';
  } else if (title) {
    stockStatus = 'in_stock';
  }

  return {
    url: page.url(),
    title: title?.trim() ?? null,
    price: price?.trim() ?? null,
    stockStatus,
    scrapedAt: new Date().toISOString(),
  };
}
