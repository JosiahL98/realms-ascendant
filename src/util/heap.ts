/** Binary min-heap of integer ids keyed by float priorities (for A*). */
export class MinHeap {
  private ids: Int32Array;
  private keys: Float32Array;
  size = 0;
  constructor(capacity: number) {
    this.ids = new Int32Array(capacity);
    this.keys = new Float32Array(capacity);
  }
  clear(): void {
    this.size = 0;
  }
  push(id: number, key: number): void {
    if (this.size >= this.ids.length) {
      const nIds = new Int32Array(this.ids.length * 2);
      nIds.set(this.ids);
      const nKeys = new Float32Array(this.keys.length * 2);
      nKeys.set(this.keys);
      this.ids = nIds;
      this.keys = nKeys;
    }
    let i = this.size++;
    const ids = this.ids, keys = this.keys;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= key) break;
      ids[i] = ids[p];
      keys[i] = keys[p];
      i = p;
    }
    ids[i] = id;
    keys[i] = key;
  }
  pop(): number {
    const ids = this.ids, keys = this.keys;
    const top = ids[0];
    const n = --this.size;
    if (n > 0) {
      const id = ids[n], key = keys[n];
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && keys[c + 1] < keys[c]) c++;
        if (keys[c] >= key) break;
        ids[i] = ids[c];
        keys[i] = keys[c];
        i = c;
      }
      ids[i] = id;
      keys[i] = key;
    }
    return top;
  }
}
