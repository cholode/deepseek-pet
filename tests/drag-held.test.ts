import { beforeAll, describe, expect, it, vi } from 'vitest';
import path from 'node:path';
import { Container, Texture } from 'pixi.js';
import { readPack } from '../src/main/packs';
import { defaults, effective, makeCatalog, motionSchema, validateMotion, type Registry } from '../src/shared/schema';
import { PetRuntime } from '../src/renderer/pet/PetRuntime';
import { createSpriteRig, trackValue } from '../src/renderer/pet/sprite-rig';

let registry: Registry;
const desktop = {visible:true, dragging:false, pointerNear:false, position:{x:100,y:100}, suspended:false};
beforeAll(async()=>{ registry={revision:1,packs:[await readPack(path.resolve('resources/builtin'),true,p=>p)]}; });
function runtime() {
  const host={begin:vi.fn(()=>({update:vi.fn(),dispose:vi.fn()})),reset:vi.fn()};
  return new PetRuntime(structuredClone(registry), {...defaults,paused:true}, {...desktop}, host);
}
function advance(r: PetRuntime, ms: number) { for(let t=0;t<ms;t+=25)r.tick(Math.min(25,ms-t)); }
const held = 'builtin.deepblue:drag_held';

describe('held interaction lifecycle',()=>{
  it('cancels the previous pose, survives repeated desktop broadcasts and loops finite actions',()=>{
    const r=runtime();r.play('builtin.deepblue:walk_left','normal');
    r.setDesktop({...desktop,dragging:true});const first=r.current!.instanceId;
    expect(r.current?.group.groupId).toBe(held);
    expect(r.events.some(e=>e.type==='action_lifecycle'&&e.payload.groupId==='builtin.deepblue:walk_left'&&e.payload.status==='cancelled')).toBe(true);
    advance(r,500);r.setDesktop({...desktop,dragging:true,position:{x:250,y:300}});
    expect(r.current?.instanceId).toBe(first);expect(r.current?.elapsedMs).toBe(500);
    expect(r.play('builtin.deepblue:greet_wave','manual').errorCode).toBe('DRAG_LOCKED');
    advance(r,3100);expect(r.current?.group.groupId).toBe(held);expect(r.current?.instanceId).not.toBe(first);
    expect(r.events.some(e=>e.type==='action_lifecycle'&&e.payload.actionInstanceId===first&&e.payload.status==='completed')).toBe(true);
    r.setDesktop(desktop);expect(r.current?.group.id).toBe('drag_release');advance(r,1200);expect(r.current).toBeNull();
    advance(r,4000);expect(r.current).toBeNull();expect(r.errors).toEqual([]);
  });
  it.each(['hide','suspend','release'] as const)('cleans up on %s without reviving the held pose',mode=>{
    const r=runtime();r.setDesktop({...desktop,dragging:true});
    r.setDesktop({...desktop,visible:mode!=='hide',suspended:mode==='suspend'});
    advance(r,5000);expect(r.current).toBeNull();
  });
  it('uses metadata after renaming; disabled or faulty bindings fall back to standing',()=>{
    const r=runtime();const next=structuredClone(registry);
    next.packs[0].groups.find(g=>g.id==='drag_held')!.id='custom_pickup';r.replaceRegistry(next);
    r.setDesktop({...desktop,dragging:true});expect(r.current?.group.id).toBe('custom_pickup');
    r.current!.fail('test failure');advance(r,4000);expect(r.current).toBeNull();
    const d=runtime();d.setSettings({...d.settings,overrides:{[held]:{enabled:false}}});
    d.setDesktop({...desktop,dragging:true});expect(d.current).toBeNull();
  });
  it('registry reload and a long tick resume safely; manual preview plays only once',()=>{
    const r=runtime();r.setDesktop({...desktop,dragging:true});const first=r.current!.instanceId;
    r.replaceRegistry({...registry,revision:2});expect(r.current).toBeNull();r.tick(16);
    expect(r.current?.group.groupId).toBe(held);expect(r.current?.instanceId).not.toBe(first);
    r.tick(1800);expect(r.current).toBeNull();r.tick(16);expect(r.current?.group.groupId).toBe(held);
    r.setDesktop(desktop);advance(r,1200);expect(r.play(held,'manual').status).toBe('accepted');
    advance(r,4000);expect(r.current).toBeNull();
  });
});

