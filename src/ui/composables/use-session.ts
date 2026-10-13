import { inject, provide } from 'vue';
import type { InjectionKey } from 'vue';
import type { AppSession } from '@/app';

// The AppSession reaches components through provide/inject, never a global (spec 11, rule 5).
// It is a plain object with its own Observables: provide() does not make it reactive, and it
// must never be put into ref()/reactive() (rule 2).

export const SESSION_KEY: InjectionKey<AppSession> = Symbol('AppSession');

/** Makes the session available to the descendants of the calling component. */
export function provideSession(session: AppSession): void {
  provide(SESSION_KEY, session);
}

/** The session provided by an ancestor; throws when there is none (a wiring bug). */
export function useSession(): AppSession {
  const session = inject(SESSION_KEY);
  if (session === undefined) throw new Error('No AppSession provided (call provideSession first)');
  return session;
}
