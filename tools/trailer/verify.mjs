// Check exported codecs, decode integrity and actual browser playback/seeking.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const video=resolve('output/trailer/realms-ascendant-trailer.mp4');
const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',video],{encoding:'utf8',windowsHide:true});
assert.equal(probe.status,0,probe.stderr);
const metadata=JSON.parse(probe.stdout);
const v=metadata.streams.find(s=>s.codec_type==='video'),a=metadata.streams.find(s=>s.codec_type==='audio');
assert.equal(v.codec_name,'h264');assert.equal(v.width,1920);assert.equal(v.height,1080);assert.equal(v.avg_frame_rate,'30/1');
assert.equal(v.pix_fmt,'yuv420p');assert.equal(a.codec_name,'aac');assert.equal(a.channels,2);
assert.ok(Math.abs(Number(metadata.format.duration)-46)<.05);
const decode=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-xerror','-i',video,'-f','null','-'],{encoding:'utf8',windowsHide:true});
assert.equal(decode.status,0,decode.stderr);
const audioCheck=spawnSync('ffmpeg',['-hide_banner','-i',video,'-af','loudnorm=I=-15:TP=-2:LRA=9:print_format=json','-vn','-f','null','-'],{encoding:'utf8',windowsHide:true});
assert.equal(audioCheck.status,0,audioCheck.stderr);
const levels=JSON.parse(audioCheck.stderr.match(/\{[\s\S]*\}/)[0]);
assert.ok(Math.abs(Number(levels.input_i)+15)<1,'Audio loudness stays near the master target');
assert.ok(Number(levels.input_tp)<=-1,'AAC audio retains true-peak headroom');
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--allow-file-access-from-files']});
try{
  for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    const page=await browser.newPage({viewport});
    await page.goto(pathToFileURL(resolve('output/trailer/watch.html')).href);
    await page.waitForFunction(()=>document.querySelector('video').readyState>=2);
    const result=await page.evaluate(async()=>{
      const v=document.querySelector('video');v.muted=true;
      await v.play();
      const deadline=performance.now()+10000;
      while(v.currentTime<.4 && performance.now()<deadline)await new Promise(r=>setTimeout(r,50));
      v.pause();
      const played=v.currentTime;
      const samples=[];
      const c=document.createElement('canvas');c.width=160;c.height=90;
      const ctx=c.getContext('2d',{willReadFrequently:true});
      for(const time of [0,1.5,5,8,12,16,20,24,28,32,37,42,45.95]){
        await new Promise((resolve,reject)=>{v.addEventListener('seeked',resolve,{once:true});v.addEventListener('error',reject,{once:true});v.currentTime=time;});
        ctx.drawImage(v,0,0,160,90);const pixels=ctx.getImageData(0,0,160,90).data;
        let sum=0;for(let i=0;i<pixels.length;i+=4)sum+=(pixels[i]+pixels[i+1]+pixels[i+2])/3;
        samples.push({time,brightness:sum/(160*90)});
      }
      const rect=v.getBoundingClientRect();
      return {played,samples,error:v.error?.message??null,width:v.videoWidth,height:v.videoHeight,fits:rect.left>=0&&rect.right<=innerWidth};
    });
    assert.equal(result.error,null);assert.ok(result.played>.15,`Playback advanced to ${result.played}s`);assert.ok(result.fits);
    assert.ok(result.samples[0].brightness<15,'Opening fades from a dark frame');
    assert.ok(result.samples.at(-1).brightness<20,'Closing fades to a dark frame');
    for(const frame of result.samples.slice(1,-1))assert.ok(frame.brightness>15,`Nonblank scene at ${frame.time}s`);
    console.log(`PASS browser playback and 13 scene seeks at ${viewport.width}x${viewport.height}`);
    await page.close();
  }
}finally{await browser.close()}
console.log(`PASS full decode; 46 seconds; 1080p30 H.264 + stereo AAC; ${(Number(metadata.format.size)/1024/1024).toFixed(1)} MiB`);
console.log(`PASS audio master: ${levels.input_i} LUFS, ${levels.input_tp} dBTP`);
