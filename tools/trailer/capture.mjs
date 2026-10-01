// Deterministic, frame-by-frame captures of the actual game renderer and simulation.
// Usage: node tools/trailer/capture.mjs [--preview] [--scene intro|fleet|latins|gauls|han|town|siege|battle|end]
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';

const OUT = resolve('output/trailer');
const preview = process.argv.includes('--preview');
const chosen = process.argv.includes('--scene') ? process.argv[process.argv.indexOf('--scene') + 1] : null;
const W = 1920, H = 1080, FPS = 30, port = 5183;
mkdirSync(`${OUT}/work`, { recursive: true });
const scenes = [
  { id: 'intro', duration: 10, art: true },
  { id: 'fleet', duration: 4, map: 'mediterranean', civs: 'carthaginians,hellenes', color: 4, zoom: 86, tag: 'THE PUNIC THALASSOCRACY', title: 'CARTHAGE RULES THE SEA.' },
  { id: 'latins', duration: 4, map: 'steppe', civs: 'latins,carthaginians', color: 1, zoom: 73, tag: 'THE ALPINE REPUBLIC', title: 'ROME’S HEIRS REMEMBER.' },
  { id: 'gauls', duration: 4, map: 'forest', civs: 'gauls,suebi', color: 2, zoom: 96, tag: 'THE HIGH KINGDOM OF THE OAK', title: 'GAUL NEVER BOWED.' },
  { id: 'han', duration: 4, map: 'steppe', civs: 'han,parthians', color: 1, zoom: 115, tag: 'THE JADE MANDATE', title: 'THE EAST BRINGS FIRE.' },
  { id: 'town', duration: 4, map: 'steppe', civs: 'carthaginians,gauls', color: 4, zoom: 72, tag: 'GATHER · BUILD · ADVANCE', title: 'RAISE YOUR REALM.' },
  { id: 'siege', duration: 4, map: 'steppe', civs: 'carthaginians,latins', color: 4, zoom: 99, tag: 'ELEPHANTS. SIEGE ENGINES. AMBITION.', title: 'BREAK THEIR EMPIRE.' },
  { id: 'battle', duration: 6, map: 'steppe', civs: 'carthaginians,latins', color: 4, zoom: 103, tag: 'EIGHT REALMS. A WORLD WITHOUT ROME.', title: 'ONLY ONE WILL BE ASCENDANT.' },
  { id: 'end', duration: 6, art: true },
];
writeFileSync(`${OUT}/work/scenes.json`, JSON.stringify(scenes, null, 2));

