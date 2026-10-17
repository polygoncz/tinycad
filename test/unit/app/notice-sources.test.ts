import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter, ObservableValue } from '@/core';
import type { ConnectionState, RemoteSessionEvents } from '@/remote';
import { connectNoticeSources } from '@/app/notice-sources';
import { createNoticeCenter } from '@/app/notices';

function setup(initial: ConnectionState = 'online') {
  const connection = new ObservableValue<ConnectionState>(initial);
  const events = new Emitter<RemoteSessionEvents>();
  const notices = createNoticeCenter();
  const off = connectNoticeSources(
    { connection: connection.asObservable(), events: events.asSubscribable() },
    notices,
  );
  const shown = () => notices.notices.get().map((n) => [n.kind, n.key, n.sticky]);
  return { connection, events, notices, off, shown };
}

describe('connectNoticeSources', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('a lost transaction: the warning notice.transactionLost', () => {
    const h = setup();
    h.events.emit('lost', { what: 'transaction' });
    expect(h.shown()).toEqual([['warning', 'notice.transactionLost', false]]);
  });

  it('offline: the sticky error serverUnavailable; online again withdraws it and says so', () => {
    const h = setup();
    h.connection.set('retrying');
    h.connection.set('offline');
    expect(h.shown()).toEqual([['error', 'notice.serverUnavailable', true]]);
    h.connection.set('connecting');
    expect(h.shown()).toEqual([['error', 'notice.serverUnavailable', true]]);
    h.connection.set('online');
    expect(h.shown()).toEqual([['info', 'notice.connectionRestored', false]]);
  });

  it('retrying → online without offline in between shows nothing', () => {
    const h = setup();
    h.connection.set('retrying');
    h.connection.set('online');
    expect(h.shown()).toEqual([]);
  });

  it('the first connecting → online after opening shows nothing', () => {
    const h = setup('connecting');
    h.connection.set('online');
    expect(h.shown()).toEqual([]);
  });

  it('the returned function disconnects everything', () => {
    const h = setup();
    h.off();
    h.events.emit('lost', { what: 'transaction' });
    h.connection.set('offline');
    expect(h.shown()).toEqual([]);
  });
});
