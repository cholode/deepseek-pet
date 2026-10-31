import { useEffect, useRef, useState } from 'react';
import { usesVoicevox, voiceDefaults, type VoiceConfig, type VoiceSecrets, type VoiceSecretName, type VoiceState } from '../../shared/voice';
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
    const segments = mixed ? [{ language: 'zh' as const, text: '今天一起练习日语吧。' }, { language: 'ja' as const, text: 'こんにちは。一緒に日本語を勉強しましょう。' }, { language: 'zh' as const, text: '轮到你啦。' }] : undefined;
    try { await player.current.speak(testText, true, segments, testLanguage); if (mounted.current && playback.current === current) setNote('试听结束'); } catch (error) { if (mounted.current && playback.current === current) setNote(error instanceof Error ? error.message : '试听失败'); }
    finally { if (mounted.current && playback.current === current) setPlaying(false); }
  }
  async function chooseVoicevox() {
    try { const result = await window.pet.voice({ type: 'voicevox-directory' }); if (!result.ok) throw new Error(result.message); if (result.directory) changeTts({ voicevox: { ...config.tts.voicevox, directory: result.directory, autoStart: true } }); }
    catch (error) { setNote(error instanceof Error ? error.message : '选择目录失败'); }
  }
  async function gptAction(type: 'gpt-sovits-directory' | 'gpt-sovits-check') {
    setChecking(true); setNote(type === 'gpt-sovits-check' ? '正在加载本地 GPT-SoVITS 模型…' : '');
    try {
      const result = await window.pet.voice({ type }); if (!result.ok) throw new Error(result.message);
      if (!mounted.current) return;
      if (result.directory) changeTts({ gptSovits: { ...config.tts.gptSovits, directory: result.directory, autoStart: true } });
      if (result.message) setNote(result.message);
    } catch (error) { if (mounted.current) setNote(error instanceof Error ? error.message : 'GPT-SoVITS 连接失败'); }
    finally { if (mounted.current) setChecking(false); }
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
  function gptSovitsFields() {
    const value = config.tts.gptSovits;
    const update = (patch: Partial<typeof value>) => changeTts({ gptSovits: { ...value, ...patch } });
    return <>
      <label>GPT-SoVITS 服务目录<input aria-label="GPT-SoVITS 服务目录" readOnly value={value.directory} placeholder="选择已安装的本地语音服务文件夹"/></label>
      <div className="companion-inline"><button onClick={() => void gptAction('gpt-sovits-directory')}>选择 GPT-SoVITS 目录</button><button disabled={dirty} onClick={() => void gptAction('gpt-sovits-check')}>检查本地声音</button></div>
      <label>GPT-SoVITS 地址<input aria-label="GPT-SoVITS 地址" value={value.url} onChange={e => update({ url: e.target.value })}/></label>
      <label>参考音色情绪<select aria-label="参考音色情绪" value={value.voice} onChange={e => update({ voice: e.target.value })}>{[['neutral', '中立'], ['happy', '开心'], ['sad', '难过'], ['angry', '生气'], ['surprised', '吃惊'], ['afraid', '恐惧'], ['disgusted', '厌恶']].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select><small>使用音色包中的对应参考音频，实际表现以试听为准。</small></label>
      <label className="companion-check"><input aria-label="按需启动 GPT-SoVITS" type="checkbox" checked={value.autoStart} onChange={e => update({ autoStart: e.target.checked })}/>自动启动并提前准备本地 GPT-SoVITS</label>
      {config.tts.mode === 'language' && <label className="companion-check"><input aria-label="日文使用同一音色" type="checkbox" checked={value.japanese} onChange={e => update({ japanese: e.target.checked })}/>日文也使用这个 GPT-SoVITS 音色</label>}
      <label className="companion-check"><input aria-label="自动选择语音情绪" type="checkbox" checked={value.autoEmotion} onChange={e => update({ autoEmotion: e.target.checked })}/>根据每句话自动选择情绪</label>
      <small>普通续句沿用前一句的声音，明确出现新情绪才切换参考音频，避免一句话里频繁换声；试听使用上面选定的情绪。中文训练的音色可以跨语言合成，日语发音请以试听为准。</small>
      <label>语音合成 CPU 线程数<input aria-label="中文合成 CPU 线程数" type="number" min="1" max="64" value={value.cpuThreads} onChange={e => update({ cpuThreads: Number(e.target.value) })}/></label>
      <label>同时合成句数<input aria-label="同时合成句数" type="number" min="1" max="4" value={value.workers} onChange={e => update({ workers: Number(e.target.value) })}/><small>独立进程并发计算，按原句序播放；CPU 线程总数在进程间分配。并发数越大，内存占用越高。</small></label>
      <label>合成设备<select aria-label="GPT-SoVITS 合成设备" value={value.device} onChange={e => update({ device: e.target.value as typeof value.device })}><option value="auto">自动（优先采用本机实测推荐）</option><option value="cpu">CPU</option><option value="cuda">GPU（CUDA / ROCm）</option></select><small>GPU 需要匹配的运行环境；核显不一定更快。自动模式采用本机实测推荐；没有推荐时优先可用 GPU，否则使用 CPU。</small></label>
      <small>开启自动朗读后，打开大肥鱼就提前加载模型和默认参考音，不等第一条回复才启动。模型保留在本机；退出时关闭由它启动的服务。切换音色、修改线程数后请保存再试听。</small>
    </>;
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
    {state?.preparing && <p className="companion-help" role="status">正在提前准备本地声音，完成后可直接朗读…</p>}
    <section className="settings-card" aria-label="TTS 试听"><h3>TTS 试听</h3>
      <label>试听句子<textarea className="voice-test-text" aria-label="试听文字" value={testText} maxLength={1000} placeholder="输入想试听的句子" onChange={e => setTestText(e.target.value)}/></label>
      {config.tts.mode === 'language' && <label>试听语言<select aria-label="试听语言" value={testLanguage} onChange={e => { const language = e.target.value as SpeechLanguage; setTestLanguage(language); if (['这是我的声音', 'これが私の声です。'].includes(testText)) setTestText(language === 'ja' ? 'これが私の声です。' : '这是我的声音'); }}><option value="zh">中文 · {config.tts.languageChinese === 'system' ? '微软声音' : '已选中文声音'}</option><option value="ja">日文 · {usesVoicevox(config.tts) ? '雨晴はう' : '同一 GPT-SoVITS 音色'}</option></select></label>}
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
        <label>声音分配<select aria-label="声音分配" value={config.tts.mode} onChange={e => changeTts({ mode: e.target.value as 'single' | 'language', systemVoice: '' })}><option value="single">所有内容使用同一个声音</option><option value="language">分别指定中文和日文（支持同一音色）</option></select></label>
        {config.tts.mode === 'language' ? <>
          <p className="companion-help">聊天模型在生成回复时标注中文和日文，混合句子也按顺序切换。聊天里不显示标注；纯汉字的日语词也由模型判断。漏标时自动补齐，仍失败则保留文字并跳过朗读。</p>
          <label>中文朗读方式<select aria-label="中文朗读方式" value={config.tts.languageChinese === 'system' ? 'system' : config.tts.source === 'cloud' ? 'cloud' : config.tts.localEngine} onChange={e => {
            const engine = e.target.value;
            if (engine === 'system') changeTts({ languageChinese: 'system' });
            else if (engine === 'cloud') changeTts({ languageChinese: 'configured', source: 'cloud' });
            else changeTts({ languageChinese: 'configured', source: 'local', localEngine: engine as 'http' | 'gpt-sovits' });
          }}><option value="system">Windows 微软中文</option><option value="gpt-sovits">GPT-SoVITS 本地声音</option><option value="http">本机 TTS 兼容服务</option><option value="cloud">云端 TTS 服务</option></select></label>
          {config.tts.languageChinese === 'system' || (config.tts.source === 'local' && config.tts.localEngine === 'system') ? systemVoiceFields() : config.tts.source === 'local' && config.tts.localEngine === 'gpt-sovits' ? gptSovitsFields() : serviceFields('tts')}
          {usesVoicevox(config.tts) && <><h4>日文 · VOICEVOX:雨晴はう（ノーマル）</h4>
          <label>VOICEVOX 地址<input aria-label="VOICEVOX 地址" value={config.tts.voicevox.url} onChange={e => changeTts({ voicevox: { ...config.tts.voicevox, url: e.target.value } })}/><small>本机地址，通常为 http://127.0.0.1:50021。</small></label>
          <label>VOICEVOX 软件目录<input aria-label="VOICEVOX 软件目录" readOnly value={config.tts.voicevox.directory} placeholder="选择已解压的 VOICEVOX 文件夹"/></label>
          <div className="companion-inline"><button onClick={() => void chooseVoicevox()}>选择 VOICEVOX 目录</button><button disabled={dirty} onClick={() => void checkVoicevox()}>检查日语声音</button></div>
          <label className="companion-check"><input aria-label="按需启动 VOICEVOX" type="checkbox" checked={config.tts.voicevox.autoStart} onChange={e => changeTts({ voicevox: { ...config.tts.voicevox, autoStart: e.target.checked } })}/>朗读日文时自动启动本机 VOICEVOX 引擎</label>
          <label>日语合成设备<select aria-label="日语合成设备" value={config.tts.voicevox.device} onChange={e => changeTts({ voicevox: { ...config.tts.voicevox, device: e.target.value as 'cpu' | 'gpu' } })}><option value="cpu">CPU</option><option value="gpu">GPU / 核显（需要对应引擎）</option></select></label>
          <label>CPU 合成线程数<input aria-label="CPU 合成线程数" type="number" min="0" max="64" step="1" value={config.tts.voicevox.cpuThreads} onChange={e => changeTts({ voicevox: { ...config.tts.voicevox, cpuThreads: Number(e.target.value) } })}/><small>0 为自动，使用逻辑处理器数量的一半，最多 16 线程。线程更多不一定更快。</small></label>
          <small>设备和线程数在保存后、下次自动启动引擎时生效。AMD / Intel 核显使用 DirectML 版 VOICEVOX；手动启动的引擎需在该软件中调整。</small>
          <small>首次日语朗读可能稍等片刻。只启动所选目录内的语音引擎；退出大肥鱼时关闭由它启动的引擎。已手动打开的 VOICEVOX 会继续运行。</small></>}
        </> : <>
        <label>朗读来源<select aria-label="朗读来源" value={config.tts.source} onChange={e => changeTts({ source: e.target.value as 'local' | 'cloud' })}><option value="local">本地</option><option value="cloud">云端</option></select></label>
        {config.tts.source === 'local' && <label>本地朗读方式<select aria-label="本地朗读方式" value={config.tts.localEngine} onChange={e => changeTts({ localEngine: e.target.value as VoiceConfig['tts']['localEngine'] })}><option value="system">Windows 系统声音</option><option value="http">本机 TTS 服务（兼容音频接口）</option><option value="gpt-sovits">GPT-SoVITS 本地声音</option></select></label>}
        {config.tts.source === 'local' && config.tts.localEngine === 'system' ? systemVoiceFields() : config.tts.source === 'local' && config.tts.localEngine === 'gpt-sovits' ? gptSovitsFields() : serviceFields('tts')}
        </>}
        <div className="companion-columns"><label>语速：{config.tts.rate.toFixed(1)}×<input aria-label="朗读语速" type="range" min="0.5" max="2" step="0.1" value={config.tts.rate} onChange={e => changeTts({ rate: Number(e.target.value) })}/></label><label>音量：{Math.round(config.tts.volume * 100)}%<input aria-label="朗读音量" type="range" min="0" max="1" step="0.05" value={config.tts.volume} onChange={e => changeTts({ volume: Number(e.target.value) })}/></label></div>
        <small>开启朗读后，第一句语音就绪才显示正文；文字随播放逐句展开，同时准备下一句。停止或失败时显示完整回复。</small>
        {(config.tts.mode === 'single' || config.tts.languageChinese === 'configured') && config.tts.source === 'cloud' && <p className="companion-help">朗读时会将对应文本发送到此云端语音服务，可能产生用量费用。聊天模型和语音模型独立配置。</p>}
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
