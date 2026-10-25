import { describe, expect, it } from 'vitest';
import { DragInertia } from '../src/renderer/pet/drag-inertia';
import { rigViewport, frameViewport } from '../src/shared/geometry';

function simulate(speed: (time: number) => number, fps = 60, duration = 3000) {
  const inertia = new DragInertia(), samples: {time:number;swing:number;trailing:number}[] = [];
  let x=400, time=0, nextPacket=1000/30;
  inertia.receive(true,{x,timeMs:0,gestureId:1});
  while(time<duration-.0001){
    const end=Math.min(time+1000/fps,duration);
    while(time<end-.0001){
      const until=Math.min(end,nextPacket),dt=until-time;
      x+=speed((time+until)/2)*dt/1000;
      const sway=inertia.step(dt);time=until;samples.push({time,...sway});
      if(time>=nextPacket-.0001){inertia.receive(true,{x,timeMs:time,gestureId:1});nextPacket+=1000/30;}
    }
  }
  return {inertia,samples};
}
const peak=(values:{swing:number}[])=>Math.max(...values.map(p=>Math.abs(p.swing)));

describe('horizontal drag inertia',()=>{
  it('stays at rest when screen X is unchanged, including vertical drags',()=>{
    expect(peak(simulate(()=>0).samples)).toBe(0);
  });
  it('lags behind horizontal movement and mirrors direction; faster drags swing further',()=>{
    const right=simulate(t=>t<600?900:0).samples,left=simulate(t=>t<600?-900:0).samples;
    expect(right.find(s=>s.time>=250)!.swing).toBeGreaterThan(.1);
    right.forEach((s,i)=>expect(s.swing+left[i].swing).toBeCloseTo(0,8));
    expect(peak(right)).toBeGreaterThan(peak(simulate(t=>t<600?180:0).samples)*2);
  });
  it('reverses with momentum instead of flipping instantly, then damps back to rest',()=>{
    const {samples}=simulate(t=>t<450?1200:t<900?-1200:0,60,5000);
    const at=(t:number)=>samples.find(s=>s.time>=t)!;
    expect(at(440).swing).toBeGreaterThan(0);
    expect(Math.abs(at(460).swing-at(440).swing)).toBeLessThan(.3);
    expect(at(800).swing).toBeLessThan(0);
    expect(Math.abs(at(4990).swing)).toBeLessThan(.002);
    expect(Math.abs(at(4990).trailing)).toBeLessThan(.004);
    expect(samples.some(s=>Math.abs(s.trailing-s.swing)>.1)).toBe(true);
  });
  it('uses time-based integration at both 30 and 60 FPS',()=>{
    const speed=(t:number)=>t<500?1000:t<1000?-700:0;
    const a=simulate(speed,30).samples,b=simulate(speed,60).samples;
    expect(Math.abs(peak(a)-peak(b))).toBeLessThan(.015);
    for(const time of [300,600,1000,1500,2500]){
      expect(Math.abs(a.find(s=>s.time>=time-.001)!.swing-b.find(s=>s.time>=time-.001)!.swing)).toBeLessThan(.02);
    }
  });
  it('responds to acceleration: abrupt acceleration swings further than a gradual ramp to the same speed',()=>{
    const abrupt=simulate(()=>1000,60,1000).samples;
    const gradual=simulate(t=>Math.min(1000,t),60,1000).samples;
    expect(peak(abrupt)).toBeGreaterThan(peak(gradual)*2);
  });
  it('returns to vertical during constant-speed travel instead of keeping a speed-dependent lean',()=>{
    const {samples}=simulate(()=>1000,60,5000);
    expect(peak(samples)).toBeGreaterThan(.4);
    expect(peak(samples.filter(s=>s.time>=4000))).toBeLessThan(.002);
  });
  it('produces a clear, continuous 25–40 degree swing when rapidly dragged left and right',()=>{
    const {samples}=simulate(t=>1800*Math.sin(t/450*Math.PI),60,2000);
    expect(peak(samples)*40).toBeGreaterThan(25);
    expect(peak(samples)*40).toBeLessThan(40);
    expect(Math.max(...samples.map((s,i)=>i?Math.abs(s.swing-samples[i-1].swing)*40:0))).toBeLessThan(7);
  });
  it('reserves room for broad swings without changing character scale',()=>{
    const canvas={width:640,height:915},scale=400/915,anchor={x:.5,y:1},pivot={x:305,y:105};
    const normal=frameViewport(canvas,scale),wide=rigViewport(canvas,scale,{pivot,maxAngleDeg:40},anchor);
    expect(wide.width).toBeGreaterThan(normal.width+200);
    expect(wide.width).toBeLessThan(650);
    expect(wide.height).toBeGreaterThanOrEqual(normal.height);
    for(let deg=-40;deg<=40;deg++)for(const x of [0,640])for(const y of [0,915]){
      const a=deg*Math.PI/180,dx=pivot.x+(x-pivot.x)*Math.cos(a)-(y-pivot.y)*Math.sin(a)-320;
      expect(Math.abs(dx*scale*.82)).toBeLessThan(wide.width/2-19);
    }
  });
  it('settles when cursor samples stop and ignores duplicate/out-of-order broadcasts',()=>{
    const inertia=new DragInertia();inertia.receive(true,{x:0,timeMs:0,gestureId:1});
    inertia.receive(true,{x:40,timeMs:34,gestureId:1});inertia.step(34);
    inertia.receive(true,{x:99999,timeMs:34,gestureId:1});inertia.receive(true,{x:-99999,timeMs:20,gestureId:1});
    for(let i=0;i<180;i++)inertia.step(1000/60);
    expect(Math.abs(inertia.step(16).swing)).toBeLessThan(.003);
  });
  it('resets on release, hidden/suspended state, new gesture, and long frame gaps',()=>{
    const {inertia}=simulate(()=>1000,60,300);expect(Math.abs(inertia.step(16).swing)).toBeGreaterThan(.1);
    inertia.receive(false);expect(inertia.step(16)).toEqual({swing:0,trailing:0});
    inertia.receive(true,{x:100000,timeMs:400,gestureId:2});expect(inertia.step(16).swing).toBe(0);
    inertia.receive(true,{x:100040,timeMs:434,gestureId:2});expect(inertia.step(34).swing).not.toBe(0);
    expect(inertia.step(3000)).toEqual({swing:0,trailing:0});
    inertia.receive(true,{x:-100000,timeMs:5000,gestureId:2});expect(inertia.step(16).swing).toBe(0);
  });
  it('bounds extreme flicks and rejects non-finite samples',()=>{
    const {samples,inertia}=simulate(t=>Math.floor(t/100)%2?1e8:-1e8);
    expect(peak(samples)).toBeLessThanOrEqual(1);
    expect(samples.every(s=>Number.isFinite(s.trailing)&&Math.abs(s.trailing)<=1)).toBe(true);
    inertia.receive(true,{x:NaN,timeMs:4000,gestureId:1});expect(inertia.step(16)).toEqual({swing:0,trailing:0});
  });
});
