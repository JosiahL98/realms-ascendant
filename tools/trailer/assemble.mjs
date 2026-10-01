// Assemble the frame-accurate edit and master the original score into a shareable MP4.
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const work = resolve('output/trailer/work');
const scenes = JSON.parse(readFileSync(`${work}/scenes.json`, 'utf8'));
writeFileSync(`${work}/edit.txt`, scenes.map(s => `file '${s.id}.mp4'`).join('\n') + '\n');
const out = resolve('output/trailer/realms-ascendant-trailer.mp4');
const measurement=spawnSync('ffmpeg',['-hide_banner','-i',`${work}/score.wav`,'-af','loudnorm=I=-15:TP=-2:LRA=9:print_format=json','-f','null','-'],{encoding:'utf8',windowsHide:true});
if(measurement.status!==0)throw new Error(String(measurement.error??measurement.stderr));
const levels=JSON.parse(measurement.stderr.match(/\{[\s\S]*\}/)[0]);
const mastering=`loudnorm=I=-15:TP=-2:LRA=9:measured_I=${levels.input_i}:measured_TP=${levels.input_tp}:measured_LRA=${levels.input_lra}:measured_thresh=${levels.input_thresh}:offset=${levels.target_offset}:linear=true`;
function run(args) {
  const r=spawnSync('ffmpeg',['-hide_banner','-y',...args],{stdio:'inherit',windowsHide:true});
  if(r.status!==0)throw new Error(`FFmpeg exited ${r.status}`);
}
run(['-loglevel','warning','-f','concat','-safe','0','-i',`${work}/edit.txt`,'-i',`${work}/score.wav`,
  '-map','0:v:0','-map','1:a:0','-c:v','libx264','-preset','slow','-crf','22','-maxrate','10M','-bufsize','20M',
  '-vf','scale=in_range=pc:out_range=tv,format=yuv420p','-pix_fmt','yuv420p','-color_range','tv','-af',mastering,
  '-c:a','aac','-b:a','256k','-ar','48000','-t','46','-movflags','+faststart',
  '-metadata','title=Realms Ascendant — The Punic Centuries',
  '-metadata','comment=Alternate-history strategy game trailer. Staged in-engine footage; original synthesized score; AI-generated opening illustration.',out]);
run(['-loglevel','warning','-ss','42','-i',out,'-frames:v','1','-update','1',resolve('output/trailer/realms-ascendant-poster.jpg')]);
copyFileSync(new URL('./watch.html',import.meta.url),resolve('output/trailer/watch.html'));
console.log(`Saved ${out}`);
