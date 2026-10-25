const {chromium}=require('playwright'),{build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),sharp=require('sharp'),assert=require('node:assert/strict');
(async()=>{
 const dir=path.resolve('test-results/drag-held');await fs.mkdir(dir,{recursive:true});
 const motion=JSON.parse(await fs.readFile('resources/builtin/motions/drag_held.json','utf8'));
 const assets=Object.fromEntries(motion.parts.map(p=>[p.image,'/'+p.image]));
 const bundle=await build({stdin:{contents:`
 import {Avatar} from './src/renderer/pet/Avatar';
 import {defaults,makeCatalog} from './src/shared/schema';
 import {ActionGroupRunner} from './src/renderer/pet/engine';
 import motion from './resources/builtin/motions/drag_held.json';
 import group from './resources/builtin/groups/drag_held.json';
 const catalog=makeCatalog({revision:1,packs:[{manifest:{schemaVersion:1,id:'builtin.deepblue',name:'test',version:'1',avatarId:'deepblue-chibi-v1',description:'',motions:['motion.json'],groups:['group.json']},motions:[motion],groups:[group],assets:${JSON.stringify(assets)}}]});
 window.pet={setViewport:async()=>{}};
 window.start=async()=>{
  window.avatar=new Avatar(()=>({...defaults,size:1.5}),message=>{throw Error(message)});
  await avatar.init(document.body,catalog);avatar.app.ticker.stop();
  window.draw=()=>{avatar.idle(0,['face','pose']);avatar.app.renderer.render(avatar.app.stage);return avatar.app.canvas.toDataURL('image/png').split(',')[1];};
  window.begin=()=>{window.statuses=[];window.runner=new ActionGroupRunner(catalog.groups.get('builtin.deepblue:drag_held'),'preview','manual',catalog,avatar,status=>statuses.push(status));runner.tick(0);};
  window.inspect=()=>({pose:avatar.app.canvas.dataset.pose,width:avatar.app.canvas.width,height:avatar.app.canvas.height,children:avatar.frameStage.children.length,root:avatar.nodes.get('root').visible});
  draw();
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
  const standing=await page.evaluate(()=>({image:draw(),state:inspect()}));await fs.writeFile(path.join(dir,'standing.png'),Buffer.from(standing.image,'base64'));
  await page.evaluate(()=>begin());const heldViewport=await page.evaluate(()=>inspect());await page.setViewportSize({width:heldViewport.width,height:heldViewport.height});const frames=[],contact=[],selected=[0,8,16,24,32,40,48,56,64,72,80,83];
  let first;
  for(let i=0;i<84;i++){
   const sample=await page.evaluate(dt=>{runner.tick(dt);return{image:draw(),state:inspect()};},i?1000/24:0);
   assert.equal(sample.state.pose,'sprite-rig');assert.equal(sample.state.width,heldViewport.width);assert.equal(sample.state.height,heldViewport.height);assert.equal(sample.state.children,2);
   const png=Buffer.from(sample.image,'base64');if(!first)first=png;
   const cropped=await sharp(png).extract({left:Math.floor((heldViewport.width-standing.state.width)/2),top:heldViewport.height-standing.state.height,width:standing.state.width,height:standing.state.height}).png().toBuffer();
   frames.push(await sharp(cropped).raw().toBuffer());
   if(selected.includes(i)){
    await fs.writeFile(path.join(dir,`frame-${i}.png`),png);
    contact.push({input:await sharp(cropped).resize(255,315).png().toBuffer(),left:(contact.length%4)*255,top:Math.floor(contact.length/4)*315});
   }
  }
  const seam=await page.evaluate(()=>{const handle=avatar.frameStage.children[1];runner.leaves[0].handle.update(3500);draw();return avatar.app.canvas.toDataURL('image/png').split(',')[1];});
  assert.deepEqual(await sharp(Buffer.from(seam,'base64')).raw().toBuffer(),await sharp(first).raw().toBuffer());
  const done=await page.evaluate(()=>{runner.tick(50);draw();return{state:inspect(),statuses};});assert.deepEqual(done.statuses,['completed']);assert.equal(done.state.pose,'standing');assert.equal(done.state.children,1);assert.equal(done.state.width,standing.state.width);assert.equal(done.state.height,standing.state.height);
  await page.evaluate(()=>{begin();runner.tick(500);draw();runner.cancel();draw();});assert.equal((await page.evaluate(()=>inspect())).children,1);
  const delays=frames.map((_,i)=>Math.round((i+1)*1000/24)-Math.round(i*1000/24));
  await sharp(Buffer.concat(frames),{raw:{width:510,height:630*frames.length,channels:4,pageHeight:630}}).webp({quality:95,alphaQuality:100,delay:delays,loop:0,effort:3}).toFile(path.join(dir,'drag-held.webp'));
  const gifFrames=await Promise.all(frames.map(f=>sharp(f,{raw:{width:510,height:630,channels:4}}).resize(340,420).raw().toBuffer()));
  await sharp(Buffer.concat(gifFrames),{raw:{width:340,height:420*frames.length,channels:4,pageHeight:420}}).gif({delay:delays.map((_,i)=>(Math.round((i+1)*100/24)-Math.round(i*100/24))*10),loop:0,effort:3,dither:.3}).toFile(path.join(dir,'drag-held.gif'));
  await sharp({create:{width:1020,height:945,channels:4,background:'#e8edf5'}}).composite(contact).png().toFile(path.join(dir,'contact.png'));
  await fs.writeFile(path.join(dir,'preview.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>大肥鱼 · 拖动动画</title><style>body{margin:28px;background:#e8edf5;color:#344466;font:16px "Microsoft YaHei"}h1{font-size:26px}main{display:flex;gap:20px;flex-wrap:wrap}figure{margin:0;background:#fff9;border:1px solid #ccd6e5;border-radius:18px}img{display:block;width:340px;max-width:90vw}figcaption{text-align:center;padding:14px}button{font:inherit;padding:8px 18px;margin:12px 10px 20px 0;border-radius:9px;border:1px solid #b4c4da;background:white}</style><h1>大肥鱼 · 被拎起挣动</h1><p>握拳抗议 · 双腿悬空轻蹬 · 后发和低位鲸尾摆动。按住拖动时循环，松手回到站立。</p><button id="toggle">暂停</button><button onclick="document.body.style.background=document.body.style.background?'':'#202735'">切换背景</button><main><figure><img src="standing.png"><figcaption>程序中的站立造型</figcaption></figure><figure><img id="motion" src="drag-held.webp"><figcaption>重绘后的拖动动作 · 3.5 秒循环</figcaption></figure></main><script>let paused=false;toggle.onclick=()=>{paused=!paused;motion.src=paused?'frame-16.png':'drag-held.webp';toggle.textContent=paused?'播放':'暂停'};</script></html>`);
  assert.deepEqual(errors,[]);const report={frames:84,durationMs:3500,pixelIdenticalLoopEndpoints:true,completedAndCancelled:true,stableHeldViewport:true,restoredViewport:true,errors};
  await fs.writeFile(path.join(dir,'visual-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
