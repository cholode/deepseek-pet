import { z } from 'zod';
import { mkdir, writeFile } from 'node:fs/promises';
import { packSchema, motionSchema, groupSchema, settingsSchema } from '../src/shared/schema';
async function main() {
await mkdir('schemas', { recursive: true });
for (const [name, schema] of Object.entries({ pack: packSchema, motion: motionSchema, group: groupSchema, settings: settingsSchema })) await writeFile(`schemas/${name}.schema.json`, JSON.stringify(z.toJSONSchema(schema), null, 2));

}
void main();

