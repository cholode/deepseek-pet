import { describe, it, expect } from 'vitest';
import { neutralNode, parametersFor, transformMesh, type RigPose } from '../src/renderer/pet/live2d/pose';
import { expressionEnvelope, expressionIds } from '../src/shared/expressions';
import { articulateArm, armForeground } from '../src/renderer/pet/live2d/arms';

describe('Live2D action adapter',()=>{
  it('eases face color and eyelids from normal to shy and back without endpoint jumps',()=>{
    const times=[0,100,400,850,3300,3750,4100,4200],weights=times.map(t=>expressionEnvelope(t,4200,850,900));
    expect(weights[0]).toBe(0);expect(weights[3]).toBe(1);expect(weights[4]).toBe(1);expect(weights.at(-1)).toBe(0);
    expect(weights[1]).toBeGreaterThan(0);expect(weights[1]).toBeLessThan(weights[2]);expect(weights[2]).toBeLessThan(1);
    expect(weights[5]).toBe(.5);expect(weights[6]).toBeLessThan(weights[5]);expect(weights[6]).toBeGreaterThan(0);
    for(const w of weights){const p=parametersFor({},0,['pose','face'],'super_shy',{x:0,y:0},1,w);expect(p.ParamEyeLOpen).toBeCloseTo(1-w);expect(p.ParamEyeROpen).toBeCloseTo(1-w);}
    expect(expressionEnvelope(100,4200)).toBe(1);
  });
  it('bends a continuous sleeve/wrist chain, lifts both arms in front of the face and fully restores',()=>{
    const p:RigPose={shoulderLeft:{...neutralNode(),rotationDeg:113},elbowLeft:{...neutralNode(),rotationDeg:102}};
    const point=[(155-320)*280/640,634*400/915-400] as const;
    const sleeve=articulateArm('ArmL',...point,p),hand=articulateArm('HandL',...point,p);
    expect(hand).toEqual(sleeve);expect(hand[1]).toBeLessThan(-200);
    expect(armForeground('HandL',p)).toBe(true);expect(armForeground('ArmL',p)).toBe(true);expect(armForeground('HandR',p)).toBe(false);
    expect(articulateArm('HandL',...point,{})).toEqual(point);
    expect(articulateArm('Tail',...point,p)).toEqual(point);expect(armForeground('HandL',{})).toBe(false);
  });
  it('keeps super-shy eyes closed through idle blinks and restores normal eyes',()=>{
    const v=parametersFor({},2500,['face','pose'],'super_shy',{x:1,y:1},1);
    expect(v.ParamEyeLOpen).toBe(0);expect(v.ParamEyeROpen).toBe(0);
    const reset=parametersFor({},2500,[],'neutral',{x:0,y:0},1);
    expect(reset.ParamEyeLOpen).toBe(1);expect(reset.ParamEyeROpen).toBe(1);
  });
  it('drives original brow keyforms for protest and resets all face parameters on return to neutral',()=>{
    const protest=parametersFor({},500,['face','pose'],'annoyed',{x:1,y:1},0);
    expect(protest.ParamBrowForm).toBe(1);
    expect(protest.ParamEyeLOpen).toBe(.55);
    for(const face of expressionIds){
      parametersFor({},500,['face'],face,{x:0,y:0},1);
      const reset=parametersFor({},500,[],'neutral',{x:0,y:0},1);
      for(const id of ['ParamBrowForm','ParamBrowAsym','ParamEyeSmile','ParamMouthActive','ParamMouthForm','ParamMouthTwist','ParamMouthOpenY','ParamTear'])expect(reset[id]).toBe(0);
    }
  });
  it('keeps a wink one-sided even when an idle blink is due and restores both eyes afterward',()=>{
    const wink=parametersFor({},500,['face'],'wink',{x:0,y:0},0);
    expect(wink.ParamEyeLOpen).toBe(0);expect(wink.ParamEyeROpen).toBe(1);expect(wink.ParamEyeSmile).toBe(1);
    const rest=parametersFor({},500,[],'neutral',{x:0,y:0},1);expect(rest.ParamEyeLOpen).toBe(1);expect(rest.ParamEyeROpen).toBe(1);
  });
  it('keeps expressive gaze under face ownership, with independent brows, mouth and tears',()=>{
    const confused=parametersFor({},500,['face'],'confused',{x:-1,y:1},1);
    expect(confused.ParamEyeBallX).toBe(.3);expect(confused.ParamBrowAsym).toBe(1);expect(confused.ParamMouthTwist).toBeLessThan(0);
    const sad=parametersFor({},500,['face'],'sad',{x:1,y:-1},1);
    expect(sad.ParamTear).toBeGreaterThan(0);expect(sad.ParamBrowForm).toBeLessThan(0);expect(sad.ParamMouthForm).toBeLessThan(0);
    const flat=parametersFor({},500,['face'],'unimpressed',{x:1,y:-1},1);
    expect(flat.ParamTear).toBe(0);expect(flat.ParamBrowForm).toBe(0);expect(flat.ParamMouthOpenY).toBe(0);expect(flat.ParamMouthForm).toBe(0);
  });
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
  it('keeps detached eyelid creases and lash edges registered with the eye under nods and fades',()=>{
    const p={head:{...neutralNode(),offsetY:8,offsetX:-5,scaleX:1.05,alpha:.8},eyes:{...neutralNode(),scaleY:.3,alpha:.6}};
    const source=new Float32Array([-.3,.4,-.2,.5]),eye=new Float32Array(4),fold=new Float32Array(4);
    const alpha=transformMesh('EyeLashL',source,eye,p);
    for(const id of ['EyeCreaseL','EyeCreaseR','EyeLidEdgeR']){
      expect(transformMesh(id,source,fold,p)).toBeCloseTo(alpha);
      expect(fold).toEqual(eye);
    }
  });
  it('keeps expressive mouth components and their clipping mask together under timeline transforms',()=>{
    const p={head:{...neutralNode(),offsetY:8,offsetX:-5,scaleX:1.05,alpha:.8},mouth:{...neutralNode(),offsetX:2,scaleX:1.03,alpha:.6}};
    const source=new Float32Array([-.1,.02,-.05,-.03]),mask=new Float32Array(4),part=new Float32Array(4);
    const alpha=transformMesh('MouthFill',source,mask,p);
    for(const id of ['MouthLip','MouthTongue','MouthTeeth']){
      expect(transformMesh(id,source,part,p)).toBeCloseTo(alpha);expect(part).toEqual(mask);
    }
  });
  it('does not mutate Core vertices and keeps tail and feet isolated from arm gestures',()=>{
    const source=new Float32Array([-.5,0,-.3,-.2]),copy=source.slice(),rest=new Float32Array(4),posed=new Float32Array(4);
    const p={armRight:{...neutralNode(),rotationDeg:-110},body:{...neutralNode(),scaleY:.9}};
    transformMesh('LegR',source,rest,{});transformMesh('LegR',source,posed,p);expect(posed).toEqual(rest);
    transformMesh('ArmR',source,posed,p);expect(posed).not.toEqual(rest);expect(source).toEqual(copy);
    transformMesh('Tail',source,posed,{armRight:p.armRight});expect(posed).toEqual(rest);
  });
});
