const {_electron:electron}=require('playwright');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const tag=process.env.PET_TEST_EXE?'packaged':'source',dir=path.resolve('test-results/eyelid-'+tag);await fs.mkdir(dir,{recursive:true});
 const env={...process.env,PET_TEST_USER:path.join(dir,'user'),ELECTRON_RENDERER_URL:''};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...(process.env.PET_TEST_EXE?{executablePath:process.env.PET_TEST_EXE}:{}),args:process.env.PET_TEST_EXE?['--panel']:[path.resolve('.'),'--panel'],env});
 const errors=[],remote=[],checks=[];
 try{
  app.on('window',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});});
  await app.firstWindow();let pet,panel;
  for(let i=0;i<150;i++){pet=app.windows().find(p=>p.url().includes('page=pet'));panel=app.windows().find(p=>p.url().includes('page=panel'));if(pet&&panel)break;await wait(100);}
  assert(pet&&panel);await pet.waitForSelector('canvas[data-avatar="live2d"]',{timeout:30000});
  await panel.evaluate(async()=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),paused:true,roaming:false,size:1}));
  const request=(type,groupId)=>panel.evaluate(({type,groupId})=>window.pet.panelRequest({type:'command',command:{protocolVersion:1,commandId:crypto.randomUUID(),type,...(groupId?{groupId}:{})}}),{type,groupId});
  await request('stop_current');await wait(250);
  await pet.evaluate(()=>{
   const update=window.Live2DCubismCore.Model.prototype.update;window.__lids=[];window.__lidHold=null;window.__lidCaptured=false;
   window.Live2DCubismCore.Model.prototype.update=function(){
    // Hold the first naturally reached closed pose only long enough for a real
    // window screenshot; Pixi's default WebGL canvas cannot be read after present.
    const incoming=this.parameters.values[this.parameters.ids.indexOf('ParamEyeLOpen')];
    if(incoming===0&&!window.__lidCaptured){window.__lidHold=0;window.__lidCaptured=true;}
    if(window.__lidHold!==null)for(const id of ['ParamEyeLOpen','ParamEyeROpen'])this.parameters.values[this.parameters.ids.indexOf(id)]=window.__lidHold;
    const result=update.call(this),ids=this.drawables.ids,param=id=>this.parameters.values[this.parameters.ids.indexOf(id)];
    const fields=id=>{const i=ids.indexOf(id),v=this.drawables.vertexPositions[i];if(!v)throw Error('Missing mesh '+id);let y=0;for(let j=1;j<v.length;j+=2)y+=v[j];return {y:y/(v.length/2),opacity:this.drawables.opacities[i]};};
    const open=param('ParamEyeLOpen');window.__lids.push({open,left:fields('EyeCreaseL'),right:fields('EyeCreaseR'),brow:param('ParamBrowForm'),meshes:ids.length});
    return result;
   };
  });
  await pet.waitForFunction(()=>window.__lids.some(s=>s.open===0),undefined,{timeout:12000});
  await pet.screenshot({path:path.join(dir,'closed.png'),omitBackground:true});
  await pet.evaluate(()=>window.__lidHold=null);
  await pet.waitForFunction(()=>window.__lids.at(-1)?.open>.99);
  await pet.screenshot({path:path.join(dir,'open.png'),omitBackground:true});
  const samples=await pet.evaluate(()=>window.__lids),open=samples.find(s=>s.open>.99),closed=samples.find(s=>s.open===0);
  assert(samples.every(s=>s.meshes===38));
  for(const side of ['left','right']){
   assert(open[side].opacity>.99);assert.equal(closed[side].opacity,0);
   assert((open[side].y-closed[side].y)*320>35);
   assert(samples.some(s=>s.open>.2&&s.open<.9&&s[side].opacity>0&&s[side].opacity<1));
  }
  checks.push('自动眨眼中双眼皮随眼睑下移、渐隐并复位');
  assert.equal((await request('play_group','builtin.deepblue:annoyed_shake')).status,'accepted');
  await pet.waitForFunction(()=>window.__lids.at(-1)?.brow===1);
  const annoyed=await pet.evaluate(()=>window.__lids.at(-1));assert(Math.abs(annoyed.open-.55)<.001);assert(annoyed.left.opacity>0&&annoyed.left.opacity<1);await wait(150);await pet.screenshot({path:path.join(dir,'annoyed.png'),omitBackground:true});
  await request('stop_current');await pet.waitForFunction(()=>window.__lids.at(-1)?.brow===0);checks.push('小小抗议兼容双眼皮开合，停止后恢复');
  assert.equal((await panel.evaluate(()=>window.pet.reloadPacks())).ok,true);await wait(150);
  assert.deepEqual((await panel.evaluate(()=>window.pet.getDebug())).errors,[]);assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);checks.push('资源重载后正常，无运行错误及外网请求');
  await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({tag,checks,sampleCount:samples.length,errors,remote},null,2));console.log(JSON.stringify({tag,checks}));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
