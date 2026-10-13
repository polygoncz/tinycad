import { describe, expect, it } from 'vitest';
import type { DocumentId } from '@/document';
import { createDocumentSwitcher } from './document-switcher';

/** A fake session: records close/dispose; close can be made to fail. */
interface FakeSession {
  readonly id: DocumentId;
  closed: boolean;
  disposed: boolean;
  close(): Promise<void>;
  dispose(): void;
}

const A = 'doc-a' as DocumentId; // test values, the brand does not matter here
const B = 'doc-b' as DocumentId;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup(options: { failClose?: boolean; failOpen?: ReadonlySet<DocumentId> } = {}) {
  const log: string[] = [];
  const sessions: FakeSession[] = [];
  const gates = new Map<DocumentId, Deferred<undefined>>();
  function aSession(id: DocumentId): FakeSession {
    const s: FakeSession = {
      id,
      closed: false,
      disposed: false,
      close() {
        log.push(`close ${id}`);
        s.closed = true;
        return options.failClose === true
          ? Promise.reject(new Error(`cannot save ${id}`))
          : Promise.resolve();
      },
      dispose() {
        log.push(`dispose ${id}`);
        s.disposed = true;
      },
    };
    return s;
  }
  const switcher = createDocumentSwitcher<FakeSession>({
    async open(id) {
      log.push(`open ${id}`);
      const gate = gates.get(id);
      if (gate !== undefined) await gate.promise;
      if (options.failOpen?.has(id) === true) throw new Error(`cannot open ${id}`);
      const s = aSession(id);
      sessions.push(s);
      return s;
    },
  });
  return {
    switcher,
    log,
    sessions,
    /** The next open of `id` waits until the returned gate is resolved. */
    hold(id: DocumentId): Deferred<undefined> {
      const gate = deferred<undefined>();
      gates.set(id, gate);
      return gate;
    },
  };
}

describe('createDocumentSwitcher', () => {
  it('starts on the document list', () => {
    const { switcher } = setup();
    expect(switcher.view.value).toEqual({
      docId: null,
      session: null,
      opening: false,
      openError: null,
      closeError: null,
    });
  });

  it('opens the document and reports opening meanwhile', async () => {
    const s = setup();
    const gate = s.hold(A);
    const done = s.switcher.show(A);
    expect(s.switcher.view.value.opening).toBe(true);
    expect(s.switcher.view.value.docId).toBe(A);
    gate.resolve(undefined);
    await done;
    expect(s.switcher.view.value.opening).toBe(false);
    expect(s.switcher.view.value.session?.id).toBe(A);
  });

  it('closes the old session before it opens the new one', async () => {
    const s = setup();
    await s.switcher.show(A);
    await s.switcher.show(B);
    expect(s.log).toEqual([`open ${A}`, `close ${A}`, `open ${B}`]);
    expect(s.switcher.view.value.session?.id).toBe(B);
  });

  it('back to the list closes the session', async () => {
    const s = setup();
    await s.switcher.show(A);
    await s.switcher.show(null);
    expect(s.sessions[0]?.closed).toBe(true);
    expect(s.switcher.view.value.session).toBeNull();
    expect(s.switcher.view.value.docId).toBeNull();
  });

  it('the same document again does nothing', async () => {
    const s = setup();
    await s.switcher.show(A);
    await s.switcher.show(A);
    expect(s.log).toEqual([`open ${A}`]);
  });

  it('a failing close is reported and the next document opens anyway', async () => {
    const s = setup({ failClose: true });
    await s.switcher.show(A);
    await s.switcher.show(B);
    expect(s.switcher.view.value.closeError).toMatch(/cannot save doc-a/);
    expect(s.switcher.view.value.session?.id).toBe(B);
    s.switcher.dismissCloseError();
    expect(s.switcher.view.value.closeError).toBeNull();
  });

  it('a failing open is reported, leaving to the list clears it', async () => {
    const s = setup({ failOpen: new Set([A]) });
    await s.switcher.show(A);
    expect(s.switcher.view.value.session).toBeNull();
    expect(s.switcher.view.value.openError).toMatch(/cannot open doc-a/);
    await s.switcher.show(null);
    expect(s.switcher.view.value.openError).toBeNull();
  });

  it('a newer request while opening wins; the stale session is closed', async () => {
    const s = setup();
    const gate = s.hold(A);
    const first = s.switcher.show(A);
    const second = s.switcher.show(B);
    gate.resolve(undefined);
    await Promise.all([first, second]);
    expect(s.log).toEqual([`open ${A}`, `close ${A}`, `open ${B}`]);
    expect(s.switcher.view.value.session?.id).toBe(B);
    expect(s.switcher.view.value.docId).toBe(B);
  });

  it('dispose releases the open session at once', async () => {
    const s = setup();
    await s.switcher.show(A);
    s.switcher.dispose();
    expect(s.sessions[0]?.disposed).toBe(true);
    expect(s.switcher.view.value.session).toBeNull();
  });

  it('a session that opens after dispose is released', async () => {
    const s = setup();
    const gate = s.hold(A);
    const done = s.switcher.show(A);
    s.switcher.dispose();
    gate.resolve(undefined);
    await done;
    expect(s.sessions[0]?.disposed).toBe(true);
    expect(s.switcher.view.value.session).toBeNull();
  });

  it('the view is a frozen snapshot', async () => {
    const s = setup();
    await s.switcher.show(A);
    expect(Object.isFrozen(s.switcher.view.value)).toBe(true);
  });
});
