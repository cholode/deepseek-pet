import { Application, Assets, Container, Graphics, Rectangle, Sprite, Text, Texture } from 'pixi.js';
import 'pixi.js/unsafe-eval'; // Pixi's static uniform polyfill: works WITHOUT CSP unsafe-eval.
import { ease } from '../../shared/geometry';
import { type Catalog, type Settings, type ActionChannel } from '../../shared/schema';
import type { HitRegion } from '../../shared/contracts';
import { frameIndex, type AnimationHost, type Leaf, type RunningLeaf } from './engine';
const pivot: Record<string, [number, number]> = { root: [0,0], body: [0,-145], head: [0,-205], hairBack:[0,-300],hairFront:[0,-305],armLeft:[-49,-193],armRight:[49,-193],eyes:[0,-240],mouth:[0,-208],effects:[0,-200],tail:[28,-114] };
export class Avatar implements AnimationHost {
  readonly app = new Application(); readonly placement = new Container(); readonly overlay = new Container(); readonly nodes = new Map<string, Container>(); private sprites = new Map<string, Sprite>(); private textures = new Map<string, Texture>(); private time = 0; private nextBlink = 2500; private blinkUntil = 0; private face = 'neutral'; private headOpen = Texture.EMPTY; private headClosed = Texture.EMPTY; private expressionArt = new Graphics(); private fx = new Container(); private frame = new Sprite(); private bubble = new Text({ text: '', style: { fontFamily: 'Microsoft YaHei, sans-serif', fontSize: 14, fill: '#254269', wordWrap: true, wordWrapWidth: 235, align: 'center', fontWeight: '500' } }); private bubbleBack = new Graphics(); private bubbleContainer = new Container(); pressed = false; private gaze = 0;
  constructor(private settings: () => Settings, private onError: (e: string, instanceId: string) => void) {}
  async init(element: HTMLElement, catalog: Catalog) {
    await this.app.init({ width: 340, height: 420, backgroundAlpha: 0, antialias: true, resolution: window.devicePixelRatio || 1, autoDensity: true, preference: 'webgl' }); element.appendChild(this.app.canvas);
    this.app.stage.addChild(this.placement); this.placement.addChild(this.overlay); this.placement.position.set(170, 405); this.placement.scale.set(.82);
    for (const [id, [x,y]] of Object.entries(pivot)) { const node = new Container(); node.label = id; node.pivot.set(x,y); node.position.set(x,y); this.nodes.set(id,node); }
    const root = this.nodes.get('root')!; this.overlay.addChild(root);
    for (const id of ['hairBack','body','armLeft','armRight','head','effects']) root.addChild(this.nodes.get(id)!);
    this.nodes.get('body')!.addChild(this.nodes.get('tail')!);
    const head = this.nodes.get('head')!; for (const id of ['eyes','mouth','hairFront']) head.addChild(this.nodes.get(id)!);
    // Face skin must render before the nested facial feature nodes.
    for (const id of ['hairBack','tail','body','armLeft','armRight','head','eyes','mouth','hairFront']) { const sprite = new Sprite(); sprite.position.set(-170,-390); this.nodes.get(id)!.addChildAt(sprite,id==='body'?1:0); this.sprites.set(id,sprite); }
    head.addChild(this.expressionArt); this.nodes.get('effects')!.addChild(this.fx);
    head.eventMode = 'static'; head.cursor = 'grab'; head.hitArea = new Rectangle(-122,-390,244,207);
    this.nodes.get('body')!.eventMode = 'static'; this.nodes.get('body')!.cursor = 'grab'; this.nodes.get('body')!.hitArea = new Rectangle(-100,-200,265,205);
    this.overlay.addChild(this.frame); this.frame.visible=false; this.frame.eventMode='none';
    this.bubbleContainer.addChild(this.bubbleBack, this.bubble); this.app.stage.addChild(this.bubbleContainer); this.bubbleContainer.visible=false;
    await this.preload(catalog); this.useCatalog(catalog); this.resize();
  }
  async preload(catalog: Catalog) { const newlyLoaded: string[] = []; try { for (const url of new Set(catalog.assets.values())) { if (this.textures.has(url)) continue; const texture = await Assets.load<Texture>({ src: url, loadParser: 'loadTextures' }); this.textures.set(url, texture); newlyLoaded.push(url); } } catch (e) { for (const url of newlyLoaded) { this.textures.delete(url); await Assets.unload(url); } throw e; } }
  useCatalog(catalog: Catalog) { for (const [id,sprite] of this.sprites) { const url = catalog.assets.get(`builtin.deepblue:assets/${id}.png`); if (!url || !this.textures.has(url)) throw new Error(`缺少角色图层：${id}`); sprite.texture = this.textures.get(url)!; sprite.width=340; sprite.height=420; } this.headOpen=this.sprites.get('head')!.texture; const closed=catalog.assets.get('builtin.deepblue:assets/headClosed.png'); if(!closed||!this.textures.has(closed))throw new Error('缺少闭眼图层'); this.headClosed=this.textures.get(closed)!; }
  async releaseUnused(catalog: Catalog) { const used = new Set(catalog.assets.values()); for (const url of this.textures.keys()) if (!used.has(url)) { this.textures.delete(url); await Assets.unload(url); } }
  resize() { const size=this.settings().size; this.app.renderer.resize(Math.round(340*size), Math.round(420*size)); this.app.stage.scale.set(size); this.app.ticker.maxFPS=this.settings().fps; }
  regions(): HitRegion[] { return (['head','body'] as const).map(target => { const node=this.nodes.get(target)!; const r=node.hitArea as Rectangle; const points=[[r.x,r.y],[r.x+r.width,r.y],[r.x,r.y+r.height],[r.x+r.width,r.y+r.height]].map(([x,y])=>node.toGlobal({x,y})); const x=Math.min(...points.map(p=>p.x)),y=Math.min(...points.map(p=>p.y));return {target,x,y,width:Math.max(...points.map(p=>p.x))-x,height:Math.max(...points.map(p=>p.y))-y}; }); }
  setGaze(clientX: number) { this.gaze=Math.max(-2.5,Math.min(2.5,(clientX/(340*this.settings().size)-.5)*6)); }
  idle(delta: number, occupied: ActionChannel[]) {
    this.time+=Math.min(delta,100); this.overlay.scale.set(this.pressed?.965:1); this.overlay.y=this.pressed?3:0;
    if (!occupied.includes('pose')) { this.set('body','scaleY',1+Math.sin(this.time/650)*.008); this.set('head','offsetY',Math.sin(this.time/650)*1.1); this.set('hairBack','rotationDeg',Math.sin(this.time/1100)*1.7); this.set('tail','rotationDeg',Math.sin(this.time/850)*5); }
    if (!occupied.includes('face')) { if(this.time>this.nextBlink){this.blinkUntil=this.time+140;this.nextBlink=this.time+2500+Math.random()*4200;} this.nodes.get('eyes')!.scale.y=this.time<this.blinkUntil?.08:1; this.nodes.get('eyes')!.x=this.gaze; }
    const closed=this.face==='sleep'||this.face==='smile'||this.nodes.get('eyes')!.scale.y<.5; this.sprites.get('head')!.texture=closed?this.headClosed:this.headOpen; this.sprites.get('head')!.x=-170+this.gaze*.25;
  }
  set(id: string, property: string, value: number) { const n=this.nodes.get(id); if(!n) throw new Error(`未知角色节点：${id}`); const [x,y]=pivot[id]; if(property==='offsetX') n.x=x+value; else if(property==='offsetY') n.y=y+value; else if(property==='rotationDeg') n.rotation=value*Math.PI/180; else if(property==='scaleX') n.scale.x=value; else if(property==='scaleY') n.scale.y=value; else if(property==='alpha') n.alpha=value; }
  private resetChannels(channels: ActionChannel[]) { for(const [id,n] of this.nodes) { const channel=id==='eyes'||id==='mouth'?'face':id==='effects'?'effect':'pose'; if(!channels.includes(channel)) continue; n.position.set(...pivot[id]); n.scale.set(1); n.rotation=0; n.alpha=1; } }
  reset() { this.resetChannels(['pose','face','effect']); this.expression('neutral'); this.fx.removeChildren().forEach(c=>c.destroy()); this.bubbleContainer.visible=false; this.frame.visible=false; this.nodes.get('root')!.visible=true; }
  private expression(id: string) {
    this.face=id; const g=this.expressionArt; g.clear();
    // Painted open/closed faces share one silhouette; overlays only add small expression accents.
    if(id==='smile'||id==='shy') g.ellipse(-43,-230,12,4).ellipse(43,-230,12,4).fill({color:0xf29ba9,alpha:.24});
    if(id==='annoyed') g.moveTo(-46,-270).lineTo(-26,-264).moveTo(26,-264).lineTo(46,-270).stroke({color:0x29344f,width:1.4});
    if(id==='surprised') g.ellipse(-1,-219,2.5,3.3).fill(0xb6737d);
  }
  begin(node: Leaf, catalog: Catalog, source: string, instanceId: string): RunningLeaf {
    let disposed=false; let update: (ms:number)=>void=()=>{}; let dispose:()=>void=()=>{};
    if(node.type==='motion') {
      const m=catalog.motions.get(node.motionId)!; if(!m)throw new Error('motion 丢失');
      if(m.kind==='rig_timeline'){this.resetChannels(m.channels);update=ms=>{const time=ms>=m.durationMs*node.repeat?m.durationMs:ms%m.durationMs;for(const track of m.tracks){let index=track.keyframes.findIndex(k=>k.timeMs>=time);if(index<1)index=1;const a=track.keyframes[index-1],b=track.keyframes[index];const f=ease(Math.min(1,Math.max(0,(time-a.timeMs)/(b.timeMs-a.timeMs))),b.easing);this.set(track.targetId,track.property,a.value+(b.value-a.value)*f);}};dispose=()=>this.resetChannels(m.channels);}
      else {this.nodes.get('root')!.visible=false;this.frame.visible=true;this.frame.anchor.set(m.anchor.x,m.anchor.y);update=ms=>{const frame=m.frames[frameIndex(m,ms>=m.durationMs*node.repeat?m.durationMs:ms%m.durationMs)];const packId=node.motionId.split(':')[0];const url=catalog.assets.get(`${packId}:${frame}`);if(!url||!this.textures.has(url))throw new Error(`帧未预加载：${frame}`);this.frame.texture=this.textures.get(url)!;};dispose=()=>{this.frame.visible=false;this.nodes.get('root')!.visible=true;};}
    } else if(node.type==='expression'){this.resetChannels(['face']);this.expression(node.expressionId);dispose=()=>this.expression('neutral');}
    else if(node.type==='effect'){ const items: (Graphics|Text)[]=[]; for(let i=0;i<7;i++){const item=node.effectId==='sleepy'?new Text({text:'z',style:{fontSize:17+i*2,fill:'#78a6df',fontFamily:'sans-serif'}}):new Graphics();if(item instanceof Graphics){if(node.effectId==='hearts'){item.moveTo(0,4).bezierCurveTo(-19,-9,-5,-20,0,-8).bezierCurveTo(5,-20,19,-9,0,4).fill(0xf195b9);}else item.star(0,0,4,8,3).fill(node.effectId==='splash'?0x60c8ff:0xffd58b);}this.fx.addChild(item);items.push(item);}update=ms=>{items.forEach((item,i)=>{const p=(ms/1600+i/7)%1;item.position.set(Math.sin(i*2.4)*115,-170-p*150);item.alpha=Math.sin(p*Math.PI);item.rotation=node.effectId==='sleepy'?0:ms/1000+i;});};dispose=()=>items.forEach(item=>item.destroy());}
    else if(node.type==='bubble'){const s=this.settings();if(s.bubbles&&(source!=='normal'||s.autonomousBubbles)){this.bubble.text=node.text;this.bubble.position.set(14,10);const width=this.bubble.width+28,height=this.bubble.height+20;this.bubbleBack.clear().roundRect(0,0,width,height,14).fill({color:0xf7fcff,alpha:.98}).stroke({color:0xbbd7ef,width:1});this.bubbleContainer.position.set((340-width)/2,15);this.bubbleContainer.visible=true;}dispose=()=>{this.bubbleContainer.visible=false;};}
    else if(node.type==='move_by'){const id=`${instanceId}-move`;void window.pet.moveStart(id,node.dxDip,node.dyDip,node.durationMs,node.easing).catch(e=>this.onError(String(e),instanceId));dispose=()=>{void window.pet.moveStop(id).catch(e=>this.onError(String(e),instanceId));};}
    return {update:ms=>{if(!disposed)update(ms);},dispose:()=>{if(disposed)return;disposed=true;dispose();}};
  }
  async destroy(){this.app.destroy(true,{children:true});for(const url of this.textures.keys())await Assets.unload(url);this.textures.clear();}
}


