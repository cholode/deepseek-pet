const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const tag=process.env.PET_TEST_EXE?'packaged':'source',dir=path.resolve('test-results/phone-faces',tag);
 await fs.mkdir(dir,{recursive:true});
 const env={...process.env,PET_TEST_USER:path.join(dir,'user'),ELECTRON_RENDERER_URL:''};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...(process.env.PET_TEST_EXE?{executablePath:process.env.PET_TEST_EXE}:{}),args:process.env.PET_TEST_EXE?['--panel']:[path.resolve('.'),'--panel'],env});
 const errors=[],remote=[],checks=[];
 try{
  const attach=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});};
  app.on('window',attach);app.windows().forEach(attach);await app.firstWindow();let pet,panel;
  for(let i=0;i<150;i++){pet=app.windows().find(p=>p.url().includes('page=pet'));panel=app.windows().find(p=>p.url().includes('page=panel'));if(pet&&panel)break;await wait(100);}
  assert(pet&&panel);await pet.waitForSelector('canvas[data-avatar="live2d"]',{timeout:45000});
  await panel.evaluate(async()=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),paused:true,roaming:false,fixedPosition:true,size:1}));
  const command=(type,id)=>panel.evaluate(({type,id})=>window.pet.panelRequest({type:'command',command:{protocolVersion:1,commandId:crypto.randomUUID(),type,...(id?{groupId:'builtin.deepblue:'+id}:{})}}),{type,id});
  const get=()=>panel.evaluate(()=>window.pet.getDebug());
  const standing=()=>pet.waitForFunction(()=>document.querySelector('canvas')?.dataset.pose==='standing');
  const frames=()=>pet.waitForFunction(()=>document.querySelector('canvas')?.dataset.pose==='frames');
  await command('stop_current');await standing();await wait(200);
  const size=await pet.evaluate(()=>({w:innerWidth,h:innerHeight}));
  const pack=await panel.evaluate(async()=>(await window.pet.bootstrap()).registry.packs.find(p=>p.manifest.id==='builtin.deepblue'));
  assert.equal(pack.manifest.version,require('../package.json').version);assert.equal(pack.groups.length,32);
  const groups=pack.groups.filter(g=>/^play_phone(?:_|$)/.test(g.id));assert.equal(groups.length,12);
  const base=pack.motions.find(m=>m.id==='play_phone');assert.equal(base.frames.length,96);
  await panel.getByRole('button',{name:/^动作组/}).click();
  for(const g of groups){
   const m=pack.motions.find(m=>m.id===g.id);assert.equal(m.fps,24);assert.equal(m.durationMs,4000);assert.deepEqual(m.frames,base.frames);
   if(g.id!=='play_phone'){assert.equal(m.frameOverlays.length,1);assert.equal(g.random.eligible,false);}
   const card=panel.locator('article').filter({has:panel.locator('code').filter({hasText:new RegExp('^builtin.deepblue:'+g.id+'$')})});
   await card.getByRole('button',{name:'预览',exact:true}).click();await frames();
   assert.equal((await get()).snapshot.currentAction.groupId,'builtin.deepblue:'+g.id);
   await wait(650);await pet.screenshot({path:path.join(dir,g.id+'.png'),omitBackground:true});
   await command('stop_current');await standing();await wait(130);assert.deepEqual(await pet.evaluate(()=>({w:innerWidth,h:innerHeight})),size);
   checks.push(g.name+'：面板预览与停止复位');
  }
  await command('play_group','play_phone_super_shy');await frames();
  const instance=(await get()).snapshot.currentAction;
  await wait(2000);await pet.screenshot({path:path.join(dir,'super-shy-hold.png'),omitBackground:true});
  await standing();
  let completed;for(let i=0;i<30;i++){completed=(await get()).events.find(e=>e.type==='action_lifecycle'&&e.payload.actionInstanceId===instance.actionInstanceId&&e.payload.status==='completed');if(completed)break;await wait(100);}
  assert(completed);checks.push('超级害羞重播自然完成，恢复站立');
  await wait(150);await command('play_group','play_phone_wink');await frames();
  assert.equal((await panel.evaluate(()=>window.pet.reloadPacks())).ok,true);await standing();await wait(200);
  await command('play_group','play_phone_shy');await frames();await wait(300);await command('stop_current');await standing();await wait(150);
  checks.push('播放中重载清理图集视图，重载后可再播放另一表情');
  await command('play_group','greet_wave');assert.equal((await command('play_group','play_phone_smile')).errorCode,'REQUIRES_STANDING');
  await command('stop_current');await standing();checks.push('仅从站立进入');
  await panel.getByRole('button',{name:'设置',exact:true}).click();
  for(const g of groups)assert.equal(await panel.getByLabel('摸头动作').getByRole('option',{name:g.name,exact:true}).count(),1);
  checks.push('十二种表情均可绑定鼠标点击');
  assert.deepEqual((await get()).errors,[]);assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  const report={tag,version:await app.evaluate(({app})=>app.getVersion()),checks,errors,remote};
  await fs.writeFile(path.join(dir,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
