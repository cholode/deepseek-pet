import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { packSchema, motionSchema, groupSchema, settingsSchema } from '../src/shared/schema';
import { softwarePluginSchema } from '../src/shared/software';
import { stickerPluginSchema, stickerCatalogSchema } from '../src/shared/stickers';
async function main() {
await mkdir('schemas', { recursive: true });
for (const [name, schema] of Object.entries({ pack: packSchema, motion: motionSchema, group: groupSchema, settings: settingsSchema, 'software-plugin': softwarePluginSchema, 'sticker-plugin': stickerPluginSchema, 'sticker-catalog': stickerCatalogSchema })) await writeFile(`schemas/${name}.schema.json`, JSON.stringify(z.toJSONSchema(schema), null, 2));

}
void main();

