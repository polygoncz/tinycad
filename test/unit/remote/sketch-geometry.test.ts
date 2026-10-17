import { create } from '@bufbuild/protobuf';
import { Code, ConnectError, createRouterTransport } from '@connectrpc/connect';
import { describe, expect, it } from 'vitest';
import { kernelErrorCode } from '@/kernel/testing';
import type { KernelErrorCode } from '@/kernel';
import {
  ErrorDetailSchema,
  ErrorReason,
  GeometryService,
  IntersectionsResponseSchema,
  OffsetResponseSchema,
  SegmentResponseSchema,
} from '@/protocol';
import type {
  ErrorReason as ErrorReasonValue,
  IntersectionsRequest,
  IntersectionsResponse,
  OffsetRequest,
  OffsetResponse,
  SegmentRequest,
  SegmentResponse,
} from '@/protocol';
import type { Curve2 } from '@/sketch';
import { createRemoteSketchGeometry } from '@/remote';
import { curveToProto, filletToProto, hitToProto, offsetCurveToProto } from '@/remote/curves';

const H: Curve2 = { kind: 'line', from: [0, 0], to: [2, 0], id: 'h' };
const V: Curve2 = { kind: 'line', from: [1, -1], to: [1, 1], id: 'v' };
const C: Curve2 = { kind: 'circle', center: [0, 0], radius: 1, id: 'c' };

/** A request the fake server holds until the test answers it. */
interface Held<Req, Res> {
  readonly request: Req;
  answer(response: Res): void;
  fail(error: unknown): void;
}

/** A GeometryService whose Intersections, Segment and Offset calls wait for the test (to see what is in flight). */
function heldServer() {
  const intersections: Held<IntersectionsRequest, IntersectionsResponse>[] = [];
  const segments: Held<SegmentRequest, SegmentResponse>[] = [];
  const offsets: Held<OffsetRequest, OffsetResponse>[] = [];
  const hold = <Req, Res>(list: Held<Req, Res>[], request: Req): Promise<Res> =>
    new Promise<Res>((resolve, reject) => {
      list.push({ request, answer: resolve, fail: reject });
    });
  const transport = createRouterTransport(({ service }) => {
    service(GeometryService, {
      intersections: (request) => hold(intersections, request),
      segment: (request) => hold(segments, request),
      fillet: () => Promise.reject(new ConnectError('not held', Code.Unimplemented)),
      offset: (request) => hold(offsets, request),
    });
  });
  return { transport, intersections, segments, offsets };
}

/** Lets the router transport deliver what is pending (it answers over a few microtasks). */
async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0));
}

function ids(request: IntersectionsRequest): string[] {
  return request.curves.map((c) => c.id);
}

function hitsAnswer(a: string, b: string): IntersectionsResponse {
  return create(IntersectionsResponseSchema, {
    hits: [hitToProto({ a, b, point: [1, 0], ta: 0.5, tb: 0.5 })],
  });
}

function kernelFailure(reason: ErrorReasonValue, code: Code): ConnectError {
  return new ConnectError('kernel says no', code, undefined, [
    { desc: ErrorDetailSchema, value: { reason } },
  ]);
}

async function rejectionCode(
  p: Promise<unknown>,
): Promise<KernelErrorCode | undefined | 'resolved'> {
  try {
    await p;
    return 'resolved';
  } catch (e) {
    expect(e).toBeInstanceOf(Error);
    return kernelErrorCode(e);
  }
}

