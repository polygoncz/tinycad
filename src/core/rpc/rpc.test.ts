import { afterEach, describe, expect, it } from 'vitest';
import { createRpcClient } from './client';
import { RpcError } from './error';
import { serveRpc, type RpcImpl } from './server';
import { transfer } from './transfer';

// Protocol as an interface on purpose: the RpcProtocol constraint must accept interfaces.
interface TestProtocol {
  add: { args: [a: number, b: number]; result: number };
  echoLater: { args: [value: string, delayMs: number]; result: string };
  fail: { args: []; result: never };
  failWithCode: { args: [code: string]; result: never };
  makeBuffer: { args: [size: number]; result: ArrayBuffer };
  unserializable: { args: []; result: unknown };
}

const ports: MessagePort[] = [];

afterEach(() => {
  for (const p of ports.splice(0)) p.close();
});

function connect(impl: RpcImpl<TestProtocol>) {
  const { port1, port2 } = new MessageChannel();
  ports.push(port1, port2);
  serveRpc<TestProtocol>(port2, impl);
  return createRpcClient<TestProtocol>(port1);
}

class CodedError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

let lastSent: ArrayBuffer | undefined;

const impl: RpcImpl<TestProtocol> = {
  add: (a, b) => a + b,
  echoLater: (value, delayMs) =>
    new Promise((resolve) =>
      setTimeout(() => {
        resolve(value);
      }, delayMs),
    ),
  fail: () => {
    throw new Error('plain failure');
  },
  failWithCode: (code) => {
    throw new CodedError(code, `failed with ${code}`);
  },
  makeBuffer: (size) => {
    const buffer = new Uint8Array(size).fill(7).buffer;
    lastSent = buffer;
    return transfer(buffer, [buffer]);
  },
  // A function cannot be structured-cloned, so postMessage throws DataCloneError.
  unserializable: () => () => undefined,
};

describe('rpc', () => {
  it('calls a method and returns its result', async () => {
    const client = connect(impl);
    await expect(client.call('add', 2, 3)).resolves.toBe(5);
  });

  it('matches concurrent responses to their requests', async () => {
    const client = connect(impl);
    const results = await Promise.all([
      client.call('add', 1, 1),
      client.call('add', 2, 2),
      client.call('add', 3, 3),
    ]);
    expect(results).toEqual([2, 4, 6]);
  });

  it('processes requests in order of arrival, even async ones', async () => {
    const client = connect(impl);
    const order: string[] = [];
    await Promise.all([
      client.call('echoLater', 'slow', 30).then((v) => order.push(v)),
      client.call('echoLater', 'fast', 0).then((v) => order.push(v)),
    ]);
    expect(order).toEqual(['slow', 'fast']);
  });

  it('turns a thrown error into an RpcError with code "internal"', async () => {
    const client = connect(impl);
    const error = await client.call('fail').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: 'internal', message: 'plain failure' });
  });

  it('keeps the code of a thrown error', async () => {
    const client = connect(impl);
    await expect(client.call('failWithCode', 'invalid-shape')).rejects.toMatchObject({
      code: 'invalid-shape',
      message: 'failed with invalid-shape',
    });
  });

  it('rejects an unknown method with code "unknown-method"', async () => {
    const client = connect(impl);
    // Simulates a client built against a newer protocol than the server.
    const loose = client as unknown as { call(method: string): Promise<unknown> };
    await expect(loose.call('nope')).rejects.toMatchObject({ code: 'unknown-method' });
  });

  it('keeps working after a failed call', async () => {
    const client = connect(impl);
    await client.call('fail').catch(() => undefined);
    await expect(client.call('add', 1, 2)).resolves.toBe(3);
  });

  it('transfers an ArrayBuffer instead of copying it', async () => {
    const client = connect(impl);
    const received = await client.call('makeBuffer', 1024);

    expect(received.byteLength).toBe(1024);
    expect(new Uint8Array(received)[0]).toBe(7);
    // The source buffer is detached after the transfer.
    expect(lastSent?.byteLength).toBe(0);
  });

  it('reports an unserializable result and keeps serving later requests', async () => {
    const client = connect(impl);
    await expect(client.call('unserializable')).rejects.toMatchObject({ code: 'unserializable' });
    await expect(client.call('add', 1, 2)).resolves.toBe(3);
  });

  it('rejects with an RpcError when the arguments cannot be sent', async () => {
    const client = connect(impl);
    const badArg = (() => 1) as unknown as number;
    await expect(client.call('add', badArg, 1)).rejects.toMatchObject({ code: 'unserializable' });
    await expect(client.call('add', 1, 1)).resolves.toBe(2);
  });

  it('serves a class instance, with methods on the prototype and access to this', async () => {
    class Calculator implements RpcImpl<Pick<TestProtocol, 'add'>> {
      private readonly offset = 100;
      add(a: number, b: number): number {
        return a + b + this.offset;
      }
    }
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    serveRpc<Pick<TestProtocol, 'add'>>(port2, new Calculator());
    const client = createRpcClient<Pick<TestProtocol, 'add'>>(port1);

    await expect(client.call('add', 1, 2)).resolves.toBe(103);
  });

  it('does not expose Object.prototype members as methods', async () => {
    const client = connect(impl);
    const loose = client as unknown as { call(method: string): Promise<unknown> };
    await expect(loose.call('toString')).rejects.toMatchObject({ code: 'unknown-method' });
    await expect(loose.call('constructor')).rejects.toMatchObject({ code: 'unknown-method' });
  });
});

