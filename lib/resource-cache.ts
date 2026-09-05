// Small LRU cache with leases: a fading or visible model cannot be evicted.
export class ResourceCache<T> {
  private entries = new Map<
    string,
    {
      promise: Promise<T>;
      value?: T;
      refs: number;
      controller: AbortController;
    }
  >();
  private limit: number;
  private loader: (key: string, signal: AbortSignal) => Promise<T>;
  private dispose: (value: T) => void;
  peek(key: string) {
    return this.entries.get(key)?.value;
  }
  constructor(
    limit: number,
    loader: (key: string, signal: AbortSignal) => Promise<T>,
    dispose: (value: T) => void,
  ) {
    this.limit = limit;
    this.loader = loader;
    this.dispose = dispose;
  }
  private trim() {
    for (const [key, entry] of this.entries) {
      if (this.entries.size <= this.limit) break;
      if (entry.refs) continue;
      this.entries.delete(key);
      entry.controller.abort();
      if (entry.value) this.dispose(entry.value);
    }
  }
  acquire(key: string) {
    let entry = this.entries.get(key);
    if (!entry) {
      const controller = new AbortController();
      entry = { refs: 0, controller, promise: null! };
      const current = entry;
      current.promise = this.loader(key, controller.signal)
        .then((value) => {
          if (controller.signal.aborted) {
            this.dispose(value);
            throw Error('Resource released');
          }
          current.value = value;
          return value;
        })
        .catch((error) => {
          if (this.entries.get(key) === current) this.entries.delete(key);
          throw error;
        });
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    entry.refs++;
    this.trim();
    let released = false;
    return {
      promise: entry.promise,
      release: () => {
        if (released) return;
        released = true;
        entry!.refs--;
        this.trim();
      },
    };
  }
  prefetch(key: string) {
    if (
      this.entries.has(key) ||
      [...this.entries.values()].filter((e) => !e.value).length >= 2
    )
      return;
    const lease = this.acquire(key);
    lease.promise.catch(() => {}).finally(lease.release);
  }
}
