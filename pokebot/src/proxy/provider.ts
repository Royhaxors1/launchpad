import { createBrightDataProvider } from './brightdata.js';

export interface ProxyConfig {
  server: string;
  username: string;
  password: string;
}

export interface ProxyProvider {
  name: string;
  getProxy(sessionId: string): ProxyConfig;
  reportFailure(sessionId: string): void;
}

export function createProxyProvider(config: {
  provider: string;
  customerId: string;
  zone: string;
  password: string;
  country: string;
}): ProxyProvider {
  switch (config.provider) {
    case 'brightdata':
      return createBrightDataProvider({
        customerId: config.customerId,
        zone: config.zone,
        password: config.password,
        country: config.country,
      });
    default:
      throw new Error(`Unknown proxy provider: ${config.provider}. Supported: brightdata`);
  }
}
