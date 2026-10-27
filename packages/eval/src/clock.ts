/**
 * 固定时钟：让评测时间可重复。now() 统一规范化为 UTC ISO-8601
 * （YYYY-MM-DDTHH:MM:SS.sssZ），两次以相同参数构造输出完全一致。
 */
export class FixedClock {
  private nowMs: number;

  constructor(startAtIso: string) {
    const ms = Date.parse(startAtIso);
    if (Number.isNaN(ms)) {
      throw new Error(`FixedClock: invalid start ISO datetime: ${startAtIso}`);
    }
    this.nowMs = ms;
  }

  /** 当前时间（ISO-8601，UTC，含时区后缀，满足 IsoDateTimeSchema）。 */
  now(): string {
    return new Date(this.nowMs).toISOString();
  }

  /** 推进 ms 毫秒；仅接受有限非负数。 */
  tick(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new Error(`FixedClock.tick: ms must be a finite non-negative number but got ${ms}`);
    }
    this.nowMs += ms;
  }
}
