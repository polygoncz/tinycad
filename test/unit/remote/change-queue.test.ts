import { describe, expect, it } from 'vitest';
import type { FeatureId } from '@/document';
import { OP_VERSION } from '@/ops';
import type { FeatureRenameOp, FeatureSetParamsOp, Operation } from '@/ops';
import { RemoteError } from '@/remote';
import type { ChangeOutcome, ChangeRequest, ReadModelData } from '@/remote';
import { ChangeQueue } from '@/remote/change-queue';
import type { ChangeSent, QueuedChange } from '@/remote/change-queue';

const READ_MODEL = {} as ReadModelData; // the queue only passes it on

function setParams(featureId: string, size: number): FeatureSetParamsOp {
  return {
    type: 'feature.setParams',
    v: OP_VERSION['feature.setParams'],
    featureId: featureId as FeatureId, // a test id
    typeVersion: 1,
    params: { size },
  };
}

const rename = (name: string): FeatureRenameOp => ({
  type: 'feature.rename',
  v: OP_VERSION['feature.rename'],
  featureId: 'f1' as FeatureId, // a test id
  name,
});

const OK: ChangeOutcome = { ok: true, entry: null, readModel: READ_MODEL };

function failure(reason: RemoteError['reason']): ChangeOutcome {
  return {
    ok: false,
    error: new RemoteError({ code: 'FAILED_PRECONDITION', reason, message: reason }),
  };
}

