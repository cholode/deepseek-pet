import { afterEach, describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { defaults, settingsSchema } from '../src/shared/schema';
import { SettingsStore } from '../src/main/settings';
import { resolveSafe, inspectFolder, readPack, PackStore, imageSize } from '../src/main/packs';
const dirs:string[]=[];
async function temp(){const d=await fs.mkdtemp(path.join(os.tmpdir(),'deepblue-test-'));dirs.push(d);return d;}
afterEach(async()=>{for(const d of dirs.splice(0)){if(!d.startsWith(path.join(os.tmpdir(),'deepblue-test-')))throw new Error('Unsafe cleanup');await fs.rm(d,{recursive:true,force:true});}});
describe('safe pack file access',()=>{
  it.each(['../evil.png','/evil.png','C:/evil.png',String.raw`\\server\share\evil.png`,'assets/%252e%252e/evil.png','assets/../../evil.png','./bad.png'])('rejects escape %s',p=>{expect(()=>resolveSafe('C:/packs/good',p)).toThrow();});
  it('rejects scripts and invalid image headers before texture decoding',async()=>{const dir=await temp();await fs.writeFile(path.join(dir,'evil.js'),'throw 1');await expect(inspectFolder(dir)).rejects.toThrow('文件类型');expect(()=>imageSize(Buffer.alloc(32))).toThrow('图像头');});
  it('rejects excessive dimensions before allocation',async()=>{const dir=await temp();const header=Buffer.alloc(32);Buffer.from([137,80,78,71,13,10,26,10]).copy(header);header.writeUInt32BE(9000,16);header.writeUInt32BE(9000,20);await fs.writeFile(path.join(dir,'huge.png'),header);await expect(inspectFolder(dir)).rejects.toThrow('4096');});
  it('rejects directory junctions',async()=>{const dir=await temp();const outside=await temp();await fs.symlink(outside,path.join(dir,'linked'),'junction');await expect(inspectFolder(dir)).rejects.toThrow('链接');});
  it('excludes audit-tagged images but still rejects actions referencing them',async()=>{
    const dir=await temp();await fs.cp(path.resolve('examples/custom-action-pack'),dir,{recursive:true});
    await fs.writeFile(path.join(dir,'unused_tag.png'),Buffer.alloc(32));
    expect((await inspectFolder(dir)).has('unused_tag.png')).toBe(false);
    await fs.truncate(path.join(dir,'unused_tag.png'),100*1024*1024+1);
    await expect(inspectFolder(dir)).rejects.toThrow('100 MB');
    await fs.writeFile(path.join(dir,'unused_tag.png'),Buffer.alloc(32));
    const manifest=JSON.parse(await fs.readFile(path.join(dir,'pack.json'),'utf8'));manifest.motions=['motions/tagged.json'];
    await fs.writeFile(path.join(dir,'pack.json'),JSON.stringify(manifest));
    await fs.writeFile(path.join(dir,'motions/tagged.json'),JSON.stringify({schemaVersion:1,id:'tagged',name:'tagged',kind:'frame_animation',avatarId:'deepblue-chibi-v1',durationMs:100,channels:['pose','face'],frames:['unused_tag.png'],frameDurationsMs:[100],canvas:{width:1,height:1},anchor:{x:.5,y:1}}));
    await expect(readPack(dir,false,p=>p)).rejects.toThrow('缺少帧');
  });
  it('rejects reserved builtin namespace',async()=>{const dir=await temp();await fs.cp(path.resolve('examples/custom-action-pack'),dir,{recursive:true});const file=path.join(dir,'pack.json'),manifest=JSON.parse(await fs.readFile(file,'utf8'));manifest.id='builtin.fake';await fs.writeFile(file,JSON.stringify(manifest));await expect(readPack(dir,false,p=>p)).rejects.toThrow('保留');});
  it('validates overlay atlas dimensions against its synchronized frame grid',async()=>{
    const dir=await temp();await fs.cp(path.resolve('examples/custom-action-pack'),dir,{recursive:true});
    const png=(w:number,h:number)=>{const b=Buffer.alloc(32);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(w,16);b.writeUInt32BE(h,20);return b;};
    const manifest=JSON.parse(await fs.readFile(path.join(dir,'pack.json'),'utf8'));manifest.motions=['motions/overlay.json'];
    await fs.writeFile(path.join(dir,'pack.json'),JSON.stringify(manifest));await fs.writeFile(path.join(dir,'body.png'),png(100,100));
    await fs.writeFile(path.join(dir,'motions/overlay.json'),JSON.stringify({schemaVersion:1,id:'overlay',name:'overlay',kind:'frame_animation',avatarId:'deepblue-chibi-v1',durationMs:1000,channels:['pose','face'],frames:['body.png','body.png'],fps:2,canvas:{width:100,height:100},anchor:{x:.5,y:1},frameOverlays:[{image:'face.png',x:10,y:10,width:20,height:20,columns:2}]}));
    await expect(readPack(dir,false,p=>p)).rejects.toThrow('缺少叠层图集');
    await fs.writeFile(path.join(dir,'face.png'),png(20,20));await expect(readPack(dir,false,p=>p)).rejects.toThrow('图集尺寸不一致');
    await fs.writeFile(path.join(dir,'face.png'),png(40,20));expect((await readPack(dir,false,p=>p)).motions).toHaveLength(1);
    const motionFile=path.join(dir,'motions/overlay.json'),motion=JSON.parse(await fs.readFile(motionFile,'utf8'));motion.frameOverlays[0].padding=2;
    await fs.writeFile(motionFile,JSON.stringify(motion));await expect(readPack(dir,false,p=>p)).rejects.toThrow('图集尺寸不一致');
    await fs.writeFile(path.join(dir,'face.png'),png(48,24));expect((await readPack(dir,false,p=>p)).motions).toHaveLength(1);
  });
  it('keeps imported image budgets at 256 MB and caps the shipped pack at 384 MB',async()=>{
    const dir=await temp(),header=Buffer.alloc(32);Buffer.from([137,80,78,71,13,10,26,10]).copy(header);header.writeUInt32BE(4096,16);header.writeUInt32BE(4096,20);
    for(let i=0;i<5;i++)await fs.writeFile(path.join(dir,`${i}.png`),header);
    await expect(inspectFolder(dir)).rejects.toThrow('256 MB');expect((await inspectFolder(dir,true)).size).toBe(5);
    await fs.writeFile(path.join(dir,'pack.json'),JSON.stringify({schemaVersion:1,id:'builtin.fake',name:'fake',version:'1',avatarId:'deepblue-chibi-v1',motions:[],groups:[]}));
    await expect(readPack(dir,false,p=>p)).rejects.toThrow('256 MB');
    for(let i=5;i<7;i++)await fs.writeFile(path.join(dir,`${i}.png`),header);
    await expect(inspectFolder(dir,true)).rejects.toThrow('384 MB');
  });
  it('keeps valid packs when another folder contains bad JSON',async()=>{const dir=await temp();const store=new PackStore(path.resolve('resources/builtin'),dir);store.commit(await store.candidate());await fs.mkdir(path.join(dir,'broken'));await fs.writeFile(path.join(dir,'broken','pack.json'),'{broken');const next=await store.candidate();expect(next.packs[0].manifest.id).toBe('builtin.deepblue');expect(store.errors.length).toBe(1);});
  it('valid reload publishes custom pack and invalid edit keeps its old snapshot',async()=>{const dir=await temp();const store=new PackStore(path.resolve('resources/builtin'),dir);const custom=path.join(dir,'user.celebrations');await fs.cp(path.resolve('examples/custom-action-pack'),custom,{recursive:true});store.commit(await store.candidate());expect(store.registry.packs.length).toBe(2);await fs.writeFile(path.join(custom,'pack.json'),'{bad');const next=await store.candidate();expect(next.packs.length).toBe(2);expect(next.packs[1]).toBe(store.registry.packs[1]);expect(store.errors.length).toBe(1);});
});
describe('persisted settings',()=>{
  it('loads defaults and validates numeric bounds',async()=>{const store=new SettingsStore(path.join(await temp(),'settings.json'));expect(await store.load()).toEqual(defaults);expect(settingsSchema.safeParse({...defaults,size:10}).success).toBe(false);expect(settingsSchema.safeParse({...defaults,intervalMinMs:15000,intervalMaxMs:1000}).success).toBe(false);});
  it('persists group overrides and serializes writes atomically',async()=>{const file=path.join(await temp(),'settings.json');const store=new SettingsStore(file);await store.load();await Promise.all([store.save({...defaults,size:.8}),store.save({...defaults,size:1.2,overrides:{'builtin.deepblue:greet_wave':{weight:0,enabled:true}}})]);const fresh=new SettingsStore(file);await fresh.load();expect(fresh.value.size).toBe(1.2);expect(fresh.value.overrides['builtin.deepblue:greet_wave'].weight).toBe(0);});
  it('backs up corrupted config and recovers safely',async()=>{const dir=await temp();const file=path.join(dir,'settings.json');await fs.writeFile(file,'{not-json');const store=new SettingsStore(file);expect(await store.load()).toEqual(defaults);expect((await fs.readdir(dir)).some(f=>f.includes('.corrupt-'))).toBe(true);expect(store.error).toContain('备份');});
});
