const {_electron:electron}=require('playwright');
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const tag=process.env.PET_TEST_EXE?'packaged':'source',dir=path.resolve('test-results/gif-curtsy',tag);await fs.mkdir(dir,{recursive:true});
 const env={...process.env,PET_TEST_USER:path.join(dir,'user'),ELECTRON_RENDERER_URL:''};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...(process.env.PET_TEST_EXE?{executablePath:process.env.PET_TEST_EXE}:{}),args:process.env.PET_TEST_EXE?['--panel']:[path.resolve('.'),'--panel'],env});
 const errors=[],remote=[],checks=[];
 try{
  app.on('window',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});});
  await app.firstWindow();let pet,panel;
  for(let i=0;i<150;i++){pet=app.windows().find(p=>p.url().includes('page=pet'));panel=app.windows().find(p=>p.url().includes('page=panel'));if(pet&&panel)break;await wait(100);}
  assert(pet&&panel);await pet.waitForSelector('canvas[data-avatar="live2d"]',{timeout:30000});
  await panel.evaluate(async()=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),paused:true,roaming:false,size:1}));
  const command=(type,id)=>panel.evaluate(({type,id})=>window.pet.panelRequest({type:'command',command:{protocolVersion:1,commandId:crypto.randomUUID(),type,...(id?{groupId:'builtin.deepblue:'+id}:{})}}),{type,id});
  const get=()=>panel.evaluate(()=>window.pet.getDebug());
  const standing=()=>pet.waitForFunction(()=>document.querySelector('canvas')?.dataset.pose==='standing');
  const frames=()=>pet.waitForFunction(()=>document.querySelector('canvas')?.dataset.pose==='frames');
  await command('stop_current');await standing();await wait(150);
  const before=await pet.evaluate(()=>({w:innerWidth,h:innerHeight}));
  assert.equal((await get()).groups.length,21);
  await pet.screenshot({path:path.join(dir,'standing.png'),omitBackground:true});
  await panel.getByRole('button',{name:/^动作组/}).click();
  const card=panel.locator('article').filter({has:panel.getByRole('heading',{name:/^提裙摇摇/})});
  await card.getByRole('button',{name:'预览',exact:true}).click();await frames();
  const instance=(await get()).snapshot.currentAction;assert.equal(instance.groupId,'builtin.deepblue:curtsy_sway');
  const hashes=[];
  for(let i=0;i<3;i++){await wait(300);const png=await pet.screenshot({path:path.join(dir,`playing-${i}.png`),omitBackground:true});hashes.push(crypto.createHash('sha256').update(png).digest('hex'));}
  assert.equal(new Set(hashes).size,3,'frames must visibly advance');
  await standing();
  let completed;
  for(let i=0;i<30;i++){completed=(await get()).events.find(e=>e.type==='action_lifecycle'&&e.payload.actionInstanceId===instance.actionInstanceId&&e.payload.status==='completed');if(completed)break;await wait(100);}
  if(!completed)await fs.writeFile(path.join(dir,'failure-debug.json'),JSON.stringify(await get(),null,2));assert(completed);
  assert.deepEqual(await pet.evaluate(()=>({w:innerWidth,h:innerHeight})),before);checks.push('真实预览切换到透明 PNG，帧画面推进，单次自然结束并恢复站立与窗口尺寸');
  await wait(150);assert.equal((await command('play_group','curtsy_sway')).status,'accepted');await frames();await wait(250);await command('stop_current');await standing();checks.push('中途停止恢复 Live2D');
  await wait(150);assert.equal((await command('play_group','curtsy_sway')).status,'accepted');await frames();assert.equal((await panel.evaluate(()=>window.pet.reloadPacks())).ok,true);await standing();checks.push('资源重载清理 GIF 姿态');
  await wait(150);await command('play_group','greet_wave');assert.equal((await command('play_group','curtsy_sway')).errorCode,'REQUIRES_STANDING');await command('stop_current');await standing();checks.push('只从站立进入，拒绝打断其他姿态');
  await panel.getByRole('button',{name:'设置',exact:true}).click();assert.equal(await panel.getByLabel('摸头动作').getByRole('option',{name:'提裙摇摇',exact:true}).count(),1);checks.push('可选择为鼠标点击回应');
  assert.deepEqual((await get()).errors,[]);assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);checks.push('运行无错误、无外网请求');
  await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({tag,checks,errors,remote},null,2));console.log(JSON.stringify({tag,checks}));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
