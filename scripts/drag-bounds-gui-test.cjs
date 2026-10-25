const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const tag=process.env.PET_TEST_EXE?'packaged':'source',dir=path.resolve('test-results/drag-bounds',tag);await fs.mkdir(dir,{recursive:true});
 const env={...process.env,PET_TEST_USER:path.join(dir,'user'),ELECTRON_RENDERER_URL:''};delete env.ELECTRON_RUN_AS_NODE;
 const app=await electron.launch({...(process.env.PET_TEST_EXE?{executablePath:process.env.PET_TEST_EXE}:{}),args:process.env.PET_TEST_EXE?['--panel']:[path.resolve('.'),'--panel'],env});
 const errors=[],checks=[];
 try{
  app.on('window',p=>p.on('pageerror',e=>errors.push(e.message)));await app.firstWindow();
  let pet,panel;const until=async(fn)=>{for(let i=0;i<140;i++){if(await fn())return;await delay(60);}throw Error('State timeout');};
  await until(()=>{pet=app.windows().find(p=>p.url().includes('page=pet'));panel=app.windows().find(p=>p.url().includes('page=panel'));return pet&&panel;});
  await pet.waitForSelector('canvas[data-avatar="live2d"]',{timeout:45000});
  await panel.evaluate(async()=>window.pet.saveSettings({...((await window.pet.bootstrap()).settings),paused:true,roaming:false,fixedPosition:false,size:1}));
  await panel.evaluate(()=>window.pet.panelRequest({type:'command',command:{protocolVersion:1,commandId:crypto.randomUUID(),type:'stop_current'}}));
  const pose=id=>pet.waitForFunction(id=>document.querySelector('canvas')?.dataset.pose===id,id);
  const bounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet').getBounds());
  // Isolated process only: virtual display/work-area geometry and cursor, real
  // IPC, native window positioning, resize, renderer and settings persistence.
  await app.evaluate(({screen})=>{
   const base=screen.getPrimaryDisplay();globalThis.testCursor={x:570,y:360};
   globalThis.testDisplays=[{...base,id:10001,workArea:{x:-1400,y:40,width:1200,height:900}},{...base,id:10002,workArea:{x:0,y:0,width:1280,height:1000}}];
   screen.getAllDisplays=()=>globalThis.testDisplays;screen.getCursorScreenPoint=()=>globalThis.testCursor;
  });
  const cases=[
   {name:'左侧越界',from:[-1600,100],to:[-1400,100]},
   {name:'右侧越界',from:[1200,300],to:[940,300]},
   {name:'顶部越界',from:[300,-80],to:[300,0]},
   {name:'底部工作区边界',from:[300,900],to:[300,580]},
   {name:'屏幕间隙就近回左屏',from:[-420,300],to:[-540,300]},
   {name:'屏幕间隙就近回右屏',from:[-100,300],to:[0,300]},
   {name:'站立已合法不被透明边距推开',from:[900,300],to:[900,300]},
   {name:'越界中改变画布仍跟手',from:[1200,300],to:[940,300],resize:true},
   {name:'失焦取消也归位',from:[300,-80],to:[300,0],blur:true},
   {name:'拖动时拔掉左屏',from:[-1200,150],to:[0,150],remove:true},
  ];
  for(const c of cases){
   await pose('standing');await until(async()=>!(await panel.evaluate(()=>window.pet.getDebug())).snapshot.currentAction);
   await app.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet').setPosition(400,150);globalThis.testCursor={x:570,y:360};});await delay(150);
   await pet.evaluate(()=>window.pet.pointerDown({x:570,y:360}));assert.equal(await pet.evaluate(()=>window.pet.dragStart()),true);await pose('sprite-rig');await until(async()=>(await bounds()).width===592);
   const held=await bounds(),target={x:c.from[0]-(held.width-340)/2,y:c.from[1]-(held.height-420)};
   await app.evaluate((_,delta)=>{globalThis.testCursor.x+=delta.x;globalThis.testCursor.y+=delta.y;},{x:target.x-held.x,y:target.y-held.y});
   await until(async()=>{const b=await bounds();return b.x===target.x&&b.y===target.y;});await delay(150);
   assert.equal((await pet.evaluate(()=>window.pet.bootstrap())).desktop.dragging,true);
   assert.equal((await bounds()).x,target.x);assert.equal((await bounds()).y,target.y);
   if(c.resize){await pet.evaluate(()=>window.pet.setViewport({width:700,height:450}));const b=await bounds();assert.equal(b.x+b.width/2,c.from[0]+170);assert.equal(b.y+b.height,c.from[1]+420);}
   if(c.remove)await app.evaluate(({screen})=>{const removed=globalThis.testDisplays.shift();screen.emit('display-removed',{},removed);});
   else if(c.blur)await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.getTitle()==='DeepBlue Pet').emit('blur'));
   else await pet.evaluate(()=>window.pet.dragEnd());
   await pose('standing');await until(async()=>{const b=await bounds();return b.width===340&&b.height===420&&b.x===c.to[0]&&b.y===c.to[1];});
   await until(async()=>{const s=await pet.evaluate(()=>window.pet.bootstrap());return !s.desktop.dragging&&s.settings.position?.x===c.to[0]&&s.settings.position?.y===c.to[1];});
   checks.push({name:c.name,draggedStandingAnchor:c.from,returned:c.to});
  }
  assert.deepEqual((await panel.evaluate(()=>window.pet.getDebug())).errors,[]);assert.deepEqual(errors,[]);
  const report={tag,version:await app.evaluate(({app})=>app.getVersion()),checks,errors};await fs.writeFile(path.join(dir,'gui-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{await app.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