describe('createRemoteSketchGeometry', () => {
  it('answers the four methods with converted data', async () => {
    const transport = createRouterTransport(({ service }) => {
      service(GeometryService, {
        intersections: (req) => ({
          hits: [
            hitToProto({
              a: req.curves[0]?.id ?? '',
              b: 'v',
              point: [1, 0],
              ta: 0.5,
              tb: 0.5,
              overlap: true,
            }),
          ],
        }),
        segment: (req) => ({
          curve: curveToProto({
            kind: 'arc',
            center: [0, 0],
            from: [1, 0],
            to: [0, 1],
            ccw: true,
            id: `${req.curve?.id ?? ''}:${String(req.from)}-${String(req.to)}`,
          }),
        }),
        fillet: (req) =>
          filletToProto({
            center: [req.near?.x ?? 0, req.near?.y ?? 0],
            pointA: [req.radius, 0],
            pointB: [0, req.radius],
            ta: 0.25,
            tb: 0.75,
          }),
        offset: (req) => ({
          curves: req.chain.map((c, i) =>
            offsetCurveToProto({
              kind: 'line',
              from: [0, req.distance],
              to: [1, req.distance],
              id: c.id,
              ...(req.closed && i === 0 ? {} : { source: c.id }),
            }),
          ),
        }),
      });
    });
    const geometry = createRemoteSketchGeometry(transport);

    await expect(geometry.intersections([H, V])).resolves.toEqual([
      { a: 'h', b: 'v', point: [1, 0], ta: 0.5, tb: 0.5, overlap: true },
    ]);
    await expect(geometry.segment(C, 0, 1.5)).resolves.toEqual({
      kind: 'arc',
      center: [0, 0],
      from: [1, 0],
      to: [0, 1],
      ccw: true,
      id: 'c:0-1.5',
    });
    await expect(geometry.fillet(H, V, 0.5, [0.7, 0.3])).resolves.toEqual({
      center: [0.7, 0.3],
      pointA: [0.5, 0],
      pointB: [0, 0.5],
      ta: 0.25,
      tb: 0.75,
    });
    await expect(geometry.offset([H, V], false, 2)).resolves.toEqual([
      { kind: 'line', from: [0, 2], to: [1, 2], id: 'h', source: 'h' },
      { kind: 'line', from: [0, 2], to: [1, 2], id: 'v', source: 'v' },
    ]);
    await expect(geometry.offset([H], true, -1)).resolves.toEqual([
      { kind: 'line', from: [0, -1], to: [1, -1], id: 'h' },
    ]);
  });

  it('coalesces queued intersections of the same curves: of three rapid calls the second is never sent', async () => {
    const server = heldServer();
    const geometry = createRemoteSketchGeometry(server.transport);
    // The hits of the whole sketch while a point is dragged: the same ids, new positions.
    const H2: Curve2 = { ...H, to: [3, 0] };
    const H3: Curve2 = { ...H, to: [4, 0] };

    const first = geometry.intersections([H, V]);
    const second = geometry.intersections([V, H2]);
    const third = geometry.intersections([H3, V]);
    await settle();

    expect(server.intersections.map((h) => ids(h.request))).toEqual([['h', 'v']]);

    server.intersections[0]?.answer(hitsAnswer('first', 'first'));
    await settle();

    // After the answer only the newest request with that key goes; the second is dropped.
    expect(server.intersections.map((h) => ids(h.request))).toEqual([
      ['h', 'v'],
      ['h', 'v'],
    ]);
    expect(server.intersections[1]?.request.curves[0]?.kind.value).toMatchObject({
      to: { x: 4, y: 0 },
    });
    await expect(first).resolves.toEqual([
      { a: 'first', b: 'first', point: [1, 0], ta: 0.5, tb: 0.5 },
    ]);

    server.intersections[1]?.answer(hitsAnswer('third', 'third'));
    const latest = [{ a: 'third', b: 'third', point: [1, 0], ta: 0.5, tb: 0.5 }];
    await expect(second).resolves.toEqual(latest);
    await expect(third).resolves.toEqual(latest);
    await settle();
    expect(server.intersections).toHaveLength(2);
  });

  it('gives a tool its own intersections when it is queued behind the hits of the sketch', async () => {
    const server = heldServer();
    const geometry = createRemoteSketchGeometry(server.transport);
    const chamfer: Curve2 = { kind: 'circle', center: [1, 0], radius: 0.5, id: 'chamfer' };

    const hits = geometry.intersections([H, V]);
    const tool = geometry.intersections([chamfer, V]);
    const hits2 = geometry.intersections([H, V]);
    const hits3 = geometry.intersections([V, H]);
    await settle();
    server.intersections[0]?.answer(hitsAnswer('h', 'v'));
    await settle();

    // FIFO: the tool's call goes next and is not replaced by the later hits of the sketch.
    expect(server.intersections.map((h) => ids(h.request))).toEqual([
      ['h', 'v'],
      ['chamfer', 'v'],
    ]);
    server.intersections[1]?.answer(hitsAnswer('chamfer', 'v'));
    await expect(tool).resolves.toEqual([
      { a: 'chamfer', b: 'v', point: [1, 0], ta: 0.5, tb: 0.5 },
    ]);
    await settle();

    // The two later hits of the sketch coalesced into one request.
    expect(server.intersections.map((h) => ids(h.request))).toEqual([
      ['h', 'v'],
      ['chamfer', 'v'],
      ['v', 'h'],
    ]);
    server.intersections[2]?.answer(hitsAnswer('v', 'h'));
    await expect(hits).resolves.toEqual([{ a: 'h', b: 'v', point: [1, 0], ta: 0.5, tb: 0.5 }]);
    const latest = [{ a: 'v', b: 'h', point: [1, 0], ta: 0.5, tb: 0.5 }];
    await expect(hits2).resolves.toEqual(latest);
    await expect(hits3).resolves.toEqual(latest);
  });

  it('never coalesces segment: three pieces asked at once each get their own piece', async () => {
    const server = heldServer();
    const geometry = createRemoteSketchGeometry(server.transport);
    const pieceOf = (req: SegmentRequest): SegmentResponse =>
      create(SegmentResponseSchema, {
        curve: curveToProto({
          kind: 'arc',
          center: [0, 0],
          from: [1, 0],
          to: [0, 1],
          ccw: true,
          id: `${String(req.from)}-${String(req.to)}`,
        }),
      });

    const all = Promise.all([
      geometry.segment(C, 0, 1),
      geometry.segment(C, 1, 2),
      geometry.segment(C, 2, 3),
    ]);
    for (let i = 0; i < 3; i++) {
      await settle();
      // One in flight at a time, in the order of the calls.
      expect(server.segments).toHaveLength(i + 1);
      const held = server.segments[i];
      if (held !== undefined) held.answer(pieceOf(held.request));
    }

    expect((await all).map((c) => c.id)).toEqual(['0-1', '1-2', '2-3']);
  });

  it('coalesces queued offsets of the same chain and keeps other chains', async () => {
    const server = heldServer();
    const geometry = createRemoteSketchGeometry(server.transport);
    const answer = (req: OffsetRequest): OffsetResponse =>
      create(OffsetResponseSchema, {
        curves: req.chain.map((c) =>
          offsetCurveToProto({
            kind: 'line',
            from: [0, req.distance],
            to: [1, req.distance],
            id: c.id,
            source: c.id,
          }),
        ),
      });

    const d1 = geometry.offset([H, V], false, 1);
    const d2 = geometry.offset([H, V], false, 2);
    const closed = geometry.offset([H, V], true, 2);
    const other = geometry.offset([C], false, 2);
    const d3 = geometry.offset([H, V], false, 3);
    for (let i = 0; i < 4; i++) {
      await settle();
      const held = server.offsets[i];
      if (held !== undefined) held.answer(answer(held.request));
    }
    await settle();

    expect(
      server.offsets.map((h) => [
        h.request.chain.map((c) => c.id),
        h.request.closed,
        h.request.distance,
      ]),
    ).toEqual([
      [['h', 'v'], false, 1],
      [['h', 'v'], false, 3],
      [['h', 'v'], true, 2],
      [['c'], false, 2],
    ]);
    expect((await d1)[0]).toMatchObject({ from: [0, 1] });
    expect((await d2)[0]).toMatchObject({ from: [0, 3] });
    expect((await d3)[0]).toMatchObject({ from: [0, 3] });
    expect((await closed)[0]).toMatchObject({ from: [0, 2] });
    expect((await other)[0]?.id).toBe('c');
  });

  it('sends the next call at once when nothing is in flight any more', async () => {
    const server = heldServer();
    const geometry = createRemoteSketchGeometry(server.transport);

    const first = geometry.intersections([H]);
    await settle();
    server.intersections[0]?.answer(hitsAnswer('h', 'h'));
    await first;
    const next = geometry.intersections([V]);
    await settle();

    expect(server.intersections.map((h) => ids(h.request))).toEqual([['h'], ['v']]);
    server.intersections[1]?.answer(hitsAnswer('v', 'v'));
    await expect(next).resolves.toHaveLength(1);
  });

  it('does not let one method wait for another', async () => {
    const server = heldServer();
    const geometry = createRemoteSketchGeometry(server.transport);

    const hits = geometry.intersections([H, V]);
    const piece = geometry.segment(C, 0, 1);
    await settle();

    expect(server.intersections).toHaveLength(1);
    expect(server.segments).toHaveLength(1);

    server.segments[0]?.answer(create(SegmentResponseSchema, { curve: curveToProto(H) }));
    await expect(piece).resolves.toEqual(H);
    server.intersections[0]?.answer(hitsAnswer('h', 'v'));
    await expect(hits).resolves.toHaveLength(1);
  });

  it('sends the waiting request after a failed one and rejects the waiting callers with its error', async () => {
    const server = heldServer();
    const geometry = createRemoteSketchGeometry(server.transport);

    const first = geometry.intersections([H]);
    const second = geometry.intersections([C]);
    const third = geometry.intersections([C]);
    await settle();
    server.intersections[0]?.fail(
      kernelFailure(ErrorReason.KERNEL_INVALID_INPUT, Code.InvalidArgument),
    );

    expect(await rejectionCode(first)).toBe('invalid-input');
    await settle();
    expect(server.intersections.map((h) => ids(h.request))).toEqual([['h'], ['c']]);

    server.intersections[1]?.fail(
      kernelFailure(ErrorReason.KERNEL_OPERATION_FAILED, Code.FailedPrecondition),
    );
    expect(await rejectionCode(second)).toBe('operation-failed');
    expect(await rejectionCode(third)).toBe('operation-failed');
  });

  it.each([
    [
      'KERNEL_INVALID_INPUT',
      ErrorReason.KERNEL_INVALID_INPUT,
      Code.InvalidArgument,
      'invalid-input',
    ],
    [
      'KERNEL_OPERATION_FAILED',
      ErrorReason.KERNEL_OPERATION_FAILED,
      Code.FailedPrecondition,
      'operation-failed',
    ],
    ['KERNEL_INTERNAL', ErrorReason.KERNEL_INTERNAL, Code.Internal, 'internal'],
    // The reason decides over the gRPC code.
    [
      'KERNEL_OPERATION_FAILED under INTERNAL',
      ErrorReason.KERNEL_OPERATION_FAILED,
      Code.Internal,
      'operation-failed',
    ],
  ] as const)('rejects %s with the kernel code', async (_, reason, code, expected) => {
    const transport = createRouterTransport(({ service }) => {
      service(GeometryService, {
        intersections: () => Promise.reject(kernelFailure(reason, code)),
        segment: () => Promise.reject(kernelFailure(reason, code)),
        fillet: () => Promise.reject(kernelFailure(reason, code)),
        offset: () => Promise.reject(kernelFailure(reason, code)),
      });
    });
    const geometry = createRemoteSketchGeometry(transport);

    expect(await rejectionCode(geometry.intersections([H, V]))).toBe(expected);
    expect(await rejectionCode(geometry.segment(H, 0, 1))).toBe(expected);
    expect(await rejectionCode(geometry.fillet(H, V, 1, [0, 0]))).toBe(expected);
    expect(await rejectionCode(geometry.offset([H], false, 1))).toBe(expected);
  });

  it.each([
    ['INVALID_ARGUMENT', Code.InvalidArgument, 'invalid-input'],
    ['FAILED_PRECONDITION', Code.FailedPrecondition, 'operation-failed'],
    ['INTERNAL', Code.Internal, 'internal'],
    ['UNAVAILABLE', Code.Unavailable, 'internal'],
    ['DEADLINE_EXCEEDED', Code.DeadlineExceeded, 'internal'],
    ['UNKNOWN', Code.Unknown, 'internal'],
  ] as const)('without a kernel reason maps the gRPC code %s', async (_, code, expected) => {
    const transport = createRouterTransport(({ service }) => {
      service(GeometryService, {
        intersections: () => Promise.reject(new ConnectError('down', code)),
        segment: () => Promise.reject(new ConnectError('down', code)),
        fillet: () => Promise.reject(new ConnectError('down', code)),
        offset: () => Promise.reject(new ConnectError('down', code)),
      });
    });
    const geometry = createRemoteSketchGeometry(transport);

    expect(await rejectionCode(geometry.intersections([H, V]))).toBe(expected);
  });

  it('rejects a broken answer as an internal kernel error', async () => {
    const transport = createRouterTransport(({ service }) => {
      service(GeometryService, {
        intersections: () => ({}),
        segment: () => ({}),
        fillet: () => ({}),
        offset: () => ({}),
      });
    });
    const geometry = createRemoteSketchGeometry(transport);

    expect(await rejectionCode(geometry.segment(H, 0, 1))).toBe('internal');
    expect(await rejectionCode(geometry.fillet(H, V, 1, [0, 0]))).toBe('internal');
    // An empty list is a valid answer.
    await expect(geometry.intersections([H, V])).resolves.toEqual([]);
  });
});