const server = spawn(process.execPath, ['-e', `import('vite').then(async ({createServer})=>{const s=await createServer({server:{host:'127.0.0.1',port:${port},strictPort:true,hmr:false}});await s.listen();s.printUrls()})`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let browser;
try {
  await new Promise((res, rej) => {
    const timeout = setTimeout(() => rej(new Error('Vite timeout')), 30000);
    server.stdout.on('data', d => { if (String(d).includes('Local')) { clearTimeout(timeout); res(); } });
    server.stderr.on('data', d => process.stderr.write(d));
    server.once('exit', c => { clearTimeout(timeout); rej(new Error(`Vite exit ${c}`)); });
  });
  browser = await chromium.launch({ channel: 'chrome', headless: true,
    args: ['--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-background-timer-throttling'] });
  for (const scene of scenes.filter(s => !chosen || s.id === chosen)) {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
    const errors = [];
    page.on('pageerror', e => errors.push(e.stack));
    const query = scene.art ? '' : `?autostart=1&size=120&seed=23751&map=${scene.map}&civs=${scene.civs}&age=3&reveal=all&speed=0&quality=medium`;
    await page.goto(`http://127.0.0.1:${port}/${query}`);
    if (!scene.art) await page.waitForFunction(() => window.__ready, null, { timeout: 90000 });
    await page.evaluate(async ({ scene, W, H }) => {
      const { CIVS, CIV_LIST } = await import('/src/data/civs.ts');
      const { civEmblem } = await import('/src/ui/icons.ts');
      const { PLAYER_COLORS } = await import('/src/sim/player.ts');
      const { TerrainView } = await import('/src/render/terrainView.ts');
      const s = window.__session;
      let r, g, unitIds = [], clocks = 0;
      window.__filmClock = 0;
      if (s) {
        cancelAnimationFrame(s.raf);
        s.audio.stopMusic();
        s.speed = 0; s.ais.length = 0;
        r = s.renderer; g = s.game;
        r.setViewTeam(-1); r.selectedIds.clear();
        g.players[1].color = PLAYER_COLORS[scene.color===4?5:scene.color];
        g.players[2].color = PLAYER_COLORS[scene.id === 'han' ? 7 : 1];
        r.dyes.clear();
        r.gl.toneMappingExposure=1.17;
        s.viewAll=true;
        for (const u of [...g.units]) g.killUnit(u, 0);
        // Staging the units/buildings changes only this capture's in-memory match.
        for (const b of g.buildings) { b.alive = false; g.map.setObstacle(b.tx, b.tz, b.w, b.h, 0); }
        g.buildings.length = 0; g.buildingsVersion++;
        const clear = (x,z,w,h) => {
          for (const p of [...g.resources]) if (p.x > x && p.x < x+w && p.z > z && p.z < z+h) g.removeResource(p);
        };
        if (scene.id === 'gauls') clear(49,49,24,24);
        else if (scene.id !== 'fleet') clear(38, 38, 46, 46);
        if(scene.id!=='fleet'){
          // Dry staging ground prevents decorative low-lying pools under buildings.
          for(let z=38;z<=84;z++)for(let x=38;x<=84;x++){
            const i=z*(g.map.n+1)+x;g.map.heights[i]=Math.max(.24,g.map.heights[i]);
          }
          const textures=r.terrain.terrainTex;
          r.scene.remove(r.terrain.mesh,r.terrain.water);
          r.terrain=new TerrainView(g.map,textures);r.scene.add(r.terrain.mesh,r.terrain.water);
        }
        g.events.length = 0; g.map.refreshAll();
        const building = (type, owner, x, z) => g.createBuilding(type, owner, x, z, true);
        const army = (type, owner, count, x, z, cols, spacing=0.95, dest=null) => {
          const ids = [];
          for (let i=0;i<count;i++) {
            const u = g.spawnUnit(type, owner, x + Math.floor(i/cols)*spacing, z+(i%cols)*spacing);
            u.facing = u.pfacing = owner===1 ? Math.PI/2 : -Math.PI/2;
            if (dest) u.order = {t:'move', x:dest[0] + Math.floor(i/cols)*spacing, z:dest[1]+(i%cols)*spacing, attackMove:scene.id==='han'||scene.id==='battle'||scene.id==='siege'};
            ids.push(u.id);
          }
          unitIds.push(...ids); return ids;
        };
        let cx=60, cz=60;
        if (scene.id==='fleet') {
          army('warGalley',1,12,52,52,4,2.3,[66,55]);
          army('fireShip',1,6,49,57,3,2.5,[63,60]);
          army('tradeCog',1,3,49,50,3,2.7,[64,50]);
          cx=59; cz=58;
        } else if (scene.id==='latins') {
          building('castle',1,54,49); building('townCenter',1,65,48);
          building('barracks',1,47,49); building('blacksmith',1,61,47);
          for(let x=45;x<75;x++) if(x<57||x>60) building('stoneWall',1,x,44);
          building('guardTower',1,45,44); building('guardTower',1,73,44);
          army('legionary',1,42,51,59,7,0.9,[57,61]);
          army('scorpion',1,4,49,58,2,1.6,[54,59]); cx=59; cz=54;
        } else if (scene.id==='gauls') {
          // Keep woodland framing the formation and show the natural forest trails.
          for (let i=0;i<32;i++) {
            const angle=i*2.399, rad=10+(i%5)*0.8;
            const tx=Math.floor(60+Math.cos(angle)*rad), tz=Math.floor(60+Math.sin(angle)*rad);
            if(!g.map.obstacle[g.map.idx(tx,tz)]) g.addResource('tree','wood',100,tx,tz,true);
          }
          army('gaesatae',1,32,54,54,8,0.9,[61,57]);
          army('champion',1,16,51,55,8,1,[58,58]);
          army('mangonel',1,3,49,54,3,2,[56,57]); cx=59; cz=59;
        } else if (scene.id==='han') {
          building('castle',1,48,45); building('archeryRange',1,44,50);
          army('fireLancer',1,30,55,55,10,0.72,[63,55]);
          army('berserker',2,35,62,55,10,0.75,[55,55]);
          army('crossbowman',1,10,52,56,10,0.72,[59,56]); cx=60; cz=59;
        } else if (scene.id==='town') {
          building('townCenter',1,57,56); building('castle',1,64,44);
          building('market',1,49,54); building('monastery',1,53,47);
          building('stable',1,65,53); building('blacksmith',1,64,61);
          for (const [x,z] of [[49,47],[47,61],[51,64],[58,47],[68,59],[70,51]]) building('house',1,x,z);
          for (const [x,z] of [[54,63],[58,64],[61,68],[54,68],[48,69]]) {
            const f=building('farm',1,x,z); const ids=army('villager',1,1,x+1,z+1,1); g.get(ids[0]).order={t:'gather',target:f.id};
          }
          const site=g.createBuilding('university',1,66,67,false);
          for(const id of army('villager',1,6,65,71,3,0.6)) g.get(id).order={t:'build',target:site.id};
          army('knight',1,6,62,54,3,1.2,[61,64]);
          army('tradeCart',1,3,50,58,3,1.4,[63,60]); cx=59;cz=59;
        } else if (scene.id==='siege') {
          const fort=building('castle',2,63,53); fort.hp=fort.stats.hp*.34;
          building('barracks',2,69,50);
          for(let z=49;z<67;z++) if(z<56||z>59) building('stoneWall',2,62,z);
          army('legionary',2,20,60,54,8,0.8,[55,56]);
          army('warElephant',1,6,53,52,3,2.1,[63,55]);
          army('longSwordsman',1,24,53,56,8,0.85,[63,56]);
          const siege=army('trebuchet',1,3,49,54,3,3.3);
          for (const id of siege) { const u=g.get(id);u.packed=false;u.order={t:'attack',target:fort.id}; }
          cx=59;cz=57;
        } else if (scene.id==='battle') {
          army('warElephant',1,8,54,51,4,2,[64,51]);
          army('knight',1,16,51,63,8,1.05,[65,61]);
          army('longSwordsman',1,32,53,56,8,.77,[64,56]);
          army('crossbowman',1,20,49,54,10,.8,[60,54]);
          army('legionary',2,42,63,52,10,.8,[53,52]);
          army('pikeman',2,24,62,62,8,.85,[53,61]);
          army('arbalest',2,20,68,55,10,.8,[59,55]);
          army('mangonel',2,3,71,55,3,2);
          cx=61;cz=59;
        }
        g.map.refreshAll(); g.vision.update(true); g.events.length=0;
        g.recomputePop(1);g.recomputePop(2);
        window.__cameraBase={cx,cz};
        Object.defineProperty(performance,'now',{value:()=>window.__filmClock*1000+10000,configurable:true});
        r.lastFrame=10000;
        // Warm the real simulation so marching and combat are already moving at the cut.
        for(let i=0;i<(scene.id==='battle'?60:scene.id==='han'?25:10);i++)g.step();
        s.processEvents();
        r.zoom=scene.zoom;r.centerOn(cx,cz);r.render(1);
      }
      const style = document.createElement('style');
      style.textContent = `
        #hud,#overlay,#vignette,#menu-root{display:none!important}body{background:#080b0b!important}
        #film{position:fixed;inset:0;z-index:10000;color:#f8eedb;pointer-events:none;font-family:Cinzel,serif;overflow:hidden}
        #film .art{position:absolute;inset:-2%;width:104%;height:104%;object-fit:cover;transform-origin:60% 50%}
        .shade{position:absolute;inset:0;background:linear-gradient(180deg,#04070760 0%,transparent 32%,transparent 60%,#030707c9 100%)}
        .letterbox{position:absolute;left:0;right:0;height:64px;background:#070909}.letterbox.bottom{bottom:0}.letterbox.top{top:0}
        .copy{position:absolute;left:112px;right:112px;bottom:116px;text-shadow:0 3px 16px #000,0 1px 2px #000}
        .eyebrow{color:#e5be76;font:600 21px/1.4 Arial,sans-serif;letter-spacing:5px;margin-bottom:18px}
        .rule{width:76px;height:3px;background:#d7ad65;margin-bottom:23px}
        .headline{font-size:54px;line-height:1.18;font-weight:700;letter-spacing:1px}
        .counter{position:absolute;right:112px;top:92px;font:14px Arial;letter-spacing:3px;color:#e5d6b6;opacity:.65}
        .artcopy{left:132px;top:150px;bottom:auto}.artcopy .headline{font-size:91px;line-height:1.15;max-width:1510px}.artcopy .eyebrow{font-size:24px}
        .center{top:245px;bottom:auto;text-align:center}.center .rule{margin:0 auto 30px}.center .headline{font-size:100px;letter-spacing:8px;line-height:1.07}
        .subtitle{margin-top:25px;color:#dcb978;font-size:27px;letter-spacing:9px}
        .tagline{font:italic 31px 'EB Garamond',serif;letter-spacing:1px;margin-top:36px;color:#ebdec4}
        .cta{font:600 21px Arial;letter-spacing:4px;margin-top:38px;color:#fff3d4}.url{font:18px Arial;letter-spacing:1px;color:#c8bb9f;margin-top:17px}
        #emblems{display:flex;justify-content:center;gap:26px;margin-top:34px}#emblems svg{width:52px;height:52px;filter:drop-shadow(0 2px 5px #000)}
        #particles{position:absolute;inset:0}.fine{position:absolute;bottom:24px;left:112px;font:12px Arial;letter-spacing:3px;color:#8f897b}
      `;
      document.head.append(style);
      const film=document.createElement('div');film.id='film';
      film.innerHTML=`${scene.art?'<img class="art" src="/tools/trailer/assets/rome-burns.png">':''}<div class="shade"></div><canvas id="particles" width="1920" height="1080"></canvas><div class="letterbox top"></div><div class="letterbox bottom"></div><div class="counter">REALMS ASCENDANT / THE PUNIC CENTURIES</div><div class="copy"><div class="rule"></div><div class="eyebrow"></div><div class="headline"></div></div>`;
      document.body.append(film);
      const art=film.querySelector('.art');if(art)await art.decode();
      const copy=film.querySelector('.copy'),head=film.querySelector('.headline'),tag=film.querySelector('.eyebrow');
      if(scene.id==='end'){
        copy.classList.add('center');tag.textContent='HISTORY BROKE. YOUR REALM RISES.';
        head.innerHTML='REALMS<br>ASCENDANT';
        copy.insertAdjacentHTML('beforeend',`<div class="subtitle">THE PUNIC CENTURIES</div><div id="emblems">${CIV_LIST.map(c=>civEmblem(c)).join('')}</div><div class="cta">PLAY FREE IN YOUR BROWSER</div><div class="url">josiahl98.github.io/realms-ascendant</div>`);
        film.querySelector('.shade').style.background='linear-gradient(180deg,#040909cb,#040909e8)';
        film.querySelector('.counter').style.display='none';
      }else if(scene.id==='intro'){copy.classList.add('artcopy');film.querySelector('.counter').style.display='none';}
      else {head.textContent=scene.title;tag.textContent=scene.tag;}
      await document.fonts.ready;
      const clamp=v=>Math.max(0,Math.min(1,v));
      const ctx=film.querySelector('canvas').getContext('2d');
      window.__drawFilm = t => {
        window.__filmClock=t;
        if(g){
          const target=Math.floor(t*20*(scene.id==='town'?3:1));
          while(clocks<target){g.step();s.processEvents();clocks++;}
          s.ambientFx(1/30);
          const q=t/scene.duration, {cx,cz}=window.__cameraBase;
          const a=Math.PI/4+(q-.5)*.095;
          r.camDir.set(Math.cos(Math.PI/6)*Math.sin(a),.5,Math.cos(Math.PI/6)*Math.cos(a));
          r.zoom=scene.zoom*(1+q*(scene.id==='battle'?-.13:.07));
          r.centerOn(cx+(q-.5)*1.8,cz+(q-.5)*.7);
          r.render((t*20)%1);
        }
        if(art) art.style.transform=`scale(${1.015+t*.006}) translate(${t*-.13}%,${t*.05}%)`;
        let opacity=1;
        if(scene.id==='intro'){
          const part=t<3.5?0:t<7?1:2,local=t-[0,3.5,7][part];
          tag.textContent=['AN ALTERNATE HISTORY · 216 BC','THE MOMENT THAT CHANGED EVERYTHING','A WORLD THAT NEVER KNEW ROME'][part];
          head.innerHTML=['HANNIBAL MARCHES<br>ON ROME.','ROME BURNS.<br>HISTORY BREAKS.','TWELVE CENTURIES<br>LATER…'][part];
          opacity=clamp(local/.4)*clamp(([3.5,3.5,3][part]-local)/.3);
          film.style.opacity=String(clamp(t/.8));
        }else if(scene.id==='end'){
          opacity=clamp(t/.6)*clamp((scene.duration-t)/.65);
          film.style.opacity=String(clamp((scene.duration-t)/.65));
        }
        else opacity=clamp((t-.15)/.4)*clamp((scene.duration-t)/.25);
        copy.style.opacity=String(opacity);copy.style.transform=`translateY(${(1-clamp(t/.6))*13}px)`;
        ctx.clearRect(0,0,W,H);
        if(scene.art){
          for(let i=0;i<100;i++){
            const x=(i*419.31+Math.sin(t*.4+i)*40+t*(8+i%7))%W;
            const y=H-((i*71.19+t*(22+i%20))%(H+150));
            ctx.fillStyle=`rgba(255,${130+i%80},48,${.12+(i%7)*.055})`;ctx.fillRect(x,y,i%3+1,i%4+1);
          }
        }
      };
      window.__drawFilm(0);
    }, { scene, W, H });
    await page.waitForTimeout(200);
    if (preview) {
      await page.evaluate(t=>window.__drawFilm(t), scene.duration/2);
      await page.screenshot({ path: `${OUT}/work/${scene.id}-preview.jpg`, type: 'jpeg', quality: 92 });
      console.log(`Preview ${scene.id}`);
    } else {
      const ff = spawn('ffmpeg', ['-hide_banner','-loglevel','warning','-y','-f','image2pipe','-vcodec','mjpeg','-framerate',String(FPS),'-i','pipe:0','-an','-c:v','libx264','-preset','fast','-crf','18','-pix_fmt','yuv420p','-r',String(FPS),'-movflags','+faststart',`${OUT}/work/${scene.id}.mp4`],{stdio:['pipe','ignore','pipe'],windowsHide:true});
      let ffErrors=''; ff.stderr.on('data',d=>ffErrors+=String(d));
      const done=once(ff,'close');
      for(let frame=0;frame<scene.duration*FPS;frame++){
        await page.evaluate(t=>window.__drawFilm(t),frame/FPS);
        const jpg=await page.screenshot({type:'jpeg',quality:93});
        if(!ff.stdin.write(jpg))await once(ff.stdin,'drain');
        if(frame===Math.round(scene.duration*FPS/2))writeFileSync(`${OUT}/work/${scene.id}-preview.jpg`,jpg);
        if(frame%60===0)console.log(`${scene.id}: ${frame}/${scene.duration*FPS}`);
      }
      ff.stdin.end();const [code]=await done;if(code!==0)throw new Error(ffErrors);
      console.log(`Encoded ${scene.id}`);
    }
    if(errors.length)throw new Error(errors.join('\n'));
    await page.close();
  }
}finally{await browser?.close();server.kill();}
