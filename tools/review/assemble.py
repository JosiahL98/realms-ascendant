"""
Builds the horse review page from the template, the gait solver and two model JSON files.
Usage: python tools/review/assemble.py <current-rig.json> <new-horse.json> <light-horse.json> <out.html>
  current-rig.json:  npx tsx tools/exportRig.ts scout <file>
  new-horse.json:    blender --background --factory-startup --python tools/blender/horse.py -- <file>
  light-horse.json:  the same with --tris 0.38
"""
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
old_path, new_path, light_path, out_path = sys.argv[1:5]
t = open(os.path.join(here, 'horse-review.template.html'), encoding='utf8').read()
gait = open(os.path.join(here, 'horse-gait.cjs'), encoding='utf8').read()
gait = gait.replace("if (typeof module !== 'undefined') module.exports = { GAITS, makeHorseGait };", '')
html = t.replace('%%GAIT%%', gait).replace('%%OLD%%', open(old_path, encoding='utf8').read()).replace('%%NEW%%', open(new_path, encoding='utf8').read()).replace('%%LIGHT%%', open(light_path, encoding='utf8').read())
open(out_path, 'w', encoding='utf8').write(html)
print(f'{out_path}: {len(html)} bytes')