/** A queue over a send the test answers by hand, one call at a time. */
function setup() {
  const sent: QueuedChange[] = [];
  const answers: ((outcome: ChangeOutcome) => void)[] = [];
  const renewals: { epoch: number; transactionLost: boolean }[] = [];
  const pending: number[] = [];
  let epoch = 1;
  let renewal: Promise<void> = Promise.resolve();
  let next = 0;
  const queue = new ChangeQueue({
    send: (change) => {
      sent.push(change);
      const at = epoch;
      return new Promise<ChangeSent>((resolve) => {
        answers.push((outcome) => {
          resolve({ outcome, epoch: at });
        });
      });
    },
    renewSession: async (failedEpoch, transactionLost) => {
      renewals.push({ epoch: failedEpoch, transactionLost });
      await renewal;
      epoch += 1;
    },
    newOperationId: () => `op-${String(++next)}`,
    onPending: (n) => pending.push(n),
  });
  const answer = async (outcome: ChangeOutcome): Promise<void> => {
    const fn = answers.shift();
    if (fn === undefined) throw new Error('nothing in flight');
    fn(outcome);
    await flush();
  };
  return {
    queue,
    sent,
    renewals,
    pending,
    answer,
    inFlight: () => answers.length,
    failRenewal: (error: Error) => {
      renewal = Promise.reject(error);
      renewal.catch(() => undefined);
    },
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const apply = (op: Operation): ChangeRequest => ({ kind: 'apply', op });

describe('ChangeQueue', () => {
  it('sends one change at a time, in order, each with its own operation_id', async () => {
    const { queue, sent, answer, inFlight } = setup();
    const a = queue.enqueue({ kind: 'begin', label: 'Edit' });
    const b = queue.enqueue(apply(rename('x')));
    const c = queue.enqueue({ kind: 'commit' });
    expect(sent.map((s) => s.request.kind)).toEqual(['begin']);
    expect(inFlight()).toBe(1);
    await answer(OK);
    expect(sent.map((s) => s.request.kind)).toEqual(['begin', 'apply']);
    await answer(OK);
    await answer(OK);
    expect(sent.map((s) => s.operationId)).toEqual(['op-1', 'op-2', 'op-3']);
    expect(await Promise.all([a, b, c])).toEqual([OK, OK, OK]);
  });

  it('counts the changes queued and in flight', async () => {
    const { queue, pending, answer } = setup();
    void queue.enqueue({ kind: 'undo' });
    void queue.enqueue({ kind: 'redo' });
    expect(queue.pending).toBe(2);
    await answer(OK);
    expect(queue.pending).toBe(1);
    await answer(OK);
    expect(queue.pending).toBe(0);
    expect(pending.at(-1)).toBe(0);
  });

  it('a queued apply of setParams is replaced by a newer one of the same feature', async () => {
    const { queue, sent, answer } = setup();
    void queue.enqueue({ kind: 'begin', label: 'Drag' });
    const first = queue.enqueue(apply(setParams('f1', 1)));
    const second = queue.enqueue(apply(setParams('f1', 2)));
    const third = queue.enqueue(apply(setParams('f1', 3)));
    expect(queue.pending).toBe(2);
    await answer(OK);
    const last: ChangeOutcome = { ok: true, entry: null, readModel: { ...READ_MODEL } };
    await answer(last);
    expect(sent.map((s) => s.request)).toEqual([
      { kind: 'begin', label: 'Drag' },
      apply(setParams('f1', 3)),
    ]);
    expect(await first).toBe(last);
    expect(await second).toBe(last);
    expect(await third).toBe(last);
  });

  it('does not replace setParams of another feature, other ops or a change in flight', async () => {
    const { queue, sent, answer } = setup();
    void queue.enqueue(apply(setParams('f1', 1))); // in flight
    void queue.enqueue(apply(setParams('f1', 2)));
    void queue.enqueue(apply(setParams('f2', 3)));
    void queue.enqueue(apply(rename('a')));
    void queue.enqueue(apply(rename('b')));
    void queue.enqueue({ kind: 'applyTransient', op: setParams('f1', 4) });
    void queue.enqueue({ kind: 'applyTransient', op: setParams('f1', 5) });
    for (let i = 0; i < 7; i++) await answer(OK);
    expect(sent).toHaveLength(7);
  });

  it('replaces only the last queued change (the order of changes stays)', async () => {
    const { queue, sent, answer } = setup();
    void queue.enqueue({ kind: 'begin', label: 'x' });
    void queue.enqueue(apply(setParams('f1', 1)));
    void queue.enqueue(apply(setParams('f2', 1)));
    void queue.enqueue(apply(setParams('f1', 2)));
    for (let i = 0; i < 4; i++) await answer(OK);
    expect(sent).toHaveLength(4);
  });

  it('a failure of the server is the outcome of its change; the queue goes on', async () => {
    const { queue, answer } = setup();
    const a = queue.enqueue({ kind: 'undo' });
    const b = queue.enqueue({ kind: 'redo' });
    const failed = failure('NOTHING_TO_UNDO');
    await answer(failed);
    await answer(OK);
    expect(await a).toBe(failed);
    expect(await b).toBe(OK);
  });

  it('SESSION_NOT_FOUND: durable changes go again with the same id, steps of a transaction fail', async () => {
    const { queue, sent, renewals, answer } = setup();
    void queue.enqueue({ kind: 'dispatch', op: rename('a') }); // answered before
    await answer(OK);
    const step = queue.enqueue(apply(rename('b')));
    const commit = queue.enqueue({ kind: 'commit' });
    const undo = queue.enqueue({ kind: 'undo' });
    await answer(failure('SESSION_NOT_FOUND'));
    expect(renewals).toEqual([{ epoch: 1, transactionLost: true }]);
    expect(await step).toMatchObject({ ok: false, error: { reason: 'NO_TRANSACTION' } });
    expect(await commit).toMatchObject({ ok: false, error: { reason: 'NO_TRANSACTION' } });
    expect(sent.at(-1)?.request.kind).toBe('undo');
    expect(sent.at(-1)?.operationId).toBe('op-4');
    await answer(OK);
    expect(await undo).toBe(OK);
  });

  it('SESSION_NOT_FOUND of a durable change sends it again in the new session', async () => {
    const { queue, sent, renewals, answer } = setup();
    const dispatch = queue.enqueue({ kind: 'dispatch', op: rename('a') });
    await answer(failure('SESSION_NOT_FOUND'));
    expect(renewals).toEqual([{ epoch: 1, transactionLost: false }]);
    expect(sent.map((s) => s.operationId)).toEqual(['op-1', 'op-1']);
    await answer(OK);
    expect(await dispatch).toBe(OK);
  });

  it('changes queued while the session renews go after the recovered ones', async () => {
    const { queue, sent, answer } = setup();
    void queue.enqueue({ kind: 'dispatch', op: rename('a') });
    void queue.enqueue({ kind: 'redo' });
    const answered = answer(failure('SESSION_NOT_FOUND'));
    void queue.enqueue({ kind: 'undo' });
    await answered;
    await answer(OK);
    await answer(OK);
    await answer(OK);
    expect(sent.map((s) => s.request.kind)).toEqual(['dispatch', 'dispatch', 'redo', 'undo']);
  });

  it('when no new session opens every affected change fails with its error', async () => {
    const { queue, failRenewal, answer } = setup();
    failRenewal(new RemoteError({ code: 'UNAVAILABLE', message: 'down' }));
    const a = queue.enqueue({ kind: 'dispatch', op: rename('a') });
    const b = queue.enqueue({ kind: 'commit' });
    await answer(failure('SESSION_NOT_FOUND'));
    expect(await a).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect(await b).toMatchObject({ ok: false, error: { code: 'UNAVAILABLE' } });
    expect(queue.pending).toBe(0);
  });

  it('dispose rejects every waiting change and later ones', async () => {
    const { queue } = setup();
    const a = queue.enqueue({ kind: 'undo' });
    const b = queue.enqueue({ kind: 'redo' });
    queue.dispose();
    await expect(a).rejects.toThrow('disposed');
    await expect(b).rejects.toThrow('disposed');
    await expect(queue.enqueue({ kind: 'undo' })).rejects.toThrow('disposed');
  });
});
