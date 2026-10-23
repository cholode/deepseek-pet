// Verify the shipped action against real Core samples and the actual Electron lifecycle.
const {_electron:electron}=require('playwright');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const tag=process.env.PET_TEST_EXE?'packaged':'source',dir=path.resolve('test-results/protest-'+tag);await fs.mkdir(dir,{recursive:true});
 const env={...process.env,PET_TEST_USER:path.join(dir,'user'),ELECTRON_RENDERER_URL:''};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...(process.env.PET_TEST_EXE?{executablePath:process.env.PET_TEST_EXE}:{}),args:process.env.PET_TEST_EXE?['--panel']:[path.resolve('.'),'--panel'],env});
 const errors=[],requests=[],checks=[];
 try{
  app.on('window',page=>{page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});});
  await app.firstWindow();let pet,panel;
  for(let i=0;i<150;i++){pet=app.windows().find(p=>p.url().includes('page=pet'));panel=app.windows().find(p=>p.url().includes('page=panel'));if(pet&&panel)break;await wait(100);}
  assert(pet&&panel);await pet.waitForSelector('canvas[data-avatar="live2d"]',{timeout:30000});
  const get=()=>panel.evaluate(()=>window.pet.getDebug());
  const request=type=>panel.evaluate(type=>window.pet.panelRequest({type:'command',command:{protocolVersion:1,commandId:crypto.randomUUID(),type,...(type==='play_group'?{groupId:'builtin.deepblue:annoyed_shake'}:{})}}),type);
  const check=name=>{checks.push(name);console.log('PASS',name);};
  await panel.evaluate(async()=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),paused:true,roaming:false,size:1}));await request('stop_current');await wait(250);
  await pet.evaluate(()=>{const update=window.Live2DCubismCore.Model.prototype.update;window.__protest=[];window.Live2DCubismCore.Model.prototype.update=function(){const result=update.call(this);window.__protest.push({params:Object.fromEntries(this.parameters.ids.map((id,i)=>[id,this.parameters.values[i]])),meshes:this.drawables.count});return result;};});
  const reset=()=>pet.waitForFunction(()=>window.__protest.at(-1)?.params.ParamBrowForm===0);
  await reset();await pet.screenshot({path:path.join(dir,'standing.png'),omitBackground:true});
  const play=await request('play_group');assert.equal(play.status,'accepted');
  await pet.waitForFunction(()=>window.__protest.at(-1)?.params.ParamBrowForm===1);
  await wait(280);await pet.screenshot({path:path.join(dir,'protest.png'),omitBackground:true});
  for(let i=0;i<40;i++){if((await get()).events.some(e=>e.type==='action_lifecycle'&&e.payload.actionInstanceId===play.actionInstanceId&&e.payload.status==='completed'))break;await wait(100);}
  assert((await get()).events.some(e=>e.type==='action_lifecycle'&&e.payload.actionInstanceId===play.actionInstanceId&&e.payload.status==='completed'));
  await reset();const samples=await pet.evaluate(()=>window.__protest),active=samples.filter(s=>s.params.ParamBrowForm===1);
  assert(active.length>5);assert(active.every(s=>s.params.ParamEyeLOpen>.54&&s.params.ParamEyeLOpen<.56));
  assert(active.some(s=>s.params.ParamAngleZ>2)&&active.some(s=>s.params.ParamAngleZ<-2));assert(samples.every(s=>s.meshes===30));
  check('小小抗议同时驱动原眉毛、半闭眼及左右摇头，结束恢复眉毛');
  await wait(150);assert.equal((await request('play_group')).status,'accepted');await pet.waitForFunction(()=>window.__protest.at(-1)?.params.ParamBrowForm===1);await request('stop_current');await reset();
  check('中途停止恢复原眉毛');
  await wait(150);assert.equal((await request('play_group')).status,'accepted');await pet.waitForFunction(()=>window.__protest.at(-1)?.params.ParamBrowForm===1);
  assert.equal((await panel.evaluate(()=>window.pet.reloadPacks())).ok,true);await reset();
  check('资源重载清除抗议表情');
  assert.deepEqual((await get()).errors,[]);assert.deepEqual(errors,[]);assert.deepEqual(requests,[]);check('无运行错误及外网资源请求');
  await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({tag,checks,errors,requests,sampleCount:samples.length},null,2));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
