import { create } from '@bufbuild/protobuf';
import { timestampFromMs } from '@bufbuild/protobuf/wkt';
import { describe, expect, it } from 'vitest';
import type { MeshData } from '@/kernel';
import {
  BodyMaterial,
  FeatureError_Code,
  GetHistoryResponseSchema,
  LogEntryViewSchema,
  LogEntryView_Kind,
  MeshSchema,
} from '@/protocol';
import type { Mesh } from '@/protocol';
import { decodeReadModel, RemoteError } from '@/remote';
import { decodeHistory, decodeLogEntry, decodeMesh } from '@/remote/read-model';
import { aBodyView, aMeshData, aReadModel, aSketchView, meshToProto } from '@/remote/testing';

const PLANE_XY = {
  origin: { x: 0, y: 0, z: 0 },
  normal: { x: 0, y: 0, z: 1 },
  xDir: { x: 1, y: 0, z: 0 },
};

/** The bytes of `bytes` at `offset` inside a bigger buffer, as a decoder may hand them over. */
function atOffset(bytes: Uint8Array, offset: number): Uint8Array {
  const buffer = new Uint8Array(offset + bytes.byteLength + 3);
  buffer.set(bytes, offset);
  return new Uint8Array(buffer.buffer, offset, bytes.byteLength);
}

function shifted(mesh: Mesh, offset: number): Mesh {
  return create(MeshSchema, {
    positions: atOffset(mesh.positions, offset),
    normals: atOffset(mesh.normals, offset),
    indices: atOffset(mesh.indices, offset),
    faceRanges: atOffset(mesh.faceRanges, offset),
    edgePositions: atOffset(mesh.edgePositions, offset),
    edgeRanges: atOffset(mesh.edgeRanges, offset),
  });
}

function plainMesh(mesh: MeshData) {
  return {
    positions: [...mesh.positions],
    normals: [...mesh.normals],
    indices: [...mesh.indices],
    faceRanges: [...mesh.faceRanges],
    edgePositions: [...mesh.edgePositions],
    edgeRanges: [...mesh.edgeRanges],
  };
}

