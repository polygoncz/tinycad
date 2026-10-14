import type { NCollection_List_TopoDS_Shape, TopoDS_Shape } from 'replicad-opencascadejs';
import type { HistoryLink, ShapeHistory, SubShapeIndex } from '@/kernel';
import type { Occt } from './occt';
import { indexOfSame, type ShapeEntry } from './shape-entry';

// History of an OCCT algorithm as ShapeHistory (spec 06, "Historie, role a topologie v adaptéru
// (M14)"). Internal to kernel-occt.

/** What collectHistory needs of an algorithm: BRepBuilderAPI_MakeShape, BRepAlgoAPI_BuilderAlgo… */
export interface HistoryMaker {
  Modified(s: TopoDS_Shape): NCollection_List_TopoDS_Shape;
  Generated(s: TopoDS_Shape): NCollection_List_TopoDS_Shape;
  IsDeleted(s: TopoDS_Shape): boolean;
}

/**
 * The history of `maker` from the input entries to the output entry (spec 06):
 * - every face of every input exactly once: IsDeleted → deleted; otherwise the faces of the
 *   output IsSame as an item of Modified; none of them and the face itself in the output →
 *   the identity, not in the output → deleted;
 * - Generated of every face, edge and vertex of the inputs → only the faces in the output.
 * Entries are ordered by input, kind (face, edge, vertex) and index; target indices ascend.
 * Cost O(sub-shapes of the inputs · faces of the output) IsSame calls.
 */
export function collectHistory(
  oc: Occt,
  maker: HistoryMaker,
  inputs: readonly ShapeEntry[],
  output: ShapeEntry,
): ShapeHistory {
  const modified: HistoryLink[] = [];
  const generated: HistoryLink[] = [];
  const deleted: { input: number; sub: SubShapeIndex }[] = [];
  const facesIn = (list: NCollection_List_TopoDS_Shape): readonly SubShapeIndex[] =>
    outputFaces(oc, list, output);

  inputs.forEach((entry, input) => {
    entry.faces.forEach((face, index) => {
      const from: SubShapeIndex = { type: 'face', index };
      if (maker.IsDeleted(face)) {
        deleted.push({ input, sub: from });
        return;
      }
      using list = maker.Modified(face);
      const to = facesIn(list);
      if (to.length > 0) {
        modified.push({ input, from, to });
        return;
      }
      const same = indexOfSame(output.faces, face);
      if (same >= 0) {
        modified.push({ input, from, to: [{ type: 'face', index: same }] });
      } else {
        deleted.push({ input, sub: from });
      }
    });
    const kinds = [
      ['face', entry.faces],
      ['edge', entry.edges],
      ['vertex', entry.vertices],
    ] as const;
    for (const [type, map] of kinds) {
      map.forEach((sub, index) => {
        using list = maker.Generated(sub);
        const to = facesIn(list);
        if (to.length > 0) generated.push({ input, from: { type, index }, to });
      });
    }
  });
  return { modified, generated, deleted };
}

/**
 * Indices of the output faces IsSame as an item of `list`, ascending without duplicates.
 * Drains the list (the caller owns it): every item wrapper is deleted.
 */
export function outputFaces(
  oc: Occt,
  list: NCollection_List_TopoDS_Shape,
  output: ShapeEntry,
): readonly SubShapeIndex[] {
  const found = new Set<number>();
  while (!list.IsEmpty()) {
    using item = list.First();
    list.RemoveFirst();
    if (item.ShapeType() !== oc.TopAbs_ShapeEnum.TopAbs_FACE) continue;
    const index = indexOfSame(output.faces, item);
    if (index >= 0) found.add(index);
  }
  return [...found].sort((a, b) => a - b).map((index) => ({ type: 'face', index }));
}
