const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
(async () => {
  await fs.mkdir('test-results', { recursive: true });
  const env = { ...process.env, PET_TEST_USER: path.resolve('.test-user'), ELECTRON_RENDERER_URL: '' }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ args: [path.resolve('.'), '--panel', '--remote-debugging-port=9225'], env });
  app.process().stdout.on('data', d => process.stdout.write(d)); app.process().stderr.on('data', d => process.stderr.write(d));
  await app.firstWindow();
  await new Promise(r=>setTimeout(r,2000));
  console.log('WINDOWS',app.windows().map(p=>p.url()));
  const pet = app.windows().find(p=>p.url().includes('page=pet'));
  for(const p of app.windows()) { p.on('pageerror', e => console.log('PAGE ERROR',e.message)); p.on('console', m => { if(m.type()==='error') console.log('BROWSER ERROR',m.text()); }); }
  await pet.waitForSelector('canvas', { timeout: 30000 });
  const panel = app.windows().find(p => p.url().includes('page=panel')) || await app.waitForEvent('window');
  await panel.waitForFunction(() => document.body.textContent.includes('你的小蓝'));
  await new Promise(r => setTimeout(r, 3000));
  const report={startedAt:new Date().toISOString(),checks:[],samples:[]};
  const check=(name)=>{report.checks.push(name);console.log('PASS',name);};
  const get=()=>panel.evaluate(()=>window.pet.getDebug());
  const request=(type,groupId)=>panel.evaluate(({type,groupId})=>window.pet.panelRequest({type:'command',command:type==='play_group'?{protocolVersion:1,commandId:crypto.randomUUID(),type,groupId}:{protocolVersion:1,commandId:crypto.randomUUID(),type}}),{type,groupId});
  const save=patch=>panel.evaluate(async patch=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),...patch}),patch);
  const wait=async fn=>{const end=Date.now()+15000;while(Date.now()<end){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error('Condition timeout');};
  await wait(async()=>Boolean(await get()));
  assert.equal((await get()).groups.length>=13,true);check('13 builtin groups in live renderer');
  await app.evaluate(({Menu})=>{const original=Menu.prototype.popup;Menu.prototype.popup=function(options){globalThis.__testContextMenu=this;return original.call(this,options);};});
  try { const result=await pet.evaluate(()=>window.pet.contextMenu());assert.equal(result,undefined);check('context menu IPC resolves without cloning native Menu'); }
  finally { await app.evaluate(()=>globalThis.__testContextMenu?.closePopup()); }
  await save({paused:true,roaming:false,fixedPosition:false});await request('stop_current');
  await new Promise(r=>setTimeout(r,300));
  await pet.screenshot({ path: 'test-results/pet-start.png', omitBackground: true });
  await panel.screenshot({ path: 'test-results/panel-home.png' });
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet');w.setPosition(600,300);});
  for(const g of (await get()).groups.filter(g=>g.packId==='builtin.deepblue')){const result=await request('play_group',g.groupId);assert.equal(result.status,'accepted',JSON.stringify(result));await wait(async()=>(await get()).events.some(e=>e.type==='action_lifecycle'&&e.payload.actionInstanceId===result.actionInstanceId&&e.payload.status==='completed'));check(`live playback complete: ${g.id}`);}
  const ai=await panel.evaluate(()=>window.pet.panelRequest({type:'mode',mode:'ai'}));assert.equal(ai.errorCode,'MODE_NOT_AVAILABLE');check('AI unavailable in real IPC');
  await save({fixedPosition:true});const fixed=await request('play_group','builtin.deepblue:walk_left');assert.equal(fixed.errorCode,'FIXED_POSITION');await save({fixedPosition:false});check('fixed position blocks manual movement');
  await new Promise(r=>setTimeout(r,150));const walking=await request('play_group','builtin.deepblue:walk_left');assert.equal(walking.status,'accepted');await new Promise(r=>setTimeout(r,350));await request('stop_current');await new Promise(r=>setTimeout(r,100));const p1=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet').getPosition());await new Promise(r=>setTimeout(r,500));const p2=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet').getPosition());assert.deepEqual(p1,p2);check('cancelled desktop movement remains stopped');
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});dialog.showMessageBox=async()=>({response:1,checkboxChecked:false});},path.resolve('examples/custom-action-pack'));
  const imported=await panel.evaluate(()=>window.pet.importPack());assert.equal(imported.ok,true,imported.message);await wait(async()=>(await get()).groups.some(g=>g.groupId==='user.celebrations:celebrate'));check('native folder import pipeline with deterministic dialog selection');
  const custom=await request('play_group','user.celebrations:celebrate');assert.equal(custom.status,'accepted');await wait(async()=>(await get()).events.some(e=>e.type==='action_lifecycle'&&e.payload.actionInstanceId===custom.actionInstanceId&&e.payload.status==='completed'));check('supplied custom JSON motion + group actually play');
  const reload=await panel.evaluate(()=>window.pet.reloadPacks());assert.equal(reload.ok,true,reload.message);check('transactional resource reload succeeds');
  await panel.getByRole('button',{name:/^动作组/}).click();await panel.screenshot({path:'test-results/panel-actions.png'});await panel.getByRole('button',{name:'设置',exact:true}).click();await panel.screenshot({path:'test-results/panel-settings.png'});await panel.getByRole('button',{name:'桌宠',exact:true}).click();
  assert.equal((await get()).errors.length,0,JSON.stringify((await get()).errors));check('no runtime errors after playback/import/reload');
  await save({paused:false,roaming:true});
  await fs.writeFile('test-results/gui-report.json',JSON.stringify(report,null,2));
  if(process.env.PET_GUI_KEEP === '1') { console.log('GUI_READY'); const start=Date.now();const timer=setInterval(async()=>{try{const s=await get();const metrics=await app.evaluate(({app})=>({metrics:app.getAppMetrics().map(m=>({type:m.type,memory:m.memory,cpu:m.cpu})),resources:process.getActiveResourcesInfo()}));report.samples.push({elapsedMs:Date.now()-start,current:s.snapshot.currentAction?.groupId??null,errors:s.errors.length,events:s.events.length,...metrics});await fs.writeFile('test-results/live-state.json',JSON.stringify(s,null,2));await fs.writeFile('test-results/gui-report.json',JSON.stringify(report,null,2));if(report.samples.length%12===0)console.log('SOAK_SECONDS',Math.round((Date.now()-start)/1000),'ERRORS',s.errors.length); }catch(e){console.log('MONITOR',e.message);}},5000);await new Promise(r => app.on('close',r));clearInterval(timer); }
  else await app.close();
})().catch(e=>{console.error(e);process.exitCode=1;});

