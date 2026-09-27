"""
Builds the cavalryman review page.
Usage: python tools/review/assemble_cavalry.py <current-rig.json> <horse.json> <horse-light.json> <rider.json> <rider-light.json> <out.html>
  horse*.json: tools/blender/horse.py (light: --tris 0.38); rider*.json: tools/blender/rider.py (light: --tris 0.38)
"""
import os
import sys

here = os.path.dirname(os.path.abspath(__file__))
old, horse, horse_light, rider, rider_light, out = sys.argv[1:7]
read = lambda p: open(p, encoding='utf8').read()
t = read(os.path.join(here, 'cavalry-review.template.html'))
gait = read(os.path.join(here, 'horse-gait.cjs')).replace("if (typeof module !== 'undefined') module.exports = { GAITS, makeHorseGait };", '')
for key, path in (('%%OLD%%', old), ('%%HORSE%%', horse), ('%%HORSE_LIGHT%%', horse_light), ('%%RIDER%%', rider), ('%%RIDER_LIGHT%%', rider_light)):
    t = t.replace(key, read(path))
t = t.replace('%%GAIT%%', gait)
open(out, 'w', encoding='utf8').write(t)
print(f'{out}: {len(t)} bytes')
