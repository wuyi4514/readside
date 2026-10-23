export class TextCache<V> {
  private entries = new Map<string, { value: V; bytes: number }>();
  private bytes = 0;
  constructor(private readonly maxEntries = 1000, private readonly maxBytes = 5 * 1024 * 1024) {}
  get(key: string): V | undefined {
    const item = this.entries.get(key);
    if (!item) return undefined;
    this.entries.delete(key); this.entries.set(key, item);
    return item.value;
  }
  set(key: string, value: V): void {
    const existing = this.entries.get(key);
    if (existing) { this.bytes -= existing.bytes; this.entries.delete(key); }
    const bytes = (key.length + JSON.stringify(value).length) * 2;
    if (bytes > this.maxBytes) return;
    this.entries.set(key, { value, bytes }); this.bytes += bytes;
    while (this.entries.size > this.maxEntries || this.bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.bytes -= this.entries.get(oldest)!.bytes; this.entries.delete(oldest);
    }
  }
  clear(): void { this.entries.clear(); this.bytes = 0; }
}
