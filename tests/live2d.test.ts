import { describe, it, expect } from 'vitest';
import { neutralNode, parametersFor, transformMesh, type RigPose } from '../src/renderer/pet/live2d/pose';

describe('Live2D action adapter',()=>{
  it('keeps the neck on the torso during head nods and follows body translations',()=>{
    const source=new Float32Array([0,-.03,.1,-.08]),rest=new Float32Array(4),posed=new Float32Array(4);
    transformMesh('Neck',source,rest,{});
    transformMesh('Neck',source,posed,{head:{...neutralNode(),offsetY:8,offsetX:-8,scaleY:1.06}});
    expect(posed).toEqual(rest);
    transformMesh('Neck',source,posed,{body:{...neutralNode(),offsetY:3}});
    expect(posed[1]-rest[1]).toBeCloseTo(-3/200*.96);
  });
  it('moves rear hair roots with head nods while keeping its lower tips anchored',()=>{
    // Cubism canvas spans source y=0..915 with origin at the centre, 320 px/unit.
    const source=new Float32Array([0,(457.5-410)/320,0,(457.5-730)/320]);
    const rest=new Float32Array(4),posed=new Float32Array(4);
    transformMesh('BackHair',source,rest,{});
    transformMesh('BackHair',source,posed,{head:{...neutralNode(),offsetY:8}});
    expect(posed[1]-rest[1]).toBeCloseTo(-8/200*.96);expect(posed[3]).toBe(rest[3]);
  });
  it('keeps face-channel ownership ahead of idle blink and mouse gaze',()=>{
    const values=parametersFor({},1000,['face'],'smile',{x:1,y:1},1);
    expect(values.ParamEyeLOpen).toBe(0);expect(values.ParamEyeROpen).toBe(0);
    expect(values.ParamEyeBallX).toBe(0);expect(values.ParamEyeBallY).toBe(0);
    const active=parametersFor({eyes:{...neutralNode(),scaleY:.5}},1000,['face'],'neutral',{x:1,y:1},0);
    expect(active.ParamEyeLOpen).toBe(.5);
  });
  it('pauses pose idle under foreground actions without stopping independent blinking',()=>{
    const v=parametersFor({},1300,['pose'],'neutral',{x:1,y:1},.4);
    for(const p of ['ParamAngleZ','ParamBreath','ParamTail','ParamHairBack','ParamEarL','ParamSkirt'])expect(v[p]).toBe(0);
    expect(v.ParamEyeLOpen).toBe(.4);expect(v.ParamEyeBallX).toBe(1);
  });
  it('bounds legacy action rotations to real model ranges and restores defaults',()=>{
    const v=parametersFor({head:{...neutralNode(),rotationDeg:120},tail:{...neutralNode(),rotationDeg:-70},armRight:{...neutralNode(),rotationDeg:-110}},0,['pose'],'neutral',{x:0,y:0},1);
    expect(v.ParamAngleZ).toBe(4);expect(v.ParamTail).toBe(-1);expect(v.ParamArmR).toBe(-1);
    const reset=parametersFor({},0,['pose'],'neutral',{x:0,y:0},1);
    expect(reset.ParamAngleZ).toBe(0);expect(reset.ParamTail).toBe(0);expect(reset.ParamArmR).toBe(0);
  });
  it('clips gaze and blinks smoothly, without multiplying iris vertices by eye openness',()=>{
    const p:RigPose={eyes:{...neutralNode(),scaleY:.3,offsetX:30}};
    const a=new Float32Array([-.3,.4,-.2,.5]),out=new Float32Array(4),rest=new Float32Array(4);
    transformMesh('EyeIrisL',a,out,p);transformMesh('EyeIrisL',a,rest,{});expect(out).toEqual(rest);
    expect(parametersFor(p,0,[],'neutral',{x:5,y:-5},.5).ParamEyeLOpen).toBeCloseTo(.15);
    expect(parametersFor(p,0,[],'neutral',{x:5,y:-5},1).ParamEyeBallY).toBe(-1);
  });
  it('applies identical head transforms to the iris and its mask',()=>{
    const p={head:{...neutralNode(),offsetY:7,offsetX:3,scaleX:1.04,alpha:.7}};
    const a=new Float32Array([-.3,.4,-.2,.5]),iris=new Float32Array(4),mask=new Float32Array(4);
    expect(transformMesh('EyeIrisL',a,iris,p)).toBe(.7);expect(transformMesh('EyeOpenL',a,mask,p)).toBe(.7);expect(iris).toEqual(mask);
  });
  it('does not mutate Core vertices and keeps tail and feet isolated from arm gestures',()=>{
    const source=new Float32Array([-.5,0,-.3,-.2]),copy=source.slice(),rest=new Float32Array(4),posed=new Float32Array(4);
    const p={armRight:{...neutralNode(),rotationDeg:-110},body:{...neutralNode(),scaleY:.9}};
    transformMesh('LegR',source,rest,{});transformMesh('LegR',source,posed,p);expect(posed).toEqual(rest);
    transformMesh('ArmR',source,posed,p);expect(posed).not.toEqual(rest);expect(source).toEqual(copy);
    transformMesh('Tail',source,posed,{armRight:p.armRight});expect(posed).toEqual(rest);
  });
});
