import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Mechanical atlas extraction and registration only; all character painting is image-generated.
async function main() {
const output = path.resolve('resources/builtin/assets');
const source = path.resolve('art/source/components-v2.png');
const heads = path.resolve('art/source/heads-v2.png');
const scale = 2;
type Piece = { crop: [number, number, number, number]; box: [number, number, number, number] };
const pieces: Record<string, Piece> = {
  head: { crop: [0, 0, 887, 887], box: [-122, -390, 244, 214] },
  headClosed: { crop: [0, 0, 887, 887], box: [-122, -390, 244, 214] },
  body: { crop: [1090, 0, 446, 555], box: [-84, -211, 168, 211] },
  hairBack: { crop: [0, 493, 534, 531], box: [-121, -351, 242, 292] },
  armLeft: { crop: [561, 633, 218, 295], box: [-85, -200, 63, 94] },
  armRight: { crop: [815, 633, 224, 295], box: [22, -200, 63, 94] },
  tail: { crop: [1100, 560, 436, 464], box: [8, -207, 156, 110] },
};
const layers = new Map<string, Buffer>();
await mkdir(output, { recursive: true });
for (const [id, { crop, box }] of Object.entries(pieces)) {
  const [left, top, width, height] = crop;
  let cell = await sharp(id.startsWith('head')?heads:source).extract({ left, top, width, height }).png().toBuffer();
  if(id==='headClosed') {
    // Use only the generated closed-eye region. The silhouette and bows remain pixel-identical.
    const eyes=await sharp(heads).extract({left:1121,top:485,width:414,height:137}).png().toBuffer();
    cell=await sharp(cell).composite([{input:eyes,left:246,top:485}]).png().toBuffer();
  }
  if(id==='tail') cell=await sharp(cell).rotate(35,{background:'#00000000'}).png().toBuffer();
  const cutout = await sharp(cell).trim({ background: '#00000000', threshold: 8 }).resize(box[2]*scale, box[3]*scale, {fit:'fill'}).png().toBuffer();
  const layer = await sharp({create:{width:340*scale,height:420*scale,channels:4,background:'#00000000'}}).composite([{input:cutout,left:Math.round((box[0]+170)*scale),top:Math.round((box[1]+390)*scale)}]).png().toBuffer();
  layers.set(id,layer); await writeFile(path.join(output,`${id}.png`),layer);
}
// Preserve the old logical face/fringe nodes for imported timelines, without old vector artwork.
const empty=await sharp({create:{width:680,height:840,channels:4,background:'#00000000'}}).png().toBuffer();
for(const id of ['eyes','mouth','hairFront'])await writeFile(path.join(output,`${id}.png`),empty);
const order=['hairBack','tail','body','armLeft','armRight','head'];
const assemble=async (closed=false)=>sharp({create:{width:680,height:840,channels:4,background:'#00000000'}}).composite(order.map(id=>({input:layers.get(closed&&id==='head'?'headClosed':id)!}))).png().toBuffer();
const portrait=await assemble();
await writeFile(path.join(output,'portrait.png'),portrait);
await mkdir('art/previews',{recursive:true});
await sharp(portrait).flatten({background:'#f5f8ff'}).png().toFile('art/previews/assembled-v2.png');
for(let i=0;i<4;i++)await sharp(await assemble(i===1)).resize(340,420).modulate({brightness:[1,1.07,1.12,1.04][i],saturation:[1,1.05,1.1,1.03][i]}).png().toFile(path.join(output,`frame-${i}.png`));
console.log('Generated high-resolution registered layers, matching portrait and four matching animation frames.');
}
void main();
