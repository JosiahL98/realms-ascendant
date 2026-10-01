// Assemble the frame-accurate edit and master the original score into a shareable MP4.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const work = resolve('output/trailer/work');
const scenes = JSON.parse(readFileSync(`${work}/scenes.json`, 'utf8'));
writeFileSync(`${work}/edit.txt`, scenes.map(s => `file '${s.id}.mp4'`).join('\n') + '\n');
const out = resolve('output/trailer/realms-ascendant-trailer.mp4');
function run(args) {
  const r=spawnSync('ffmpeg',['-hide_banner','-y',...args],{stdio:'inherit',windowsHide:true});
  if(r.status!==0)throw new Error(`FFmpeg exited ${r.status}`);
}
run(['-loglevel','warning','-f','concat','-safe','0','-i',`${work}/edit.txt`,'-i',`${work}/score.wav`,
  '-map','0:v:0','-map','1:a:0','-c:v','copy','-af','loudnorm=I=-15:TP=-1.2:LRA=9',
  '-c:a','aac','-b:a','256k','-ar','48000','-t','46','-movflags','+faststart',
  '-metadata','title=Realms Ascendant — The Punic Centuries',
  '-metadata','comment=Alternate-history strategy game trailer. Staged in-engine footage; original synthesized score; AI-generated opening illustration.',out]);
run(['-loglevel','warning','-ss','42','-i',out,'-frames:v','1','-update','1',resolve('output/trailer/realms-ascendant-poster.jpg')]);
console.log(`Saved ${out}`);
