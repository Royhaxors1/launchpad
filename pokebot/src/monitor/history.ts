import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { StockStatus, TransitionType } from './state.js';

export interface StockEvent {
  timestamp: string;
  url: string;
  title: string | null;
  previousStatus: StockStatus | null;
  newStatus: StockStatus;
  price: string | null;
  transition: TransitionType;
}

export function logStockEvent(event: StockEvent, logPath: string): void {
  mkdirSync(dirname(logPath), { recursive: true });
  appendFileSync(logPath, JSON.stringify(event) + '\n');
}
