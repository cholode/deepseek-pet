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
  it('rejects reserved builtin namespace',async()=>{await expect(readPack(path.resolve('resources/builtin'),false,p=>p)).rejects.toThrow('保留');});
  it('keeps valid packs when another folder contains bad JSON',async()=>{const dir=await temp();const store=new PackStore(path.resolve('resources/builtin'),dir);store.commit(await store.candidate());await fs.mkdir(path.join(dir,'broken'));await fs.writeFile(path.join(dir,'broken','pack.json'),'{broken');const next=await store.candidate();expect(next.packs[0].manifest.id).toBe('builtin.deepblue');expect(store.errors.length).toBe(1);});
  it('valid reload publishes custom pack and invalid edit keeps its old snapshot',async()=>{const dir=await temp();const store=new PackStore(path.resolve('resources/builtin'),dir);const custom=path.join(dir,'user.celebrations');await fs.cp(path.resolve('examples/custom-action-pack'),custom,{recursive:true});store.commit(await store.candidate());expect(store.registry.packs.length).toBe(2);await fs.writeFile(path.join(custom,'pack.json'),'{bad');const next=await store.candidate();expect(next.packs.length).toBe(2);expect(next.packs[1]).toBe(store.registry.packs[1]);expect(store.errors.length).toBe(1);});
});
describe('persisted settings',()=>{
  it('loads defaults and validates numeric bounds',async()=>{const store=new SettingsStore(path.join(await temp(),'settings.json'));expect(await store.load()).toEqual(defaults);expect(settingsSchema.safeParse({...defaults,size:10}).success).toBe(false);expect(settingsSchema.safeParse({...defaults,intervalMinMs:15000,intervalMaxMs:1000}).success).toBe(false);});
  it('persists group overrides and serializes writes atomically',async()=>{const file=path.join(await temp(),'settings.json');const store=new SettingsStore(file);await store.load();await Promise.all([store.save({...defaults,size:.8}),store.save({...defaults,size:1.2,overrides:{'builtin.deepblue:greet_wave':{weight:0,enabled:true}}})]);const fresh=new SettingsStore(file);await fresh.load();expect(fresh.value.size).toBe(1.2);expect(fresh.value.overrides['builtin.deepblue:greet_wave'].weight).toBe(0);});
  it('backs up corrupted config and recovers safely',async()=>{const dir=await temp();const file=path.join(dir,'settings.json');await fs.writeFile(file,'{not-json');const store=new SettingsStore(file);expect(await store.load()).toEqual(defaults);expect((await fs.readdir(dir)).some(f=>f.includes('.corrupt-'))).toBe(true);expect(store.error).toContain('备份');});
});
