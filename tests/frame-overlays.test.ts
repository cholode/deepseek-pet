import { describe, expect, it } from 'vitest';
import { Container, Sprite, Texture, TextureSource } from 'pixi.js';
import { createFrameOverlays } from '../src/renderer/pet/frame-overlays';
import { makeCatalog, validateMotion, type Motion, type Registry } from '../src/shared/schema';

const motion = (): Extract<Motion, {kind:'frame_animation'}> => ({
  schemaVersion:1,id:'overlay',name:'overlay',avatarId:'deepblue-chibi-v1',kind:'frame_animation',durationMs:4000,
  channels:['pose','face'],frames:Array(96).fill('base.png'),fps:24,canvas:{width:384,height:476},anchor:{x:.5,y:1},
  frameOverlays:[{image:'face.webp',x:112,y:120,width:152,height:104,columns:12}]
});

describe('synchronized atlas overlays',()=>{
  it('selects the same numbered cell as the body, including the last row, and frees only its view',()=>{
    const source=new TextureSource({width:1824,height:832}),atlas=new Texture({source}),stage=new Container();
    const overlay=createFrameOverlays(stage,motion(),()=>atlas),sprite=stage.children[0] as Sprite;
    expect([sprite.x,sprite.y]).toEqual([112,120]);expect(sprite.texture.source).toBe(source);
    for(const i of [0,11,12,57,95,0]){overlay.update(i);expect(sprite.texture.frame.x).toBe(i%12*152);expect(sprite.texture.frame.y).toBe(Math.floor(i/12)*104);expect(sprite.width).toBe(152);expect(sprite.height).toBe(104);}
    const view=sprite.texture;overlay.dispose();overlay.dispose();overlay.update(12);
    expect(stage.children).toHaveLength(0);expect(view.destroyed).toBe(true);expect(source.destroyed).toBe(false);expect(atlas.destroyed).toBe(false);
    const next=createFrameOverlays(stage,motion(),()=>atlas);next.update(95);expect(stage.children).toHaveLength(1);next.dispose();atlas.destroy(true);
  });
  it('cleans partial setup if a second texture cannot be resolved',()=>{
    const source=new TextureSource({width:1824,height:832}),atlas=new Texture({source}),stage=new Container(),m=motion();m.frameOverlays!.push({...m.frameOverlays![0],image:'missing.webp'});
    expect(()=>createFrameOverlays(stage,m,file=>{if(file==='missing.webp')throw Error('missing');return atlas;})).toThrow('missing');
    expect(stage.children).toHaveLength(0);expect(source.destroyed).toBe(false);atlas.destroy(true);
  });
  it('skips extruded borders so scaled sprites never sample a neighboring frame',()=>{
    const source=new TextureSource({width:1872,height:864}),atlas=new Texture({source}),stage=new Container(),m=motion();m.frameOverlays![0].padding=2;
    const overlay=createFrameOverlays(stage,m,()=>atlas),sprite=stage.children[0] as Sprite;
    for(const i of [0,11,12,95]){overlay.update(i);expect(sprite.texture.frame.x).toBe(i%12*156+2);expect(sprite.texture.frame.y).toBe(Math.floor(i/12)*108+2);expect(sprite.width).toBe(152);expect(sprite.height).toBe(104);}
    overlay.dispose();atlas.destroy(true);
  });
  it('rejects overlays outside the body canvas or with impossible grid dimensions',()=>{
    const m=motion();m.frameOverlays![0].x=300;expect(()=>validateMotion(m)).toThrow('超出动作画布');
    m.frameOverlays![0].x=112;m.frameOverlays![0].columns=96;expect(()=>validateMotion(m)).toThrow('图集尺寸超限');
  });
  it('rejects a missing atlas before registering a candidate catalog',()=>{
    const r:Registry={revision:1,packs:[{manifest:{schemaVersion:1,id:'user.overlays',name:'overlays',version:'1',avatarId:'deepblue-chibi-v1',description:'',motions:['motion.json'],groups:['group.json']},motions:[motion()],groups:[],assets:{'base.png':'base.png'}}]};
    expect(()=>makeCatalog(r)).toThrow('缺少图片：face.webp');
  });
});
