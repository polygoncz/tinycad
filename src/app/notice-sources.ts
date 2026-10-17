// The sources of the notices of a session (spec 11, N151): what the session of the core says by
// itself – a transaction lost on the server, the connection given up and back. They read only the
// RemoteSession (its events and connection), never the mirror, so they stay when M52 removes it;
// the refusals of changes go through noticeOfRefusal from the dispatcher.

import type { Unsubscribe } from '@/core';
import type { RemoteSession } from '@/remote';
import type { NoticeCenter } from './notices';

/**
 * Wires the notices to the session of the core: the event 'lost' → transactionLost; the
 * transitions of the connection. Returns a function that disconnects everything (lifetime of the
 * session).
 */
export function connectNoticeSources(
  session: Pick<RemoteSession, 'events' | 'connection'>,
  notices: NoticeCenter,
): Unsubscribe {
  const offLost = session.events.on('lost', () => {
    notices.show({ kind: 'warning', key: 'notice.transactionLost' });
  });
  // Only offline (the retrier gave up) and back from it, possibly through 'connecting':
  // 'retrying' and 'connecting' are shown by the title bar, a short outage should not flash a toast.
  let offline = session.connection.get() === 'offline';
  const offConnection = session.connection.subscribe(() => {
    const current = session.connection.get();
    if (current === 'offline' && !offline) {
      offline = true;
      notices.show({ kind: 'error', key: 'notice.serverUnavailable' });
    } else if (current === 'online' && offline) {
      offline = false;
      notices.dismissKey('notice.serverUnavailable');
      notices.show({ kind: 'info', key: 'notice.connectionRestored' });
    }
  });
  return () => {
    offLost();
    offConnection();
  };
}
