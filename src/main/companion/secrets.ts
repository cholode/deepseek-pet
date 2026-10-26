import { safeStorage } from 'electron';
import { promises as fs } from 'node:fs';
import { z } from 'zod';
export type SecretName = 'model' | 'qq' | 'mcp';
// 密钥只存在于主进程和系统加密文件；状态快照只返回“是否已配置”。
export class SecretStore {
  private values: Partial<Record<SecretName, string>> = {};
  private sealed: Partial<Record<SecretName, string>> = {};
  constructor(private file: string) {}
  async load() {
    try {
      this.sealed = z.object({ model: z.string().optional(), qq: z.string().optional(), mcp: z.string().optional() }).strict().parse(JSON.parse(await fs.readFile(this.file, 'utf8')));
      for (const name of ['model', 'qq', 'mcp'] as const) if (this.sealed[name]) this.values[name] = (await safeStorage.decryptStringAsync(Buffer.from(this.sealed[name]!, 'base64'))).result;
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('无法读取系统加密的密钥，请在设置中重新填写'); }
  }
  get(name: SecretName) { return this.values[name] ?? ''; }
  status() { return { model: !!this.values.model, qq: !!this.values.qq, mcp: !!this.values.mcp }; }
  async set(patch: Partial<Record<SecretName, string>>) {
    if (!Object.keys(patch).length) return;
    if (!(await safeStorage.isAsyncEncryptionAvailable())) throw new Error('系统密钥加密不可用，未保存任何明文密钥');
    const next = { ...this.sealed }; const values = { ...this.values };
    for (const name of ['model', 'qq', 'mcp'] as const) {
      if (patch[name] === undefined) continue;
      const value = patch[name]!.trim();
      if (value) { next[name] = (await safeStorage.encryptStringAsync(value)).toString('base64'); values[name] = value; }
      else { delete next[name]; delete values[name]; }
    }
    await fs.writeFile(`${this.file}.tmp`, JSON.stringify(next), 'utf8'); await fs.rename(`${this.file}.tmp`, this.file);
    this.sealed = next; this.values = values;
  }
}
