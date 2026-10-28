export class DirtyHintBuffer {
  private readonly buffers = new Map<string, { paths: Set<string>; timer: ReturnType<typeof setTimeout> | null }>();

  constructor(
    private readonly debounceMs: number,
    private readonly onFlush: (projectId: string, paths: string[]) => void,
  ) {}

  hint(projectId: string, relativePath: string, debounceMs = this.debounceMs): void {
    const existing = this.buffers.get(projectId) ?? { paths: new Set<string>(), timer: null };
    existing.paths.add(relativePath);
    if (existing.timer !== null) clearTimeout(existing.timer);
    existing.timer = setTimeout(() => {
      this.flush(projectId);
    }, debounceMs);
    this.buffers.set(projectId, existing);
  }

  take(projectId: string): string[] {
    const existing = this.buffers.get(projectId);
    if (existing === undefined) return [];
    if (existing.timer !== null) clearTimeout(existing.timer);
    const paths = [...existing.paths];
    this.buffers.delete(projectId);
    return paths;
  }

  flush(projectId: string): string[] {
    const paths = this.take(projectId);
    if (paths.length > 0) this.onFlush(projectId, paths);
    return paths;
  }

  pending(projectId: string): boolean {
    const existing = this.buffers.get(projectId);
    return existing !== undefined && existing.paths.size > 0;
  }

  clear(): void {
    for (const entry of this.buffers.values()) {
      if (entry.timer !== null) clearTimeout(entry.timer);
    }
    this.buffers.clear();
  }
}
