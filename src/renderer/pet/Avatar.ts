import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import 'pixi.js/unsafe-eval'; // Pixi's static uniform polyfill: works WITHOUT CSP unsafe-eval.
import { avatarScale, baseViewport, dimensions, ease, frameViewport } from '../../shared/geometry';
import { type Catalog, type Settings, type ActionChannel, type Motion } from '../../shared/schema';
import type { HitRegion } from '../../shared/contracts';
import { frameIndex, type AnimationHost, type Leaf, type RunningLeaf } from './engine';
import { Live2DRenderer } from './live2d/Live2DRenderer';
import { parametersFor, type RigPose } from './live2d/pose';
import { expressionEnvelope, expressionProfile } from '../../shared/expressions';
import { steamEffect } from './steam';
const pivot: Record<string, [number, number]> = { root: [0,0], body: [0,-145], head: [0,-205], hairBack:[0,-300],hairFront:[0,-305],armLeft:[-49,-193],armRight:[49,-193],eyes:[0,-240],mouth:[0,-208],effects:[0,-200],tail:[28,-114] };
for (const side of ['Left','Right']) for (const joint of ['shoulder','elbow','wrist']) pivot[joint+side]=[0,0];
export class Avatar implements AnimationHost {
  readonly app = new Application(); readonly placement = new Container(); readonly overlay = new Container(); readonly nodes = new Map<string, Container>(); private textures = new Map<string, Texture>(); private time = 0; private nextBlink = 2500; private blinkUntil = 0; private face = 'neutral'; private expressionArt = new Graphics(); private fx = new Container(); private frame = new Sprite(); private bubble = new Text({ text: '', style: { fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 14, fill: '#254269', wordWrap: true, wordWrapWidth: 235, align: 'center', fontWeight: '500' } }); private bubbleBack = new Graphics(); private bubbleContainer = new Container(); pressed = false;
  private live = new Live2DRenderer(); private liveTexture?: Texture;
  private faceWeight=1;
  private gaze = {x:0,y:0}; private gazeTarget = {x:0,y:0};
  private frameStage = new Container();
  private frameMotion?: Extract<Motion, {kind:'frame_animation'}>;
  private scene = new Container();
  private viewport = { ...baseViewport };
  constructor(private settings: () => Settings, private onError: (e: string, instanceId: string) => void) {}
  async init(element: HTMLElement, catalog: Catalog) {
    await this.app.init({ width: 340, height: 420, backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true, preference: 'webgl' }); element.appendChild(this.app.canvas);
    this.app.stage.addChild(this.scene); this.scene.addChild(this.placement); this.placement.addChild(this.overlay); this.placement.position.set(170, 405); this.placement.scale.set(avatarScale);
    for (const [id, [x,y]] of Object.entries(pivot)) { const node = new Container(); node.label = id; node.pivot.set(x,y); node.position.set(x,y); this.nodes.set(id,node); }
    const root = this.nodes.get('root')!; this.overlay.addChild(root);
    for (const id of ['hairBack','body','armLeft','armRight','head','effects']) root.addChild(this.nodes.get(id)!);
    this.nodes.get('body')!.addChild(this.nodes.get('tail')!);
    const head = this.nodes.get('head')!; for (const id of ['eyes','mouth','hairFront']) head.addChild(this.nodes.get(id)!);
    await this.live.init(); this.liveTexture=Texture.from(this.live.canvas);
    const liveSprite=new Sprite(this.liveTexture);liveSprite.anchor.set(.5,1);liveSprite.width=280;liveSprite.height=400;root.addChildAt(liveSprite,0);
    this.app.canvas.dataset.avatar='live2d';this.app.canvas.dataset.pose='standing';
    this.app.canvas.setAttribute('aria-label','Live2D 桌宠，可点击和拖动');
    root.addChild(this.expressionArt);this.expressionArt.pivot.set(-6.3,-194.3);this.expressionArt.position.copyFrom(this.expressionArt.pivot);this.nodes.get('effects')!.addChild(this.fx);
    head.eventMode = 'static'; head.cursor = 'grab'; head.hitArea = new Rectangle(-122,-390,244,207);
    this.nodes.get('body')!.eventMode = 'static'; this.nodes.get('body')!.cursor = 'grab'; this.nodes.get('body')!.hitArea = new Rectangle(-100,-200,265,205);
    this.frameStage.addChild(this.frame); this.overlay.addChild(this.frameStage, this.nodes.get('effects')!); this.frame.visible=false; this.frame.eventMode='none';
    this.bubbleContainer.addChild(this.bubbleBack, this.bubble); this.scene.addChild(this.bubbleContainer); this.bubbleContainer.visible=false;
    await this.preload(catalog); this.useCatalog(catalog); this.resize();
  }
  async preload(catalog: Catalog) { const newlyLoaded: string[] = []; try { for (const url of new Set(catalog.assets.values())) { if (this.textures.has(url)) continue; const texture = await Assets.load<Texture>({ src: url, loadParser: 'loadTextures' }); this.textures.set(url, texture); newlyLoaded.push(url); } } catch (e) { for (const url of newlyLoaded) { this.textures.delete(url); await Assets.unload(url); } throw e; } }
  useCatalog(_catalog: Catalog) { this.reset(); }
  async releaseUnused(catalog: Catalog) { const used = new Set(catalog.assets.values()); for (const url of this.textures.keys()) if (!used.has(url)) { this.textures.delete(url); await Assets.unload(url); } }
  resize() {
    const size=this.settings().size, viewport=this.frameMotion?frameViewport(this.frameMotion.canvas,this.frameMotion.displayScale??1):baseViewport;
    const changed=viewport.width!==this.viewport.width||viewport.height!==this.viewport.height;
    this.viewport={...viewport}; const pixels=dimensions(size,viewport);
    this.app.renderer.resize(pixels.width,pixels.height); this.scene.scale.set(size); this.placement.position.set(viewport.width/2,viewport.height-15); this.app.ticker.maxFPS=this.settings().fps;
    if(this.bubbleContainer.visible)this.bubbleContainer.x=(viewport.width-this.bubbleContainer.width)/2;
    if(changed)void window.pet.setViewport(viewport).catch(e=>this.onError(String(e),''));
  }
  regions(): HitRegion[] {
    const areas=this.frameMotion?.hitAreas;
    if(areas) return areas.map(r=>{const a=this.frameStage.toGlobal({x:r.x,y:r.y}),b=this.frameStage.toGlobal({x:r.x+r.width,y:r.y+r.height});return {target:r.target,x:a.x,y:a.y,width:b.x-a.x,height:b.y-a.y};});
    return (['head','body'] as const).map(target => { const node=this.nodes.get(target)!; const r=node.hitArea as Rectangle; const points=[[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]].map(([x,y])=>node.toGlobal({x,y})); const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));return {target,x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y}; });
  }
  setGaze(clientX: number,clientY=210*this.settings().size) { const s=this.settings().size;this.gazeTarget={x:Math.max(-1,Math.min(1,((clientX/s-(this.viewport.width-340)/2)/340-.5)*2)),y:Math.max(-1,Math.min(1,((clientY/s-(this.viewport.height-420))/420-.47)*2))}; }
  idle(delta: number, occupied: ActionChannel[]) {
    this.time+=Math.min(delta,100); this.overlay.scale.set(this.pressed?.965:1); this.overlay.y=this.pressed?3:0;
    const follow=1-Math.exp(-Math.min(delta,100)/130);this.gaze.x+=(this.gazeTarget.x-this.gaze.x)*follow;this.gaze.y+=(this.gazeTarget.y-this.gaze.y)*follow;
    if(this.frameMotion)return; // The sleeping figure and its independent tail use the same action runner.
    if(!occupied.includes('face')&&this.time>this.nextBlink){this.blinkUntil=this.time+280;this.nextBlink=this.time+2500+Math.random()*4200;}
    const remaining=this.blinkUntil-this.time;const blink=remaining<=0?1:remaining>200?(remaining-200)/80:remaining>130?0:1-remaining/130;
    const pose:RigPose={};for(const [id,n]of this.nodes){const [x,y]=pivot[id];pose[id]={offsetX:n.x-x,offsetY:n.y-y,rotationDeg:n.rotation*180/Math.PI,scaleX:n.scale.x,scaleY:n.scale.y,alpha:n.alpha};}
    const values=parametersFor(pose,this.time,occupied,this.face,this.gaze,blink,this.faceWeight);
    this.live.render(values,pose,(expressionProfile(this.face).faceFlush??0)*this.faceWeight);this.liveTexture!.source.update();
    this.expressionArt.position.set(-6.3+pose.head.offsetX*.96,-194.3+pose.head.offsetY*.96-values.ParamBreath*1.23);this.expressionArt.rotation=(values.ParamAngleZ+values.ParamBodyAngleZ)*Math.PI/180;this.expressionArt.alpha=pose.head.alpha*this.faceWeight;
  }
  set(id: string, property: string, value: number) { const n=this.nodes.get(id); if(!n) throw new Error(`未知角色节点：${id}`); const [x,y]=pivot[id]; if(property==='offsetX') n.x=x+value; else if(property==='offsetY') n.y=y+value; else if(property==='rotationDeg') n.rotation=value*Math.PI/180; else if(property==='scaleX') n.scale.x=value; else if(property==='scaleY') n.scale.y=value; else if(property==='alpha') n.alpha=value; }
  private resetChannels(channels: ActionChannel[]) { for(const [id,n] of this.nodes) { const channel=id==='eyes'||id==='mouth'?'face':id==='effects'?'effect':'pose'; if(!channels.includes(channel)) continue; n.position.set(...pivot[id]); n.scale.set(1); n.rotation=0; n.alpha=1; } }
  reset() { this.resetChannels(['pose','face','effect']); this.expression('neutral'); this.fx.removeChildren().forEach(c=>c.destroy()); this.bubbleContainer.visible=false; this.frame.visible=false; this.frameMotion=undefined; this.frameStage.removeChildren().filter(c=>c!==this.frame).forEach(c=>c.destroy()); this.frameStage.addChild(this.frame); this.nodes.get('root')!.visible=true; this.app.canvas.dataset.pose='standing'; this.resize(); }
  private expression(id: string) {
    this.face=id;this.faceWeight=1; this.app.canvas.dataset.expression=id; const g=this.expressionArt; g.clear();
    // Blush is an accent; brows, eyelids, mouth shapes and tears belong to Core meshes.
    const blush=expressionProfile(id).blush;
    if(blush) {
      const [rx,ry]=blush.radius??[9,3],[left,right]=blush.x??[-42,31],y=blush.y??-213,layers=blush.feather?12:1;
      // Nested translucent ellipses soften the edge without a full-canvas blur.
      const alpha=1-Math.pow(1-blush.alpha,1/layers);
      for(let i=0;i<layers;i++){
        const scale=1-i/(layers*1.6);
        g.ellipse(left,y,rx*scale,ry*scale).ellipse(right,y,rx*scale,ry*scale).fill({color:blush.color??0xf29ba9,alpha});
      }
    }
  }
  begin(node: Leaf, catalog: Catalog, source: string, instanceId: string): RunningLeaf {
    let disposed=false; let update: (ms:number)=>void=()=>{}; let dispose:()=>void=()=>{};
    if(node.type==='motion') {
      const m=catalog.motions.get(node.motionId)!; if(!m)throw new Error('motion 丢失');
      if(m.kind==='rig_timeline'){this.resetChannels(m.channels);update=ms=>{const time=ms>=m.durationMs*node.repeat?m.durationMs:ms%m.durationMs;for(const track of m.tracks){let index=track.keyframes.findIndex(k=>k.timeMs>=time);if(index<1)index=1;const a=track.keyframes[index-1],b=track.keyframes[index];const f=ease(Math.min(1,Math.max(0,(time-a.timeMs)/(b.timeMs-a.timeMs))),b.easing);this.set(track.targetId,track.property,a.value+(b.value-a.value)*f);}};dispose=()=>this.resetChannels(m.channels);}
      else {
        const texture=(file:string)=>{const url=catalog.assets.get(`${node.motionId.split(':')[0]}:${file}`);if(!url||!this.textures.has(url))throw new Error(`帧未预加载：${file}`);return this.textures.get(url)!;};
        this.nodes.get('root')!.visible=false;this.frame.visible=true;this.frameMotion=m;this.app.canvas.dataset.pose='frames';this.resize();
        this.frameStage.scale.set(m.displayScale??1);this.frameStage.position.set(-m.canvas.width*m.anchor.x*(m.displayScale??1),-m.canvas.height*m.anchor.y*(m.displayScale??1));this.frame.anchor.set(0,0);
        const layers=(m.layers??[]).map(l=>{const sprite=new Sprite(texture(l.image));sprite.pivot.set(l.pivotX,l.pivotY);sprite.position.set(l.x+l.pivotX,l.y+l.pivotY);this.frameStage.addChildAt(sprite,0);return {sprite,definition:l};});
        update=ms=>{this.frame.texture=texture(m.frames[frameIndex(m,ms>=m.durationMs*node.repeat?m.durationMs:ms%m.durationMs)]);for(const {sprite,definition:l} of layers)sprite.rotation=l.rotationDeg*Math.PI/180*Math.sin(ms/l.periodMs*Math.PI*2);};
        dispose=()=>{layers.forEach(l=>l.sprite.destroy());this.frame.visible=false;this.frameMotion=undefined;this.nodes.get('root')!.visible=true;this.app.canvas.dataset.pose='standing';this.resize();};
      }
    } else if(node.type==='expression'){
      this.resetChannels(['face']);this.expression(node.expressionId);
      update=ms=>{this.faceWeight=expressionEnvelope(ms,node.durationMs,node.fadeInMs,node.fadeOutMs);};
      update(0);dispose=()=>this.expression('neutral');
    }
    else if(node.type==='effect'&&node.effectId==='steam'){
      const steam=steamEffect(this.fx,node.origin);update=steam.update;dispose=steam.dispose;
    }
    else if(node.type==='effect'){
      const sleepy=node.effectId==='sleepy',count=sleepy?3:7,items:(Graphics|Text)[]=[];
      for(let i=0;i<count;i++){const item=sleepy?new Text({text:'Z',style:{fontSize:21,fill:'#b7ddff',stroke:{color:'#345886',width:2},fontWeight:'bold',fontFamily:'sans-serif'}}):new Graphics();if(item instanceof Graphics){if(node.effectId==='hearts'){item.moveTo(0,4).bezierCurveTo(-19,-9,-5,-20,0,-8).bezierCurveTo(5,-20,19,-9,0,4).fill(0xf195b9);}else item.star(0,0,4,8,3).fill(node.effectId==='splash'?0x60c8ff:0xffd58b);}this.fx.addChild(item);items.push(item);}
      update=ms=>{items.forEach((item,i)=>{if(sleepy){const age=ms-i*800;if(age<0){item.alpha=0;return;}const p=(age%2400)/2400;item.position.set((node.origin?.x??-60)+p*90,(node.origin?.y??-270)-p*100);item.scale.set(.65+p*.55);item.alpha=Math.sin(p*Math.PI);}else{const p=(ms/1600+i/7)%1;item.position.set(Math.sin(i*2.4)*115,-170-p*150);item.alpha=Math.sin(p*Math.PI);item.rotation=ms/1000+i;}});};dispose=()=>items.forEach(item=>item.destroy());
    }
    else if(node.type==='bubble'){const s=this.settings();if(s.bubbles&&(source!=='normal'||s.autonomousBubbles)){this.bubble.text=node.text;this.bubble.position.set(14,10);const width=this.bubble.width+28,height=this.bubble.height+20;this.bubbleBack.clear().roundRect(0,0,width,height,14).fill({color:0xf7fcff,alpha:.98}).stroke({color:0xbbd7ef,width:1});this.bubbleContainer.position.set((this.viewport.width-width)/2,15);this.bubbleContainer.visible=true;}dispose=()=>{this.bubbleContainer.visible=false;};}
    else if(node.type==='move_by'){const id=`${instanceId}-move`;void window.pet.moveStart(id,node.dxDip,node.dyDip,node.durationMs,node.easing).catch(e=>this.onError(String(e),instanceId));dispose=()=>{void window.pet.moveStop(id).catch(e=>this.onError(String(e),instanceId));};}
    return {update:ms=>{if(!disposed)update(ms);},dispose:()=>{if(disposed)return;disposed=true;dispose();}};
  }
  async destroy(){this.app.destroy(true,{children:true});this.liveTexture?.destroy(true);this.live.destroy();for(const url of this.textures.keys())await Assets.unload(url);this.textures.clear();}
}


