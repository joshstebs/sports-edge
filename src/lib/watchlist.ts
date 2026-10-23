export type WatchKind = 'player' | 'prop' | 'matchup' | 'research';

export interface WatchSnapshot {
  checkedAt: string;
  average: number | null;
  sample: number;
  hitRate: number | null;
  line: number | null;
  side: 'over' | 'under' | null;
}

export interface WatchItem {
  id: string;
  kind: WatchKind;
  createdAt: string;
  sport: string;
  label: string;
  player?: string;
  market?: string;
  line?: number | null;
  side?: 'over' | 'under';
  matchup?: string;
  windowSize?: number;
  snapshot?: WatchSnapshot;
}

const PREFIX = 'sports-edge:watchlist:v1:';

export function watchlistStorageKey(userId: string): string {
  return `${PREFIX}${userId}`;
}

export function watchIdentity(item: Pick<WatchItem, 'kind' | 'sport' | 'player' | 'market' | 'line' | 'side' | 'matchup' | 'label'>): string {
  return [
    item.kind,
    item.sport,
    item.player ?? '',
    item.market ?? '',
    item.line ?? '',
    item.side ?? '',
    item.matchup ?? '',
    item.label,
  ].join('|').toLowerCase();
}

function isWatchItem(value: unknown): value is WatchItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<WatchItem>;
  return typeof item.id === 'string'
    && typeof item.kind === 'string'
    && typeof item.createdAt === 'string'
    && typeof item.sport === 'string'
    && typeof item.label === 'string';
}

export function loadWatchlist(userId: string, storage: Pick<Storage, 'getItem'> = localStorage): WatchItem[] {
  try {
    const raw = storage.getItem(watchlistStorageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isWatchItem).slice(0, 80);
  } catch {
    return [];
  }
}

export function saveWatchlist(userId: string, items: WatchItem[], storage: Pick<Storage, 'setItem'> = localStorage): void {
  storage.setItem(watchlistStorageKey(userId), JSON.stringify(items.slice(0, 80)));
}

export function upsertWatch(items: WatchItem[], item: WatchItem): WatchItem[] {
  const key = watchIdentity(item);
  return [item, ...items.filter((existing) => watchIdentity(existing) !== key)].slice(0, 80);
}

export function removeWatch(items: WatchItem[], id: string): WatchItem[] {
  return items.filter((item) => item.id !== id);
}

/** Compare only when the line and side are the same. Otherwise the hit rate is not the same question. */
export function compareSnapshots(previous: WatchSnapshot | undefined, next: WatchSnapshot): string | null {
  if (!previous || !previous.checkedAt || !next.checkedAt) return null;
  if (previous.line !== next.line || previous.side !== next.side) return null;
  const notes: string[] = [];
  if (previous.average != null && next.average != null && previous.average !== next.average) {
    const delta = next.average - previous.average;
    notes.push(`Average ${delta > 0 ? '+' : ''}${delta.toFixed(2)}`);
  }
  if (previous.hitRate != null && next.hitRate != null && previous.hitRate !== next.hitRate) {
    const delta = next.hitRate - previous.hitRate;
    notes.push(`Hit rate ${delta > 0 ? '+' : ''}${delta.toFixed(1)} pp`);
  }
  if (previous.sample !== next.sample) notes.push(`Sample ${previous.sample} → ${next.sample}`);
  if (!notes.length) return 'No change in the comparable observations.';
  return `${notes.join(' · ')} since ${previous.checkedAt}`;
}