describe('decodeReadModel', () => {
  it('decodes the document as PartStudioData with canonical body metadata', () => {
    const data = decodeReadModel(
      aReadModel({
        document: {
          documentId: 'doc-7',
          name: 'Bracket',
          lastSeq: 12n,
          features: [
            {
              id: 'f1',
              type: 'box',
              typeVersion: 1,
              name: 'Box 1',
              suppressed: true,
              params: { width: 2, origin: [0, 0, 0] },
            },
          ],
          rollbackIndex: 1,
          bodyMeta: {
            'f1/body': {
              name: 'Base',
              hidden: true,
              color: '#ff0000',
              material: BodyMaterial.STEEL,
            },
            'f2/body': { material: BodyMaterial.PLASTIC },
            'f3/body': { name: '' },
          },
        },
      }),
    );
    expect(data.document).toEqual({
      id: 'doc-7',
      name: 'Bracket',
      lastSeq: 12,
      studio: {
        features: [
          {
            id: 'f1',
            type: 'box',
            typeVersion: 1,
            name: 'Box 1',
            suppressed: true,
            params: { width: 2, origin: [0, 0, 0] },
          },
        ],
        rollbackIndex: 1,
        bodies: { 'f1/body': { name: 'Base', hidden: true, color: '#ff0000', material: 'steel' } },
      },
    });
  });

  it('leaves out the bodies of a document without metadata', () => {
    expect(decodeReadModel(aReadModel()).document.studio).toEqual({
      features: [],
      rollbackIndex: 0,
    });
  });

  it('decodes the statuses in the shape of FeatureStatus', () => {
    const { regen } = decodeReadModel(
      aReadModel({
        regen: {
          statuses: {
            a: { kind: { case: 'ok', value: {} } },
            b: { kind: { case: 'warning', value: { message: 'careful' } } },
            c: {
              kind: {
                case: 'error',
                value: {
                  code: FeatureError_Code.INVALID_PARAMS,
                  message: 'bad',
                  issues: [{ param: 'width', code: 'param.atOrBelowMin' }],
                },
              },
            },
            d: { kind: { case: 'error', value: { code: FeatureError_Code.KERNEL, message: 'k' } } },
            e: { kind: { case: 'suppressed', value: {} } },
            f: { kind: { case: 'rolledBack', value: {} } },
          },
        },
      }),
    );
    expect(Object.fromEntries(regen.statuses)).toEqual({
      a: { kind: 'ok' },
      b: { kind: 'warning', message: 'careful' },
      c: {
        kind: 'error',
        error: {
          code: 'INVALID_PARAMS',
          message: 'bad',
          issues: [{ param: 'width', code: 'param.atOrBelowMin' }],
        },
      },
      d: { kind: 'error', error: { code: 'KERNEL', message: 'k' } },
      e: { kind: 'suppressed' },
      f: { kind: 'rolledBack' },
    });
  });

  it('decodes the final state: bodies, sketches, planes and axes', () => {
    const { regen } = decodeReadModel(
      aReadModel({
        regen: {
          generation: 5n,
          durationMs: 12.5,
          final: {
            bodies: [aBodyView()],
            sketches: [aSketchView()],
            planes: [{ planeId: 'origin/plane:xy', owner: 'origin', plane: PLANE_XY }],
            axes: [
              {
                axisId: 'origin/axis:z',
                owner: 'origin',
                origin: { x: 0, y: 0, z: 0 },
                direction: { x: 0, y: 0, z: 1 },
              },
            ],
          },
        },
      }),
    );
    expect(regen.generation).toBe(5);
    expect(regen.durationMs).toBe(12.5);
    expect(regen.input).toBeNull();
    const [body] = regen.final.bodies;
    expect(body).toMatchObject({
      id: 'f1/body',
      origin: 'f1',
      lastModifiedBy: 'f1',
      contentVersion: 'v1',
      faceNames: ['face:top', ''],
      edgeNames: ['edge:a'],
    });
    expect(Object.fromEntries(body?.facePlanes ?? [])).toEqual({
      0: { origin: [0, 0, 1], normal: [0, 0, 1], xDir: [1, 0, 0] },
    });
    expect(body?.mesh && plainMesh(body.mesh)).toEqual(plainMesh(aMeshData()));
    expect(regen.final.sketches).toEqual([
      {
        sketchId: 'f2/sketch',
        featureId: 'f2',
        plane: { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] },
        entities: [{ kind: 'line', id: 'a', from: [0, 0], to: [1, 0] }],
        regions: [
          {
            name: 'a,b,c,d',
            outer: [
              { kind: 'line', id: 'a', from: [0, 0], to: [1, 0] },
              { kind: 'line', id: 'b', from: [1, 0], to: [1, 1] },
              { kind: 'line', id: 'c', from: [1, 1], to: [0, 1] },
              { kind: 'line', id: 'd', from: [0, 1], to: [0, 0] },
            ],
            holes: [],
            area: 1,
          },
        ],
      },
    ]);
    expect(regen.final.planes).toEqual([
      {
        id: 'origin/plane:xy',
        owner: 'origin',
        plane: { origin: [0, 0, 0], normal: [0, 0, 1], xDir: [1, 0, 0] },
      },
    ]);
    expect(regen.final.axes).toEqual([
      { id: 'origin/axis:z', owner: 'origin', origin: [0, 0, 0], direction: [0, 0, 1] },
    ]);
  });

  it('gives a body without a mesh null', () => {
    const { regen } = decodeReadModel(
      aReadModel({ regen: { final: { bodies: [aBodyView({ mesh: undefined })] } } }),
    );
    expect(regen.final.bodies[0]?.mesh).toBeNull();
  });

  it('decodes the input of the edited feature and the anchors', () => {
    const { regen } = decodeReadModel(
      aReadModel({
        regen: {
          input: { featureId: 'f2', state: { bodies: [aBodyView({ contentVersion: 'v0' })] } },
          anchors: {
            f1: {
              anchors: {
                base: { point: { x: 1, y: 2, z: 3 } },
                axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
              },
            },
          },
        },
      }),
    );
    expect(regen.input?.featureId).toBe('f2');
    expect(regen.input?.state.bodies.map((b) => b.contentVersion)).toEqual(['v0']);
    expect(Object.fromEntries(regen.anchors)).toEqual({
      f1: { base: { point: [1, 2, 3] }, axis: { point: [0, 0, 0], direction: [0, 0, 1] } },
    });
  });

  it('decodes the session', () => {
    expect(decodeReadModel(aReadModel()).session).toEqual({
      writable: true,
      canUndo: false,
      canRedo: false,
      transactionLabel: null,
    });
    expect(
      decodeReadModel(
        aReadModel({
          session: { writable: false, canUndo: true, canRedo: true, transaction: { label: 'Box' } },
        }),
      ).session,
    ).toEqual({ writable: false, canUndo: true, canRedo: true, transactionLabel: 'Box' });
  });

  it('freezes the data', () => {
    const data = decodeReadModel(
      aReadModel({
        document: { features: [{ id: 'f1', type: 'box', params: { list: [1] } }] },
        regen: { final: { bodies: [aBodyView()], sketches: [aSketchView()] } },
      }),
    );
    expect(Object.isFrozen(data)).toBe(true);
    expect(Object.isFrozen(data.document.studio.features)).toBe(true);
    expect(Object.isFrozen(data.document.studio.features[0]?.params)).toBe(true);
    expect(Object.isFrozen(data.regen.final.bodies[0])).toBe(true);
    expect(Object.isFrozen(data.regen.final.sketches[0]?.entities[0])).toBe(true);
  });

  it.each([1, 2, 3])('decodes a mesh whose bytes start at offset %i the same', (offset) => {
    const mesh = decodeMesh(shifted(meshToProto(aMeshData()), offset));
    expect(plainMesh(mesh)).toEqual(plainMesh(aMeshData()));
    expect(mesh.positions.byteOffset).toBe(0);
  });

  it('copies every array of a mesh into its own buffer', () => {
    const mesh = decodeMesh(meshToProto(aMeshData()));
    const buffers = new Set(Object.values(mesh).map((a: Float32Array | Uint32Array) => a.buffer));
    expect(buffers.size).toBe(6);
  });

  describe('a broken answer is a RemoteError INTERNAL', () => {
    const cases: [string, () => unknown][] = [
      [
        'without the final state',
        () => decodeReadModel(aReadModel({ regen: { final: undefined } })),
      ],
      [
        'with a status without a kind',
        () => decodeReadModel(aReadModel({ regen: { statuses: { a: {} } } })),
      ],
      [
        'with an error without a code',
        () =>
          decodeReadModel(
            aReadModel({ regen: { statuses: { a: { kind: { case: 'error', value: {} } } } } }),
          ),
      ],
      [
        'with a sketch without a plane',
        () =>
          decodeReadModel(
            aReadModel({ regen: { final: { sketches: [aSketchView({ plane: undefined })] } } }),
          ),
      ],
      [
        'with mesh bytes that are no words of 4',
        () =>
          decodeReadModel(
            aReadModel({
              regen: {
                final: {
                  bodies: [
                    aBodyView({
                      mesh: { ...meshToProto(aMeshData()), positions: new Uint8Array(5) },
                    }),
                  ],
                },
              },
            }),
          ),
      ],
    ];
    it.each(cases)('%s', (_, decode) => {
      let error: unknown;
      try {
        decode();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(RemoteError);
      expect(error).toMatchObject({ code: 'INTERNAL', reason: 'UNSPECIFIED' });
    });
  });
});

