// Render the production Core model, inspect real mesh changes, and capture both expressions.
const {chromium}=require('playwright');
const {build}=require('esbuild');
const fs=require('node:fs/promises'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),sharp=require('sharp');
(async()=>{
 const dir=path.resolve('test-results/live2d-brows');await fs.mkdir(dir,{recursive:true});
 const bundle=await build({stdin:{contents:"import {Live2DRenderer} from './src/renderer/pet/live2d/Live2DRenderer'; import {parametersFor,neutralNode} from './src/renderer/pet/live2d/pose'; window.start=async()=>{window.rig=new Live2DRenderer();await rig.init();document.body.append(rig.canvas);window.draw=(face='neutral',angle=0,y=0)=>{const pose={head:{...neutralNode(),rotationDeg:angle*3,offsetY:y}};rig.render(parametersFor(pose,0,['pose','face'],face,{x:0,y:0},1),pose)}}",resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,format:'iife',platform:'browser'});
 const server=http.createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html');return res.end('<body style="margin:0;background:#e8eef8"><script src="/test.js"></script>');}
  if(req.url==='/test.js'){res.setHeader('Content-Type','application/javascript');return res.end(bundle.outputFiles[0].contents);}
  const file=req.url.slice('/live2d/'.length);if(!req.url.startsWith('/live2d/')||!['DeepBlue.moc3','texture_00.png','live2dcubismcore.min.js'].includes(file)){res.statusCode=404;return res.end();}
  res.end(await fs.readFile(path.resolve('src/renderer/public/live2d',file)));
 }catch(e){res.statusCode=500;res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 try{
  const page=await browser.newPage({viewport:{width:448,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);await page.evaluate(()=>start());
  const checks=await page.evaluate(()=>{
   const m=rig.model;rig.render({},{});
   const snapshot=()=>m.drawables.vertexPositions.map(v=>Array.from(v));
   const original=snapshot(),image=rig.canvas.toDataURL();
   rig.render({ParamBrowForm:1},{});
   const changed=m.drawables.ids.filter((_,i)=>original[i].some((v,j)=>Math.abs(v-m.drawables.vertexPositions[i][j])>1e-6));
   const browPixelChange=image!==rig.canvas.toDataURL();
   // Original brows span three overlapping cutouts. Other meshes must stay fixed.
   const displacements={};for(const id of changed){const i=m.drawables.ids.indexOf(id);displacements[id]=Math.max(...original[i].map((v,j)=>Math.abs(v-m.drawables.vertexPositions[i][j])*320));}
   rig.render({},{});const exactReset=rig.canvas.toDataURL()===image;
   return {parameters:m.parameters.ids,meshes:m.drawables.count,changed,browPixelChange,displacements,exactReset};
  });
  assert(checks.parameters.includes('ParamBrowForm'));assert.equal(checks.meshes,38);
  assert.deepEqual(checks.changed.sort(),['BangCenter','FrontHair','HeadBase']);
  assert(checks.browPixelChange);assert(checks.exactReset);assert(Object.values(checks.displacements).every(d=>d>3&&d<12));
  const captures=[['neutral','neutral',0,0],['annoyed','annoyed',0,0],['annoyed-left','annoyed',-4,-8],['annoyed-right','annoyed',4,8]];
  const crops=[];
  for(const [name,face,angle,y]of captures){
   await page.evaluate(({face,angle,y})=>draw(face,angle,y),{face,angle,y});
   const file=path.join(dir,name+'.png');await page.screenshot({path:file});
   crops.push({input:await sharp(file).extract({left:100,top:160,width:245,height:175}).resize(490,350).toBuffer(),left:crops.length*490,top:0});
  }
  await sharp({create:{width:1960,height:350,channels:4,background:'#e8eef8'}}).composite(crops).png().toFile(path.join(dir,'comparison.png'));
  assert.deepEqual(errors,[]);await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify(checks));
 }finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
