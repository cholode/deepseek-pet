import {describe,expect,it} from 'vitest';
import {nearestContainedRect,resizeAtFeet,dimensions} from '../src/shared/geometry';

const left={x:-1400,y:40,width:1200,height:900},right={x:0,y:0,width:1280,height:1000};
const pet=(x:number,y:number)=>({x,y,width:340,height:420});
describe('release into the nearest activity work area',()=>{
  it('keeps a legal placement, including one close to a screen edge',()=>{
    expect(nearestContainedRect(pet(900,300),[left,right])).toEqual(pet(900,300));
    expect(nearestContainedRect(pet(-900,100),[left,right])).toEqual(pet(-900,100));
  });
  it.each([
    [-1600,100,-1400,100],[-420,300,-540,300],[-100,300,0,300],
    [1200,300,940,300],[300,-80,300,0],[300,900,300,580],[2000,1100,940,580],
  ])('projects (%i,%i) to the nearest legal point (%i,%i)',(x,y,tx,ty)=>{
    expect(nearestContainedRect(pet(x,y),[left,right])).toEqual(pet(tx,ty));
  });
  it('minimizes required movement instead of choosing only by window center',()=>{
    const a={x:-1000,y:0,width:1000,height:420},b={x:0,y:0,width:1920,height:1080};
    expect(nearestContainedRect(pet(-220,200),[a,b])).toEqual(pet(0,200));
  });
  it('projects after restoring standing dimensions, so swing margins do not push the pet inward',()=>{
    for(const scale of [.6,1,1.5]) {
      const size=dimensions(scale),standing={x:1280-size.width,y:1000-size.height,...size};
      const held=resizeAtFeet(standing,dimensions(scale,{width:592,height:427}));
      expect(held.x+held.width).toBeGreaterThan(1280);
      expect(nearestContainedRect(resizeAtFeet(held,size),[right])).toEqual(standing);
    }
  });
  it('prefers a screen that can fit the pet and handles removal of a negative-coordinate display',()=>{
    expect(nearestContainedRect(pet(-1200,150),[right])).toEqual(pet(0,150));
    const tiny={x:-300,y:0,width:300,height:200};
    expect(nearestContainedRect(pet(-300,0),[tiny,right])).toEqual(pet(0,0));
    expect(nearestContainedRect(pet(-500,-20),[tiny])).toEqual(pet(-300,0));
  });
});
