import { afterEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { completedSpeechSegments, hasSpeechLanguages, parseSpeechLanguages, speechLanguagePrompt } from '../src/shared/speech-language';
import { voiceConfigSchema, voiceDefaults } from '../src/shared/voice';
import { VoiceAudio, validateVoiceConfig } from '../src/main/voice/audio';
import { VoiceService } from '../src/main/voice/service';
import { VoicePlayer } from '../src/renderer/voice/player';
import { encodeVoiceWav } from '../src/shared/voice-wav';
import { fixture } from './companion-fixture';

const mixed = '<voice lang="zh">今天练习 **</voice><voice lang="ja">先生</voice><voice lang="zh">**，意思是老师。</voice>';
const folders: string[] = [];
afterEach(async () => { vi.unstubAllGlobals(); vi.restoreAllMocks(); await Promise.all(folders.splice(0).map(folder => fs.rm(folder, { recursive: true, force: true }))); });
describe('模型输出的语言元数据', () => {
  it('任意网络分片只提交闭合标签，相邻同语言无标点句保持稳定前缀', () => {
    const first = '<voice lang="zh" emotion="happy">准备好啦</voice>';
    const second = '<voice lang="zh" emotion="happy">我们开始</voice>';
    for (let i = 0; i < first.length; i++) expect(completedSpeechSegments(first.slice(0, i))).toEqual([]);
    const prefix = [{ language: 'zh', emotion: 'happy', text: '准备好啦' }];
    for (let i = 0; i < second.length; i++) expect(completedSpeechSegments(first + second.slice(0, i))).toEqual(prefix);
    const all = [...prefix, { language: 'zh', emotion: 'happy', text: '我们开始' }];
    expect(completedSpeechSegments(first + second)).toEqual(all);
    expect(parseSpeechLanguages(first + second).segments).toEqual(all);
    expect(completedSpeechSegments('漏标' + first)).toEqual([]);
  });
  it('情绪与语言在同次输出中解析；未知情绪温和回退，不合并不同情绪', () => {
    const source = '<voice emotion="happy" lang="zh">答对啦！</voice><voice lang="zh" emotion="sad">再试试。</voice><voice lang="ja" emotion="unknown">先生</voice>';
    expect(hasSpeechLanguages(source)).toBe(true);
    expect(parseSpeechLanguages(source).segments).toEqual([{ language: 'zh', emotion: 'happy', text: '答对啦！' }, { language: 'zh', emotion: 'sad', text: '再试试。' }, { language: 'ja', emotion: 'neutral', text: '先生' }]);
    for (let i = 0; i < source.length; i++) expect(parseSpeechLanguages(source.slice(0, i), true).text).not.toContain('<');
  });
  it('同一个汉字串根据模型标注使用不同语言，显示正文仍保留 Markdown', () => {
    expect(parseSpeechLanguages('<voice lang="zh">先生</voice><voice lang="ja">先生</voice>')).toEqual({ text: '先生先生', segments: [{ language: 'zh', text: '先生' }, { language: 'ja', text: '先生' }] });
    expect(parseSpeechLanguages(mixed).text).toBe('今天练习 **先生**，意思是老师。');
    expect(parseSpeechLanguages('未标注的旧回复').segments).toEqual([{ language: 'zh', text: '未标注的旧回复' }]);
  });
  it('每个字符都可能是网络分片边界，不闪现半个标签', () => {
    const full = parseSpeechLanguages(mixed).text;
    for (let i = 0; i <= mixed.length; i++) { const current = parseSpeechLanguages(mixed.slice(0, i), true).text; expect(current).not.toContain('<'); expect(full.startsWith(current)).toBe(true); }
    expect(parseSpeechLanguages('<voice lang="ja">こんにちは</voice').text).toBe('こんにちは');
    expect(parseSpeechLanguages('普通 <b>HTML</b>').text).toBe('普通 <b>HTML</b>');
  });
  it('聊天同一次请求要求语言标注，历史和气泡保存净正文与独立分段', async () => {
    const f = fixture(); f.host.speechLanguages = () => true; f.data.config.mood.enabled = false; f.data.config.memory.automatic = false;
    f.model.complete.mockImplementationOnce(async (messages, _config, _signal, _tools, onText) => {
      expect(messages[0].content).toContain(speechLanguagePrompt); for (const char of mixed) onText?.(char); return { text: mixed, calls: [] };
    });
    expect(await f.coordinator.chat('教我先生这个词')).toBe('今天练习 **先生**，意思是老师。');
    expect(f.model.complete).toHaveBeenCalledTimes(1);
    expect(f.data.events.at(-1)).toMatchObject({ text: '今天练习 **先生**，意思是老师。', speechSegments: parseSpeechLanguages(mixed).segments });
    const values = vi.mocked(f.host.present).mock.calls.map(([value]) => value);
    expect(values.every(value => !value?.text.includes('<voice'))).toBe(true);
    expect(values.find(value => value?.phase === 'complete')?.speechSegments?.[1]).toEqual({ language: 'ja', text: '先生' });
  });
  it('工具中间轮不朗读，最终回复才使用新的语言分段', async () => {
    const f = fixture(); f.host.speechLanguages = () => true; f.data.config.mood.enabled = false; f.data.config.memory.automatic = false;
    f.data.config.mcp.enabled = true; f.data.config.mcp.allowedTools = ['study'];
    f.tools.list.mockResolvedValue([{ name: 'study', description: '学习', inputSchema: {} }]);
    f.model.complete.mockResolvedValueOnce({ text: '<voice lang="zh">我查一下。</voice>', calls: [{ id: '1', type: 'function', function: { name: 'study', arguments: '{}' } }] }).mockResolvedValueOnce({ text: mixed, calls: [] });
    await f.coordinator.chat('查一下');
    const completed = vi.mocked(f.host.present).mock.calls.filter(([value]) => value?.phase === 'complete');
    expect(completed).toHaveLength(1); expect(completed[0][0]?.text).not.toContain('我查一下');
  });
  it('校验覆盖率，漏标、嵌套和截断不能作为可朗读元数据', () => {
    expect(hasSpeechLanguages(mixed)).toBe(true);
    for (const text of ['こんにちは', '<voice lang="ja">先生', '<voice lang="zh">你好</voice>先生', '<voice lang="zh"><voice lang="ja">先生</voice></voice>']) expect(hasSpeechLanguages(text)).toBe(false);
  });
  it('模型漏标时只补一次标注，不调用工具，补完后正常分声', async () => {
    const f = fixture(); f.host.speechLanguages = () => true; f.data.config.mood.enabled = false; f.data.config.memory.automatic = false;
    f.model.complete.mockResolvedValueOnce({ text: '练习：先生', calls: [] }).mockResolvedValueOnce({ text: '<voice lang="zh">练习：</voice><voice lang="ja">先生</voice>', calls: [] });
    await f.coordinator.chat('练习日语'); expect(f.model.complete).toHaveBeenCalledTimes(2); expect(f.model.complete.mock.calls[1][3]).toBeUndefined();
    expect(f.data.events.at(-1)?.speechSegments?.map(segment => segment.language)).toEqual(['zh', 'ja']);
  });
  it('补标注仍失败或擅自改正文时保留原文并静音，不用中文误读日语', async () => {
    const f = fixture(); f.host.speechLanguages = () => true; f.data.config.mood.enabled = false; f.data.config.memory.automatic = false;
    f.model.complete.mockResolvedValueOnce({ text: '先生', calls: [] }).mockResolvedValueOnce({ text: '<voice lang="ja">生徒</voice>', calls: [] });
    expect(await f.coordinator.chat('练习日语')).toBe('先生'); expect(f.data.events.at(-1)?.speechSegments).toEqual([]); expect(f.coordinator.notice).toContain('跳过朗读');
  });
});

describe('中日声音路由与 VOICEVOX 协议', () => {
  it('旧配置加载保留来源与音量，新增字段使用兼容默认值', () => {
    const config = JSON.parse(JSON.stringify(voiceDefaults)); delete config.tts.mode; delete config.tts.voicevox; config.tts.volume = 0.35;
    expect(voiceConfigSchema.parse(config).tts).toMatchObject({ mode: 'single', voicevox: { autoStart: false }, volume: 0.35 });
  });
  it('拒绝远程 VOICEVOX 和带路径的引擎地址', () => {
    for (const url of ['http://example.com', 'http://127.0.0.1:50021/synthesis', 'http://127.0.0.1:50021?key=x']) {
      const config = structuredClone(voiceDefaults); config.tts.voicevox.url = url; expect(() => validateVoiceConfig(config)).toThrow();
    }
  });
  const wav = () => encodeVoiceWav(new Float32Array(1600));
  const fetcher = () => vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json([{ name: '別の人', styles: [{ name: 'ノーマル', id: 10 }] }, { name: '雨晴はう', styles: [{ name: 'ノーマル', id: 42, type: 'talk' }] }])).mockResolvedValueOnce(Response.json({ accent_phrases: [], speedScale: 1, pitchScale: 0, volumeScale: 1 })).mockResolvedValueOnce(new Response(wav()));
  it('从实际角色列表选雨晴はう，先生成参数再合成 WAV，语速生效且不发送其他 TTS 密钥', async () => {
    const request = fetcher(); const config = structuredClone(voiceDefaults.tts); config.rate = 1.2;
    expect((await new VoiceAudio(request).speakJapanese(config, '先生', new AbortController().signal)).byteLength).toBeGreaterThan(44);
    const urls = request.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.map(url => url.pathname)).toEqual(['/speakers', '/audio_query', '/synthesis']); expect(urls[1].searchParams.get('text')).toBe('先生'); expect(urls[2].searchParams.get('speaker')).toBe('42');
    expect(JSON.parse(request.mock.calls[2][1]?.body as string)).toMatchObject({ speedScale: 1.2, volumeScale: 1, outputStereo: false });
    expect(request.mock.calls.every(([, options]) => options?.redirect === 'error' && !JSON.stringify(options?.headers ?? {}).includes('Authorization'))).toBe(true);
  });
  it('没有目标角色或音频异常时明确失败，不用别的角色代替', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ name: 'ずんだもん', styles: [{ name: 'ノーマル', id: 3 }] }]));
    await expect(new VoiceAudio(request).speakJapanese(voiceDefaults.tts, 'こんにちは', new AbortController().signal)).rejects.toThrow('雨晴はう'); expect(request).toHaveBeenCalledTimes(1);
  });
  it('兼容 0.26 的 streaming_talk 风格，跳过同名歌唱模型', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ name: '雨晴はう', styles: [{ name: 'ノーマル', id: 3010, type: 'frame_decode' }, { name: 'ノーマル', id: 10, type: 'streaming_talk' }] }]));
    expect(await new VoiceAudio(request).voicevoxSpeaker(voiceDefaults.tts.voicevox.url, new AbortController().signal)).toBe(10);
  });
  it('服务按模型语言选择微软系统声音或 VOICEVOX，保持原云端设置但不会调用', async () => {
    const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'pet-language-')); folders.push(folder);
    const request = fetcher(); const engine = { ensure: vi.fn(async () => {}), close: vi.fn(async () => {}) };
    const service = new VoiceService(path.join(folder, 'voice.json'), { emit: () => {}, seal: async v => v, unseal: async v => v }, new VoiceAudio(request), engine);
    await service.start({ enabled: false, voice: '', rate: 1, volume: 0.8 });
    const config = structuredClone(voiceDefaults); config.tts.mode = 'language'; config.tts.source = 'cloud'; config.tts.enabled = true;
    expect((await service.request({ type: 'configure', config, secrets: {} }, 1, 'panel')).ok).toBe(true);
    expect((await service.request({ type: 'speak', text: '先生', language: 'zh' }, 3, 'pet')).system).toBeDefined(); expect(request).not.toHaveBeenCalled();
    expect((await service.request({ type: 'speak', text: '先生', language: 'ja' }, 3, 'pet')).audio).toBeInstanceOf(ArrayBuffer); expect(engine.ensure).toHaveBeenCalledTimes(1);
    expect((await service.request({ type: 'voicevox-check' }, 3, 'pet')).ok).toBe(false); await service.close();
  });
});

