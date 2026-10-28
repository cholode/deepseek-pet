import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { voiceConfigSchema, voiceDefaults, voiceRequestSchema, voiceSecretNames, voiceSecretsSchema, type VoiceConfig, type VoiceEvent, type VoiceResponse, type VoiceSecrets, type VoiceState } from '../../shared/voice';
import { VoiceAudio, validateVoiceConfig } from './audio';
import { VoicevoxProcess, findVoicevoxEngine } from './voicevox';
import { WhisperProcess, findWhisperEngine, validateWhisperModel, whisperStartArgs } from './whisper';

interface Host { emit(event: VoiceEvent): void; seal(value: string): Promise<string>; unseal(value: string): Promise<string>; chooseVoicevoxDirectory?(): Promise<string | undefined>; chooseWhisperDirectory?(): Promise<string | undefined>; chooseWhisperModel?(): Promise<string | undefined> }
export class VoiceService {
  private config: VoiceConfig = structuredClone(voiceDefaults);
  private sealed: VoiceSecrets = {}; private secrets: VoiceSecrets = {}; private error?: string; private saving = false;
  private savingDone?: Promise<void>;
  private jobs = new Map<string, AbortController>();
  private capture?: { owner: number; id: string; expires: number; recording: boolean };
  constructor(private file: string, private host: Host, private audio = new VoiceAudio(), private voicevox: Pick<VoicevoxProcess, 'ensure' | 'close'> = new VoicevoxProcess(), private whisper: Pick<WhisperProcess, 'ensure' | 'close'> = new WhisperProcess()) {}
  async start(legacy: { enabled: boolean; voice: string; rate: number; volume: number }) {
    try {
      const saved = z.object({ version: z.literal(1), config: voiceConfigSchema, sealed: voiceSecretsSchema }).strict().parse(JSON.parse(await fs.readFile(this.file, 'utf8')));
      validateVoiceConfig(saved.config); this.config = saved.config; this.sealed = saved.sealed;
      for (const name of voiceSecretNames) if (this.sealed[name]) this.secrets[name] = await this.host.unseal(this.sealed[name]!);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.config.tts = { ...this.config.tts, enabled: legacy.enabled, systemVoice: legacy.voice, rate: legacy.rate, volume: legacy.volume };
        await this.persist(this.config, {});
      } else { this.config.tts.enabled = false; this.config.asr.enabled = false; this.error = '对话设置或语音密钥无法读取，请重新保存设置与密钥'; }
    }
  }
  state(): VoiceState { return { config: structuredClone(this.config), hasSecrets: { ttsLocal: !!this.secrets.ttsLocal, ttsCloud: !!this.secrets.ttsCloud, asrLocal: !!this.secrets.asrLocal, asrCloud: !!this.secrets.asrCloud }, error: this.error }; }
  get ttsEnabled() { return this.config.tts.enabled; }
  get speechLanguages() { return this.config.tts.mode === 'language'; }
  get conversationPolicy() { return { ...this.config.session }; }
  permitsCapture(owner: number) { return !!this.config.asr.enabled && !!this.capture && this.capture.owner === owner && this.capture.recording && this.capture.expires > Date.now(); }
  cancel(owner?: number, playbackOnly = false, playbackId?: string) {
    for (const [id, controller] of this.jobs) if ((owner === undefined || id.startsWith(`${owner}:`)) && (!playbackOnly || id.endsWith(':speak')) && (!playbackId || id.endsWith(`:${playbackId}:speak`))) { controller.abort(); this.jobs.delete(id); }
    if (!playbackOnly && !playbackId && (owner === undefined || this.capture?.owner === owner)) this.capture = undefined;
  }
  stopAll(playbackOnly = false) { this.cancel(undefined, playbackOnly); this.host.emit({ type: playbackOnly ? 'stop-playback' : 'stop-all' }); }
  private async persist(config: VoiceConfig, sealed: VoiceSecrets) {
    await fs.writeFile(`${this.file}.tmp`, JSON.stringify({ version: 1, config, sealed }, null, 2), 'utf8'); await fs.rename(`${this.file}.tmp`, this.file);
  }
  private publish() { this.host.emit({ type: 'state', state: this.state() }); }
  async request(raw: unknown, owner: number, role: 'panel' | 'pet' | 'chat'): Promise<VoiceResponse> {
    try {
      const request = voiceRequestSchema.parse(raw);
      if (request.type === 'state') return { ok: true, state: this.state() };
      if (request.type === 'whisper-directory' || request.type === 'whisper-model') {
        if (role !== 'panel') throw new Error('只能在小屋选择识别引擎与模型');
        if (request.type === 'whisper-directory') { const directory = await this.host.chooseWhisperDirectory?.(); if (directory) await findWhisperEngine(directory); return { ok: true, directory }; }
        const modelPath = await this.host.chooseWhisperModel?.(); if (modelPath) await validateWhisperModel(modelPath); return { ok: true, modelPath };
      }
      if (request.type === 'voicevox-directory') {
        if (role !== 'panel') throw new Error('只能在小屋选择 VOICEVOX 目录');
        const directory = await this.host.chooseVoicevoxDirectory?.();
        if (directory) await findVoicevoxEngine(directory);
        return { ok: true, directory };
      }
      if (request.type === 'cancel') { this.cancel(owner, request.playbackOnly, request.playbackId); return { ok: true }; }
      if (request.type === 'report-error') { if (role === 'chat') throw new Error('此窗口不能报告朗读错误'); this.error = request.message; this.publish(); return { ok: true }; }
      if (request.type === 'configure') {
        if (role !== 'panel') throw new Error('只能在小屋修改对话设置');
        if (this.saving) throw new Error('设置正在保存'); this.saving = true;
        let finishSave!: () => void; this.savingDone = new Promise<void>(resolve => { finishSave = resolve; });
        try {
          validateVoiceConfig(request.config);
          if (request.config.tts.mode === 'language' && request.config.tts.voicevox.autoStart) await findVoicevoxEngine(request.config.tts.voicevox.directory);
          if (request.config.asr.source === 'local' && request.config.asr.localProtocol === 'whisper-cpp' && request.config.asr.whisper.autoStart) {
            await findWhisperEngine(request.config.asr.whisper.directory); const model = await validateWhisperModel(request.config.asr.whisper.modelPath); whisperStartArgs(request.config.asr, model);
          }
          const sealed = { ...this.sealed }; const secrets = { ...this.secrets };
          for (const name of voiceSecretNames) if (request.secrets[name] !== undefined) { const key = request.secrets[name]!.trim(); if (key) { sealed[name] = await this.host.seal(key); secrets[name] = key; } else { delete sealed[name]; delete secrets[name]; } }
          await this.persist(request.config, sealed); this.stopAll(); await Promise.all([this.voicevox.close(), this.whisper.close()]); this.config = request.config; this.sealed = sealed; this.secrets = secrets; this.error = undefined; this.publish();
          return { ok: true, state: this.state() };
        } finally { this.saving = false; finishSave(); }
      }
      const cpp = this.config.asr.source === 'local' && this.config.asr.localProtocol === 'whisper-cpp';
      let captureId: string | undefined;
      if (request.type === 'capture-begin' || request.type === 'asr-check') {
        if (!cpp && !this.config.asr[this.config.asr.source].model.trim()) throw new Error('识别尚未配置：请在对话设置填写识别模型，或选择 whisper.cpp 并绑定本地模型');
      }
      if (request.type === 'capture-begin') {
        if (role === 'pet' || !this.config.asr.enabled) throw new Error('请先在对话设置中启用语音输入');
        if (this.capture && this.capture.expires > Date.now()) throw new Error('已有录音或识别进行中，请先完成或取消');
        this.stopAll(true); captureId = randomUUID(); this.capture = { owner, id: captureId, expires: Date.now() + 125000, recording: false };
      }
      if (request.type === 'speak') {
        if (role === 'chat' || (request.test && role !== 'panel')) throw new Error('此窗口不能发起朗读');
        if (!request.test && !this.config.tts.enabled) return { ok: true };
        if (this.capture?.recording && this.capture.expires > Date.now()) throw new Error('正在录音，朗读已暂停');
        if (this.config.tts.mode === 'language' ? request.language !== 'ja' : this.config.tts.source === 'local' && this.config.tts.localEngine === 'system') return { ok: true, system: structuredClone(this.config.tts) };
      } else if (request.type === 'voicevox-check') {
        if (role !== 'panel') throw new Error('只能在小屋检查 VOICEVOX');
      } else if (request.type === 'asr-check') {
        if (role !== 'panel') throw new Error('只能在小屋检查识别服务');
      } else if (request.type === 'capture-begin') {
        // 识别模型加载完成后才授权麦克风，等待期间也能通过本窗口取消。
      } else {
        if (role === 'pet' || !this.config.asr.enabled || !this.capture || this.capture.owner !== owner || this.capture.id !== request.captureId || this.capture.expires <= Date.now() || !this.capture.recording) throw new Error('录音已取消或过期，请重新录音');
        this.capture.recording = false; this.capture.expires = Date.now() + 125000;
      }
      const id = request.type === 'speak' && request.playbackId ? `${owner}:${request.playbackId}:speak` : `${owner}:${request.type}`;
      // 预合成与播放使用同一个批次；迟到的旧批次取消不能中断新的朗读。
      this.jobs.get(id)?.abort(); const controller = new AbortController(); this.jobs.set(id, controller);
      const timer = setTimeout(() => controller.abort(new Error('语音服务超时')), 120000);
      try {
        if (request.type === 'capture-begin') {
          if (cpp && this.config.asr.whisper.autoStart) await this.whisper.ensure(this.config.asr, controller.signal);
          controller.signal.throwIfAborted();
          if (!this.capture || this.capture.id !== captureId) throw new Error('录音启动已取消');
          this.capture.recording = true; this.capture.expires = Date.now() + 90000;
          return { ok: true, captureId };
        }
        if (request.type === 'asr-check') {
          if (cpp) await this.whisper.ensure(this.config.asr, controller.signal);
          else await this.audio.checkAsr(this.config.asr, this.secrets[this.config.asr.source === 'local' ? 'asrLocal' : 'asrCloud'] ?? '', controller.signal);
          controller.signal.throwIfAborted(); return { ok: true, message: cpp ? '本地识别引擎已就绪，请录音测试中文或日语' : '识别接口可连接，请录音测试实际转写；尚未验证模型与识别质量' };
        }
        if (request.type === 'voicevox-check') {
          await this.voicevox.ensure(this.config.tts.voicevox, controller.signal);
          const speaker = await this.audio.voicevoxSpeaker(this.config.tts.voicevox.url, controller.signal);
          controller.signal.throwIfAborted(); return { ok: true, message: `已连接 VOICEVOX：雨晴はう（ノーマル，声音 ID ${speaker}）` };
        }
        const kind = request.type === 'speak' ? 'tts' : 'asr'; const source = this.config[kind].source;
        const key = this.secrets[`${kind}${source === 'local' ? 'Local' : 'Cloud'}`] ?? '';
        const japanese = request.type === 'speak' && this.config.tts.mode === 'language' && request.language === 'ja';
        if (japanese) await this.voicevox.ensure(this.config.tts.voicevox, controller.signal);
        if (request.type === 'transcribe' && cpp && this.config.asr.whisper.autoStart) await this.whisper.ensure(this.config.asr, controller.signal);
        const result = request.type === 'speak' ? { audio: japanese ? await this.audio.speakJapanese(this.config.tts, request.text, controller.signal) : await this.audio.speak(this.config.tts, request.text, key, controller.signal), volume: this.config.tts.volume } : { text: await this.audio.transcribe(this.config.asr, request.audio, key, controller.signal) };
        controller.signal.throwIfAborted(); this.error = undefined; this.publish(); return { ok: true, ...result };
      } catch (error) {
        if (controller.signal.aborted) throw new Error(controller.signal.reason?.message === '语音服务超时' ? '语音服务超时，请检查本地引擎或云端连接' : '已取消语音请求');
        // 不把远端错误正文或请求头带入日志、状态和聊天。
        throw error instanceof TypeError ? new Error(request.type === 'speak' || request.type === 'voicevox-check' ? '无法连接语音服务，请检查地址与服务是否运行' : '无法连接识别服务，请在对话设置检查地址，启动识别引擎后重试') : error;
      } finally { clearTimeout(timer); if (this.jobs.get(id) === controller) this.jobs.delete(id); if ((request.type === 'transcribe' && this.capture?.id === request.captureId) || (request.type === 'capture-begin' && this.capture?.id === captureId && !this.capture?.recording)) this.capture = undefined; }
    } catch (error) { const message = error instanceof z.ZodError ? '对话设置或语音请求格式不正确' : error instanceof Error ? error.message : '语音请求失败'; return { ok: false, message }; }
  }
  async close() { this.stopAll(); await this.savingDone; await Promise.all([this.voicevox.close(), this.whisper.close()]); }
}
