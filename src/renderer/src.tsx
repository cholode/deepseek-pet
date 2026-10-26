import React from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from './panel/Panel';
import { QuickChat } from './chat/QuickChat';
import { SpeechBubble } from './chat/SpeechBubble';
import './style.css';
const element=document.getElementById('root')!;
const page = new URLSearchParams(location.search).get('page');
if(page === 'quick-chat'){document.body.className='quick-chat-page';createRoot(element).render(<QuickChat/>);}
else if(page === 'speech-bubble'){document.body.className='speech-bubble-page';createRoot(element).render(<SpeechBubble/>);}
else if(page==='panel'){document.body.className='panel';createRoot(element).render(<React.StrictMode><Panel/></React.StrictMode>);}
else{document.title='DeepBlue Pet';document.body.className='pet';void import('./pet/mount').then(m=>m.mountPet(element)).catch(e=>{element.textContent=`桌宠加载失败：${String(e)}`;element.className='startup-error';});}
