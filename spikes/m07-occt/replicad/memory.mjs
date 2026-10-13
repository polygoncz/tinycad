import initOC from 'replicad-opencascadejs';
const oc = await initOC();
const mem = () => oc.wasmMemory.buffer.byteLength;
function run(n, del) {
  for (let k = 0; k < n; k++) {
    const pp = new oc.gp_Pnt(0, 0, 0);
    const m = new oc.BRepPrimAPI_MakeBox(pp, 1, 1, 1);
    const s = m.Shape();
    const ims = new oc.BRepMesh_IncrementalMesh(s, 0.1, false, 0.5, false);
    if (del) { ims.delete(); s.delete(); m.delete(); pp.delete(); }
  }
}
run(200, true);
const a = mem(); run(3000, true); const b = mem(); run(3000, false); const c = mem();
console.log('memory bytes: start', a, 'after 3000 with delete', b, 'after 3000 without delete', c);
