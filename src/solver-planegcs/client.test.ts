import { afterEach, describe, expect, it } from 'vitest';
import { createRpcClient, RpcError, serveRpc } from '@/core';
import type { SolveResult } from '@/sketch';
import { rectangleData } from '@/sketch/testing';
import { createSolverClient, type SolverConnection } from './client';
import { loadPlanegcs } from './planegcs-module';
import type { SolverProtocol } from './protocol';
import { createSolverWorkerImpl } from './worker-impl';

// The main-thread solver against the worker implementation over a MessageChannel in Node,
// without a Worker: the result crosses the boundary, the connection is created lazily and
// replaced after it dies.

const ports: MessagePort[] = [];

afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

/** Connections made by the client; each one a real worker implementation behind a channel. */
function channelConnections() {
  const made: { terminated: boolean; failAll(message: string): void }[] = [];
  const connect = (): SolverConnection => {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    serveRpc<SolverProtocol>(
      port2,
      createSolverWorkerImpl(() => loadPlanegcs()),
    );
    const rpc = createRpcClient<SolverProtocol>(port1);
    const record = {
      terminated: false,
      failAll: (message: string) => {
        rpc.failAll(message);
      },
    };
    made.push(record);
    return {
      rpc,
      terminate: () => {
        record.terminated = true;
        rpc.dispose();
      },
    };
  };
  return { made, connect };
}

function first<T>(items: readonly T[]): T {
  const [item] = items;
  if (item === undefined) throw new Error('nothing made');
  return item;
}

async function rejection(p: Promise<SolveResult>): Promise<unknown> {
  return p.then(
    () => expect.fail('Expected solve to reject'),
    (e: unknown) => e,
  );
}

describe('createSolverClient', () => {
  it('the result arrives over the channel', async () => {
    const { connect } = channelConnections();
    const solver = createSolverClient(connect);
    const result = await solver.solve(rectangleData());
    expect(result).toMatchObject({ status: 'ok', dof: 4, conflicting: [], redundant: [] });
    expect(result.entities).toEqual(rectangleData().entities);
    solver.dispose();
  });

  it('connects lazily, on the first solve, and reuses the connection', async () => {
    const { made, connect } = channelConnections();
    const solver = createSolverClient(connect);
    expect(made).toHaveLength(0);
    await solver.solve(rectangleData());
    await solver.solve(rectangleData());
    expect(made).toHaveLength(1);
    solver.dispose();
  });

  it('a disconnected call ends the connection, the next solve makes a new one', async () => {
    const { made, connect } = channelConnections();
    const solver = createSolverClient(connect);
    await solver.solve(rectangleData());
    const pending = solver.solve(rectangleData());
    first(made).failAll('worker crashed');
    const e = await rejection(pending);
    expect(e).toBeInstanceOf(RpcError);
    expect(e).toMatchObject({ code: 'disconnected' });
    expect(first(made).terminated).toBe(true);

    await expect(solver.solve(rectangleData())).resolves.toMatchObject({ status: 'ok' });
    expect(made).toHaveLength(2);
    solver.dispose();
  });

  it('dispose ends the connection and rejects later solves', async () => {
    const { made, connect } = channelConnections();
    const solver = createSolverClient(connect);
    await solver.solve(rectangleData());
    solver.dispose();
    expect(first(made).terminated).toBe(true);
    const e = await rejection(solver.solve(rectangleData()));
    expect(e).toBeInstanceOf(RpcError);
    expect(e).toMatchObject({ code: 'disconnected' });
    expect(made).toHaveLength(1);
  });
});
