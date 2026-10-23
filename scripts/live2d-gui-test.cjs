// Application-scoped integration via Electron/Playwright, never desktop computer-use.
const {_electron:electron}=require('playwright');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const tag=process.env.PET_TEST_EXE?'packaged':'source',dir=path.resolve('test-results/live2d-'+tag);await fs.mkdir(dir,{recursive:true});
 const env={...process.env,PET_TEST_USER:path.join(dir,'user'),ELECTRON_RENDERER_URL:''};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...(process.env.PET_TEST_EXE?{executablePath:process.env.PET_TEST_EXE}:{}),args:process.env.PET_TEST_EXE?['--panel']:[path.resolve('.'),'--panel'],env});
 const errors=[],remoteRequests=[],checks=[];
 try{
  app.on('window',page=>{page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url()))remoteRequests.push(r.url());});});
  await app.firstWindow();let pet,panel;for(let i=0;i<150;i++){pet=app.windows().find(p=>p.url().includes('page=pet'));panel=app.windows().find(p=>p.url().includes('page=panel'));if(pet&&panel)break;await wait(100);}
  assert(pet&&panel);await pet.waitForSelector('canvas[data-avatar="live2d"]',{timeout:30000});
  await panel.waitForFunction(async()=>Boolean(await window.pet.getDebug()));
  const get=()=>panel.evaluate(()=>window.pet.getDebug());
  const request=(type,groupId)=>panel.evaluate(({type,groupId})=>window.pet.panelRequest({type:'command',command:{protocolVersion:1,commandId:crypto.randomUUID(),type,...(groupId?{groupId}:{})}}),{type,groupId});
  const complete=async id=>{for(let i=0;i<220;i++){if((await get()).events.some(e=>e.type==='action_lifecycle'&&e.payload.actionInstanceId===id&&e.payload.status==='completed'))return;await wait(100);}throw Error('动作未完成 '+id);};
  const check=name=>{checks.push(name);console.log('PASS',name);};
  await panel.evaluate(async()=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),paused:true,roaming:false,size:1}));await request('stop_current');await wait(250);
  const core=await pet.evaluate(()=>({version:window.Live2DCubismCore.Version.csmGetVersion(),csp:document.querySelector('meta[http-equiv="Content-Security-Policy"]').content,nodeIntegration:typeof window.require,pose:document.querySelector('canvas').dataset.pose}));
  assert(core.version);assert(core.csp.includes("'wasm-unsafe-eval'"));assert(!core.csp.includes("'unsafe-eval'"));assert.equal(core.nodeIntegration,'undefined');check('本地 Core 加载；隔离与 CSP 保留');
  await pet.screenshot({path:path.join(dir,'standing.png'),omitBackground:true});
  // Instrument the already-running Core update to observe actual parameter values, not a mock.
  await pet.evaluate(()=>{const original=window.Live2DCubismCore.Model.prototype.update;window.__liveSamples=[];window.Live2DCubismCore.Model.prototype.update=function(){const result=original.call(this);window.__liveSamples.push(Object.fromEntries(this.parameters.ids.map((id,i)=>[id,this.parameters.values[i]])));if(window.__liveSamples.length>1000)window.__liveSamples.shift();return result;};});
  await wait(7500);const samples=await pet.evaluate(()=>window.__liveSamples);assert(samples.some(s=>s.ParamEyeLOpen<.15));assert(samples.some(s=>s.ParamEyeLOpen>.99));assert(Math.max(...samples.map(s=>s.ParamTail))-Math.min(...samples.map(s=>s.ParamTail))>.4);check('实际模型自动眨眼与独立尾巴待机');
  // Exercise the trusted sampler path without moving the user's real system cursor.
  await app.evaluate(({screen,BrowserWindow})=>{globalThis.__cursorOriginal=screen.getCursorScreenPoint;const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet');screen.getCursorScreenPoint=()=>{const {x,y,width,height}=w.getBounds();return {x:x+Math.round(width*.91),y:y+Math.round(height*.24)};};});try{await pet.waitForFunction(()=>window.__liveSamples.at(-1)?.ParamEyeBallX>.65&&window.__liveSamples.at(-1)?.ParamEyeBallY<-.3,undefined,{timeout:5000});}catch(e){console.log('GAZE_DIAGNOSTIC',JSON.stringify(await pet.evaluate(()=>({last:window.__liveSamples.at(-1),n:window.__liveSamples.length}))),JSON.stringify(await panel.evaluate(async()=>(await window.pet.bootstrap()).desktop)),JSON.stringify((await get()).errors));throw e;}
  const gaze=await pet.evaluate(()=>window.__liveSamples.at(-1));assert(gaze.ParamEyeBallX>.65);assert(gaze.ParamEyeBallY<-.3);await app.evaluate(({screen})=>{screen.getCursorScreenPoint=globalThis.__cursorOriginal;});check('主进程鼠标采样接入双轴视线');
  const wave=await request('play_group','builtin.deepblue:greet_wave');assert.equal(wave.status,'accepted');await wait(600);await pet.screenshot({path:path.join(dir,'wave.png'),omitBackground:true});
  const forbidden=await request('play_group','builtin.deepblue:sleep_short');assert.equal(forbidden.errorCode,'REQUIRES_STANDING');await complete(wave.actionInstanceId);check('原有招手动作与站立入睡限制');
  await wait(160);const sleep=await request('play_group','builtin.deepblue:sleep_short');assert.equal(sleep.status,'accepted');await wait(1900);assert.equal(await pet.getAttribute('canvas','data-pose'),'frames');await pet.screenshot({path:path.join(dir,'sleep.png'),omitBackground:true});
  const count=await pet.evaluate(()=>window.__liveSamples.length);await wait(300);assert.equal(await pet.evaluate(()=>window.__liveSamples.length),count);check('睡眠显示原有帧动画，暂停隐藏的 Live2D 运算');
  await complete(sleep.actionInstanceId);assert.equal(await pet.getAttribute('canvas','data-pose'),'standing');check('睡眠自然完成后恢复 Live2D');
  await wait(150);const again=await request('play_group','builtin.deepblue:sleep_short');assert.equal(again.status,'accepted');await wait(200);await request('stop_current');await wait(200);assert.equal(await pet.getAttribute('canvas','data-pose'),'standing');check('取消睡眠清理效果并恢复 Live2D');
  for(const id of ['water_magic','look_around','head_touch','body_touch']){await wait(150);const action=await request('play_group','builtin.deepblue:'+id);assert.equal(action.status,'accepted');if(id==='head_touch'){await wait(300);await pet.screenshot({path:path.join(dir,'head-touch.png'),omitBackground:true});}await complete(action.actionInstanceId);assert.equal(await pet.getAttribute('canvas','data-pose'),'standing');}check('逐帧水光、张望、摸头和身体交互兼容');
  await panel.evaluate(async()=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),size:1.5,fps:30}));await wait(350);assert.equal(await pet.evaluate(()=>innerWidth),510);await pet.screenshot({path:path.join(dir,'scaled.png'),omitBackground:true});check('大小与 30 FPS 设置生效');
  const reload=await panel.evaluate(()=>window.pet.reloadPacks());assert.equal(reload.ok,true,reload.message);await wait(250);assert.equal(await pet.getAttribute('canvas','data-pose'),'standing');check('资源重载保留可用 Live2D 模型');
  assert.deepEqual((await get()).errors,[]);assert.deepEqual(errors,[]);assert.deepEqual(remoteRequests,[]);check('零运行错误、零 HTTP(S) 资源请求');
  await panel.bringToFront();await panel.screenshot({path:path.join(dir,'panel.png')});
  await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({tag,executable:process.env.PET_TEST_EXE??'project Electron',core,checks,errors,remoteRequests},null,2));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
