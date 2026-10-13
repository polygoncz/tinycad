import init from 'opencascade.js/dist/node.js';
const t0 = performance.now();
const oc = await init();
console.log('init ms', Math.round(performance.now() - t0));
const s = new oc.BRepPrimAPI_MakeBox_2(10, 20, 30).Shape();
for (const n of ['TopTools_IndexedMapOfShape', 'TopExp', 'TopTools_ShapeMapHasher']) console.log(n, typeof oc[n]);
try { const m = new oc.TopTools_IndexedMapOfShape_1(); oc.TopExp.MapShapes_1(s, oc.TopAbs_ShapeEnum.TopAbs_FACE, m); console.log('MapShapes faces', m.Extent()); } catch (e) { console.log('map fail', e.message ?? e); }
console.log('HashCode', typeof s.HashCode, 'Symbol.dispose', typeof s[Symbol.dispose]);
try { new oc.BRepPrimAPI_MakeBox_2(-1, 0, 0).Shape(); } catch (e) { console.log('bad box throws', typeof e, e); }
