const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const tag=process.env.PET_TEST_EXE?'packaged':'source',dir=path.resolve('test-results/drag-held',tag);await fs.mkdir(dir,{recursive:true});
 const env={...process.env,PET_TEST_USER:path.join(dir,'user'),ELECTRON_RENDERER_URL:''};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...(process.env.PET_TEST_EXE?{executablePath:process.env.PET_TEST_EXE}:{}),args:process.env.PET_TEST_EXE?['--panel']:[path.resolve('.'),'--panel'],env});
 const errors=[],remote=[],checks=[];
 try{
  const attach=p=>{p.on('pageerror',e=>errors.push(e.message));p.on('request',r=>{if(/^https?:/.test(r.url()))remote.push(r.url());});};app.on('window',attach);app.windows().forEach(attach);
  await app.firstWindow();let pet,panel;for(let i=0;i<150;i++){pet=app.windows().find(p=>p.url().includes('page=pet'));panel=app.windows().find(p=>p.url().includes('page=panel'));if(pet&&panel)break;await delay(100);}assert(pet&&panel);
  await pet.waitForSelector('canvas[data-avatar="live2d"]',{timeout:45000});
  const save=patch=>panel.evaluate(async patch=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),...patch}),patch);
  await save({paused:true,roaming:false,fixedPosition:false,size:1});
  const command=(type,id)=>panel.evaluate(({type,id})=>window.pet.panelRequest({type:'command',command:{protocolVersion:1,commandId:crypto.randomUUID(),type,...(id?{groupId:'builtin.deepblue:'+id}:{})}}),{type,id});
  const get=()=>panel.evaluate(()=>window.pet.getDebug());
  const until=async fn=>{for(let i=0;i<120;i++){if(await fn())return;await delay(100);}throw Error('State timeout');};
  const pose=id=>pet.waitForFunction(id=>document.querySelector('canvas')?.dataset.pose===id,id);
  await command('stop_current');await pose('standing');await delay(300);
  const viewport=await pet.evaluate(()=>({w:innerWidth,h:innerHeight}));await pet.screenshot({path:path.join(dir,'standing.png'),omitBackground:true});
  // Inject cursor coordinates only in this isolated Electron main process. The
  // production pointer-down/drag-start IPC, window placement and renderer run unchanged.
  await app.evaluate(({screen})=>{globalThis.originalCursor=screen.getCursorScreenPoint;globalThis.testCursor=screen.getCursorScreenPoint();screen.getCursorScreenPoint=()=>globalThis.testCursor;});
  const press=async()=>{
    const point=await app.evaluate(({BrowserWindow})=>{const b=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet').getBounds();globalThis.testCursor={x:b.x+170,y:b.y+210};return globalThis.testCursor;});
    await pet.evaluate(p=>window.pet.pointerDown(p),point);return pet.evaluate(()=>window.pet.dragStart());
  };
  assert.equal(await press(),true);await pose('sprite-rig');await until(async()=>(await get()).snapshot.currentAction?.groupId==='builtin.deepblue:drag_held');
  const first=(await get()).snapshot.currentAction.actionInstanceId;
  const before=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet').getBounds());
  await app.evaluate(()=>{globalThis.testCursor.x-=40;globalThis.testCursor.y-=20;});await delay(300);
  const after=await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet').getBounds());
  assert.equal(after.x,before.x-40);assert.equal(after.y,before.y-20);assert.equal(after.width,before.width);assert.equal(after.height,before.height);
  await pet.screenshot({path:path.join(dir,'held.png'),omitBackground:true});assert.equal((await command('play_group','greet_wave')).errorCode,'DRAG_LOCKED');checks.push('拖动 IPC 触发组件动画，窗口跟随坐标且画布不变；手动动作仍被锁定');
  await until(async()=>{const s=(await get()).snapshot;return s.currentAction?.groupId==='builtin.deepblue:drag_held'&&s.currentAction.actionInstanceId!==first;});
  assert.equal((await get()).snapshot.dragging,true);checks.push('多次桌面广播不会重启动作，3.5 秒后连续进入下一轮');
  assert.equal((await panel.evaluate(()=>window.pet.reloadPacks())).ok,true);await until(async()=>(await get()).snapshot.currentAction?.groupId==='builtin.deepblue:drag_held');await pose('sprite-rig');checks.push('拖动期间重载后组件清理并恢复循环');
  await pet.evaluate(()=>window.pet.dragEnd());await pose('standing');await until(async()=>!(await get()).snapshot.currentAction);assert.deepEqual(await pet.evaluate(()=>({w:innerWidth,h:innerHeight})),viewport);checks.push('松手清理组件并完成站稳动作');
  await delay(150);assert.equal((await command('play_group','drag_held')).status,'accepted');await pose('sprite-rig');await pose('standing');await until(async()=>!(await get()).snapshot.currentAction);checks.push('面板手动预览只播放一轮');
  await delay(150);await command('play_group','sleep_short');await pose('frames');assert.equal(await press(),true);await pose('sprite-rig');await pet.evaluate(()=>window.pet.dragEnd());await pose('standing');await until(async()=>!(await get()).snapshot.currentAction);checks.push('从宽幅睡眠拖起后恢复标准画布，松手站立');
  assert.equal(await press(),true);await pose('sprite-rig');await app.evaluate(({powerMonitor})=>powerMonitor.emit('suspend'));await until(async()=>!(await get()).snapshot.currentAction);await app.evaluate(({powerMonitor})=>powerMonitor.emit('resume'));await pose('standing');checks.push('系统挂起事件取消拖动，恢复后保持站立');
  await save({fixedPosition:true});await delay(150);assert.equal(await press(),false);await pose('standing');checks.push('固定位置仍禁止拖动动画');
  assert.deepEqual((await get()).errors,[]);assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
  const report={tag,version:await app.evaluate(({app})=>app.getVersion()),checks,errors,remote};await fs.writeFile(path.join(dir,'gui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
