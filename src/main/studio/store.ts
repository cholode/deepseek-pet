import { promises as fs } from 'node:fs';
import path from 'node:path';
import { studioDefaults, studioSchema, type StudioData } from '../../shared/studio';

// 课程与聊天分开落盘：聊天过期不删除课程。写入按队列原子替换，读取失败保留原文件。
export class StudioStore {
  data: StudioData = structuredClone(studioDefaults);
  private writing = Promise.resolve();
  constructor(readonly directory: string) {}
  async load() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const file = path.join(this.directory, 'studio.json');
      if ((await fs.stat(file)).size > 64 * 1024 * 1024) throw new Error('学习工作区超过大小限制');
      this.data = studioSchema.parse(JSON.parse(await fs.readFile(file, 'utf8')));
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('学习工作区无法读取，已保留原文件，请检查备份'); }
    // 重启只自动重试可重做的备课步骤。外部写入结果未知时必须先查询，避免重复建卡。
    for (const workflow of this.data.workflows) {
      for (const step of workflow.steps.filter(s => s.status === 'running')) {
        const kind = workflow.plan.steps.find(s => s.id === step.id)?.kind;
        if (kind === 'review-export') { workflow.status = 'needs-review'; workflow.error = '上次外部记录结果未知，请先检查学习插件中的记录，再重试同一课程记录'; step.status = 'failed'; }
        else { step.status = 'pending'; if (workflow.status === 'running') workflow.status = 'queued'; }
      }
      if (workflow.status === 'running') workflow.status = 'queued';
    }
    for (const session of this.data.sessions) { if (session.status === 'active') session.status = 'paused'; if (session.exportState === 'pending') session.exportState = 'unknown'; }
    await this.save();
  }
  save() {
    const text = JSON.stringify(studioSchema.parse(this.data), null, 2);
    if (Buffer.byteLength(text) > 64 * 1024 * 1024) throw new Error('学习工作区过大，请整理资料后重试');
    const next = this.writing.then(async () => { const target = path.join(this.directory, 'studio.json'); await fs.writeFile(`${target}.tmp`, text, 'utf8'); await fs.rename(`${target}.tmp`, target); });
    this.writing = next.catch(() => {}); return next;
  }
  flush() { return this.writing; }
}
