// Deterministic renders of the production renderer, with the real exported MOC3.
const {chromium}=require('playwright');
const {build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
(async()=>{
 const dir=path.resolve('test-results/live2d-cutouts');await fs.mkdir(dir,{recursive:true});
 const bundle=await build({stdin:{contents:"import {Live2DRenderer} from './src/renderer/pet/live2d/Live2DRenderer'; import {neutralNode} from './src/renderer/pet/live2d/pose'; window.start=async()=>{window.rig=new Live2DRenderer();await rig.init();document.body.append(rig.canvas);window.pose=(y=0,x=0,scale=1)=>({head:{...neutralNode(),offsetY:y,offsetX:x,scaleX:scale,scaleY:scale}})}",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
 const server=http.createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<body style="margin:0;background:#ece7df"><script src="/test.js"></script>');}
  if(req.url==='/test.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].contents);}
  const file=req.url.slice('/live2d/'.length);if(!req.url.startsWith('/live2d/')||!['DeepBlue.moc3','texture_00.png','live2dcubismcore.min.js'].includes(file)){res.statusCode=404;return res.end();}
  res.end(await fs.readFile(path.resolve('src/renderer/public/live2d',file)));
 }catch(e){res.statusCode=500;res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:448,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(()=>start());
  for(const [name,y,angle,tail] of [['neutral',0,0,0],['head-up',-8,-4,-1],['head-down',8,4,1],['tail-left',0,0,-1],['tail-right',0,0,1]]){
   await page.evaluate(({y,angle,tail})=>rig.render({ParamAngleZ:angle,ParamTail:tail},pose(y)),{y,angle,tail});await page.screenshot({path:path.join(dir,name+'.png')});
  }
  const checks=await page.evaluate(()=>{
   const m=rig.model,update=m.update.bind(m),only=(...ids)=>{m.update=()=>{update();m.drawables.ids.forEach((id,i)=>{if(!ids.includes(id))m.drawables.opacities[i]=0;});};};
   only('Neck');rig.render({},{});const neck=rig.canvas.toDataURL();rig.render({ParamAngleZ:4},pose(8,8,1.06));const neckFixed=neck===rig.canvas.toDataURL();
   only('BackHair');rig.render({},{});const gl=rig.canvas.getContext('webgl'),pixels=new Uint8Array(448*250*4);gl.readPixels(0,640-250,448,250,gl.RGBA,gl.UNSIGNED_BYTE,pixels);const upperRearEmpty=pixels.every((v,i)=>i%4!==3||v===0);
   const oldFinOutlineEmpty=[[550,709],[580,700],[598,680]].every(([x,y])=>{const pixel=new Uint8Array(4);gl.readPixels(Math.round(224+(x-320)*.672),639-Math.round(320+(y-457.5)*(640/915)*.96),1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return pixel[3]===0;});
   only('BackHair','Dress','Neck','LegL','LegR');rig.render({},{});const body=rig.canvas.toDataURL();rig.render({ParamTail:1},{});const tailIndependent=body===rig.canvas.toDataURL();
   m.update=update;rig.render({},{});return {neckFixed,upperRearEmpty,oldFinOutlineEmpty,tailIndependent,meshes:m.drawables.count};
  });
  assert.equal(checks.neckFixed,true,'neck follows torso, not head');assert.equal(checks.upperRearEmpty,true,'rear hair must not contain headband/ahoge fragments');assert.equal(checks.tailIndependent,true);assert.equal(checks.meshes,30);
  assert.equal(checks.oldFinOutlineEmpty,true,'rear layer must not retain the old fin outline');
  // Capture an entire cycle at 30 fps with nod and tail extremes, not just neutral.
  const frames=path.join(dir,'frames');await fs.mkdir(frames,{recursive:true});
  for(let i=0;i<90;i++){
   await page.evaluate(i=>{const a=i*Math.PI*2/90;rig.render({ParamAngleZ:Math.sin(a)*4,ParamTail:Math.sin(a)*1,ParamEyeLOpen:i>40&&i<45?0:1,ParamEyeROpen:i>40&&i<45?0:1},pose(Math.sin(a)*8));},i);
   const data=await page.evaluate(()=>rig.canvas.toDataURL().split(',')[1]);await fs.writeFile(path.join(frames,`${String(i).padStart(3,'0')}.png`),Buffer.from(data,'base64'));
  }
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify(checks));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
