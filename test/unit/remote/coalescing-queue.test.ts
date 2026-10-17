import { describe, expect, it } from 'vitest';
import { coalescingQueue } from '@/remote/coalescing-queue';

/** A send whose calls wait until released, in the order they were sent. */
function heldSend() {
  const sent: string[] = [];
  const releases: (() => void)[] = [];
  const send = (request: string): Promise<string> => {
    sent.push(request);
    return new Promise<string>((resolve) => {
      releases.push(() => {
        resolve(`answer ${request}`);
      });
    });
  };
  const releaseAll = async (): Promise<void> => {
    for (let i = 0; i < releases.length; i++) {
      releases[i]?.();
      await new Promise((r) => setTimeout(r, 0));
    }
  };
  return { sent, send, releaseAll };
}

describe('coalescingQueue', () => {
  it('rejects a synchronous throw of send and stays usable', async () => {
    let calls = 0;
    const call = coalescingQueue((n: number) => {
      calls++;
      if (n === 0) throw new Error('sync');
      return Promise.resolve(n * 2);
    });

    await expect(call(0)).rejects.toThrow('sync');
    await expect(call(2)).resolves.toBe(4);
    expect(calls).toBe(2);
  });

  it('without a key sends every call, one at a time, in order', async () => {
    const held = heldSend();
    const call = coalescingQueue(held.send);

    const results = Promise.all([call('a'), call('b'), call('c')]);
    await new Promise((r) => setTimeout(r, 0));
    expect(held.sent).toEqual(['a']);
    await held.releaseAll();

    expect(await results).toEqual(['answer a', 'answer b', 'answer c']);
    expect(held.sent).toEqual(['a', 'b', 'c']);
  });

  it('replaces a queued call with the same key in its place; the call in flight keeps its answer', async () => {
    const held = heldSend();
    // Key: the letter; 'x1' and 'x2' ask the same question.
    const call = coalescingQueue(held.send, (r) => r[0] ?? null);

    const results = Promise.all([call('x0'), call('x1'), call('y1'), call('x2')]);
    await held.releaseAll();

    expect(await results).toEqual(['answer x0', 'answer x2', 'answer y1', 'answer x2']);
    expect(held.sent).toEqual(['x0', 'x2', 'y1']);
  });
});
