import initOC from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
const t0 = performance.now();
const oc = await initOC({ locateFile: () => wasmUrl });
const tInit = performance.now() - t0;
const s = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0, 0, 0), 10, 20, 30).Shape();
new oc.BRepMesh_IncrementalMesh(s, 0.1, false, 0.5, false);
let tris = 0;
const ex = new oc.TopExp_Explorer(s, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
for (; ex.More(); ex.Next()) { const t = oc.BRep_Tool.Triangulation(oc.TopoDS.Face(ex.Current()), new oc.TopLoc_Location(), 0); tris += t.NbTriangles(); }
postMessage({ initMs: Math.round(tInit), triangles: tris, wasmUrl });
