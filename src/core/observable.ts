import type { Unsubscribe } from './disposable';
import { Emitter } from './emitter';

// Framework-independent contract for state shown by the UI (ADR 0010).
// The snapshot is immutable, so a change is detected by identity.
export interface Observable<T> {
  get(): T;
  subscribe(fn: () => void): Unsubscribe;
}

export class ObservableValue<T> implements Observable<T> {
  private value: T;
  // Composition: subscription and error semantics come from Emitter.
  private readonly emitter = new Emitter<{ change: undefined }>();

  constructor(initial: T) {
    this.value = initial;
  }

  get(): T {
    return this.value;
  }

  set(value: T): void {
    if (Object.is(this.value, value)) return;
    this.value = value;
    this.emitter.emit('change', undefined);
  }

  subscribe(fn: () => void): Unsubscribe {
    return this.emitter.on('change', fn);
  }
}
