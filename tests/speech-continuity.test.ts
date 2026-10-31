import { describe, expect, it } from 'vitest';
import { parseSpeechLanguages, type SpeechEmotion, type SpeechSegment } from '../src/shared/speech-language';
import { speechPlaybackPlan, speechPlan, voiceDefaults } from '../src/shared/voice';

const config = () => {
  const tts = structuredClone(voiceDefaults.tts);
  Object.assign(tts, { mode: 'language', languageChinese: 'configured', localEngine: 'gpt-sovits' });
  Object.assign(tts.gptSovits, { voice: 'happy', japanese: true }); return tts;
};
const emotions = (values: (SpeechEmotion | undefined)[]): SpeechSegment[] => values.map((emotion, index) => ({ language: 'zh', text: `第${index + 1}句。`, emotion }));

describe('同一回复声音连贯', () => {
  it('复现问候：开心之后的中性续句继续同一参考音，正文和原标注不变', () => {
    const parsed = parseSpeechLanguages('<voice lang="zh" emotion="happy">早上好呀。</voice><voice lang="zh" emotion="neutral">今天精神怎么样？</voice>');
    const before = structuredClone(parsed);
    const plan = speechPlaybackPlan(parsed.text, config(), parsed.segments);
    expect(plan.map(c => c.emotion)).toEqual(['happy', 'happy']);
    expect(plan.map(c => c.text)).toEqual(['早上好呀。', '今天精神怎么样？']);
    expect(plan.map(c => c.displayEnd)).toEqual(speechPlan(parsed.text, parsed.segments).map(c => c.displayEnd));
    expect(parsed).toEqual(before);
  });
  it('明确的新情绪保留，后续中性或漏标继承最近情绪；新回复独立选择', () => {
    const segments = emotions(['happy', 'sad', 'neutral', undefined, 'surprised']);
    expect(speechPlaybackPlan('', config(), segments).map(c => c.emotion)).toEqual(['happy', 'sad', 'sad', 'sad', 'surprised']);
    expect(speechPlaybackPlan('', config(), emotions(['neutral', 'neutral'])).map(c => c.emotion)).toEqual(['neutral', 'neutral']);
    expect(speechPlaybackPlan('你好。下一句。', config()).map(c => c.emotion)).toEqual(['happy', 'happy']);
  });
  it('中日共用三月七时保持声音，保留不同语言及分段', () => {
    const segments: SpeechSegment[] = [{ language: 'zh', text: '答对了！', emotion: 'happy' }, { language: 'ja', text: '学生。', emotion: 'neutral' }, { language: 'zh', text: '意思是学生。', emotion: 'neutral' }];
    const plan = speechPlaybackPlan('', config(), segments);
    expect(plan.map(c => c.emotion)).toEqual(['happy', 'happy', 'happy']);
    expect(plan.map(c => c.language)).toEqual(['zh', 'ja', 'zh']);
    const tts = config(); tts.gptSovits.japanese = false;
    expect(speechPlaybackPlan('', tts, segments).map(c => c.emotion)).toEqual(['happy', 'neutral', 'happy']);
  });
  it('关闭自动情绪或使用其他引擎时保持原设置', () => {
    const segments = emotions(['happy', 'neutral']); const original = speechPlan('', segments);
    const tts = config(); tts.gptSovits.autoEmotion = false;
    expect(speechPlaybackPlan('', tts, segments)).toEqual(original);
    tts.gptSovits.autoEmotion = true; tts.localEngine = 'system';
    expect(speechPlaybackPlan('', tts, segments)).toEqual(original);
    expect(speechPlaybackPlan('', undefined, segments)).toEqual(original);
  });
});
