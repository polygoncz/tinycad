import initOC from 'replicad-opencascadejs';
const oc = await initOC();
const names = Object.keys(oc).filter(n => /^(NCollection_|TopTools_)/.test(n) && /Map|List|Sequence/.test(n));
for (const n of names) { try { const o = new oc[n](); console.log('OK  ', n); o.delete(); } catch (e) { console.log('FAIL', n, String(e.message).slice(0,80)); } }
const s = new oc.BRepPrimAPI_MakeBox(new oc.gp_Pnt(0,0,0),1,2,3).Shape();
console.log('shape methods:', ['HashCode','IsSame','IsEqual','IsPartner','TShape','Location','Orientation'].map(m=>m+':'+typeof s[m]).join(' '));
console.log('TopTools_ShapeMapHasher', typeof oc.TopTools_ShapeMapHasher, 'TopExp', typeof oc.TopExp, 'BRepTools', typeof oc.BRepTools);