describe('decodeLogEntry and decodeHistory', () => {
  it('decodes a log entry; target only for undo and redo', () => {
    expect(
      decodeLogEntry(
        create(LogEntryViewSchema, {
          seq: 3n,
          kind: LogEntryView_Kind.DO,
          label: 'Box 1',
          time: timestampFromMs(1000),
          opType: 'feature.add',
        }),
      ),
    ).toEqual({ seq: 3, kind: 'do', label: 'Box 1', time: 1000, opType: 'feature.add' });
    expect(
      decodeLogEntry(
        create(LogEntryViewSchema, { seq: 4n, kind: LogEntryView_Kind.UNDO, target: 3n }),
      ),
    ).toMatchObject({ seq: 4, kind: 'undo', target: 3 });
  });

  it('refuses a log entry without a kind', () => {
    expect(() => decodeLogEntry(create(LogEntryViewSchema, { seq: 1n }))).toThrow(RemoteError);
  });

  it('decodes the history with its stacks', () => {
    const history = decodeHistory(
      create(GetHistoryResponseSchema, {
        entries: [{ seq: 1n, kind: LogEntryView_Kind.DO, opType: 'feature.add' }],
        undoStack: [1n],
        redoStack: [],
      }),
    );
    expect(history.entries.map((e) => e.seq)).toEqual([1]);
    expect(history.stacks).toEqual({ undo: [1], redo: [] });
  });
});
