// App-scoped verification of the data-driven profile walking frames and movement.
const {_electron:electron}=require('playwright');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const dir=path.resolve('test-results/side-walk-'+(process.env.PET_TEST_EXE?'packaged':'source'));await fs.mkdir(dir,{recursive:true});
 const env={...process.env,PET_TEST_USER:path.join(dir,'user'),ELECTRON_RENDERER_URL:''};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...(process.env.PET_TEST_EXE?{executablePath:process.env.PET_TEST_EXE}:{}),args:process.env.PET_TEST_EXE?['--panel']:[path.resolve('.'),'--panel'],env});
 const errors=[],checks=[];app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)));
 try{
  await app.firstWindow();let pet,panel;for(let i=0;i<200;i++){pet=app.windows().find(p=>p.url().includes('page=pet'));panel=app.windows().find(p=>p.url().includes('page=panel'));if(pet&&panel)break;await wait(100);}assert(pet&&panel);
  await pet.waitForSelector('canvas[data-avatar="live2d"]');await panel.waitForFunction(async()=>Boolean(await window.pet.getDebug()));await wait(350);
  const get=()=>panel.evaluate(()=>window.pet.getDebug());
  const save=patch=>panel.evaluate(async patch=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),...patch}),patch);
  const request=(type,id)=>panel.evaluate(({type,id})=>window.pet.panelRequest({type:'command',command:{protocolVersion:1,commandId:crypto.randomUUID(),type,...(id?{groupId:'builtin.deepblue:'+id}:{})}}),{type,id});
  const pos=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet').getPosition());
  const complete=async id=>{for(let i=0;i<100;i++){if((await get()).events.some(e=>e.type==='action_lifecycle'&&e.payload.actionInstanceId===id&&e.payload.status==='completed'))return;await wait(100);}throw Error('walking did not complete');};
  const check=name=>{checks.push(name);console.log('PASS',name);};
  await save({paused:true,roaming:false,fixedPosition:false,size:1});await request('stop_current');await wait(200);
  await app.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet'),a=screen.getPrimaryDisplay().workArea;w.setPosition(Math.round(a.x+(a.width-w.getSize()[0])/2),Math.round(a.y+(a.height-w.getSize()[1])/2));});
  await pet.screenshot({path:path.join(dir,'front.png'),omitBackground:true});
  const motions=await panel.evaluate(async()=>{const b=await window.pet.bootstrap();return b.registry.packs.find(p=>p.manifest.id==='builtin.deepblue').motions.filter(m=>m.id.startsWith('walk_'));});
  assert(motions.every(m=>m.kind==='frame_animation'&&m.frames.length===32&&m.channels.includes('face')));check('左右动作读取各自的 32 帧侧面素材');
  for(const direction of ['left','right']){
   const before=await pos();const r=await request('play_group','walk_'+direction);assert.equal(r.status,'accepted');await wait(400);
   assert.equal(await pet.getAttribute('canvas','data-pose'),'frames');await pet.screenshot({path:path.join(dir,direction+'.png'),omitBackground:true});
   const mid=await pos();assert(direction==='left'?mid[0]<before[0]:mid[0]>before[0]);assert.equal(mid[1],before[1]);
   await complete(r.actionInstanceId);assert.equal(await pet.getAttribute('canvas','data-pose'),'standing');
   const after=await pos();assert(Math.abs(after[0]-before[0]-(direction==='left'?-120:120))<=2,JSON.stringify({direction,before,after,expectedDelta:direction==='left'?-120:120}));await pet.screenshot({path:path.join(dir,direction+'-finished.png'),omitBackground:true});
   check(direction==='left'?'向左侧身、实际移动 120 DIP、完成恢复正面':'向右侧身、实际移动 120 DIP、完成恢复正面');await wait(180);
  }
  const active=await request('play_group','walk_left');assert.equal(active.status,'accepted');await wait(400);await request('stop_current');await wait(150);assert.equal(await pet.getAttribute('canvas','data-pose'),'standing');const stopped=await pos();await wait(350);assert.deepEqual(await pos(),stopped);check('中途取消恢复正面并停止窗口移动');
  await save({fixedPosition:true});assert.equal((await request('play_group','walk_right')).errorCode,'FIXED_POSITION');assert.equal(await pet.getAttribute('canvas','data-pose'),'standing');await save({fixedPosition:false});check('固定位置仍拒绝移动，不留下侧面姿态');
  const again=await request('play_group','walk_right');assert.equal(again.status,'accepted');await wait(250);const reload=await panel.evaluate(()=>window.pet.reloadPacks());assert.equal(reload.ok,true);await wait(200);assert.equal(await pet.getAttribute('canvas','data-pose'),'standing');check('走路期间重新加载，清理帧动画并恢复正面');
  assert.deepEqual((await get()).errors,[]);assert.deepEqual(errors,[]);check('无运行错误');
  await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({checks,errors,motions:motions.map(m=>({id:m.id,frames:m.frames.length,duration:m.durationMs,fps:m.fps}))},null,2));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
