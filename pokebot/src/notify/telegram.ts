export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

interface TelegramResult {
  ok: boolean;
  error?: string;
}

export async function sendTelegramMessage(
  config: TelegramConfig,
  text: string,
  parseMode: 'HTML' | 'Markdown' = 'HTML',
): Promise<TelegramResult> {
  const url = `https://api.telegram.org/bot${config.botToken}/sendMessage`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: config.chatId,
        text,
        parse_mode: parseMode,
      }),
    });

    const data = (await res.json()) as { ok: boolean; description?: string };

    if (!data.ok) {
      const error = data.description ?? `HTTP ${res.status}`;
      console.error(`Telegram API error: ${error}`);
      return { ok: false, error };
    }

    return { ok: true };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`Telegram send failed: ${error}`);
    return { ok: false, error };
  }
}

function toSGT(date: Date): string {
  return date.toLocaleString('en-SG', { timeZone: 'Asia/Singapore' });
}

export function formatRestockAlert(data: {
  title: string;
  price: string;
  url: string;
  detectedAt: Date;
}): string {
  return [
    `<b>RESTOCK DETECTED</b>`,
    ``,
    `<b>${escapeHtml(data.title)}</b>`,
    `Price: ${escapeHtml(data.price)}`,
    `<a href="${data.url}">View on Lazada</a>`,
    ``,
    `Detected: ${toSGT(data.detectedAt)}`,
  ].join('\n');
}

export function formatSoldOutAlert(data: {
  title: string;
  url: string;
  detectedAt: Date;
}): string {
  return [
    `<b>SOLD OUT</b>`,
    ``,
    `${escapeHtml(data.title)}`,
    `<a href="${data.url}">View on Lazada</a>`,
    ``,
    `Detected: ${toSGT(data.detectedAt)}`,
  ].join('\n');
}

export function formatDigest(summary: {
  urlsMonitored: number;
  restocksDetected: number;
  soldOuts: number;
  errorsEncountered: number;
  uptime: string;
}): string {
  return [
    `<b>Daily Digest</b>`,
    ``,
    `URLs monitored: ${summary.urlsMonitored}`,
    `Restocks detected: ${summary.restocksDetected}`,
    `Sold outs: ${summary.soldOuts}`,
    `Errors: ${summary.errorsEncountered}`,
    `Uptime: ${escapeHtml(summary.uptime)}`,
  ].join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
