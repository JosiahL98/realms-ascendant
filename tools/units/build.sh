#!/usr/bin/env bash
# Builds the game's new unit models and their baked animation clips.
#   BLENDER=/path/to/blender tools/units/build.sh <work-dir>
# Blender exports the light (game) versions into <work-dir>; the baker writes public/units/*.json.
set -euo pipefail
B="${BLENDER:-blender}"
OUT="$1"
mkdir -p "$OUT"
run() { local log; log="$OUT/log_$(echo "$*" | md5sum | cut -c1-10).log"   # one log per job: the jobs run in parallel
  "$B" --background --factory-startup --python "$@" > "$log" 2>&1 || { echo "FAILED: $*"; tail -n 30 "$log"; exit 1; }; }
run tools/blender/human.py -- male "$OUT/villager_m.json" --tris 0.38 &
run tools/blender/human.py -- female "$OUT/villager_f.json" --tris 0.38 &
run tools/blender/horse.py -- "$OUT/horse.json" &
run tools/blender/horse.py -- "$OUT/horse_light.json" --tris 0.38 &
wait
# units listed in one of equipment.py's tables (KITS or RIDER_KITS)
kits() { awk "/^$1 = \{/{f=1;next} /^\}/{f=0} f" tools/blender/equipment.py | grep -oE "^    '[a-zA-Z]+': dict" | sed "s/    '//; s/': dict//"; }
# other mounts: full detail to fit riders and tack to, light for the game
for m in camel elephant; do
  run tools/blender/quadruped.py -- $m "$OUT/mount_$m.json" &
  run tools/blender/quadruped.py -- $m "$OUT/mount_${m}_light.json" --tris 0.38 &
done
wait
# horsemen (and camel and elephant riders): rider and tack fitted to the full-detail mount, dressed per unit
# (equipment.RIDER_KITS)
for u in $(kits RIDER_KITS); do
  m=$(grep -E "^    '$u': dict" tools/blender/equipment.py | grep -oE "mount='[a-z]+'" | cut -d"'" -f2 || true)
  mount="$OUT/horse.json"; [ -n "$m" ] && mount="$OUT/mount_$m.json"
  run tools/blender/rider.py -- "$mount" "$OUT/cav_$u.json" kit=$u --tris 0.38 &
  while [ "$(jobs -r | wc -l)" -ge 6 ]; do sleep 1; done
done
wait
# animals (tools/blender/quadruped.py)
for a in sheep deer boar wolf; do run tools/blender/quadruped.py -- $a "$OUT/animal_$a.json" --tris 0.38 & done
wait
# siege engines and the trade cart (tools/blender/siege.py; the cart's collar is fitted to the full-detail horse)
for u in ram cappedRam siegeRam mangonel onager siegeOnager scorpion heavyScorpion bombard trebuchet; do
  run tools/blender/siege.py -- $u "$OUT/siege_$u.json" &
done
run tools/blender/siege.py -- tradeCart "$OUT/siege_tradeCart.json" horse="$OUT/horse.json" &
wait
# ships (tools/blender/ship.py)
for u in fishingShip transportShip tradeCog galley warGalley galleon fireShip fastFireShip demolitionShip heavyDemolitionShip cannonGalleon; do
  run tools/blender/ship.py -- $u "$OUT/ship_$u.json" &
  while [ "$(jobs -r | wc -l)" -ge 6 ]; do sleep 1; done
done
wait
# foot soldiers, archers and the priest: the villager's body with each unit's kit (tools/blender/equipment.py)
for u in $(kits KITS); do
  run tools/blender/human.py -- male "$OUT/kit_$u.json" kit=$u --tris 0.38 &
  while [ "$(jobs -r | wc -l)" -ge 6 ]; do sleep 1; done
done
wait
node tools/units/bake.cjs "$OUT" public/units
