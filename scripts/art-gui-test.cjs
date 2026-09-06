const { _electron: electron } = require('playwright');
const path = require('node:path');
const fs = require('node:fs/promises');
const assert = require('node:assert/strict');
(async()=>{
  const env={...process.env,PET_TEST_USER:path.resolve('.art-test-user')};delete env.ELECTRON_RUN_AS_NODE;
  const app=await electron.launch({args:[path.resolve('.'),'--panel','--remote-debugging-port=9226'],env});
  await app.firstWindow();await new Promise(r=>setTimeout(r,2000));
  const pet=app.windows().find(p=>p.url().includes('page=pet'));
  const panel=app.windows().find(p=>p.url().includes('page=panel'));
  await pet.waitForSelector('canvas');
  await panel.waitForFunction(async()=>Boolean(await window.pet.getDebug()),undefined,{timeout:60000});
  const save=patch=>panel.evaluate(async patch=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),...patch}),patch);
  const play=groupId=>panel.evaluate(groupId=>window.pet.panelRequest({type:'command',command:{protocolVersion:1,commandId:crypto.randomUUID(),type:'play_group',groupId}}),groupId);
  await save({paused:true,roaming:false,size:1,alwaysOnTop:true});
  await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet').setPosition(750,250);});
  await fs.mkdir('test-results/art-v2',{recursive:true});
  for(const [name,id,delay] of [['wave','greet_wave',470],['sleep','sleep_short',500],['water','water_magic',450],['body','body_touch',350]]){
    const receipt=await play('builtin.deepblue:'+id);assert.equal(receipt.status,'accepted');
    await new Promise(r=>setTimeout(r,delay));await pet.screenshot({path:`test-results/art-v2/${name}.png`,omitBackground:true});
    await panel.evaluate(()=>window.pet.panelRequest({type:'command',command:{protocolVersion:1,commandId:crypto.randomUUID(),type:'stop_current'}}));
  }
  await pet.screenshot({path:'test-results/art-v2/idle.png',omitBackground:true});
  await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>w.getTitle()!=='DeepBlue Pet').hide();});
  if(process.env.ART_GUI_ONCE==='1'){assert.deepEqual((await panel.evaluate(()=>window.pet.getDebug())).errors,[]);await app.close();console.log('ART_GUI_PASS');return;}
  console.log('ART_GUI_READY');
  const timer=setInterval(async()=>{try{const state=await panel.evaluate(()=>window.pet.getDebug());const bounds=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet').getBounds());await fs.writeFile('test-results/art-v2/live.json',JSON.stringify({state,bounds},null,2));}catch{}},500);
  await new Promise(r=>app.on('close',r));clearInterval(timer);
})().catch(e=>{console.error(e);process.exitCode=1;});