describe('混合语音播放生命周期', () => {
  it('首次启动等待微软声音列表就绪后再读，不能把暂时为空当成未安装', async () => {
    const events = new EventTarget(); let ready = false; const speak = vi.fn((utterance: { onend: () => void }) => utterance.onend());
    const add = vi.fn(events.addEventListener.bind(events));
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    vi.stubGlobal('window', { pet: { voice: vi.fn(async () => ({ ok: true, system: { ...voiceDefaults.tts, mode: 'language' } })) }, speechSynthesis: { cancel: vi.fn(), getVoices: () => ready ? [{ localService: true, name: 'Microsoft Huihui', voiceURI: 'huihui', lang: 'zh-CN' }] : [], addEventListener: add, removeEventListener: events.removeEventListener.bind(events), speak } });
    const player = new VoicePlayer(); const pending = player.speak('你好');
    await vi.waitFor(() => expect(add).toHaveBeenCalled()); expect(speak).not.toHaveBeenCalled();
    ready = true; events.dispatchEvent(new Event('voiceschanged')); await pending; expect(speak).toHaveBeenCalledTimes(1);
  });
  it('等待微软声音列表时也能停止，列表迟到后不复活朗读', async () => {
    const events = new EventTarget(); const speak = vi.fn(); const add = vi.fn(events.addEventListener.bind(events));
    vi.stubGlobal('window', { pet: { voice: vi.fn(async () => ({ ok: true, system: voiceDefaults.tts })) }, speechSynthesis: { cancel: vi.fn(), getVoices: () => [], addEventListener: add, removeEventListener: events.removeEventListener.bind(events), speak } });
    const player = new VoicePlayer(); const pending = player.speak('你好'); await vi.waitFor(() => expect(add).toHaveBeenCalled()); player.stop(); await pending;
    events.dispatchEvent(new Event('voiceschanged')); expect(speak).not.toHaveBeenCalled();
  });
  it('按标注顺序播放，停止后丢弃已预合成的后续段落', async () => {
    let finish!: () => void; const spoken: string[] = [];
    const voice = vi.fn(async (request: { type: string; language?: string }) => request.type === 'speak' ? { ok: true, system: { ...voiceDefaults.tts, mode: 'language' } } : { ok: true });
    vi.stubGlobal('SpeechSynthesisUtterance', class { constructor(public text: string) {} });
    vi.stubGlobal('window', { pet: { voice }, speechSynthesis: { cancel: vi.fn(), getVoices: () => [{ localService: true, name: 'Microsoft Huihui', voiceURI: 'huihui', lang: 'zh-CN' }], speak: (utterance: { text: string; onend: () => void }) => { spoken.push(utterance.text); finish = utterance.onend; } } });
    const player = new VoicePlayer(); const segments = parseSpeechLanguages(mixed).segments;
    const pending = player.speak('unused', false, segments);
    await vi.waitFor(() => expect(spoken).toHaveLength(1)); finish();
    await vi.waitFor(() => expect(spoken).toHaveLength(2)); player.stop(); finish(); await pending;
    expect(voice.mock.calls.filter(([r]) => r.type === 'speak').map(([r]) => r.language)).toEqual(['zh', 'ja', 'zh']);
    expect(spoken).toEqual(['今天练习', '先生']);
  });
});
