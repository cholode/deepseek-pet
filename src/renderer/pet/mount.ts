import { Avatar } from './Avatar';
import { PetRuntime } from './PetRuntime';
import { makeCatalog } from '../../shared/schema';
import type { CommandReceipt, RuntimeMessage } from '../../shared/contracts';
import { mountCompanionPresentation } from './companion-presentation';
export async function mountPet(element: HTMLElement) {
  const initial=await window.pet.bootstrap(); let settings=initial.settings;
  // Loading textures can take seconds. Subscribe now so early settings/commands are not lost.
  const queued: RuntimeMessage[]=[]; let receive=(message: RuntimeMessage)=>{queued.push(message);};
  const off=window.pet.onMessage(message=>receive(message));
  const avatar=new Avatar(()=>settings,(e,id)=>{if(!id)runtime.log(e);if(runtime.current&&(!id||runtime.current.instanceId===id))runtime.current.fail(e);}); const runtime=new PetRuntime(initial.registry,settings,initial.desktop,avatar); initial.errors.forEach(e=>runtime.log(e));
  try { await avatar.init(element,runtime.catalog); avatar.setDragState(initial.desktop); await runtime.start(); } catch(e) { off(); throw e; }
  runtime.setCompanionEnabled(initial.companionEnabled ?? false);
  const offCompanion = mountCompanionPresentation(runtime);
  const canvas=avatar.app.canvas; let down:{x:number;y:number;target:'head'|'body';id:number;dragging:boolean;starting:boolean}|undefined;let clickTimer:ReturnType<typeof setTimeout>|undefined;let lastClick=0; let lastTarget='';let disposed=false;let renderFailed=false;
  const clearClick=()=>{if(clickTimer)clearTimeout(clickTimer);clickTimer=undefined;};
  const finish=async(cancel=false)=>{const gesture=down;down=undefined;avatar.pressed=false;if(!gesture)return;try{if(canvas.hasPointerCapture(gesture.id))canvas.releasePointerCapture(gesture.id);}catch{/* Capture may already be released by Windows. */}await window.pet.dragEnd();if(cancel||gesture.dragging||gesture.starting)return;const now=Date.now();if(now-lastClick<260&&lastTarget===gesture.target){clearClick();lastClick=0;await window.pet.openPanel();return;}lastClick=now;lastTarget=gesture.target;clearClick();clickTimer=setTimeout(()=>{runtime.interact(gesture.target);const id=gesture.target==='head'?settings.headAction:settings.bodyAction;const result=runtime.play(id,'interaction');if(result.status==='rejected')runtime.log(result.message??result.errorCode??'点击失败');clickTimer=undefined;},260);};
  const onDown=(event:PointerEvent)=>{if(event.button!==0)return;const region=avatar.regions().find(r=>event.clientX>=r.x&&event.clientX<=r.x+r.width&&event.clientY>=r.y&&event.clientY<=r.y+r.height);if(!region)return;avatar.pressed=true;down={x:event.screenX,y:event.screenY,target:region.target,id:event.pointerId,dragging:false,starting:false};canvas.setPointerCapture(event.pointerId);void window.pet.pointerDown({x:event.screenX,y:event.screenY}).catch(e=>runtime.log(String(e)));};
  const onMove=(event:PointerEvent)=>{avatar.setGaze(event.clientX,event.clientY);const gesture=down;if(!gesture||gesture.dragging||gesture.starting)return;if(Math.hypot(event.screenX-gesture.x,event.screenY-gesture.y)>6){clearClick();lastClick=0;gesture.starting=true;void window.pet.dragStart().then(ok=>{if(down!==gesture){if(ok)void window.pet.dragEnd();return;}gesture.dragging=ok;gesture.starting=false;if(!ok){down=undefined;avatar.pressed=false;}}).catch(e=>{runtime.log(String(e));void finish(true);});}};
  const onUp=()=>{void finish().catch(e=>runtime.log(String(e)));};const onCancel=()=>{clearClick();void finish(true).catch(e=>runtime.log(String(e)));};const onContext=(e:Event)=>{e.preventDefault();onCancel();void window.pet.contextMenu().catch(e=>runtime.log(String(e)));};
  canvas.addEventListener('pointerdown',onDown);canvas.addEventListener('pointermove',onMove);canvas.addEventListener('pointerup',onUp);canvas.addEventListener('pointercancel',onCancel);canvas.addEventListener('lostpointercapture',()=>{if(down)onCancel();});window.addEventListener('blur',onCancel);canvas.addEventListener('contextmenu',onContext);
  let lastPublish=0;let lastRegions=0;
  avatar.app.ticker.add(ticker=>{if(disposed||renderFailed)return;try{runtime.tick(ticker.elapsedMS);avatar.idle(ticker.elapsedMS,runtime.current?.group.channels??[]);}catch(e){renderFailed=true;runtime.log(String(e));runtime.current?.fail(String(e));avatar.app.stop();window.pet.publish(runtime.debug());return;}const now=performance.now();if(now-lastRegions>100){window.pet.hitRegions(avatar.regions());lastRegions=now;}if(now-lastPublish>250){window.pet.publish(runtime.debug());lastPublish=now;}});
  receive=message=>{void(async()=>{if(message.type==='settings'){settings=message.settings;runtime.setSettings(settings);avatar.resize();}
    else if(message.type==='desktop'){avatar.setDragState(message.desktop);runtime.setDesktop(message.desktop);if(message.desktop.pointer)avatar.setGaze(message.desktop.pointer.x,message.desktop.pointer.y);if(message.desktop.visible&&!message.desktop.suspended&&!renderFailed)avatar.app.start();else{onCancel();avatar.app.stop();window.pet.publish(runtime.debug());}}
    else if(message.type==='companion-mode')runtime.setCompanionEnabled(message.enabled);
    else if(message.type==='error')runtime.log(message.error);
    else if(message.type==='registry'){try{const catalog=makeCatalog(message.registry);await avatar.preload(catalog);runtime.replaceRegistry(message.registry);avatar.useCatalog(catalog);await avatar.releaseUnused(catalog);window.pet.reply(message.requestId,{commandId:message.requestId,status:'accepted'});}catch(e){runtime.log(String(e));window.pet.reply(message.requestId,{commandId:message.requestId,status:'rejected',errorCode:'REGISTRY_REJECTED',message:String(e)});}}
    else if(message.type==='request'){let result:CommandReceipt;const r=message.request;if(r.type==='command'){runtime.interact('desktop');result=await runtime.port('manual').submit(r.command);}else if(r.type==='mode'){const m=runtime.setMode(r.mode);result=m.available?{commandId:message.requestId,status:'accepted'}:{commandId:message.requestId,status:'rejected',errorCode:m.errorCode,message:m.message};}else{settings={...settings,paused:r.value};runtime.setSettings(settings);result={commandId:message.requestId,status:'accepted'};}window.pet.reply(message.requestId,result);window.pet.publish(runtime.debug());}
  })().catch(e=>runtime.log(String(e)));};
  for(const message of queued)receive(message);queued.length=0;
  const dispose=()=>{disposed=true;clearClick();off();offCompanion();window.removeEventListener('blur',onCancel);void runtime.dispose().then(()=>avatar.destroy());};window.addEventListener('beforeunload',dispose,{once:true});if(import.meta.hot)import.meta.hot.dispose(dispose);
}



