import { InsightConsumer } from './consume.js';
import { processProjectRules } from './insights/processor.js';
import type { ObserverReadPort } from './observer-read-port.js';
import type { InsightStore } from './store/store.js';

/** Deterministic reconciliation only. No analysis/provider dependency. */
export class InsightCoordinator {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private active: Promise<void> | undefined;
  private stopped = true;
  private offset = 0;
  private readonly consumer: InsightConsumer;
  private readonly metrics = { ticks: 0, errors: 0, frozen: 0, lastSuccessAt: null as string | null, lastErrorCode: null as string | null };
  constructor(private readonly deps: {
    store: InsightStore; port: ObserverReadPort; projectIds: () => string[];
    intervalMs?: number; projectsPerTick?: number;
  }) { this.consumer = new InsightConsumer(deps.store); }

  health() { return { ...this.metrics, running: !this.stopped, busy: this.active !== undefined }; }
  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.schedule(0);
  }
  async stop(): Promise<void> {
    this.stopped = true;
    clearTimeout(this.timer);
    await this.active;
  }
  private schedule(ms: number): void {
    this.timer = setTimeout(() => {
      this.active = this.tick().finally(() => {
        this.active = undefined;
        if (!this.stopped) this.schedule(Math.max(20, this.deps.intervalMs ?? 1000));
      });
    }, ms);
    this.timer.unref();
  }
  private async tick(): Promise<void> {
    this.metrics.ticks++;
    try {
      const ids = this.deps.projectIds().sort();
      const count = Math.min(ids.length, Math.max(1, Math.min(32, this.deps.projectsPerTick ?? 8)));
      for (let i = 0; i < count && !this.stopped; i++) {
        const id = ids[(this.offset + i) % ids.length]!;
        try {
          const consumed = await this.consumer.consumeProjectBatch(this.deps.port, { projectId: id, limit: 100 });
          // Rule processing must also run when consume has no new signals: it may
          // be catching up after a crash between signal commit and rule commit.
          const rules = processProjectRules(this.deps.store, { projectId: id, streamEpoch: consumed.checkpoint.streamEpoch, limit: 100, baseline: 'none' });
          if (rules.outcome === 'FROZEN' || consumed.outcome === 'FROZEN') this.metrics.frozen++;
          this.metrics.lastSuccessAt = new Date().toISOString();
        } catch (cause) {
          this.metrics.errors++;
          const code = (cause as { code?: string }).code;
          this.metrics.lastErrorCode = code && /^[A-Z_]+$/.test(code) ? code : 'CONSUME_FAILED';
        }
      }
      this.offset = ids.length ? (this.offset + count) % ids.length : 0;
    } catch { this.metrics.errors++; this.metrics.lastErrorCode = 'SOURCE_LIST_FAILED'; }
  }
}
