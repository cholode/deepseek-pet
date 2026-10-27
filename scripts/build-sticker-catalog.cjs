// 从随插件保留的上游快照构建目录；不下载或执行远程代码。
const fs = require('node:fs');
const path = require('node:path');
const directory = path.resolve(__dirname, '../plugins/nekowhale-stickers');
const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'upstream/manifest.json'), 'utf8'));
const meta = JSON.parse(fs.readFileSync(path.join(directory, 'upstream/nekowhale.json'), 'utf8'));
const knowledge = new Map(meta.stickers.map(s => [s.id, s]));
const items = manifest.items.map(item => {
  const k = knowledge.get(item.id);
  if (!k || k.hash !== item.hash) throw new Error(`知识库与图像不匹配：${item.id}`);
  return { id: item.id, pack: item.pack, name: item.name || item.stem, hash: item.hash, bytes: item.bytes, width: item.w, height: item.h, frames: item.frames,
    url: `https://kiriyuki.com${manifest.gif_base}/${encodeURIComponent(item.pack)}/${encodeURIComponent(item.file)}?h=${item.hash}`,
    emotion: k.emotion, tags: k.tags, description: k.desc, use: k.use, direction: k.dir, text: k.text, meme: k.meme };
});
fs.writeFileSync(path.join(directory, 'catalog.json'), JSON.stringify({ updated: manifest.updated, items }, null, 2) + '\n');
console.log(`表情目录：${items.length} 张`);
