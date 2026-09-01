export class LruCache<T> {
  private readonly values = new Map<string, { value: T; expiresAt: number }>();

  public constructor(private readonly capacity: number, private readonly ttlMs: number) {}

  public get(key: string): T | undefined {
    const entry = this.values.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return undefined;
    }
    this.values.delete(key);
    this.values.set(key, entry);
    return entry.value;
  }

  public set(key: string, value: T): void {
    this.values.delete(key);
    this.values.set(key, { value, expiresAt: Date.now() + this.ttlMs });
    while (this.values.size > this.capacity) this.values.delete(this.values.keys().next().value as string);
  }

  public clear(): void {
    this.values.clear();
  }
}
