export type StockStatus = 'in_stock' | 'out_of_stock' | 'pre_order' | 'coming_soon' | 'unknown';

export interface StockState {
  url: string;
  status: StockStatus;
  price: string | null;
  title: string | null;
  lastChecked: string;
  lastTransition: string | null;
}

export type TransitionType = 'restock' | 'sold_out' | 'none';

export function isAvailable(status: StockStatus): boolean {
  return status === 'in_stock';
}

export function detectTransition(
  previous: StockState | null,
  current: StockState,
): TransitionType {
  if (!previous) {
    return isAvailable(current.status) ? 'restock' : 'none';
  }

  const wasBuyable = isAvailable(previous.status);
  const isBuyable = isAvailable(current.status);

  if (!wasBuyable && isBuyable) return 'restock';
  if (wasBuyable && !isBuyable) return 'sold_out';
  return 'none';
}
