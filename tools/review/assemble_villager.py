"""
Builds the villager review page.
Usage: python tools/review/assemble_villager.py <old-m.json> <old-f.json> <new-m.json> <new-f.json> <new-m-light.json> <new-f-light.json> <out.html>
  old-*.json: npx tsx tools/exportRig.ts villager|villagerF <file>
  new-*.json: blender --background --factory-startup --python tools/blender/human.py -- male|female <file> [--tris 0.38]
"""
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
old_m, old_f, new_m, new_f, new_ml, new_fl, out = sys.argv[1:8]
read = lambda p: open(p, encoding='utf8').read()
t = read(os.path.join(here, 'villager-review.template.html'))
pose = read(os.path.join(here, 'human-pose.cjs')).replace("if (typeof module !== 'undefined') module.exports = { makeHumanPose };", '')
for key, path in (('%%OLD_M%%', old_m), ('%%OLD_F%%', old_f), ('%%NEW_M%%', new_m), ('%%NEW_F%%', new_f),
                  ('%%NEW_M_LIGHT%%', new_ml), ('%%NEW_F_LIGHT%%', new_fl)):
    t = t.replace(key, read(path))
t = t.replace('%%HUMANPOSE%%', pose)
open(out, 'w', encoding='utf8').write(t)
print(f'{out}: {len(t)} bytes')
