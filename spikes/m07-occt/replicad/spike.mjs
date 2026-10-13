// Spike: replicad-opencascadejs in Node – box, mesh, edges, bbox, history, STEP, errors, memory.
import initOC from 'replicad-opencascadejs';

const t0 = performance.now();
const oc = await initOC();
console.log(`init: ${(performance.now() - t0).toFixed(0)} ms`);

const heap = () => oc.wasmMemory?.buffer.byteLength;
console.log('heap bytes after init:', heap());

// --- makeBox
const p0 = new oc.gp_Pnt(0, 0, 0);
const mk = new oc.BRepPrimAPI_MakeBox(p0, 10, 20, 30);
const shape = mk.Shape();
console.log('shape type:', shape.ShapeType(), 'null?', shape.IsNull());

// --- MapShapes replacement: TopExp_Explorer + IndexedMap (TopExp::MapShapes does exactly this)
function mapShapes(s, type) {
  // No IndexedMap/HashCode in this build: explorer + dedup by IsSame (same TShape + Location).
  const list = [];
  const ex = new oc.TopExp_Explorer(s, type, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) { const c = ex.Current(); if (!list.some((x) => x.IsSame(c))) list.push(c); else c.delete(); }
  ex.delete();
  return { Extent: () => list.length, FindKey: (i) => list[i - 1], FindIndex: (x) => list.findIndex((y) => y.IsSame(x)) + 1 };
}
const faces = mapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE);
const edges = mapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
const verts = mapShapes(shape, oc.TopAbs_ShapeEnum.TopAbs_VERTEX);
console.log('faces/edges/vertices:', faces.Extent(), edges.Extent(), verts.Extent());

// --- roles: MakeBox has TopFace/BottomFace/... accessors
const roleFns = ['BottomFace', 'TopFace', 'FrontFace', 'BackFace', 'LeftFace', 'RightFace'];
console.log('roles:', roleFns.map((r) => `${r}=${typeof mk[r] === 'function' ? faces.FindIndex(mk[r]()) : 'n/a'}`).join(' '));

// --- bbox
const box = new oc.Bnd_Box();
oc.BRepBndLib.AddOptimal(shape, box, false, false);
console.log('bbox AddOptimal:', [box.GetXMin(), box.GetYMin(), box.GetZMin(), box.GetXMax(), box.GetYMax(), box.GetZMax()]);
const box2 = new oc.Bnd_Box();
oc.BRepBndLib.Add(shape, box2, false);
console.log('bbox Add      :', [box2.GetXMin(), box2.GetXMax()]);

// --- mesh
const t1 = performance.now();
const im = new oc.BRepMesh_IncrementalMesh(shape, 0.1, false, 0.5, false);
console.log(`mesh: ${(performance.now() - t1).toFixed(1)} ms, done=${im.IsDone?.()}`);
let tris = 0;
let nodes = 0;
for (let i = 1; i <= faces.Extent(); i++) {
  const f = oc.TopoDS.Face(faces.FindKey(i));
  const loc = new oc.TopLoc_Location();
  const tri = oc.BRep_Tool.Triangulation(f, loc, 0);
  const reversed = f.Orientation() === oc.TopAbs_Orientation.TopAbs_REVERSED;
  if (tri.IsNull?.()) { console.log('face', i, 'no triangulation'); continue; }
  const t = tri.get ? tri.get() : tri;
  tris += t.NbTriangles();
  nodes += t.NbNodes();
  if (i === 1) {
    const tr = t.Triangle(1);
    console.log('face1 reversed?', reversed, 'tri1 nodes', tr.Value(1), tr.Value(2), tr.Value(3), 'hasNormals', t.HasNormals(), 'loc identity', loc.IsIdentity());
  }
}
console.log('triangles:', tris, 'nodes:', nodes);

// --- edges polyline
let edgePts = 0;
for (let i = 1; i <= edges.Extent(); i++) {
  const e = oc.TopoDS.Edge(edges.FindKey(i));
  const loc = new oc.TopLoc_Location();
  const r = oc.BRep_Tool.PolygonOnTriangulation(e, loc);
  const P = r.P.get ? r.P.get() : r.P;
  if (!P || r.P.IsNull?.()) { console.log('edge', i, 'no polygon'); continue; }
  edgePts += P.NbNodes();
}
console.log('edge points:', edgePts);

// --- history on a boolean (Generated/Modified/IsDeleted)
const tool = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(5, 5, 5), 10, 10, 10).Shape();
const cut = new oc.BRepAlgoAPI_Cut(shape, tool, new oc.Message_ProgressRange());
console.log('cut done:', cut.IsDone(), 'hasHistory', cut.HasModified?.(), cut.HasGenerated?.(), cut.HasDeleted?.());
const top = faces.FindKey(2);
const modList = cut.Modified(top);
console.log('modified(face2) size:', modList.Size(), 'isDeleted', cut.IsDeleted(top));

// --- STEP export via virtual FS
const w = new oc.STEPControl_Writer();
const st = w.Transfer(shape, oc.STEPControl_StepModelType.STEPControl_AsIs, true, new oc.Message_ProgressRange());
const ws = w.Write('/out.step');
const step = oc.FS.readFile('/out.step');
console.log('STEP transfer/write status:', st?.value ?? st, ws?.value ?? ws, 'bytes', step.length);

// --- errors: invalid box (negative size)
try {
  const bad = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0, 0, 0), -1, 0, 0);
  bad.Shape();
  console.log('bad box: no throw');
} catch (e) {
  const msg = e instanceof WebAssembly.Exception && oc.getExceptionMessage ? oc.getExceptionMessage(e) : String(e);
  console.log('bad box throws:', e?.constructor?.name, msg);
}

// --- using / Symbol.dispose
{
  using p = new oc.gp_Pnt(1, 2, 3);
  console.log('Symbol.dispose on embind object:', typeof p[Symbol.dispose]);
}

// --- leak check: create/delete many boxes, watch heap
const before = heap();
for (let k = 0; k < 2000; k++) {
  const pp = new oc.gp_Pnt(0, 0, 0);
  const m = new oc.BRepPrimAPI_MakeBox(pp, 1, 1, 1);
  const s = m.Shape();
  const ims = new oc.BRepMesh_IncrementalMesh(s, 0.1, false, 0.5, false);
  ims.delete(); s.delete(); m.delete(); pp.delete();
}
console.log('heap after 2000 boxes (with delete):', before, '->', heap());
