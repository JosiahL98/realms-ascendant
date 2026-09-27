#!/usr/bin/env bash
# Builds the game's new unit models and their baked animation clips.
#   BLENDER=/path/to/blender tools/units/build.sh <work-dir>
# Blender exports the light (game) versions into <work-dir>; the baker writes public/units/*.json.
set -euo pipefail
B="${BLENDER:-blender}"
OUT="$1"
mkdir -p "$OUT"
run() { "$B" --background --factory-startup --python "$@" > "$OUT/blender.log" 2>&1 || { tail -n 30 "$OUT/blender.log"; exit 1; }; }
run tools/blender/human.py -- male "$OUT/villager_m.json" --tris 0.38 &
run tools/blender/human.py -- female "$OUT/villager_f.json" --tris 0.38 &
run tools/blender/horse.py -- "$OUT/horse.json" &
run tools/blender/horse.py -- "$OUT/horse_light.json" --tris 0.38 &
wait
# the tack is fitted to the full-detail horse
run tools/blender/rider.py -- "$OUT/horse.json" "$OUT/rider_light.json" --tris 0.38
# foot soldiers, archers and the priest: the villager's body with each unit's kit (tools/blender/equipment.py)
for u in $(grep -oE "^    '[a-zA-Z]+': dict" tools/blender/equipment.py | sed "s/    '//; s/': dict//"); do
  run tools/blender/human.py -- male "$OUT/kit_$u.json" kit=$u --tris 0.38 &
  while [ "$(jobs -r | wc -l)" -ge 6 ]; do sleep 1; done
done
wait
node tools/units/bake.cjs "$OUT" public/units
