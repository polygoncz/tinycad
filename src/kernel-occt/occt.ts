// OCCT WASM module (replicad-opencascadejs, ADR 0013): loading and helpers the build lacks.
// Internal to kernel-occt; the rest of the app never sees OCCT types.

import init from 'replicad-opencascadejs';
import type { OpenCascadeInstance, TopAbs_ShapeEnum, TopoDS_Shape } from 'replicad-opencascadejs';
import { createKernelError, kernelErrorCode } from '@/kernel';
import { isWasmTrap } from './wasm-trap';

/** Initialised OCCT module: every bound class plus Emscripten helpers. */
export type Occt = OpenCascadeInstance;

export interface LoadOcctOptions {
  /** URL of the .wasm file. In Node omit it, the package finds the file itself. */
  readonly locateWasm?: () => string;
}

/**
 * Loads and initialises the OCCT module. First makes sure Symbol.dispose exists (spec 06,
 * "`using` in the browser"): embind adds [Symbol.dispose] to its objects only if the symbol
 * exists, and the `using` helper emitted by Vite falls back to Symbol.for('Symbol.dispose').
 */
export async function loadOcct(options: LoadOcctOptions = {}): Promise<Occt> {
  ensureSymbolDispose();
  const { locateWasm } = options;
  return init(locateWasm ? { locateFile: locateWasm } : {});
}

/**
 * Equivalent of `Symbol.dispose ??= Symbol.for('Symbol.dispose')`. TypeScript declares the
 * property read-only, so it is defined explicitly – only where the runtime lacks it.
 */
function ensureSymbolDispose(): void {
  if (Reflect.has(Symbol, 'dispose')) return;
  Object.defineProperty(Symbol, 'dispose', { value: Symbol.for('Symbol.dispose') });
}

/**
 * Distinct sub-shapes of the given type, in the order of TopExp::MapShapes (which this build
 * does not bind): TopExp_Explorer order, a sub-shape added only if no earlier one IsSame.
 * The position in the result is the SubShapeIndex. The caller owns (and deletes) the shapes.
 * O(n²) IsSame calls.
 */
export function mapSubShapes(
  oc: Occt,
  shape: TopoDS_Shape,
  type: TopAbs_ShapeEnum,
): readonly TopoDS_Shape[] {
  const found: TopoDS_Shape[] = [];
  using explorer = new oc.TopExp_Explorer(shape, type, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  try {
    while (explorer.More()) {
      const current = explorer.Current();
      // Until it is pushed to `found`, `current` is owned here: delete it if the test throws.
      let duplicate: boolean;
      try {
        duplicate = found.some((s) => s.IsSame(current));
      } catch (e) {
        current.delete();
        throw e;
      }
      if (duplicate) {
        current.delete();
      } else {
        found.push(current);
      }
      explorer.Next();
    }
  } catch (e) {
    // The result never reaches the caller: delete what was found so far.
    for (const s of found) s.delete();
    throw e;
  }
  return found;
}

/** Whether `shape` contains at least one solid (TopExp_Explorer over TopAbs_SOLID). */
export function hasSolid(oc: Occt, shape: TopoDS_Shape): boolean {
  const { TopAbs_SOLID, TopAbs_SHAPE } = oc.TopAbs_ShapeEnum;
  using explorer = new oc.TopExp_Explorer(shape, TopAbs_SOLID, TopAbs_SHAPE);
  return explorer.More();
}

/**
 * Converts anything thrown inside the adapter to a kernel error (spec 06, Errors). An OCCT
 * exception (WebAssembly.Exception) becomes 'internal' with the OCCT type in the message and
 * is released (occtExceptionText); an error that already has a kernel code passes unchanged;
 * anything else is 'internal'.
 * A WASM trap (WebAssembly.RuntimeError) passes unchanged too: it is fatal, not a kernel
 * error, and the worker must still recognise it (Q055).
 */
export function toKernelError(oc: Occt, e: unknown): Error {
  if (e instanceof Error && kernelErrorCode(e) !== undefined) return e;
  if (isWasmTrap(e)) return e;
  const text = occtExceptionText(oc, e);
  if (text !== undefined) return createKernelError('internal', text);
  return createKernelError('internal', e instanceof Error ? e.message : String(e));
}

/**
 * The text of an OCCT exception (WebAssembly.Exception): `<OCCT type>: <message>`, just the
 * type when the message is empty; undefined for anything else (a trap included).
 *
 * Releases the exception after reading it (M19.1, C8): a C++ exception that reaches JS keeps
 * its reference count of 1 and no C++ catch frees it, so its object would stay on the WASM
 * heap. Every path that catches a WebAssembly.Exception must therefore end here, exactly once;
 * afterwards the exception must not be read or rethrown.
 */
export function occtExceptionText(oc: Occt, e: unknown): string | undefined {
  if (!isWasmException(e)) return undefined;
  const [type, message] = oc.getExceptionMessage(e);
  oc.decrementExceptionRefcount(e);
  return message ? `${type}: ${message}` : type;
}

/**
 * WebAssembly.Exception is not a declared value without lib DOM (the test project), so the
 * check uses its toStringTag, which the package's own declaration of the type relies on.
 */
function isWasmException(e: unknown): e is WebAssembly.Exception {
  return Object.prototype.toString.call(e) === '[object WebAssembly.Exception]';
}
