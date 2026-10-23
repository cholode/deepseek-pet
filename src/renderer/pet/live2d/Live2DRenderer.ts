import { loadCore, modelUrl, type CoreModel, type CoreMoc } from './core';
import { clamp, transformMesh, type RigPose } from './pose';
import { armForeground } from './arms';
import { articulatedTexture } from './arm-art';

interface MeshBuffers { position: WebGLBuffer; uv: WebGLBuffer; indices: WebGLBuffer; vertices: Float32Array; alpha: number }
interface MaskBuffer { texture: WebGLTexture; framebuffer: WebGLFramebuffer }

/** One local Cubism model, driven by Avatar's existing ticker, rendered into a Pixi canvas texture. */
export class Live2DRenderer {
  readonly canvas = document.createElement('canvas');
  private gl!: WebGLRenderingContext; private model!: CoreModel; private moc!: CoreMoc;
  private program!: WebGLProgram; private texture!: WebGLTexture; private armTexture!: WebGLTexture;
  private meshes: MeshBuffers[] = []; private masks = new Map<number,MaskBuffer>();
  private parameters = new Map<string,number>(); private order: number[] = [];
  private locations!: { position: number; uv: number; opacity: WebGLUniformLocation | null; clipped: WebGLUniformLocation | null; flush: WebGLUniformLocation | null; cleanArm: WebGLUniformLocation | null };
  private faceFlush = 0;
  private armClean = {Left:0,Right:0};
  private disposed = false; private contextLost = false;
  private readonly onContextLost = (event: Event) => { event.preventDefault(); this.contextLost = true; };

