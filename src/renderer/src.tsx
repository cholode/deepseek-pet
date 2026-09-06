import React from 'react';
import { createRoot } from 'react-dom/client';
import { Panel } from './panel/Panel';
import './style.css';
const element=document.getElementById('root')!;
if(new URLSearchParams(location.search).get('page')==='panel'){document.body.className='panel';createRoot(element).render(<React.StrictMode><Panel/></React.StrictMode>);}
else{document.title='DeepBlue Pet';document.body.className='pet';void import('./pet/mount').then(m=>m.mountPet(element)).catch(e=>{element.textContent=`桌宠加载失败：${String(e)}`;element.className='startup-error';});}
