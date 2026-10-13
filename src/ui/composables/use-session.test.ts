import { describe, expect, it } from 'vitest';
import { createApp, defineComponent } from 'vue';
import { SESSION_KEY, useSession } from './use-session';
import type { AppSession } from '@/app';

// Only the identity matters here: useSession never reads the session.
const fakeSession = Object.freeze({}) as AppSession; // test double, never used as a session

function anApp() {
  return createApp(defineComponent({ render: () => null }));
}

describe('useSession', () => {
  it('returns the provided session', () => {
    const app = anApp();
    app.provide(SESSION_KEY, fakeSession);
    expect(app.runWithContext(() => useSession())).toBe(fakeSession);
  });

  it('throws without a provided session', () => {
    const app = anApp();
    expect(() => app.runWithContext(() => useSession())).toThrow(/No AppSession/);
  });
});
