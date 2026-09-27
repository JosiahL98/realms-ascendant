"""
Builds the villager work review page (part 2: jobs, tool holds, fighting, dying).
Usage: python tools/review/assemble_villager_work.py <new-m.json> <new-f.json> <new-m-light.json> <new-f-light.json> <notes.html> <out.html>
  new-*.json: blender --background --factory-startup --python tools/blender/human.py -- male|female <file> [--tris 0.38]
  notes.html: the <li> items for the "About these animations" list
"""
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
new_m, new_f, new_ml, new_fl, notes, out = sys.argv[1:7]
read = lambda p: open(p, encoding='utf8').read()
t = read(os.path.join(here, 'villager-work-review.template.html'))
pose = read(os.path.join(here, 'human-pose.cjs')).replace("if (typeof module !== 'undefined') module.exports = { makeHumanPose };", '')
for key, path in (('%%NEW_M%%', new_m), ('%%NEW_F%%', new_f), ('%%NEW_M_LIGHT%%', new_ml), ('%%NEW_F_LIGHT%%', new_fl),
                  ('%%NOTES%%', notes)):
    t = t.replace(key, read(path))
t = t.replace('%%HUMANPOSE%%', pose)
open(out, 'w', encoding='utf8').write(t)
print(f'{out}: {len(t)} bytes')
