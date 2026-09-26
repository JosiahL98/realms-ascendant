// Dumps a unit rig (bones + part geometry) as JSON, e.g. for side-by-side model reviews.
// Usage: npx tsx tools/exportRig.ts <model> <out.json>
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import { getRig } from '../src/render/models/units';

const model = process.argv[2] ?? 'scout';
const out = process.argv[3] ?? `${model}.json`;
const rig = getRig(model);
const round = (v: number, k = 4) => Math.round(v * 10 ** k) / 10 ** k;
const parts = rig.parts.filter((p) => !p.variant).map((p) => {
  const pos = p.geo.getAttribute('position') as THREE.BufferAttribute;
  const nrm = p.geo.getAttribute('normal') as THREE.BufferAttribute;
  const col = p.geo.getAttribute('color') as THREE.BufferAttribute;
  return {
    bone: rig.bones[p.bone].name,
    pc: p.pc,
    pos: Array.from(pos.array as Float32Array, (v) => round(v)),
    nrm: Array.from(nrm.array as Float32Array, (v) => round(v, 3)),
    col: Array.from(col.array as Float32Array, (v) => round(v, 3)),
  };
});
const bones = rig.bones.map((b) => ({ name: b.name, parent: b.parent, pivot: b.pivot }));
writeFileSync(out, JSON.stringify({ model, bones, parts }));
const tris = parts.reduce((a, p) => a + p.pos.length / 9, 0);
console.log(`${model}: ${bones.length} bones, ${parts.length} parts, ${tris} triangles -> ${out}`);
