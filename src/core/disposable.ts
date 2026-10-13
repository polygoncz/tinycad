import { throwCollected } from './collect-errors';

export type Unsubscribe = () => void;

export interface Disposable {
  dispose(): void;
}

// Collects resources and releases them together, in reverse order of addition
// (like destructors of stack objects in C++).
export class DisposableStore implements Disposable {
  private items: (Disposable | Unsubscribe)[] = [];
  private disposed = false;

  add<T extends Disposable | Unsubscribe>(d: T): T {
    if (this.disposed) {
      // Adding to a disposed store would leak silently; release right away instead.
      release(d);
    } else {
      this.items.push(d);
    }
    return d;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const items = this.items.reverse();
    this.items = [];
    const errors: unknown[] = [];
    for (const d of items) {
      try {
        release(d);
      } catch (e) {
        errors.push(e);
      }
    }
    throwCollected(errors, 'Several disposables failed');
  }
}

function release(d: Disposable | Unsubscribe): void {
  if (typeof d === 'function') d();
  else d.dispose();
}
