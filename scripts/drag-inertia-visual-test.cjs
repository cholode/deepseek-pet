const {chromium}=require('playwright'),{build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),sharp=require('sharp'),assert=require('node:assert/strict');

(async()=>{
 const dir=path.resolve('test-results/drag-inertia-v2');await fs.mkdir(dir,{recursive:true});
 const motion=JSON.parse(await fs.readFile('resources/builtin/motions/drag_held.json','utf8'));
 const assets=Object.fromEntries(motion.parts.map(p=>[p.image,'/'+p.image]));
 const bundle=await build({stdin:{contents:`
 import {Avatar} from './src/renderer/pet/Avatar';
 import {defaults,makeCatalog} from './src/shared/schema';
 import {ActionGroupRunner} from './src/renderer/pet/engine';
 import motion from './resources/builtin/motions/drag_held.json';
 import group from './resources/builtin/groups/drag_held.json';
 const catalog=makeCatalog({revision:1,packs:[{manifest:{schemaVersion:1,id:'builtin.deepblue',name:'test',version:'1',avatarId:'deepblue-chibi-v1',description:'',motions:['motion.json'],groups:['group.json']},motions:[motion],groups:[group],assets:${JSON.stringify(assets)}}]});
 window.viewportRequests=[];window.pet={setViewport:async v=>{viewportRequests.push(v);}};
 window.start=async()=>{
  window.avatar=new Avatar(()=>({...defaults,size:1}),message=>{throw Error(message)});
  await avatar.init(document.body,catalog);avatar.app.ticker.stop();
  window.begin=()=>{window.done=false;window.runner=new ActionGroupRunner(catalog.groups.get('builtin.deepblue:drag_held'),'preview','system',catalog,avatar,()=>window.done=true);runner.tick(0);};
  window.draw=()=>{avatar.app.renderer.render(avatar.app.stage);return avatar.app.canvas.toDataURL('image/png').split(',')[1];};
  window.sample=(x,timeMs)=>avatar.setDragState({dragging:true,visible:true,suspended:false,dragSample:{x,timeMs,gestureId:1}});
  window.step=(dt,x,timeMs)=>{
   sample(x,timeMs);runner.tick(dt);if(done)begin();avatar.idle(dt,['pose','face']);
   const state={swing:Number(avatar.app.canvas.dataset.dragSwing),trailing:Number(avatar.app.canvas.dataset.dragTrailing)};
   return{image:draw(),state};
  };
  window.extreme=(time,swing,trailing)=>{avatar.spriteRig.update(time);avatar.spriteRig.applyInertia({swing,trailing});return draw();};
  begin();sample(0,0);avatar.idle(0,['pose','face']);
 };`,loader:'ts',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',platform:'browser'});
 const server=http.createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<body style="margin:0"><script src="/test.js"></script>');}
  if(req.url==='/test.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].contents);}
  if(Object.values(assets).includes(req.url)){res.setHeader('Content-Type','image/webp');return res.end(await fs.readFile(path.resolve('resources/builtin',req.url.slice(1))));}
  const name=req.url.split('/').at(-1);if(!['DeepBlue.moc3','texture_00.png','live2dcubismcore.min.js'].includes(name)){res.statusCode=404;return res.end();}
  res.end(await fs.readFile(path.resolve('src/renderer/public/live2d',name)));
 }catch(e){res.statusCode=500;res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:510,height:630}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(()=>start());
  const {width,height}=await page.evaluate(()=>({width:avatar.app.canvas.width,height:avatar.app.canvas.height}));
  await page.setViewportSize({width,height});
  const frameHeight=height+38,tileWidth=300,tileHeight=Math.round(frameHeight*tileWidth/width);
  const frames=[],samples=[],tiles=[],selected=[0,20,32,49,80,104,105,115,135,160,190,239];
  let x=0;
  // 8 s: right, stop, left across the 3.5 s action boundary, stop and settle.
  const speed=t=>t>=500&&t<1500?1100:t>=2100&&t<4200?1800*Math.sin((t-2100)/450*Math.PI):0;
  for(let i=0;i<240;i++){
   const t=i*1000/30,v=speed(t-1000/60);x+=i?v/30:0;
   const frame=await page.evaluate(p=>step(p.dt,p.x,p.t),{dt:i?1000/30:0,x,t});
   const png=Buffer.from(frame.image,'base64');samples.push({t,velocity:v,...frame.state});
   const label=`${(t/1000).toFixed(2)}s   vx=${Math.round(v)}   angle=${(frame.state.swing*motion.dragInertia.maxAngleDeg).toFixed(1)}`;
   const strip=Buffer.from(`<svg width="${width}" height="38"><rect width="${width}" height="38" fill="#edf3fa"/><text x="20" y="25" font-family="sans-serif" font-size="16" fill="#334b73">${label}</text></svg>`);
   frames.push(await sharp(png).flatten({background:'#edf3fa'}).extend({bottom:38,background:'#edf3fa'}).composite([{input:strip,left:0,top:height}]).ensureAlpha().raw().toBuffer());
   if(selected.includes(i)){
    await fs.writeFile(path.join(dir,`frame-${i}.png`),png);
    tiles.push({input:await sharp(frames.at(-1),{raw:{width,height:frameHeight,channels:4}}).resize(tileWidth,tileHeight).png().toBuffer(),left:(tiles.length%4)*tileWidth,top:Math.floor(tiles.length/4)*tileHeight});
   }
  }
  assert(Math.max(...samples.map(s=>s.swing))>.3);assert(Math.min(...samples.map(s=>s.swing))<-.3);
  assert(Math.abs(samples[239].swing)<.005);assert(Math.abs(samples[105].swing)>.15,'loop restart must retain momentum');
  assert(Math.max(...samples.map(s=>Math.abs(s.swing)))*40>25,'fast reversal must swing visibly');
  assert(Math.abs(samples[105].swing-samples[104].swing)<.22,'loop boundary must stay continuous');
  const clipping=[];
  const currentViewport=await page.evaluate(()=>({width:avatar.app.canvas.width,height:avatar.app.canvas.height}));assert.deepEqual(currentViewport,{width,height});
  assert.equal(await page.evaluate(()=>viewportRequests.length),1,'finite loops must not shrink/re-expand the window');
  // Worst-case root + secondary rotations at twelve different keyframe phases.
  for(let phase=0;phase<12;phase++)for(const swing of [-1,1])for(const trailing of [-1,1]){
   const image=Buffer.from(await page.evaluate(p=>extreme(p.time,p.swing,p.trailing),{time:phase*3500/12,swing,trailing}),'base64');
   const {data,info}=await sharp(image).raw().toBuffer({resolveWithObject:true});
   let border=0;for(let y=0;y<info.height;y++)for(let x=0;x<info.width;x++)if((x<2||y<2||x>=info.width-2||y>=info.height-2)&&data[(y*info.width+x)*4+3]>8)border++;
   if(border)clipping.push({phase,swing,trailing,border});
   if(phase===0&&swing===trailing)await fs.writeFile(path.join(dir,`extreme-${swing}.png`),image);
  }
  await fs.writeFile(path.join(dir,'samples.json'),JSON.stringify(samples,null,2));
  await sharp({create:{width:tileWidth*4,height:tileHeight*3,channels:4,background:'#edf3fa'}}).composite(tiles).png().toFile(path.join(dir,'contact.png'));
  const delays=frames.map((_,i)=>Math.round((i+1)*1000/30)-Math.round(i*1000/30));
  await sharp(Buffer.concat(frames),{raw:{width,height:frameHeight*frames.length,channels:4,pageHeight:frameHeight}}).webp({quality:90,alphaQuality:100,delay:delays,loop:0,effort:3}).toFile(path.join(dir,'drag-inertia.webp'));
  const smaller=await Promise.all(frames.map(f=>sharp(f,{raw:{width,height:frameHeight,channels:4}}).resize(width,frameHeight).raw().toBuffer()));
  await sharp(Buffer.concat(smaller),{raw:{width,height:frameHeight*frames.length,channels:4,pageHeight:frameHeight}}).gif({delay:delays.map((_,i)=>(Math.round((i+1)*100/30)-Math.round(i*100/30))*10),loop:0,effort:3,dither:.2}).toFile(path.join(dir,'drag-inertia.gif'));
  await fs.writeFile(path.join(dir,'preview.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>大肥鱼 · 拖动惯性</title><style>body{margin:28px;background:#edf3fa;color:#344466;font:16px "Microsoft YaHei"}h1{font-size:26px}main{display:flex;align-items:start;gap:24px;flex-wrap:wrap}figure{margin:0}img{max-width:92vw;border-radius:18px}figcaption{padding:12px 0}p{line-height:1.8;max-width:600px}button{font:inherit;padding:8px 18px;margin:0 12px 18px 0;border-radius:9px;border:1px solid #b4c4da;background:white}</style><h1>大肥鱼 · 水平拖动惯性</h1><p>先加速拖动、停下，再快速左右拖动，最后停下稳住。以头顶为支点，水平加速度驱动摆动；匀速移动不会持续倾斜，头发与鲸尾慢半拍。下方标注模拟鼠标速度与实际身体角度。实际程序会响应你的鼠标。</p><button id="toggle">暂停</button><main><figure><img id="motion" src="drag-inertia.webp" width="${width}"><figcaption>程序渲染器 · 8 秒 / 240 帧</figcaption></figure><figure><img src="contact.png" width="510"><figcaption>动作过程与循环衔接抽帧</figcaption></figure></main><script>let paused=false;toggle.onclick=()=>{paused=!paused;motion.src=paused?'frame-104.png':'drag-inertia.webp';toggle.textContent=paused?'播放':'暂停'};</script></html>`);
  const report={frames:240,viewport:{width,height},peakAngleDeg:Math.max(...samples.map(s=>Math.abs(s.swing)))*motion.dragInertia.maxAngleDeg,clipChecks:48,clipping,loopBoundaryRetainsMomentum:true,errors};
  await fs.writeFile(path.join(dir,'visual-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  await page.evaluate(()=>{runner.cancel();avatar.setDragState({dragging:false,visible:true,suspended:false});avatar.reset();});
  assert.deepEqual(await page.evaluate(()=>({width:avatar.app.canvas.width,height:avatar.app.canvas.height})),{width:340,height:420});
  assert.equal(await page.evaluate(()=>viewportRequests.length),2,'only start and release change the viewport');
  assert.deepEqual(errors,[]);assert.deepEqual(clipping,[],'inertial motion must stay inside the pet window');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
