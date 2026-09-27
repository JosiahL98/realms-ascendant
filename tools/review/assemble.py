import sys
sp = sys.argv[1]
t = open(sp + '/review2_template.html', encoding='utf8').read()
gait = open(sp + '/gait.js', encoding='utf8').read().replace("if (typeof module !== 'undefined') module.exports = { GAITS, makeHorseGait };", '')
old = open(sp + '/scout_rig.json', encoding='utf8').read()
new = open(sp + '/horse2.json', encoding='utf8').read()
html = t.replace('%%GAIT%%', gait).replace('%%OLD%%', old).replace('%%NEW%%', new)
open(sp + '/horse-review.html', 'w', encoding='utf8').write(html)
open(sp + '/horse-review-local.html', 'w', encoding='utf8').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body style="margin:0">' + html + '</body></html>')
print(len(html))
