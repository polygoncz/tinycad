import { beforeAll, describe, expect, it } from 'vitest';
import type { TopoDS_Shape } from 'replicad-opencascadejs';
import { kernelErrorCode, type BoundingBox, type ShapeHandle } from '@/kernel';
import { loadOcct, type Occt } from '@/kernel-occt/occt';
import { OcctKernelImpl } from '@/kernel-occt/occt-kernel-impl';
import { writeStep } from '@/kernel-occt/step';

// What the OCCT adapter does beyond the contract (spec 06, "Export STEP v adaptéru (M15)"):
// the exported file read back with STEPControl_Reader has the same solids, volume and box,
// and no temporary file stays in the Emscripten file system.

let oc: Occt;

beforeAll(async () => {
  oc = await loadOcct();
});

const TMP = '/tmp';
const READ_BACK = '/tmp/read-back.step';

/** The tinycad-export-*.step files left in the in-memory file system. */
function exportFiles(): string[] {
  // The Emscripten declaration types readdir as any; it returns the names of the entries.
  const names: unknown = oc.FS.readdir(TMP);
  if (!Array.isArray(names)) return expect.fail('FS.readdir did not return an array');
  return names.filter((n): n is string => typeof n === 'string' && n.startsWith('tinycad-export-'));
}

/** The shape of a STEP file written into oc.FS and read back with STEPControl_Reader. */
function readBack(bytes: Uint8Array): TopoDS_Shape {
  oc.FS.writeFile(READ_BACK, bytes);
  try {
    using reader = new oc.STEPControl_Reader();
    expect(reader.ReadFile(READ_BACK)).toBe(oc.IFSelect_ReturnStatus.IFSelect_RetDone);
    using progress = new oc.Message_ProgressRange();
    expect(reader.TransferRoots(progress)).toBeGreaterThanOrEqual(1);
    return reader.OneShape();
  } finally {
    oc.FS.unlink(READ_BACK);
  }
}

/** The solids of the shape, each with its volume (BRepGProp.VolumeProperties). */
function solidVolumes(shape: TopoDS_Shape): number[] {
  const { TopAbs_SOLID, TopAbs_SHAPE } = oc.TopAbs_ShapeEnum;
  const volumes: number[] = [];
  using explorer = new oc.TopExp_Explorer(shape, TopAbs_SOLID, TopAbs_SHAPE);
  while (explorer.More()) {
    using solid = explorer.Current();
    using props = new oc.GProp_GProps();
    oc.BRepGProp.VolumeProperties(solid, props, true, false, false);
    volumes.push(props.Mass());
    explorer.Next();
  }
  return volumes;
}

function boxOf(shape: TopoDS_Shape): BoundingBox {
  using box = new oc.Bnd_Box();
  oc.BRepBndLib.AddOptimal(shape, box, false, false);
  return {
    min: [box.GetXMin(), box.GetYMin(), box.GetZMin()],
    max: [box.GetXMax(), box.GetYMax(), box.GetZMax()],
  };
}

function expectBoxClose(actual: BoundingBox, expected: BoundingBox): void {
  for (let k = 0; k < 3; k++) {
    expect(Math.abs((actual.min[k] ?? NaN) - (expected.min[k] ?? NaN))).toBeLessThan(1e-5);
    expect(Math.abs((actual.max[k] ?? NaN) - (expected.max[k] ?? NaN))).toBeLessThan(1e-5);
  }
}

function expectRelativelyClose(actual: number, expected: number, tolerance: number): void {
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThan(tolerance);
}

/** Acceptance model of M15: a box 20 × 20 × 10 minus a cylinder r = 3 through its height. */
async function aBoxWithHole(kernel: OcctKernelImpl): Promise<ShapeHandle> {
  const box = await kernel.makeBox({ origin: [0, 0, 0], size: [20, 20, 10] });
  const cylinder = await kernel.makeCylinder({
    base: [10, 10, -1],
    axis: [0, 0, 1],
    radius: 3,
    height: 12,
  });
  const cut = await kernel.boolean('subtract', [box.shape], [cylinder.shape]);
  await kernel.release([box.shape, cylinder.shape]);
  return cut.shape;
}

describe('OcctKernelImpl.exportStep (M15)', () => {
  it('acceptance: a box with a hole reads back as one solid of volume 4000 − 90π and the same box', async () => {
    const kernel = new OcctKernelImpl(oc);
    const shape = await aBoxWithHole(kernel);
    const original = await kernel.boundingBox(shape);

    using back = readBack(await kernel.exportStep([shape]));

    const volumes = solidVolumes(back);
    expect(volumes).toHaveLength(1);
    expectRelativelyClose(volumes[0] ?? NaN, 4000 - 90 * Math.PI, 1e-4);
    expectBoxClose(boxOf(back), original);
  });

  it('two separate boxes read back as two solids with the sum of the volumes', async () => {
    const kernel = new OcctKernelImpl(oc);
    const a = await kernel.makeBox({ origin: [0, 0, 0], size: [1, 2, 3] });
    const b = await kernel.makeBox({ origin: [10, 0, 0], size: [2, 2, 2] });

    using back = readBack(await kernel.exportStep([a.shape, b.shape]));

    const volumes = solidVolumes(back);
    expect(volumes).toHaveLength(2);
    expectRelativelyClose(
      volumes.reduce((sum, v) => sum + v, 0),
      6 + 8,
      1e-6,
    );
    expectBoxClose(boxOf(back), { min: [0, 0, 0], max: [12, 2, 3] });
  });

  it('the file is in millimetres', async () => {
    const kernel = new OcctKernelImpl(oc);
    const a = await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
    const text = new TextDecoder().decode(await kernel.exportStep([a.shape]));
    expect(text).toContain('SI_UNIT(.MILLI.,.METRE.)');
  });

  it('no temporary file stays after an export, a failed one included', async () => {
    const kernel = new OcctKernelImpl(oc);
    const a = await kernel.makeBox({ origin: [0, 0, 0], size: [1, 1, 1] });
    await kernel.exportStep([a.shape]);
    await kernel.exportStep([a.shape]);
    await kernel.exportStep([
      a.shape,
      (await kernel.makeBox({ origin: [5, 0, 0], size: [1, 1, 1] })).shape,
    ]);
    const failed = await kernel.exportStep([a.shape, a.shape]).catch((e: unknown) => e);
    expect(kernelErrorCode(failed)).toBe('invalid-input');
    expect(exportFiles()).toEqual([]);
  });

  it('writeStep: a failed Transfer is operation-failed and removes the file at the path', () => {
    // An empty shape is the only input Transfer refuses (IFSelect_RetVoid); a file placed at
    // the path beforehand shows that the clean-up runs after a failure too.
    const path = '/tmp/tinycad-export-failed.step';
    oc.FS.writeFile(path, 'stale');
    using empty = new oc.TopoDS_Shape();
    let failure: unknown;
    try {
      writeStep(oc, [empty], path);
    } catch (e) {
      failure = e;
    }
    expect(kernelErrorCode(failure)).toBe('operation-failed');
    expect(exportFiles()).toEqual([]);
  });
});
