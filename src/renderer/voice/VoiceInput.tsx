import { useEffect, useRef, useState } from 'react';
import { maxRecordingSeconds, type VoiceState } from '../../shared/voice';
import { encodeVoiceWav } from '../../shared/voice-wav';
import './voice.css';

interface Props { onText(text: string): boolean | void; onBusy?(busy: boolean): void; onStatus?(message: string): void; compact?: boolean; disabled?: boolean }
export function VoiceInput({ onText, onBusy, onStatus, compact = false, disabled = false }: Props) {
  const [state, setState] = useState<VoiceState>(); const [phase, setPhase] = useState<'idle' | 'starting' | 'recording' | 'transcribing'>('idle');
  const [seconds, setSeconds] = useState(0); const [message, setMessage] = useState('');
  const generation = useRef(0); const cleanup = useRef<() => void>(() => {}); const finish = useRef<() => void>(() => {});
  const callbacks = useRef({ onText, onBusy, onStatus }); callbacks.current = { onText, onBusy, onStatus };
  const phaseRef = useRef(phase); phaseRef.current = phase;
  const cancelRef = useRef<() => void>(() => {});
  function cancel() { generation.current++; cleanup.current(); cleanup.current = () => {}; setPhase('idle'); callbacks.current.onBusy?.(false); void window.pet.voice({ type: 'cancel' }).catch(() => {}); }
  cancelRef.current = cancel;
  useEffect(() => {
    let live = true;
    void window.pet.voice({ type: 'state' }).then(r => { if (live) setState(r.state); }).catch(() => {});
    const off = window.pet.onVoice(event => { if (event.type === 'state') setState(event.state); else if (event.type === 'stop-all') cancelRef.current(); });
    const visibility = () => { if (document.hidden) cancelRef.current(); };
    document.addEventListener('visibilitychange', visibility);
    return () => { live = false; off(); document.removeEventListener('visibilitychange', visibility); generation.current++; cleanup.current(); callbacks.current.onBusy?.(false); void window.pet.voice({ type: 'cancel' }).catch(() => {}); };
  }, []);
  async function start() {
    if (phaseRef.current !== 'idle') return;
    const current = ++generation.current; setPhase('starting'); setMessage(''); setSeconds(0); callbacks.current.onBusy?.(true);
    let stream: MediaStream | undefined; let context: AudioContext | undefined; let node: AudioWorkletNode | undefined; let timer: ReturnType<typeof setInterval> | undefined;
    const release = () => { clearInterval(timer); if (node) { node.port.onmessage = null; node.disconnect(); } stream?.getTracks().forEach(track => track.stop()); if (context && context.state !== 'closed') void context.close(); };
    cleanup.current = release;
    try {
      const response = await window.pet.voice({ type: 'capture-begin' }); if (current !== generation.current) return;
      if (!response.ok || !response.captureId) throw new Error(response.message ?? '无法开始录音');
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (current !== generation.current) { release(); return; }
      context = new AudioContext({ sampleRate: 16000 });
      await context.audioWorklet.addModule(new URL('voice-recorder.js', window.location.href).href);
      if (current !== generation.current) { release(); return; }
      node = new AudioWorkletNode(context, 'voice-recorder'); const source = context.createMediaStreamSource(stream); source.connect(node); node.connect(context.destination);
      const chunks: Float32Array[] = []; let length = 0; let finishing = false; const started = Date.now();
      const submit = async () => {
        if (finishing || current !== generation.current) return; finishing = true; release(); setPhase('transcribing');
        try {
          if (length < 3200) throw new Error('录音太短，请说完一句话再结束');
          const samples = new Float32Array(length); let offset = 0; for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
          const result = await window.pet.voice({ type: 'transcribe', captureId: response.captureId!, audio: encodeVoiceWav(samples) });
          if (current !== generation.current) return;
          if (!result.ok || !result.text) throw new Error(result.message ?? '没有识别到文字'); const accepted = callbacks.current.onText(result.text); setMessage(accepted === false ? `草稿超过 4000 字，请先整理。识别结果：${result.text}` : '已填入文字，请检查后发送');
        } catch (error) { if (current === generation.current) setMessage(error instanceof Error ? error.message : '语音识别失败'); }
        finally { if (current === generation.current) { cancelRef.current(); } }
      };
      finish.current = () => { void submit(); };
      node.port.onmessage = event => { if (current !== generation.current || finishing) return; const part = (event.data as Float32Array).slice(0, maxRecordingSeconds * 16000 - length); chunks.push(part); length += part.length; if (length >= maxRecordingSeconds * 16000) void submit(); };
      stream.getAudioTracks().forEach(track => { track.onended = () => { if (current === generation.current && !finishing) { setMessage('麦克风已断开，请重新录音'); cancelRef.current(); } }; });
      await context.resume(); if (current !== generation.current) { release(); return; }
      setPhase('recording'); timer = setInterval(() => { const elapsed = Math.floor((Date.now() - started) / 1000); setSeconds(elapsed); if (elapsed >= maxRecordingSeconds) void submit(); }, 250);
    } catch (error) {
      release(); if (current !== generation.current) return;
      setMessage(error instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(error.name) ? '无法使用麦克风：请检查 Windows 麦克风权限，允许桌面应用访问' : error instanceof DOMException && error.name === 'NotFoundError' ? '没有检测到麦克风，请连接设备后重试' : error instanceof Error ? error.message : '录音失败'); cancelRef.current();
    }
  }
  const active = phase !== 'idle';
  const label = phase === 'recording' ? `结束录音 ${seconds}s` : phase === 'transcribing' ? '取消识别' : phase === 'starting' ? '取消录音' : '语音输入';
  const hint = phase === 'starting' ? '正在准备麦克风和识别引擎，首次需加载模型，点击可取消' : phase === 'recording' ? `正在录音 ${seconds} 秒，点击结束并识别（最长 60 秒）` : phase === 'transcribing' ? '正在识别，点击可取消' : state?.config.asr.enabled ? `点击录音 · ${state.config.asr.source === 'local' ? '本地' : '云端'}识别` : '请在智能陪伴 → 对话设置中启用语音输入';
  useEffect(() => { callbacks.current.onStatus?.(active ? hint : message); }, [active, hint, message]);
  return <div className={`voice-input ${compact ? 'compact' : ''}`}>
    <button type="button" className={active ? 'voice-active' : ''} aria-label={label} title={message || hint} disabled={!active && (disabled || !state?.config.asr.enabled)} onClick={() => phase === 'recording' ? finish.current() : active ? cancel() : void start()}>{compact ? phase === 'recording' ? `${seconds}s ■` : phase === 'transcribing' || phase === 'starting' ? '×' : <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 11v1a7 7 0 0 0 14 0v-1M12 19v3M8 22h8"/></svg> : label}</button>
    {!compact && phase === 'recording' && <button type="button" onClick={cancel}>取消录音</button>}
    <span role="status" className={compact ? 'voice-sr' : ''}>{active ? hint : message || hint}</span>
  </div>;
}
