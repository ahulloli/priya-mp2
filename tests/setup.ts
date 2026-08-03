/*
 * A minimal Web Storage shim.
 *
 * The alternative was jsdom, which drags in a dependency chain that needs
 * require(ESM) — unavailable before Node 22.12, and this project runs on
 * 22.3. Since nothing under test needs a DOM, only storage, a shim is both
 * lighter and less fragile.
 */
class MemoryStorage implements Storage {
  private entries = new Map<string, string>();

  get length(): number {
    return this.entries.size;
  }

  clear(): void {
    this.entries.clear();
  }

  getItem(key: string): string | null {
    return this.entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.entries.set(key, String(value));
  }
}

const local = new MemoryStorage();
const session = new MemoryStorage();

Object.defineProperties(globalThis, {
  localStorage: { value: local, writable: true },
  sessionStorage: { value: session, writable: true },
  window: {
    value: Object.assign(globalThis, {
      localStorage: local,
      sessionStorage: session,
    }),
    writable: true,
  },
});
