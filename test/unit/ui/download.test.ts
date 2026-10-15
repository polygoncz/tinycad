import { describe, expect, it } from 'vitest';
import { downloadFile } from '@/ui/download';
import type { DownloadEnv } from '@/ui/download';

/** A DownloadEnv that records the calls; `run()` runs the deferred callbacks. */
function fakeEnv(): DownloadEnv & {
  readonly calls: string[];
  readonly blobs: Blob[];
  run(): void;
} {
  const calls: string[] = [];
  const blobs: Blob[] = [];
  const pending: (() => void)[] = [];
  return {
    calls,
    blobs,
    createObjectURL(b) {
      blobs.push(b);
      calls.push('create');
      return `blob:${String(blobs.length)}`;
    },
    revokeObjectURL(u) {
      calls.push(`revoke ${u}`);
    },
    click(href, name) {
      calls.push(`click ${href} ${name}`);
    },
    later(fn) {
      calls.push('later');
      pending.push(fn);
    },
    run() {
      for (const fn of pending.splice(0)) fn();
    },
  };
}

describe('downloadFile', () => {
  it('clicks a link to a Blob of the text with its type and name', async () => {
    const env = fakeEnv();
    downloadFile({ name: 'Box.tinycad.json', mime: 'application/json', data: '{"a":1}\n' }, env);
    expect(env.calls).toEqual(['create', 'click blob:1 Box.tinycad.json', 'later']);
    const blob = env.blobs[0];
    expect(blob?.type).toBe('application/json');
    expect(await blob?.text()).toBe('{"a":1}\n');
  });

  it('takes bytes as they are', async () => {
    const env = fakeEnv();
    const data = new TextEncoder().encode('ISO-10303-21;');
    downloadFile({ name: 'Box.step', mime: 'model/step', data }, env);
    const blob = env.blobs[0];
    expect(blob?.type).toBe('model/step');
    expect(new Uint8Array((await blob?.arrayBuffer()) ?? new ArrayBuffer(0))).toEqual(data);
  });

  it('revokes the URL only in the deferred callback', () => {
    const env = fakeEnv();
    downloadFile({ name: 'a.step', mime: 'model/step', data: 'x' }, env);
    expect(env.calls).not.toContain('revoke blob:1');
    env.run();
    expect(env.calls.at(-1)).toBe('revoke blob:1');
  });

  it('revokes the URL later even when the click throws', () => {
    const env = fakeEnv();
    const throwing: DownloadEnv = {
      ...env,
      click() {
        throw new Error('blocked');
      },
    };
    expect(() => {
      downloadFile({ name: 'a.step', mime: 'model/step', data: 'x' }, throwing);
    }).toThrow('blocked');
    env.run();
    expect(env.calls.at(-1)).toBe('revoke blob:1');
  });
});
