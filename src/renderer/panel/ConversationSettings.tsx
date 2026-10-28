import { useEffect, useRef, useState } from 'react';
import { voiceDefaults, type VoiceConfig, type VoiceSecrets, type VoiceSecretName, type VoiceState } from '../../shared/voice';
import { VoiceInput } from '../voice/VoiceInput';
import { VoicePlayer } from '../voice/player';

export function ConversationSettings() {
  const [state, setState] = useState<VoiceState>(); const [config, setConfig] = useState<VoiceConfig>(structuredClone(voiceDefaults));
  const [secrets, setSecrets] = useState<VoiceSecrets>({}); const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [note, setNote] = useState(''); const [saving, setSaving] = useState(false); const [playing, setPlaying] = useState(false); const [recording, setRecording] = useState(false);
  const [testText, setTestText] = useState('你好，我是大肥鱼。今日も一緒に日本語を練習しましょう。'); const [transcript, setTranscript] = useState('');
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
  async function preview() {
    const current = ++playback.current; player.current.stop(); setPlaying(true); setNote('正在合成并播放试听…');
    try { await player.current.speak(testText, true); if (mounted.current && playback.current === current) setNote('试听结束'); } catch (error) { if (mounted.current && playback.current === current) setNote(error instanceof Error ? error.message : '试听失败'); }
    finally { if (mounted.current && playback.current === current) setPlaying(false); }
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
    <p className="companion-help">设置对话间隔、大肥鱼的声音与语音输入。录音只在你点击后开始，识别结果先填入草稿，确认后再发送。语音由 AI 合成。</p>
    {(note || state?.error) && <div className="notice" role="status">{note || state?.error}</div>}
    <fieldset disabled={saving || playing || recording}>
      <section className="settings-card"><h3>对话分段</h3>
        <label>多久没有新消息后结束对话（分钟）<input aria-label="对话空闲结束时间" type="number" min="5" max="1440" step="5" value={config.session.idleMinutes} onChange={e => setConfig({ ...config, session: { idleMinutes: Number(e.target.value) } })}/></label>
        <small>默认 30 分钟。跨过本地日期也会结束上一段对话。只计算你发来的聊天消息，摸头、提醒和大肥鱼自己的回复不会延长。旧聊天仍可查看，共同记忆和学习计划继续保留；新对话不会自动接着上次的问题或操作。</small>
      </section>
      <section className="settings-card"><h3>语音朗读 · TTS</h3>
        <label className="companion-check"><input aria-label="自动朗读回复" type="checkbox" checked={config.tts.enabled} onChange={e => changeTts({ enabled: e.target.checked })}/>自动朗读大肥鱼的回复</label>
        <label>朗读来源<select aria-label="朗读来源" value={config.tts.source} onChange={e => changeTts({ source: e.target.value as 'local' | 'cloud' })}><option value="local">本地</option><option value="cloud">云端</option></select></label>
        {config.tts.source === 'local' && <label>本地朗读方式<select aria-label="本地朗读方式" value={config.tts.localEngine} onChange={e => changeTts({ localEngine: e.target.value as 'system' | 'http' })}><option value="system">Windows 系统声音</option><option value="http">本机 TTS 服务（兼容音频接口）</option></select></label>}
        {config.tts.source === 'local' && config.tts.localEngine === 'system' ? <><label>系统声音<select aria-label="系统声音" value={config.tts.systemVoice} onChange={e => changeTts({ systemVoice: e.target.value })}><option value="">自动选择本地声音</option>{voices.map(voice => <option key={voice.voiceURI} value={voice.voiceURI}>{voice.name} · {voice.lang}</option>)}</select></label><small>无需 API Key。日语练习可在 Windows“时间和语言 → 语音”安装日语声音后选择；只使用标记为本地的声音。</small></> : serviceFields('tts')}
        <div className="companion-columns"><label>语速：{config.tts.rate.toFixed(1)}×<input aria-label="朗读语速" type="range" min="0.5" max="2" step="0.1" value={config.tts.rate} onChange={e => changeTts({ rate: Number(e.target.value) })}/></label><label>音量：{Math.round(config.tts.volume * 100)}%<input aria-label="朗读音量" type="range" min="0" max="1" step="0.05" value={config.tts.volume} onChange={e => changeTts({ volume: Number(e.target.value) })}/></label></div>
        {config.tts.source === 'cloud' && <p className="companion-help">朗读时会将回复文本发送到此云端语音服务，可能产生用量费用。聊天模型和语音模型独立配置。</p>}
      </section>
      <section className="settings-card"><h3>语音识别 · ASR</h3>
        <label className="companion-check"><input aria-label="启用语音输入" type="checkbox" checked={config.asr.enabled} onChange={e => changeAsr({ enabled: e.target.checked })}/>启用聊天中的麦克风按钮</label>
        <label>识别来源<select aria-label="识别来源" value={config.asr.source} onChange={e => changeAsr({ source: e.target.value as 'local' | 'cloud' })}><option value="local">本地</option><option value="cloud">云端</option></select></label>
        {config.asr.source === 'local' && <label>本地识别协议<select aria-label="本地识别协议" value={config.asr.localProtocol} onChange={e => { const localProtocol = e.target.value as 'compatible' | 'whisper-cpp'; const url = config.asr.local.url.replace(/\/(?:v1\/audio\/transcriptions|inference)$/, localProtocol === 'whisper-cpp' ? '/inference' : '/v1/audio/transcriptions'); changeAsr({ localProtocol, local: { ...config.asr.local, url } }); }}><option value="compatible">兼容 /audio/transcriptions</option><option value="whisper-cpp">whisper.cpp /inference</option></select></label>}
        {serviceFields('asr')}
        <label>识别语言<select aria-label="识别语言" value={config.asr.language} onChange={e => changeAsr({ language: e.target.value })}><option value="">自动判断</option><option value="zh">中文</option><option value="ja">日语</option><option value="en">英语</option><option value="ko">韩语</option></select></label>
        <p className="companion-help">{config.asr.source === 'local' ? '本地识别需要你安装并运行识别引擎；程序不附带大型语音模型。音频只发到配置的本机地址。' : '结束录音后，音频将上传到你配置的云端服务，可能产生用量费用。'} 每次最长 60 秒，不持续监听，不保存录音文件。</p>
      </section>
      <button className="primary companion-save" disabled={!state} onClick={() => void save()}>保存对话设置</button>
    </fieldset>
    <section className="settings-card"><h3>试听与录音测试</h3><small>{dirty ? '设置尚未保存，请先保存后测试。' : '使用已保存的设置测试，不发送聊天，也不调用软件工具。'}</small>
      <textarea className="voice-test-text" aria-label="试听文字" value={testText} maxLength={1000} onChange={e => setTestText(e.target.value)}/>
      <div className="companion-inline"><button disabled={dirty || saving || playing || recording || !testText.trim()} onClick={() => void preview()}>试听声音</button><button disabled={!playing} onClick={() => { playback.current++; player.current.stop(); setPlaying(false); setNote('已停止试听'); }}>停止试听</button></div>
      <VoiceInput disabled={dirty || saving || playing} onBusy={setRecording} onText={setTranscript}/>
      {transcript && <div className="voice-result" aria-label="识别测试结果">{transcript}</div>}
    </section>
  </div>;
}