  async init() {
    try {
      const core = await loadCore();
      const response = await fetch(modelUrl('DeepBlue.moc3')); if (!response.ok) throw new Error(`Live2D 模型加载失败：${response.status}`);
      const moc = core.Moc.fromArrayBuffer(await response.arrayBuffer()); if (!moc) throw new Error('Live2D 模型文件无效'); this.moc = moc;
      const model = core.Model.fromMoc(moc); if (!model) throw new Error('Live2D 模型创建失败'); this.model = model;
      this.canvas.width=448; this.canvas.height=640;
      const gl=this.canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true}); if(!gl)throw new Error('Live2D 需要 WebGL 图形支持'); this.gl=gl;
      this.canvas.addEventListener('webglcontextlost',this.onContextLost);
      this.program=gl.createProgram()!;
      const vertex=this.shader(gl.VERTEX_SHADER,'attribute vec2 position;attribute vec2 uv;varying vec2 vUv;void main(){vUv=uv;gl_Position=vec4(position,0.,1.);}');
      const fragment=this.shader(gl.FRAGMENT_SHADER,`precision mediump float;
        varying vec2 vUv; uniform sampler2D tex; uniform sampler2D clipTex; uniform sampler2D armTex;
        uniform vec2 viewport; uniform float clipped; uniform float opacity; uniform float flush; uniform float cleanArm;
        void main(){
          vec4 c=texture2D(tex,vec2(vUv.x,1.-vUv.y))*opacity;
          if(cleanArm>0.0)c=mix(c,texture2D(armTex,vec2(vUv.x,1.-vUv.y))*opacity,cleanArm);
          if(flush>0.0 && c.a>0.001){
            vec3 rgb=c.rgb/c.a;
            // Restrict the flush to warm skin. Blue hair, white lace and ink retain their colors.
            float skin=smoothstep(-0.10,-0.02,rgb.r-rgb.b)*smoothstep(0.3,0.6,rgb.r);
            c.rgb=mix(rgb,rgb*vec3(1.0,0.30,0.40),skin*flush)*c.a;
          }
          if(clipped>0.5)c*=texture2D(clipTex,gl_FragCoord.xy/viewport).a;
          gl_FragColor=c;
        }`);
      gl.attachShader(this.program,vertex);gl.attachShader(this.program,fragment);gl.linkProgram(this.program);gl.deleteShader(vertex);gl.deleteShader(fragment);
      if(!gl.getProgramParameter(this.program,gl.LINK_STATUS))throw new Error(`Live2D 着色器链接失败：${gl.getProgramInfoLog(this.program)}`);
      gl.useProgram(this.program);gl.uniform1i(gl.getUniformLocation(this.program,'tex'),0);gl.uniform1i(gl.getUniformLocation(this.program,'clipTex'),1);gl.uniform2f(gl.getUniformLocation(this.program,'viewport'),this.canvas.width,this.canvas.height);
      this.locations={position:gl.getAttribLocation(this.program,'position'),uv:gl.getAttribLocation(this.program,'uv'),opacity:gl.getUniformLocation(this.program,'opacity'),clipped:gl.getUniformLocation(this.program,'clipped'),flush:gl.getUniformLocation(this.program,'flush'),cleanArm:gl.getUniformLocation(this.program,'cleanArm')};
      gl.uniform1i(gl.getUniformLocation(this.program,'armTex'),2);
      const image=new Image();image.src=modelUrl('texture_00.png');await image.decode();
      this.texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);this.textureOptions();
      this.armTexture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,this.armTexture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,articulatedTexture(image));this.textureOptions();
      for(let i=0;i<model.drawables.count;i++){
        const position=gl.createBuffer()!,uv=gl.createBuffer()!,indices=gl.createBuffer()!;
        this.meshes.push({position,uv,indices,vertices:new Float32Array(model.drawables.vertexPositions[i].length),alpha:1});
        gl.bindBuffer(gl.ARRAY_BUFFER,uv);gl.bufferData(gl.ARRAY_BUFFER,model.drawables.vertexUvs[i],gl.STATIC_DRAW);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,indices);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,model.drawables.indices[i],gl.STATIC_DRAW);
        for(const mask of model.drawables.masks[i])if(!this.masks.has(mask)){
          const texture=gl.createTexture()!,framebuffer=gl.createFramebuffer()!;this.masks.set(mask,{texture,framebuffer});
          gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,this.canvas.width,this.canvas.height,0,gl.RGBA,gl.UNSIGNED_BYTE,null);this.textureOptions();
          gl.bindFramebuffer(gl.FRAMEBUFFER,framebuffer);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
          if(gl.checkFramebufferStatus(gl.FRAMEBUFFER)!==gl.FRAMEBUFFER_COMPLETE)throw new Error('Live2D 眼部遮罩初始化失败');
        }
      }
      this.parameters=new Map(model.parameters.ids.map((id,i)=>[id,i]));this.order=Array.from({length:model.drawables.count},(_,i)=>i);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);gl.disable(gl.CULL_FACE);
      this.render({},{});
    } catch (error) { this.destroy(); throw error; }
  }
  private shader(type:number,code:string){const gl=this.gl,s=gl.createShader(type)!;gl.shaderSource(s,code);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)){const error=gl.getShaderInfoLog(s);gl.deleteShader(s);throw new Error(`Live2D 着色器编译失败：${error}`);}return s;}
  private textureOptions(){const gl=this.gl;gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);}
  render(values:Record<string,number>,pose:RigPose,faceFlush=0){
    if(this.disposed)return;if(this.contextLost)throw new Error('Live2D 图形上下文丢失，请重新启动桌宠');
    const {model,gl}=this;this.faceFlush=clamp(faceFlush,0,1);model.parameters.values.set(model.parameters.defaultValues);
    for(const side of ['Left','Right'] as const)this.armClean[side]=clamp(Math.abs(pose[`shoulder${side}`]?.rotationDeg??0)/25,0,1);
    for(const [id,value]of Object.entries(values)){const i=this.parameters.get(id);if(i!==undefined)model.parameters.values[i]=clamp(value,model.parameters.minimumValues[i],model.parameters.maximumValues[i]);}
    model.update();
    for(let i=0;i<this.meshes.length;i++)this.meshes[i].alpha=transformMesh(model.drawables.ids[i],model.drawables.vertexPositions[i],this.meshes[i].vertices,pose);
    gl.useProgram(this.program);gl.viewport(0,0,this.canvas.width,this.canvas.height);gl.clearColor(0,0,0,0);
    for(const [i,mask]of this.masks){gl.bindFramebuffer(gl.FRAMEBUFFER,mask.framebuffer);gl.clear(gl.COLOR_BUFFER_BIT);this.draw(i,true);}
    const order=(i:number)=>model.renderOrders[i]+(armForeground(model.drawables.ids[i],pose)?1000:0);
    gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.clear(gl.COLOR_BUFFER_BIT);this.order.sort((a,b)=>order(a)-order(b));
    for(const i of this.order)this.draw(i,false);model.drawables.resetDynamicFlags();
  }
  private draw(i:number,maskPass:boolean){
    const {gl,model,locations:l}=this,b=this.meshes[i],opacity=model.drawables.opacities[i]*b.alpha;if(opacity<.001)return;
    gl.bindBuffer(gl.ARRAY_BUFFER,b.position);gl.bufferData(gl.ARRAY_BUFFER,b.vertices,gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(l.position);gl.vertexAttribPointer(l.position,2,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,b.uv);gl.enableVertexAttribArray(l.uv);gl.vertexAttribPointer(l.uv,2,gl.FLOAT,false,0,0);
    const clipped=!maskPass&&model.drawables.maskCounts[i]>0;gl.uniform1f(l.opacity,opacity);gl.uniform1f(l.clipped,clipped?1:0);
    const faceMesh=/^(HeadBase|FrontHair|BangCenter|Mouth|EyeOpen[LR]|EyeClosed[LR]|EyeLash[LR]|EyeCrease[LR]|EyeLidEdgeR)$/.test(model.drawables.ids[i]);
    gl.uniform1f(l.flush,!maskPass&&faceMesh?this.faceFlush:0);
    const id=model.drawables.ids[i],clean=id==='Dress'||id==='BackHair'?Math.max(this.armClean.Left,this.armClean.Right):/^(Arm|Hand)L$/.test(id)?this.armClean.Left:/^(Arm|Hand)R$/.test(id)?this.armClean.Right:0;
    gl.uniform1f(l.cleanArm,clean);
    gl.activeTexture(gl.TEXTURE2);gl.bindTexture(gl.TEXTURE_2D,this.armTexture);
    gl.activeTexture(gl.TEXTURE1);gl.bindTexture(gl.TEXTURE_2D,clipped?this.masks.get(model.drawables.masks[i][0])!.texture:null);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,b.indices);gl.drawElements(gl.TRIANGLES,model.drawables.indexCounts[i],gl.UNSIGNED_SHORT,0);
  }
  destroy(){
    if(this.disposed)return;this.disposed=true;this.canvas.removeEventListener('webglcontextlost',this.onContextLost);
    const gl=this.gl;if(gl){for(const b of this.meshes){gl.deleteBuffer(b.position);gl.deleteBuffer(b.uv);gl.deleteBuffer(b.indices);}for(const m of this.masks.values()){gl.deleteFramebuffer(m.framebuffer);gl.deleteTexture(m.texture);}gl.deleteTexture(this.texture);gl.deleteTexture(this.armTexture);gl.deleteProgram(this.program);gl.getExtension('WEBGL_lose_context')?.loseContext();}
    this.meshes=[];this.masks.clear();this.model?.release();this.moc?._release();
  }
}
