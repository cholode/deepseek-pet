// Exercise real MOC3 eye-open keyforms, including the original painted lid creases.
const {chromium}=require('playwright'),{build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),sharp=require('sharp');
(async()=>{
 const dir=path.resolve('test-results/live2d-eyelids');await fs.mkdir(dir,{recursive:true});
 const bundle=await build({stdin:{contents:"import {Live2DRenderer} from './src/renderer/pet/live2d/Live2DRenderer'; window.start=async()=>{window.rig=new Live2DRenderer();await rig.init();document.body.append(rig.canvas)}",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
 const server=http.createServer(async(req,res)=>{try{
  if(req.url==='/'||req.url==='/before/'){res.setHeader('Content-Type','text/html');return res.end('<body style="margin:0;background:#e8eef8"><script src="/test.js"></script>');}
  if(req.url==='/test.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].contents);}
  const file=req.url.split('/').at(-1);if(!['DeepBlue.moc3','texture_00.png','live2dcubismcore.min.js'].includes(file)){res.statusCode=404;return res.end();}
  const old=req.url.startsWith('/before/');
  const target=old&&file==='DeepBlue.moc3'?'test-results/eyelids/before.moc3':old&&file==='texture_00.png'?'test-results/eyelids/before-texture.png':path.join('src/renderer/public/live2d',file);
  res.end(await fs.readFile(path.resolve(target)));
 }catch(e){res.statusCode=500;res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:448,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  const crops=[];
  for(const variant of ['before','after']){
   if(variant==='before') {try{await fs.access('test-results/eyelids/before.moc3');}catch{continue;}}
   await page.goto(`http://127.0.0.1:${server.address().port}/${variant==='before'?'before/':''}`);await page.evaluate(()=>start());
   for(const [name,open]of [['open',1],['half',.5],['closed',0]]){
    await page.evaluate(open=>rig.render({ParamEyeLOpen:open,ParamEyeROpen:open},{}),open);
    const file=path.join(dir,variant+'-'+name+'.png');await page.screenshot({path:file});
    crops.push({input:await sharp(file).extract({left:110,top:200,width:220,height:125}).resize(660,375).toBuffer(),left:(crops.length%3)*660,top:Math.floor(crops.length/3)*375});
   }
  }
  const checks=await page.evaluate(()=>{
   const m=rig.model,index=id=>m.drawables.ids.indexOf(id),verts=id=>Array.from(m.drawables.vertexPositions[index(id)]);
   rig.render({},{});const rest=rig.canvas.toDataURL(),l=verts('EyeCreaseL'),r=verts('EyeCreaseR'),head=verts('HeadBase');
   const posY=values=>values.filter((_,i)=>i%2===1).map(v=>457.5-v*320),mean=v=>v.reduce((a,b)=>a+b,0)/v.length;
   const fullY=mean(posY(l));rig.render({ParamEyeLOpen:.5},{});
   const halfY=mean(posY(verts('EyeCreaseL'))),rightIndependent=JSON.stringify(r)===JSON.stringify(verts('EyeCreaseR'));
   const faceFixed=JSON.stringify(head)===JSON.stringify(verts('HeadBase'));
   rig.render({ParamEyeLOpen:0,ParamEyeROpen:0},{});
   const foldsHidden=['EyeCreaseL','EyeCreaseR','EyeLidEdgeR'].every(id=>m.drawables.opacities[index(id)]===0);
   rig.render({},{});return {meshes:m.drawables.count,fullY,halfY,expectedHalfY:401+(fullY-401)*.5,rightIndependent,faceFixed,foldsHidden,exactReset:rest===rig.canvas.toDataURL()};
  });
  assert.equal(checks.meshes,30);assert(Math.abs(checks.halfY-checks.expectedHalfY)<.01);assert(checks.halfY-checks.fullY>20);
  for(const name of ['rightIndependent','faceFixed','foldsHidden','exactReset'])assert(checks[name],name);
  await sharp({create:{width:1980,height:Math.ceil(crops.length/3)*375,channels:4,background:'#e8eef8'}}).composite(crops).png().toFile(path.join(dir,'comparison.png'));
  // The creases must remain attached to the head when timeline nods and Core rotations combine.
  await page.evaluate(()=>rig.render({ParamEyeLOpen:.5,ParamEyeROpen:.5,ParamAngleZ:4,ParamBrowForm:1},{head:{offsetX:5,offsetY:8,rotationDeg:0,scaleX:1.04,scaleY:1.04,alpha:1}}));
  await page.screenshot({path:path.join(dir,'annoyed-nod.png')});
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify(checks));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
