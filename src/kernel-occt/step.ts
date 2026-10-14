import type { TopoDS_Shape } from 'replicad-opencascadejs';
import { createKernelError } from '@/kernel';
import { occtExceptionText, type Occt } from './occt';

// Export to STEP (spec 06, "Export STEP v adaptéru (M15)"). Internal to kernel-occt; the
// handles are already checked by OcctKernelImpl.

/**
 * A STEP file (AP214, default unit mm) with the shapes `shapes`: one shape as it is, several
 * as a TopoDS_Compound in their order. STEPControl_Writer writes only to a file, so it goes
 * through the Emscripten file system (oc.FS, in memory) at `path`; the bytes are copied into
 * a new buffer of their own and the file is removed in every case, after a failure too.
 * A status other than IFSelect_RetDone or an OCCT exception from Transfer/Write is
 * 'operation-failed'; a WASM trap passes unchanged (fatal, Q055).
 */
export function writeStep(
  oc: Occt,
  shapes: readonly TopoDS_Shape[],
  path: string,
): Uint8Array<ArrayBuffer> {
  try {
    writeFile(oc, shapes, path);
    // readFile returns a view the module may reuse; the copy owns its whole buffer.
    return new Uint8Array(oc.FS.readFile(path));
  } finally {
    removeFile(oc, path);
  }
}

function writeFile(oc: Occt, shapes: readonly TopoDS_Shape[], path: string): void {
  const [first, ...rest] = shapes;
  if (first === undefined) throw createKernelError('invalid-input', 'exportStep: no shapes');
  using compound = rest.length > 0 ? compoundOf(oc, shapes) : undefined;
  const shape = compound ?? first;
  using writer = new oc.STEPControl_Writer();
  using progress = new oc.Message_ProgressRange();
  const { IFSelect_RetDone } = oc.IFSelect_ReturnStatus;
  try {
    const mode = oc.STEPControl_StepModelType.STEPControl_AsIs;
    const transferred = writer.Transfer(shape, mode, true, progress);
    if (transferred !== IFSelect_RetDone) {
      throw createKernelError('operation-failed', `exportStep: Transfer gave ${transferred}`);
    }
    const written = writer.Write(path);
    if (written !== IFSelect_RetDone) {
      throw createKernelError('operation-failed', `exportStep: Write gave ${written}`);
    }
  } catch (e) {
    const text = occtExceptionText(oc, e);
    if (text === undefined) throw e;
    throw createKernelError('operation-failed', `exportStep: ${text}`);
  }
}

/**
 * The compound of the shapes in their order. This build binds TopoDS_Builder, not its
 * subclass BRep_Builder; MakeCompound and Add are TopoDS_Builder's own methods.
 */
function compoundOf(oc: Occt, shapes: readonly TopoDS_Shape[]): TopoDS_Shape {
  const compound = new oc.TopoDS_Compound();
  try {
    using builder = new oc.TopoDS_Builder();
    builder.MakeCompound(compound);
    for (const shape of shapes) builder.Add(compound, shape);
  } catch (e) {
    compound.delete();
    throw e;
  }
  return compound;
}

/**
 * Removes the file if it is there. After a failed Transfer or Write there may be none, so a
 * failed unlink is ignored: it must not hide the original error or the result.
 */
function removeFile(oc: Occt, path: string): void {
  try {
    oc.FS.unlink(path);
  } catch {
    // No file to remove.
  }
}
