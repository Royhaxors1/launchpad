import type { Page, Response } from 'rebrowser-playwright';

export interface DetectionResult {
  detected: boolean;
  signal: 'captcha' | 'block_403' | 'redirect' | 'empty_page' | 'missing_data' | 'none';
  details?: string;
}

export async function checkDetection(page: Page, response: Response | null): Promise<DetectionResult> {
  // 1. Check for slider CAPTCHA
  const content = await page.content().catch(() => '');
  if (/baxia-dialog|nc_wrapper|captcha/i.test(content)) {
    return { detected: true, signal: 'captcha', details: 'CAPTCHA element detected on page' };
  }

  // 2. Check HTTP 403/429
  if (response) {
    const status = response.status();
    if (status === 403 || status === 429) {
      return { detected: true, signal: 'block_403', details: `HTTP ${status} response` };
    }
  }

  // 3. Check redirect to verification page
  const url = page.url();
  if (/sec\.|verify/i.test(url)) {
    return { detected: true, signal: 'redirect', details: `Redirected to verification: ${url}` };
  }

  // 4. Check for empty page
  if (content.length < 500) {
    return { detected: true, signal: 'empty_page', details: `Page content too short (${content.length} chars)` };
  }

  // 5. Check for missing product data (soft signal)
  const hasProductStructure = /<h1/i.test(content) || /product/i.test(content);
  if (!hasProductStructure) {
    return { detected: true, signal: 'missing_data', details: 'No recognizable product structure on page' };
  }

  return { detected: false, signal: 'none' };
}
