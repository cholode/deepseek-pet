const {_electron:electron}=require('playwright');
const path=require('node:path'),fs=require('node:fs/promises'),assert=require('node:assert/strict');
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const actions=[['confused_tilt','confused','歪头疑惑'],['sad_pout','sad','有点委屈'],['smug_pose','smug','小小得意'],['unimpressed_pause','unimpressed','有点无语'],['playful_wink','wink','俏皮眨单眼']];
(async()=>{
 const tag=process.env.PET_TEST_EXE?'packaged':'source',dir=path.resolve('test-results/expressions-'+tag);await fs.mkdir(dir,{recursive:true});
 const env={...process.env,PET_TEST_USER:path.join(dir,'user'),ELECTRON_RENDERER_URL:''};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...(process.env.PET_TEST_EXE?{executablePath:process.env.PET_TEST_EXE}:{}),args:process.env.PET_TEST_EXE?['--panel']:[path.resolve('.'),'--panel'],env});
 const errors=[],remote=[],checks=[];
 try{
  app.on('window',p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});});
  await app.firstWindow();let pet,panel;
  for(let i=0;i<150;i++){pet=app.windows().find(p=>p.url().includes('page=pet'));panel=app.windows().find(p=>p.url().includes('page=panel'));if(pet&&panel)break;await wait(100);}
  assert(pet&&panel);await pet.waitForSelector('canvas[data-avatar="live2d"]',{timeout:30000});
  await panel.evaluate(async()=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),paused:true,roaming:false,size:1}));
  const request=(type,id)=>panel.evaluate(({type,id})=>window.pet.panelRequest({type:'command',command:{protocolVersion:1,commandId:crypto.randomUUID(),type,...(id?{groupId:'builtin.deepblue:'+id}:{})}}),{type,id});
  const get=()=>panel.evaluate(()=>window.pet.getDebug());
  const complete=async id=>{for(let i=0;i<60;i++){if((await get()).events.some(e=>e.type==='action_lifecycle'&&e.payload.actionInstanceId===id&&e.payload.status==='completed'))return;await wait(100);}throw Error('未自然完成 '+id);};
  const reset=()=>pet.waitForFunction(()=>document.querySelector('canvas')?.dataset.expression==='neutral'&&window.__faces.at(-1)?.values.ParamMouthActive===0&&window.__faces.at(-1)?.values.ParamTear===0);
  await request('stop_current');await wait(200);
  await pet.evaluate(()=>{const update=window.Live2DCubismCore.Model.prototype.update;window.__faces=[];window.Live2DCubismCore.Model.prototype.update=function(){const result=update.call(this);const op=id=>this.drawables.opacities[this.drawables.ids.indexOf(id)];window.__faces.push({expression:document.querySelector('canvas')?.dataset.expression,values:Object.fromEntries(this.parameters.ids.map((id,i)=>[id,this.parameters.values[i]])),oldMouth:op('Mouth'),mouth:op('MouthLip'),leftClosed:op('EyeClosedL'),rightClosed:op('EyeClosedR'),tear:op('TearL')});if(window.__faces.length>1000)window.__faces.shift();return result;};});
  assert.equal((await get()).groups.length,18);
  await panel.getByRole('button',{name:/^动作组/}).click();
  for(const [id,face,name]of actions){
   assert.equal(await panel.getByRole('heading',{name:new RegExp('^'+name)}).count(),1);
   await wait(150);const result=await request('play_group',id);assert.equal(result.status,'accepted');
   await pet.waitForFunction(face=>document.querySelector('canvas')?.dataset.expression===face,face);await wait(250);
   const sample=await pet.evaluate(()=>window.__faces.at(-1));
   assert(sample.mouth>.999&&sample.oldMouth<.001,'only the selected mouth is visible');
   if(face==='wink'){assert(sample.leftClosed>.999);assert.equal(sample.rightClosed,0);assert.equal(sample.values.ParamEyeROpen,1);}
   if(face==='sad')assert(sample.tear>0);
   if(face==='confused')assert.equal(sample.values.ParamBrowAsym,1);
   if(face==='unimpressed'){assert.equal(sample.values.ParamMouthForm,0);assert.equal(sample.values.ParamBrowForm,0);}
   await pet.screenshot({path:path.join(dir,face+'.png'),omitBackground:true});await complete(result.actionInstanceId);await reset();
  }
  checks.push('五个新动作均在小屋显示、真实模型呈现并自然完成，恢复原嘴与表情');
  for(const [id,face]of actions){await wait(120);assert.equal((await request('play_group',id)).status,'accepted');await pet.waitForFunction(face=>document.querySelector('canvas').dataset.expression===face,face);await request('stop_current');await reset();}
  checks.push('五种表情中途停止均清除挑眉、嘴型、泪光和单眼闭合');
  await wait(150);await request('play_group','sad_pout');await pet.waitForFunction(()=>window.__faces.at(-1)?.values.ParamTear>0);
  await wait(120);const replacement=await request('play_group','playful_wink');assert.equal(replacement.status,'accepted',JSON.stringify(replacement));await pet.waitForFunction(()=>window.__faces.at(-1)?.expression==='wink');
  assert.equal(await pet.evaluate(()=>window.__faces.at(-1).values.ParamTear),0);await request('stop_current');await reset();checks.push('委屈被眨单眼抢占后不残留泪光');
  await wait(150);await request('play_group','smug_pose');await pet.waitForFunction(()=>document.querySelector('canvas').dataset.expression==='smug');assert.equal((await panel.evaluate(()=>window.pet.reloadPacks())).ok,true);await reset();checks.push('资源重载恢复中性表情');
  for(const [id,face]of [['happy_hop','smile'],['shy_pose','shy'],['annoyed_shake','annoyed'],['body_touch','surprised']]){await wait(150);assert.equal((await request('play_group',id)).status,'accepted');await pet.waitForFunction(face=>window.__faces.at(-1)?.expression===face,face);assert(await pet.evaluate(()=>window.__faces.at(-1).mouth>.999));await request('stop_current');await reset();}checks.push('开心、害羞、抗议、惊讶均使用新版嘴型');
  await panel.getByRole('button',{name:'设置',exact:true}).click();for(const [, ,name]of actions)assert.equal(await panel.getByLabel('摸头动作').getByRole('option',{name,exact:true}).count(),1);checks.push('新动作可选择为鼠标点击回应');
  assert.deepEqual((await get()).errors,[]);assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);checks.push('无运行错误、无外网请求');
  await fs.writeFile(path.join(dir,'report.json'),JSON.stringify({tag,checks,errors,remote},null,2));console.log(JSON.stringify({tag,checks}));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
