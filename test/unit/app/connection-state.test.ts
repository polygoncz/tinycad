import { describe, expect, it, vi } from 'vitest';
import { ObservableValue } from '@/core';
import { RemoteError } from '@/remote';
import type { ConnectionState } from '@/remote';
import { createConnectionState } from '@/app/connection-state';

function setup(refresh: () => Promise<void> = () => Promise.resolve()) {
  const connection = new ObservableValue<ConnectionState>('connecting');
  const pending = new ObservableValue(0);
  const errors: unknown[] = [];
  const refreshSpy = vi.fn(refresh);
  const state = createConnectionState({
    session: {
      connection: connection.asObservable(),
      pending: pending.asObservable(),
      refresh: refreshSpy,
    },
    reportError: (e) => errors.push(e),
  });
  return { connection, pending, errors, refresh: refreshSpy, state };
}

describe('createConnectionState', () => {
  it.each([
    ['connecting', 'starting'],
    ['online', 'ready'],
    ['retrying', 'restarting'],
    ['offline', 'unavailable'],
  ] as const)('maps the connection %s to the kernel state %s', (connection, kernel) => {
    const h = setup();
    h.connection.set(connection);
    expect(h.state.kernel.get()).toBe(kernel);
  });

  it.each([
    ['online', 0, 'saved'],
    ['online', 2, 'pending'],
    ['connecting', 1, 'pending'],
    ['retrying', 1, 'error'],
    ['offline', 1, 'failed'],
    ['offline', 0, 'saved'],
  ] as const)('maps %s with %i pending to the persistence %s', (connection, pending, status) => {
    const h = setup();
    h.connection.set(connection);
    h.pending.set(pending);
    expect(h.state.persistence.get()).toBe(status);
  });

  it('is failed offline after the mirror dropped a change for the outage, until online (N92)', () => {
    const h = setup();
    h.connection.set('retrying');
    h.pending.set(1);
    h.connection.set('offline');
    h.state.changeDropped(new RemoteError({ code: 'UNAVAILABLE', message: 'down' }));
    h.pending.set(0);
    expect(h.state.persistence.get()).toBe('failed');
    expect(h.state.persistenceError.get()).toBe('down');
    h.connection.set('online');
    h.connection.set('offline');
    expect(h.state.persistence.get()).toBe('saved');
  });

  it('a change refused by the server (not the outage) is no failure of saving', () => {
    const h = setup();
    h.connection.set('offline');
    h.state.changeDropped(new RemoteError({ code: 'FAILED_PRECONDITION', message: 'refused' }));
    expect(h.state.persistence.get()).toBe('saved');
  });

  it('shows the text of the last error only while the state calls for it', () => {
    const h = setup();
    h.connection.set('online');
    h.state.noteError(new Error('no route'));
    expect(h.state.persistenceError.get()).toBeNull();
    expect(h.state.kernelError.get()).toBeNull();
    h.pending.set(1);
    h.connection.set('retrying');
    expect(h.state.persistenceError.get()).toBe('no route');
    expect(h.state.kernelError.get()).toBeNull();
    h.connection.set('offline');
    expect(h.state.persistenceError.get()).toBe('no route');
    expect(h.state.kernelError.get()).toBe('no route');
    h.connection.set('online');
    h.pending.set(0);
    expect(h.state.persistenceError.get()).toBeNull();
    expect(h.state.kernelError.get()).toBeNull();
  });

  it('retries with a refresh and notes its failure', async () => {
    const failure = new Error('still down');
    const h = setup(() => Promise.reject(failure));
    h.connection.set('offline');
    h.state.retryKernel();
    expect(h.refresh).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(h.errors).toEqual([failure]);
    expect(h.state.kernelError.get()).toBe('still down');
  });

  it('stops following the session once disposed', () => {
    const h = setup();
    h.state.dispose();
    h.connection.set('online');
    expect(h.state.kernel.get()).toBe('starting');
  });
});