describe('rpc disconnect', () => {
  function connectCounting() {
    const { port1, port2 } = new MessageChannel();
    ports.push(port1, port2);
    serveRpc<TestProtocol>(port2, impl);
    let sent = 0;
    const counting = {
      postMessage(msg: unknown, transferList: ArrayBuffer[]) {
        sent++;
        port1.postMessage(msg, transferList);
      },
      addEventListener: port1.addEventListener.bind(port1),
      start: port1.start.bind(port1),
    };
    const client = createRpcClient<TestProtocol>(counting);
    return { client, sentCount: () => sent };
  }

  it('failAll rejects pending calls with "disconnected" and the given message', async () => {
    const client = connect(impl);
    const pending = client.call('echoLater', 'x', 20).catch((e: unknown) => e);
    client.failAll('worker crashed');
    const error = await pending;
    expect(error).toBeInstanceOf(RpcError);
    expect(error).toMatchObject({ code: 'disconnected', message: 'worker crashed' });
  });

  it('rejects later calls without sending anything', async () => {
    const { client, sentCount } = connectCounting();
    client.failAll('gone');
    await expect(client.call('add', 1, 2)).rejects.toMatchObject({
      code: 'disconnected',
      message: 'gone',
    });
    expect(sentCount()).toBe(0);
  });

  it('ignores a response that arrives after failAll', async () => {
    const client = connect(impl);
    const pending = client.call('echoLater', 'late', 5);
    client.failAll('gone');
    await expect(pending).rejects.toMatchObject({ code: 'disconnected' });
    // Give the server time to answer; the late response must not throw or resolve anything.
    await new Promise((resolve) => setTimeout(resolve, 30));
    await expect(client.call('add', 1, 1)).rejects.toMatchObject({ code: 'disconnected' });
  });

  it('keeps the message of the first failAll', async () => {
    const client = connect(impl);
    client.failAll('first');
    client.failAll('second');
    client.dispose();
    await expect(client.call('add', 1, 1)).rejects.toMatchObject({
      code: 'disconnected',
      message: 'first',
    });
  });

  it('dispose behaves like failAll("RPC client disposed")', async () => {
    const { client, sentCount } = connectCounting();
    const pending = client.call('echoLater', 'x', 20).catch((e: unknown) => e);
    client.dispose();
    await expect(pending).resolves.toMatchObject({
      code: 'disconnected',
      message: 'RPC client disposed',
    });
    await expect(client.call('add', 1, 1)).rejects.toMatchObject({
      code: 'disconnected',
      message: 'RPC client disposed',
    });
    expect(sentCount()).toBe(1);
  });
});
