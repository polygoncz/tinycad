import { createClient } from '@connectrpc/connect';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SessionService } from '@/protocol';
import { createCoreTransport } from '@/remote';
import { KEEPALIVE_HEADER } from '@/remote/transport';

/** A fetch that records its requests and fails as an unreachable server does. */
function failingFetch() {
  const fetch = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(() =>
    Promise.reject(new TypeError('Failed to fetch')),
  );
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createCoreTransport', () => {
  it('sends a call with the keepalive header as fetch with keepalive, without the header', async () => {
    const fetch = failingFetch();
    const client = createClient(SessionService, createCoreTransport('http://core'));
    await client
      .closeSession({ sessionId: 's' }, { headers: { [KEEPALIVE_HEADER]: '1' } })
      .catch(() => undefined);
    const init = fetch.mock.calls[0]?.[1];
    expect(init?.keepalive).toBe(true);
    expect(new Headers(init?.headers).has(KEEPALIVE_HEADER)).toBe(false);
  });

  it('sends other calls as they are', async () => {
    const fetch = failingFetch();
    const client = createClient(SessionService, createCoreTransport('http://core'));
    await client.getReadModel({ sessionId: 's' }).catch(() => undefined);
    expect(fetch.mock.calls[0]?.[1]?.keepalive).toBeUndefined();
  });
});