describe('sprite rig validation and playback',()=>{
  function motion() { const m=registry.packs[0].motions.find(m=>m.id==='drag_held')!;if(m.kind!=='sprite_rig')throw Error('Missing rig');return structuredClone(m); }
  it('rejects missing parts, duplicate IDs, escaped images and invalid keyframes',()=>{
    const m=motion();m.parts.push(m.parts[0]);expect(()=>validateMotion(m)).toThrow('组件 ID 重复');
    const n=motion();n.tracks[0].targetId='missing';expect(()=>validateMotion(n)).toThrow('未知组件');
    const k=motion();k.tracks[0].keyframes[0].timeMs=10;expect(()=>validateMotion(k)).toThrow('关键帧');
    const p=motion();p.parts[0].image='../bad.png';expect(motionSchema.safeParse(p).success).toBe(false);
    const r=structuredClone(registry);delete r.packs[0].assets[motion().parts[0].image];expect(()=>makeCatalog(r)).toThrow('缺少图片');
  });
  it('rejects movement/random/standing constraints on automatic drag bindings',()=>{
    const group=makeCatalog(registry).groups.get(held)!;
    expect(effective(group,{...defaults,overrides:{[held]:{eligible:true,weight:100}}}).random.eligible).toBe(false);
    for(const mode of ['movement','random','standing']){
      const r=structuredClone(registry),g=r.packs[0].groups.find(g=>g.id==='drag_held')!;
      if(mode==='movement')g.timeline={type:'move_by',dxDip:1,dyDip:0,durationMs:10,easing:'linear'};
      if(mode==='random')g.random.eligible=true;
      if(mode==='standing')g.conditions.requiresStanding=true;
      expect(()=>makeCatalog(r)).toThrow('拖动绑定');
    }
  });
  it('keeps loop endpoints identical, varies limbs independently and disposes without destroying shared textures',()=>{
    const m=motion();for(const track of m.tracks)expect(trackValue(track,0)).toBeCloseTo(trackValue(track,m.durationMs),7);
    const stage=new Container(),rig=createSpriteRig(stage,m,()=>Texture.EMPTY),parts=stage.children[0] as Container;
    const positions=parts.children.map(s=>({x:s.x,y:s.y,angle:s.rotation,scale:s.scale.y}));
    rig.update(375);expect(parts.children.map(s=>({x:s.x,y:s.y,angle:s.rotation,scale:s.scale.y}))).not.toEqual(positions);
    const left=parts.children[m.parts.findIndex(p=>p.id==='arm-left')],right=parts.children[m.parts.findIndex(p=>p.id==='arm-right')];expect(left.rotation).not.toBe(right.rotation);
    rig.dispose();rig.dispose();rig.update(500);expect(stage.children).toHaveLength(0);expect(Texture.EMPTY.destroyed).toBe(false);
  });
  it('keeps both thigh roots attached to the moving skirt throughout the loop',()=>{
    const m=motion(),body=m.parts.find(p=>p.id==='body')!;
    const value=(id:string,property:string,t:number)=>trackValue(m.tracks.find(k=>k.targetId===id&&k.property===property)!,t);
    for(let i=0;i<=84;i++){
      const t=i*3500/84,a=value('body','rotationDeg',t)*Math.PI/180;
      for(const leg of m.parts.filter(p=>p.id.startsWith('leg-'))){
        const dx=leg.x-body.x,dy=leg.y-body.y;
        const expectedX=body.x+value('body','offsetX',t)+dx*Math.cos(a)-dy*Math.sin(a);
        const expectedY=body.y+value('body','offsetY',t)+dx*Math.sin(a)+dy*Math.cos(a);
        expect(Math.hypot(leg.x+value(leg.id,'offsetX',t)-expectedX,leg.y+value(leg.id,'offsetY',t)-expectedY)).toBeLessThan(.03);
      }
    }
  });
});
