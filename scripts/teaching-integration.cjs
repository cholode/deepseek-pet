// 直接走生产 StudioService 和真实模型，不创建窗口/语音/软件插件，测试数据独立保存。
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..');
async function launch(){
  const base=path.join(root,'test-results','teaching-integration');await fs.mkdir(base,{recursive:true});const folder=await fs.mkdtemp(path.join(base,'run-')),user=path.join(folder,'profile');await fs.mkdir(user);
  for(const name of ['companion-secrets.json','Local State'])await fs.copyFile(path.join(process.env.APPDATA,'deepblue-desktop-pet',name),path.join(user,name));
  await require('esbuild').build({entryPoints:[path.join(__dirname,'teaching','runtime.ts')],outfile:path.join(folder,'runtime.cjs'),bundle:true,platform:'node',format:'cjs',external:['electron'],logLevel:'silent'});
  const env={...process.env,TEACHING_INTEGRATION_ROOT:folder};delete env.ELECTRON_RUN_AS_NODE;
  const child=require('node:child_process').spawn(require('electron'),[__filename],{cwd:root,env,stdio:'inherit',windowsHide:true});
  try {process.exitCode=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('exit',resolve)})||0;} finally {for(const name of ['companion-secrets.json','Local State'])await fs.rm(path.join(user,name),{force:true});}
  await fs.writeFile(path.join(base,'latest-run.txt'),folder);
}
async function worker(){
  const {app,safeStorage}=require('electron'),folder=process.env.TEACHING_INTEGRATION_ROOT;
  app.setPath('userData',path.join(folder,'profile'));await app.whenReady();let service;const checks=[];
  try {
    const {config}=JSON.parse(await fs.readFile(path.join(process.env.APPDATA,'deepblue-desktop-pet','companion.json'),'utf8'));
    const sealed=JSON.parse(await fs.readFile(path.join(folder,'profile','companion-secrets.json'),'utf8'));
    const key=(await safeStorage.decryptStringAsync(Buffer.from(sealed.model,'base64'))).result;assert.ok(key);
    const {StudioService}=require(path.join(folder,'runtime.cjs'));
    const curriculum=JSON.parse(await fs.readFile(path.join(__dirname,'teaching','curriculum.json'),'utf8'));let calls=0;
    const host={ready:()=>true,available:()=>true,changed:()=>{},notify:()=>{},chooseSource:async()=>undefined,openArtifact:async()=>{},reviewTargets:()=>[],recordReview:async()=>{throw new Error('测试不得调用外部学习插件');},generate:async(messages,signal)=>{
      calls++;const endpoint=config.model.baseUrl.replace(/\/$/,'')+'/chat/completions';const r=await fetch(endpoint,{method:'POST',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(60000)]),headers:{'Content-Type':'application/json',Authorization:`Bearer ${key}`},body:JSON.stringify({model:config.model.model,messages,temperature:.4,max_tokens:7000,stream:false,...(new URL(endpoint).hostname==='api.deepseek.com'?{thinking:{type:'disabled'}}:{})})});if(!r.ok)throw new Error(`HTTP ${r.status}`);return(await r.json()).choices[0].message.content;
    }};
    service=new StudioService(path.join(folder,'studio'),host);await service.start();
    const request=async value=>{const r=await service.request(value);assert.equal(r.ok,true,r.message);return r;};
    for(const lesson of curriculum.lessons){
      const created=await request({type:'create-course',course:{title:lesson.title,goal:lesson.objectives[0],edition:'前三课知识范围自编测试',level:'初学',minutes:10}});const course=created.result;
      await request({type:'add-note',courseId:course.id,title:lesson.title,text:lesson.knowledge});await request({type:'prepare',courseId:course.id,goal:course.goal,templateId:'',scheduledAt:0});await service.tick();
      const workflow=service.store.data.workflows.find(w=>w.courseId===course.id);assert.equal(workflow.status,'completed',workflow.error);const published=service.store.data.lessons.find(l=>l.courseId===course.id);
      await request({type:'start-teaching',lessonId:published.id});const session=service.store.data.sessions.find(s=>s.lessonId===published.id);assert.equal(session.tutoring.methodId,'retrieval');assert.equal(session.attempts.length,0);
      await request({type:'answer',sessionId:session.id,answer:'你讲得太长了，请讲短一点。',requestId:`${lesson.id}-short`});assert.equal(session.attempts.length,0);
      await request({type:'session',id:session.id,action:'hint'});assert.equal(session.attempts.length,0);
      const actual=session.tutoring.current.referenceAnswer;assert.ok(actual,'教师必须保留可作答任务');
      service.beginTurn({id:`${lesson.id}-answer`,actor:'user',source:'desktop',conversationId:'desktop',text:actual,at:Date.now()});
      await service.call('study_tutor',{},new AbortController().signal);await service.call('study_tutor',{},new AbortController().signal);
      assert.equal(session.attempts.length,1);assert.equal(session.attempts[0].answer,actual);assert.equal(session.attempts[0].hintUsed,true);
      await request({type:'answer',sessionId:session.id,answer:'今天先停课，我想休息，不要出新题。',requestId:`${lesson.id}-stop`});assert.equal(session.status,'paused');assert.equal(session.attempts.length,1);
      await request({type:'session',id:session.id,action:'finish'});await service.tick();assert.equal(session.status,'completed');assert.ok(session.reflection);assert.equal(session.exportState,'none');
      checks.push({lesson:lesson.title,method:session.tutoring.methodId,score:session.attempts[0].score,controlNotGraded:true,hintTracked:true,deduplicated:true,paused:true,reflection:true,externalWrites:0});console.log('PASS production classroom',lesson.id);
    }
    await service.close();service=new StudioService(path.join(folder,'studio'),host);await service.start();assert.equal(service.store.data.sessions.length,3);assert.ok(service.store.data.sessions.every(s=>s.tutoring.methodId==='retrieval'&&s.status==='completed'));
    await fs.writeFile(path.join(folder,'report.json'),JSON.stringify({checks,calls,realModel:true,model:config.model.model,noVoice:true,noWindows:true,scriptedAnswers:true,restart:true},null,2));
  }finally{await service?.close();app.exit(process.exitCode||0);}
}
(process.versions.electron?worker():launch()).catch(e=>{console.error(e);process.exitCode=1;if(process.versions.electron)require('electron').app.exit(1);});
