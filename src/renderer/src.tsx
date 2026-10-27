import React from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from './panel/Panel';
import { QuickChat } from './chat/QuickChat';
import { SpeechBubble } from './chat/SpeechBubble';
import './style.css';
const element=document.getElementById('root')!;
const page = new URLSearchParams(location.search).get('page');
// 覆盖输入法、粘贴和 DOM 输入；不采集文本，只通知主进程互动发生了。
if (page !== 'speech-bubble') {
  let lastActivity = -Infinity;
  const activity = () => { const now = performance.now(); if (now - lastActivity >= 80) { lastActivity = now; window.pet.userActivity(); } };
  const events = ['pointerdown', 'keydown', 'input', 'compositionstart', 'compositionupdate', 'wheel'];
  for (const event of events) window.addEventListener(event, activity, { capture: true, passive: true });
  if (import.meta.hot) import.meta.hot.dispose(() => { for (const event of events) window.removeEventListener(event, activity, true); });
}
if(page === 'quick-chat'){document.body.className='quick-chat-page';createRoot(element).render(<QuickChat/>);}
else if(page === 'speech-bubble'){document.body.className='speech-bubble-page';createRoot(element).render(<SpeechBubble/>);}
else if(page==='panel'){document.body.className='panel';createRoot(element).render(<React.StrictMode><Panel/></React.StrictMode>);}
else{document.title='DeepBlue Pet';document.body.className='pet';void import('./pet/mount').then(m=>m.mountPet(element)).catch(e=>{element.textContent=`桌宠加载失败：${String(e)}`;element.className='startup-error';});}
