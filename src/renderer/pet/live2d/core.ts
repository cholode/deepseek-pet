export interface CoreModel {
  parameters: { count: number; ids: string[]; values: Float32Array; defaultValues: Float32Array; minimumValues: Float32Array; maximumValues: Float32Array };
  drawables: { count: number; ids: string[]; vertexPositions: Float32Array[]; vertexUvs: Float32Array[]; indices: Uint16Array[]; indexCounts: Int32Array; opacities: Float32Array; masks: Int32Array[]; maskCounts: Int32Array; resetDynamicFlags(): void };
  renderOrders: Int32Array;
  update(): void;
  release(): void;
}
export interface CoreMoc { _release(): void }
interface Core { Version: { csmGetVersion(): number }; Moc: { fromArrayBuffer(data: ArrayBuffer): CoreMoc | null }; Model: { fromMoc(moc: CoreMoc): CoreModel | null } }
declare global { interface Window { Live2DCubismCore?: Core } }
export const modelUrl = (file: string) => new URL(`./live2d/${file}`, document.baseURI).href;
let loading: Promise<Core> | undefined;
export function loadCore(): Promise<Core> {
  return loading ??= (async () => {
    if (!window.Live2DCubismCore) await new Promise<void>((resolve,reject) => {
      const script = document.createElement('script'); script.src = modelUrl('live2dcubismcore.min.js');
      script.onload = () => resolve(); script.onerror = () => reject(new Error('无法加载本地 Live2D 运行库')); document.head.append(script);
    });
    for (let i=0;i<500;i++) {
      try { if (window.Live2DCubismCore?.Version.csmGetVersion()) return window.Live2DCubismCore; } catch { /* Embedded WebAssembly is still initializing. */ }
      await new Promise(resolve => setTimeout(resolve,20));
    }
    throw new Error('Live2D 初始化超时，请重新启动桌宠');
  })();
}
