const {chromium}=require('playwright'),{build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),sharp=require('sharp');
(async()=>{
 const dir=path.resolve('test-results/super-shy');await fs.mkdir(dir,{recursive:true});
 const duration=JSON.parse(await fs.readFile('resources/builtin/motions/cover_face.json','utf8')).durationMs;
 const definition=JSON.parse(await fs.readFile('resources/builtin/groups/super_shy.json','utf8')).timeline.children.find(n=>n.type==='expression');
 const bundle=await build({stdin:{contents:`
  import {Avatar} from './src/renderer/pet/Avatar';
  import {defaults,makeCatalog} from './src/shared/schema';
  import {ActionGroupRunner} from './src/renderer/pet/engine';
  import motion from './resources/builtin/motions/cover_face.json';
  import group from './resources/builtin/groups/super_shy.json';
  const catalog=makeCatalog({revision:1,packs:[{manifest:{schemaVersion:1,id:'builtin.deepblue',name:'test',version:'1',avatarId:'deepblue-chibi-v1',description:'',motions:['cover_face.json'],groups:['super_shy.json']},motions:[motion],groups:[group],assets:{}}]});
  window.pet={setViewport:async()=>{}};
  window.start=async()=>{
   window.avatar=new Avatar(()=>({...defaults,size:1}),message=>{throw Error(message)});
   await avatar.init(document.body,catalog);avatar.app.ticker.stop();window.live=avatar.live;
   window.begin=()=>{
    avatar.reset();avatar.app.renderer.resize(448,720);avatar.scene.scale.set(1.6);
    avatar.placement.scale.set(1);avatar.placement.position.set(140,445);
    window.statuses=[];window.runner=new ActionGroupRunner(catalog.groups.get('builtin.deepblue:super_shy'),'test','manual',catalog,avatar,status=>statuses.push(status));
   };
   window.sample=()=>{
    avatar.idle(0,['pose','face']);avatar.app.renderer.render(avatar.app.stage);
    const m=live.model;
    return {face:avatar.app.canvas.dataset.expression,flush:live.faceFlush,
      steam:avatar.fx.children.length,shoulder:avatar.nodes.get('shoulderLeft').rotation,
      eyes:['ParamEyeLOpen','ParamEyeROpen'].map(id=>m.parameters.values[m.parameters.ids.indexOf(id)]),
      vertices:live.meshes.map(b=>Array.from(b.vertices)),order:live.order.map(i=>m.drawables.ids[i])};
   };
   begin();sample();
  };`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
 const server=http.createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<body style="margin:0;background:#e8eef8"><script src="/test.js"></script>');}
  if(req.url==='/test.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].contents);}
  const file=req.url.split('/').at(-1);if(!['DeepBlue.moc3','texture_00.png','live2dcubismcore.min.js'].includes(file)){res.statusCode=404;return res.end();}
  res.end(await fs.readFile(path.resolve('src/renderer/public/live2d',file)));
 }catch(e){res.statusCode=500;res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:448,height:720}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(()=>start());
  const rest=await page.evaluate(()=>sample());const frames=[],checks=[];
  for(let frame=0;frame<=63;frame++){
   const t=frame*duration/63;
   const sample=await page.evaluate(dt=>{runner.tick(dt);return sample();},frame?duration/63:0);
   if(t>definition.fadeInMs&&t<duration-definition.fadeOutMs){assert.deepEqual(sample.eyes,[0,0]);assert(sample.flush>=.7);assert.equal(sample.steam,6);assert(sample.order.indexOf('HandL')>sample.order.indexOf('HeadBase'));assert(sample.order.indexOf('HandR')>sample.order.indexOf('FrontHair'));}
   if(frame===0){assert.deepEqual(sample.eyes,[1,1]);assert.equal(sample.flush,0);}
   if(frame===3||frame===60){assert(sample.flush>0&&sample.flush<.72);assert(sample.eyes.every(v=>v>0&&v<1));}
   const png=await page.screenshot();frames.push(await sharp(png).ensureAlpha().raw().toBuffer());
   if([0,3,6,13,24,49,57,60,63].includes(frame)){await fs.writeFile(path.join(dir,`frame-${frame}.png`),png);checks.push({t,face:sample.face,flush:sample.flush,steam:sample.steam,eyes:sample.eyes,shoulder:sample.shoulder});}
  }
  const completed=await page.evaluate(()=>{runner.tick(1);return {state:sample(),statuses};});
  assert.deepEqual(completed.statuses,['completed']);assert.equal(completed.state.face,'neutral');assert.equal(completed.state.flush,0);assert.equal(completed.state.steam,0);assert.deepEqual(completed.state.vertices,rest.vertices);
  await page.evaluate(()=>{begin();runner.tick(1600);sample();runner.cancel();});
  const cancelled=await page.evaluate(()=>({state:sample(),statuses}));
  assert.deepEqual(cancelled.statuses,['cancelled']);assert.equal(cancelled.state.flush,0);assert.equal(cancelled.state.steam,0);assert.deepEqual(cancelled.state.vertices,rest.vertices);
  const gif=path.join(dir,'super-shy.gif');
  const delays=frames.map((_,i)=>(Math.round((i+1)*duration/640)-Math.round(i*duration/640))*10);
  await sharp(Buffer.concat(frames),{raw:{width:448,height:720*frames.length,channels:4,pageHeight:720}}).gif({delay:delays,loop:0,effort:3}).toFile(gif);
  const gifInfo=await sharp(gif,{animated:true}).metadata();assert.equal(gifInfo.pages,64);assert.deepEqual(gifInfo.delay,delays);
  await fs.writeFile(path.join(dir,'preview.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>小蓝 · 超级害羞</title><style>body{margin:24px;background:#eef2f8;color:#344568;font:16px "Microsoft YaHei",sans-serif}main{display:flex;gap:24px;flex-wrap:wrap}img{max-width:100%;border-radius:16px}figure{margin:0}figcaption{text-align:center;padding:12px}</style><h1>超级害羞</h1><p>整脸通红 · 闭眼 · 双手遮脸 · 头顶冒蒸汽</p><main><figure><img src="super-shy.gif"><figcaption>完整动作：抬手、遮脸、放手</figcaption></figure><figure><img src="frame-24.png"><figcaption>遮脸姿态</figcaption></figure></main></html>`);
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({checks,completed:true,cancelled:true,exactGeometryRestored:true,errors},null,2));console.log('PASS super shy: closed eyes, full-face flush, articulated foreground hands, steam, natural completion and cancellation');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
