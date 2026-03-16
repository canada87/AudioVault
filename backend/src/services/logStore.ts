export interface LogEntry {
  id: number;
  level: number;
  levelLabel: string;
  msg: string;
  time: number;
  [key: string]: unknown;
}

export interface LogStoreOptions {
  maxEntries: number;
  maxAgeMs: number;
}

const PINO_LEVELS: Record<number, string> = {
  10: 'trace',
  20: 'debug',
  30: 'info',
  40: 'warn',
  50: 'error',
  60: 'fatal',
};

class LogStore {
  private buffer: LogEntry[] = [];
  private nextId = 1;
  private readonly maxEntries: number;
  private readonly maxAgeMs: number;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: LogStoreOptions = { maxEntries: 2000, maxAgeMs: 24 * 60 * 60 * 1000 }) {
    this.maxEntries = options.maxEntries;
    this.maxAgeMs = options.maxAgeMs;

    // Prune expired entries every 5 minutes
    this.pruneTimer = setInterval(() => this.pruneExpired(), 5 * 60 * 1000);
  }

  push(raw: Record<string, unknown>): void {
    const level = (typeof raw['level'] === 'number' ? raw['level'] : 30) as number;
    const msg = (typeof raw['msg'] === 'string' ? raw['msg'] : '') as string;
    const time = (typeof raw['time'] === 'number' ? raw['time'] : Date.now()) as number;

    const entry: LogEntry = {
      ...raw,
      id: this.nextId++,
      level,
      levelLabel: PINO_LEVELS[level] ?? 'info',
      msg,
      time,
    };

    this.buffer.push(entry);

    // Rotate: drop oldest entries when over capacity
    if (this.buffer.length > this.maxEntries) {
      this.buffer = this.buffer.slice(this.buffer.length - this.maxEntries);
    }
  }

  /** Return entries matching filters, newest first */
  query(options: { minLevel?: number; since?: number; limit?: number }): LogEntry[] {
    const { minLevel = 0, since = 0, limit = 500 } = options;
    const now = Date.now();
    const cutoff = now - this.maxAgeMs;

    let result = this.buffer.filter(
      (e) => e.level >= minLevel && e.time >= cutoff && e.time >= since,
    );

    // Newest first
    result = result.reverse();

    if (result.length > limit) {
      result = result.slice(0, limit);
    }

    return result;
  }

  /** Remove entries older than maxAgeMs */
  private pruneExpired(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    this.buffer = this.buffer.filter((e) => e.time >= cutoff);
  }

  get size(): number {
    return this.buffer.length;
  }

  clear(): void {
    this.buffer = [];
  }

  destroy(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }
}

// Singleton instance — max 2000 entries, max 24h retention
export const logStore = new LogStore({ maxEntries: 2000, maxAgeMs: 24 * 60 * 60 * 1000 });
