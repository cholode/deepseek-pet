const {chromium}=require('playwright'),{build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),sharp=require('sharp');
(async()=>{
 const dir=path.resolve('test-results/expressions');await fs.mkdir(dir,{recursive:true});
 const bundle=await build({stdin:{contents:"import {Live2DRenderer} from './src/renderer/pet/live2d/Live2DRenderer'; import {parametersFor,neutralNode} from './src/renderer/pet/live2d/pose'; import {expressionIds,expressionProfiles} from './src/shared/expressions';window.profiles=expressionProfiles;window.names=expressionIds;window.start=async()=>{window.rig=new Live2DRenderer();await rig.init();document.body.append(rig.canvas)};window.draw=(id,angle=0,y=0)=>{const pose={head:{...neutralNode(),rotationDeg:angle*3,offsetY:y}};const params=parametersFor(pose,0,['face','pose'],id,{x:0,y:0},1);rig.render(params,pose);return params}",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
 const server=http.createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<body style="margin:0;background:#e8eef8"><script src="/test.js"></script>');}
  if(req.url==='/test.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].contents);}
  const file=req.url.split('/').at(-1);if(!['DeepBlue.moc3','texture_00.png','live2dcubismcore.min.js'].includes(file)){res.statusCode=404;return res.end();}
  res.end(await fs.readFile(path.resolve('src/renderer/public/live2d',file)));
 }catch(e){res.statusCode=500;res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:448,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(()=>start());
  const names=await page.evaluate(()=>names),checks=[],crops=[],cards=[];
  for(const id of names){
   const check=await page.evaluate(id=>{const p=draw(id),m=rig.model,opacity=id=>m.drawables.opacities[m.drawables.ids.indexOf(id)];return {id,label:profiles[id].label,params:p,missing:Object.keys(p).filter(k=>!m.parameters.ids.includes(k)),oldMouth:opacity('Mouth'),mouth:opacity('MouthLip'),leftClosed:opacity('EyeClosedL'),rightClosed:opacity('EyeClosedR'),tears:opacity('TearL'),mouthClip:m.drawables.ids[m.drawables.masks[m.drawables.ids.indexOf('MouthTongue')][0]]};},id);
   assert.deepEqual(check.missing,[]);assert(Math.abs(check.oldMouth+check.mouth-1)<1e-5);assert.equal(check.mouthClip,'MouthFill');
   if(id==='wink'){assert(check.leftClosed>1-1e-5);assert.equal(check.rightClosed,0);}
   if(id==='sad')assert(check.tears>0);
   const file=path.join(dir,id+'.png');await page.screenshot({path:file});
   const crop=await sharp(file).extract({left:105,top:185,width:240,height:150}).resize(480,300).toBuffer();
   await fs.writeFile(path.join(dir,id+'-face.png'),crop);
   const label=Buffer.from(`<svg width="480" height="40"><rect width="480" height="40" fill="#fff"/><text x="20" y="28" fill="#344568" font-size="20" font-family="Microsoft YaHei">${check.label}</text></svg>`);
   const n=checks.length;crops.push({input:crop,left:(n%4)*480,top:Math.floor(n/4)*340},{input:label,left:(n%4)*480,top:Math.floor(n/4)*340+300});
   cards.push(`<figure><img src="${id}-face.png" alt="${check.label}"><figcaption>${check.label}</figcaption></figure>`);checks.push(check);
   await page.evaluate(id=>draw(id,4,8),id);await page.screenshot({path:path.join(dir,id+'-nod.png')});
  }
  await sharp({create:{width:1920,height:Math.ceil(names.length/4)*340,channels:4,background:'#e8eef8'}}).composite(crops).png().toFile(path.join(dir,'contact.png'));
  await fs.writeFile(path.join(dir,'preview.html'),`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>小蓝 · 表情一览</title><style>body{margin:24px;background:#eef2f8;color:#344568;font:16px "Microsoft YaHei",sans-serif}h1{font-size:26px}main{display:grid;grid-template-columns:repeat(auto-fit,minmax(290px,1fr));gap:16px}figure{margin:0;background:white;border-radius:14px;overflow:hidden}img{width:100%;display:block}figcaption{padding:12px;text-align:center;font-weight:600}</style><h1>小蓝 · 十一种表情</h1><p>程序实际 Live2D 模型渲染。新增疑惑、委屈、得意、无语、俏皮眨单眼，并补充原有表情的嘴型。</p><main>${cards.join('')}</main></html>`);
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({checks,errors},null,2));console.log('PASS',names.length,'expressions; native mouth, independent wink, tear masks, head transforms');
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
