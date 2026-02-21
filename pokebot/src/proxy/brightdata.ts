import type { ProxyProvider, ProxyConfig } from './provider.js';

export function createBrightDataProvider(config: {
  customerId: string;
  zone: string;
  password: string;
  country: string;
}): ProxyProvider {
  return {
    name: 'brightdata',

    getProxy(sessionId: string): ProxyConfig {
      return {
        server: 'http://brd.superproxy.io:33335',
        username: `brd-customer-${config.customerId}-zone-${config.zone}-country-${config.country}-session-${sessionId}`,
        password: config.password,
      };
    },

    reportFailure(sessionId: string): void {
      console.warn(`[brightdata] Proxy session ${sessionId} reported failure — use new sessionId for fresh IP`);
    },
  };
}
