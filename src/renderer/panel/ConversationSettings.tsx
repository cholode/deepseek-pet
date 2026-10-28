import { useEffect, useRef, useState } from 'react';
import { voiceDefaults, type VoiceConfig, type VoiceSecrets, type VoiceSecretName, type VoiceState } from '../../shared/voice';
import { VoiceInput } from '../voice/VoiceInput';
import { VoicePlayer } from '../voice/player';
import type { SpeechLanguage } from '../../shared/speech-language';

export function ConversationSettings() {
  const [state, setState] = useState<VoiceState>(); const [config, setConfig] = useState<VoiceConfig>(structuredClone(voiceDefaults));
  const [secrets, setSecrets] = useState<VoiceSecrets>({}); const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [note, setNote] = useState(''); const [saving, setSaving] = useState(false); const [playing, setPlaying] = useState(false); const [recording, setRecording] = useState(false);
  const [testText, setTestText] = useState('这是我的声音'); const [transcript, setTranscript] = useState('');
  const [testLanguage, setTestLanguage] = useState<SpeechLanguage>('zh'); const [checking, setChecking] = useState(false);
  const player = useRef(new VoicePlayer()); const mounted = useRef(true);
  const playback = useRef(0);
  useEffect(() => {
    mounted.current = true;
    void window.pet.voice({ type: 'state' }).then(r => { if (mounted.current && r.state) { setState(r.state); setConfig(r.state.config); } }).catch(() => setNote('无法读取对话设置'));
    const off = window.pet.onVoice(event => { if (event.type === 'state') setState(event.state); else { playback.current++; player.current.stop(); setPlaying(false); } });
    const refresh = () => setVoices(window.speechSynthesis?.getVoices().filter(v => v.localService) ?? []); refresh(); window.speechSynthesis?.addEventListener('voiceschanged', refresh);
    const current = player.current; return () => { mounted.current = false; off(); current.stop(); window.speechSynthesis?.removeEventListener('voiceschanged', refresh); };
  }, []);
  const dirty = !state || JSON.stringify(state.config) !== JSON.stringify(config) || Object.keys(secrets).length > 0;
  const changeTts = (patch: Partial<VoiceConfig['tts']>) => setConfig({ ...config, tts: { ...config.tts, ...patch } });
  const changeAsr = (patch: Partial<VoiceConfig['asr']>) => setConfig({ ...config, asr: { ...config.asr, ...patch } });
  async function save() {
    setSaving(true); setNote('');
    try { const result = await window.pet.voice({ type: 'configure', config, secrets }); if (!mounted.current) return; if (!result.ok || !result.state) throw new Error(result.message); setState(result.state); setConfig(result.state.config); setSecrets({}); setNote('对话设置已保存'); }
    catch (error) { if (mounted.current) setNote(error instanceof Error ? error.message : '保存失败'); } finally { if (mounted.current) setSaving(false); }
  }
  async function preview(mixed = false) {
    const current = ++playback.current; player.current.stop(); setPlaying(true); setNote('正在合成并播放试听…');
    const segments = mixed ? [{ language: 'zh' as const, text: '今天一起练习日语吧。' }, { language: 'ja' as const, text: 'こんにちは。雨晴はうです。一緒に日本語を勉強しましょう。' }, { language: 'zh' as const, text: '轮到你啦。' }] : undefined;
    try { await player.current.speak(testText, true, segments, testLanguage); if (mounted.current && playback.current === current) setNote('试听结束'); } catch (error) { if (mounted.current && playback.current === current) setNote(error instanceof Error ? error.message : '试听失败'); }
    finally { if (mounted.current && playback.current === current) setPlaying(false); }
  }
  async function chooseVoicevox() {
    try { const result = await window.pet.voice({ type: 'voicevox-directory' }); if (!result.ok) throw new Error(result.message); if (result.directory) changeTts({ voicevox: { ...config.tts.voicevox, directory: result.directory, autoStart: true } }); }
    catch (error) { setNote(error instanceof Error ? error.message : '选择目录失败'); }
  }
  async function checkVoicevox() {
    setChecking(true); setNote('正在连接 VOICEVOX…');
    try { const result = await window.pet.voice({ type: 'voicevox-check' }); if (mounted.current) setNote(result.message ?? (result.ok ? '已连接' : '连接失败')); }
    catch { if (mounted.current) setNote('无法连接 VOICEVOX'); } finally { if (mounted.current) setChecking(false); }
  }
  async function chooseWhisper(type: 'whisper-directory' | 'whisper-model') {
    try { const result = await window.pet.voice({ type }); if (!result.ok) throw new Error(result.message); const patch = result.directory ? { directory: result.directory } : result.modelPath ? { modelPath: result.modelPath } : undefined; if (patch) changeAsr({ whisper: { ...config.asr.whisper, ...patch } }); }
    catch (error) { setNote(error instanceof Error ? error.message : '选择失败'); }
  }
  async function checkAsr() {
    setChecking(true); setNote('正在连接识别服务，首次启动需加载模型…');
    try { const result = await window.pet.voice({ type: 'asr-check' }); if (mounted.current) setNote(result.message ?? (result.ok ? '识别服务已连接' : '连接失败')); }
    catch { if (mounted.current) setNote('无法连接识别服务'); } finally { if (mounted.current) setChecking(false); }
  }
  function systemVoiceFields() {
    const candidates = config.tts.mode === 'language' ? voices.filter(v => /^zh(?:-|_)/i.test(v.lang) && /Microsoft/i.test(v.name)) : voices;
    return <><label>{config.tts.mode === 'language' ? '中文 · 微软本地声音' : '系统声音'}<select aria-label="系统声音" value={config.tts.systemVoice} onChange={e => changeTts({ systemVoice: e.target.value })}><option value="">自动选择{config.tts.mode === 'language' ? '微软中文' : '本地'}声音</option>{candidates.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></label><small>无需 API Key，使用 Windows 已安装的本地声音。</small></>;
  }
  function serviceFields(kind: 'tts' | 'asr') {
    const source = config[kind].source; const value = config[kind][source]; const title = kind === 'tts' ? '朗读' : '识别';
    const secret: VoiceSecretName = `${kind}${source === 'local' ? 'Local' : 'Cloud'}`;
    const update = (patch: Partial<typeof value>) => kind === 'tts' ? changeTts({ [source]: { ...config.tts[source], ...patch } }) : changeAsr({ [source]: { ...config.asr[source], ...patch } });
    return <>
      <label>{title}接口地址<input aria-label={`${title}接口地址`} value={value.url} onChange={e => update({ url: e.target.value })}/><small>填写完整接口地址（包含路径）。{source === 'local' ? '仅访问本机，需先启动并加载本地语音模型。' : '使用 HTTPS；请确认服务支持兼容音频接口。'}</small></label>
      {!(kind === 'asr' && source === 'local' && config.asr.localProtocol === 'whisper-cpp') && <label>{title}模型<input aria-label={`${title}模型`} value={value.model} placeholder="填写语音服务中实际可用的模型 ID" onChange={e => update({ model: e.target.value })}/></label>}
      {kind === 'tts' && <label>声音 ID<input aria-label="声音 ID" value={config.tts[source].voice} placeholder="填写语音服务支持的声音 ID" onChange={e => changeTts({ [source]: { ...config.tts[source], voice: e.target.value } })}/></label>}
      <label>{title} API Key<div className="companion-inline"><input aria-label={`${title} API Key`} type="password" autoComplete="off" value={secrets[secret] ?? ''} placeholder={state?.hasSecrets[secret] ? '已加密保存，留空不修改' : '无鉴权的本地服务可留空'} onChange={e => setSecrets({ ...secrets, [secret]: e.target.value })}/><button type="button" onClick={() => setSecrets({ ...secrets, [secret]: '' })}>清除{title}密钥</button></div>{secrets[secret] === '' && <small>保存后清除当前来源的已存密钥</small>}</label>
    </>;
  }
  return <div className="companion-settings conversation-settings">
    <p className="companion-help">设置对话间隔、大肥鱼的声音与语音输入。录音只在你点击后开始，聊天中的语音识别成功后自动发送；这里的识别测试只显示文字。语音由 AI 合成。</p>
    {(note || state?.error) && <div className="notice" role="status">{note || state?.error}</div>}
    <section className="settings-card" aria-label="TTS 试听"><h3>TTS 试听</h3>
      <label>试听句子<textarea className="voice-test-text" aria-label="试听文字" value={testText} maxLength={1000} placeholder="输入想试听的句子" onChange={e => setTestText(e.target.value)}/></label>
      {config.tts.mode === 'language' && <label>试听语言<select aria-label="试听语言" value={testLanguage} onChange={e => { const language = e.target.value as SpeechLanguage; setTestLanguage(language); if (['这是我的声音', 'これが私の声です。'].includes(testText)) setTestText(language === 'ja' ? 'これが私の声です。' : '这是我的声音'); }}><option value="zh">中文 · 微软声音</option><option value="ja">日文 · 雨晴はう</option></select></label>}
      <small>{dirty ? '声音设置有修改，请先保存对话设置后再试听。' : '使用已保存的朗读来源、声音、语速和音量播放，无需开启自动朗读。'}</small>
      <div className="companion-inline"><button disabled={dirty || saving || checking || playing || recording || !testText.trim()} onClick={() => void preview()}>试听声音</button>{config.tts.mode === 'language' && <button disabled={dirty || saving || checking || playing || recording} onClick={() => void preview(true)}>试听中日切换</button>}<button disabled={!playing} onClick={() => { playback.current++; player.current.stop(); setPlaying(false); setNote('已停止试听'); }}>停止试听</button></div>
    </section>
    <fieldset disabled={saving || checking || playing || recording}>
      <section className="settings-card"><h3>对话分段</h3>
        <label>多久没有新消息后结束对话（分钟）<input aria-label="对话空闲结束时间" type="number" min="5" max="1440" step="5" value={config.session.idleMinutes} onChange={e => setConfig({ ...config, session: { idleMinutes: Number(e.target.value) } })}/></label>
        <small>默认 30 分钟。跨过本地日期也会结束上一段对话。只计算你发来的聊天消息，摸头、提醒和大肥鱼自己的回复不会延长。旧聊天仍可查看，共同记忆和学习计划继续保留；新对话不会自动接着上次的问题或操作。</small>
      </section>
      <section className="settings-card"><h3>语音朗读 · TTS</h3>
        <label className="companion-check"><input aria-label="自动朗读回复" type="checkbox" checked={config.tts.enabled} onChange={e => changeTts({ enabled: e.target.checked })}/>自动朗读大肥鱼的回复</label>
        <label>声音分配<select aria-label="声音分配" value={config.tts.mode} onChange={e => changeTts({ mode: e.target.value as 'single' | 'language', systemVoice: '' })}><option value="single">所有内容使用同一个声音</option><option value="language">中日分声：微软中文 + 雨晴はう</option></select></label>
        {config.tts.mode === 'language' ? <>
          <p className="companion-help">聊天模型在生成回复时标注中文和日文，混合句子也按顺序切换。聊天里不显示标注；纯汉字的日语词也由模型判断。漏标时自动补齐，仍失败则保留文字并跳过朗读。</p>
          {systemVoiceFields()}
          <h4>日文 · VOICEVOX:雨晴はう（ノーマル）</h4>
          <label>VOICEVOX 地址<input aria-label="VOICEVOX 地址" value={config.tts.voicevox.url} onChange={e => changeTts({ voicevox: { ...config.tts.voicevox, url: e.target.value } })}/><small>本机地址，通常为 http://127.0.0.1:50021。</small></label>
          <label>VOICEVOX 软件目录<input aria-label="VOICEVOX 软件目录" readOnly value={config.tts.voicevox.directory} placeholder="选择已解压的 VOICEVOX 文件夹"/></label>
          <div className="companion-inline"><button onClick={() => void chooseVoicevox()}>选择 VOICEVOX 目录</button><button disabled={dirty} onClick={() => void checkVoicevox()}>检查日语声音</button></div>
          <label className="companion-check"><input aria-label="按需启动 VOICEVOX" type="checkbox" checked={config.tts.voicevox.autoStart} onChange={e => changeTts({ voicevox: { ...config.tts.voicevox, autoStart: e.target.checked } })}/>朗读日文时自动启动本机 VOICEVOX 引擎</label>
          <label>日语合成设备<select aria-label="日语合成设备" value={config.tts.voicevox.device} onChange={e => changeTts({ voicevox: { ...config.tts.voicevox, device: e.target.value as 'cpu' | 'gpu' } })}><option value="cpu">CPU</option><option value="gpu">GPU / 核显（需要对应引擎）</option></select></label>
          <label>CPU 合成线程数<input aria-label="CPU 合成线程数" type="number" min="0" max="64" step="1" value={config.tts.voicevox.cpuThreads} onChange={e => changeTts({ voicevox: { ...config.tts.voicevox, cpuThreads: Number(e.target.value) } })}/><small>0 为自动，使用逻辑处理器数量的一半，最多 16 线程。线程更多不一定更快。</small></label>
          <small>设备和线程数在保存后、下次自动启动引擎时生效。AMD / Intel 核显使用 DirectML 版 VOICEVOX；手动启动的引擎需在该软件中调整。</small>
          <small>首次日语朗读可能稍等片刻。只启动所选目录内的语音引擎；退出大肥鱼时关闭由它启动的引擎。已手动打开的 VOICEVOX 会继续运行。</small>
        </> : <>
        <label>朗读来源<select aria-label="朗读来源" value={config.tts.source} onChange={e => changeTts({ source: e.target.value as 'local' | 'cloud' })}><option value="local">本地</option><option value="cloud">云端</option></select></label>
        {config.tts.source === 'local' && <label>本地朗读方式<select aria-label="本地朗读方式" value={config.tts.localEngine} onChange={e => changeTts({ localEngine: e.target.value as 'system' | 'http' })}><option value="system">Windows 系统声音</option><option value="http">本机 TTS 服务（兼容音频接口）</option></select></label>}
        {config.tts.source === 'local' && config.tts.localEngine === 'system' ? systemVoiceFields() : serviceFields('tts')}
        </>}
        <div className="companion-columns"><label>语速：{config.tts.rate.toFixed(1)}×<input aria-label="朗读语速" type="range" min="0.5" max="2" step="0.1" value={config.tts.rate} onChange={e => changeTts({ rate: Number(e.target.value) })}/></label><label>音量：{Math.round(config.tts.volume * 100)}%<input aria-label="朗读音量" type="range" min="0" max="1" step="0.05" value={config.tts.volume} onChange={e => changeTts({ volume: Number(e.target.value) })}/></label></div>
        <small>回复按句播放，播放前句时提前合成下一句；保持中日切换顺序，停止时一起取消。</small>
        {config.tts.mode === 'single' && config.tts.source === 'cloud' && <p className="companion-help">朗读时会将回复文本发送到此云端语音服务，可能产生用量费用。聊天模型和语音模型独立配置。</p>}
      </section>
      <section className="settings-card"><h3>语音识别 · ASR</h3>
        <label className="companion-check"><input aria-label="启用语音输入" type="checkbox" checked={config.asr.enabled} onChange={e => changeAsr({ enabled: e.target.checked })}/>启用聊天中的麦克风按钮</label>
        <label>识别来源<select aria-label="识别来源" value={config.asr.source} onChange={e => changeAsr({ source: e.target.value as 'local' | 'cloud' })}><option value="local">本地</option><option value="cloud">云端</option></select></label>
        {config.asr.source === 'local' && <label>本地识别协议<select aria-label="本地识别协议" value={config.asr.localProtocol} onChange={e => { const localProtocol = e.target.value as 'compatible' | 'whisper-cpp'; const url = config.asr.local.url.replace(/\/(?:v1\/audio\/transcriptions|inference)$/, localProtocol === 'whisper-cpp' ? '/inference' : '/v1/audio/transcriptions'); changeAsr({ localProtocol, local: { ...config.asr.local, url } }); }}><option value="compatible">兼容 /audio/transcriptions</option><option value="whisper-cpp">whisper.cpp /inference</option></select></label>}
        {serviceFields('asr')}
        {config.asr.source === 'local' && config.asr.localProtocol === 'whisper-cpp' && <>
          <label>Whisper 引擎目录<input aria-label="Whisper 引擎目录" readOnly value={config.asr.whisper.directory}/></label>
          <button onClick={() => void chooseWhisper('whisper-directory')}>选择识别引擎目录</button>
          <label>Whisper 模型文件<input aria-label="Whisper 模型文件" readOnly value={config.asr.whisper.modelPath}/></label>
          <button onClick={() => void chooseWhisper('whisper-model')}>选择识别模型</button>
          <label className="companion-check"><input aria-label="按需启动 Whisper" type="checkbox" checked={config.asr.whisper.autoStart} onChange={e => changeAsr({ whisper: { ...config.asr.whisper, autoStart: e.target.checked } })}/>录音前自动启动本机 Whisper 识别服务</label>
          <label>识别 CPU 线程数<input aria-label="识别 CPU 线程数" type="number" min="1" max="64" value={config.asr.whisper.cpuThreads} onChange={e => changeAsr({ whisper: { ...config.asr.whisper, cpuThreads: Number(e.target.value) } })}/></label>
          <small>选择含 whisper-server.exe 的目录和 GGML .bin 模型。首次录音先加载模型；退出时只关闭大肥鱼启动的引擎。当前按需启动使用 CPU。</small>
        </>}
        <button disabled={dirty} onClick={() => void checkAsr()}>检查识别服务</button>
        <label>识别语言<select aria-label="识别语言" value={config.asr.language} onChange={e => changeAsr({ language: e.target.value })}><option value="">自动判断</option><option value="zh">中文</option><option value="ja">日语</option><option value="en">英语</option><option value="ko">韩语</option></select></label>
        <p className="companion-help">{config.asr.source === 'local' ? '本地识别需要你安装并运行识别引擎；程序不附带大型语音模型。音频只发到配置的本机地址。' : '结束录音后，音频将上传到你配置的云端服务，可能产生用量费用。'} 每次最长 60 秒，不持续监听，不保存录音文件。</p>
      </section>
      <button className="primary companion-save" disabled={!state} onClick={() => void save()}>保存对话设置</button>
    </fieldset>
    <section className="settings-card"><h3>语音识别测试</h3><small>{dirty ? '设置尚未保存，请先保存后测试。' : '使用已保存的设置测试，不发送聊天，也不调用软件工具。'}</small>
      <VoiceInput disabled={dirty || saving || playing} onBusy={setRecording} onText={setTranscript}/>
      {transcript && <div className="voice-result" aria-label="识别测试结果">{transcript}</div>}
    </section>
  </div>;
}
