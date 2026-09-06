import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
async function main() {
const root = path.resolve('resources/builtin'); await mkdir(path.join(root, 'assets'), { recursive: true }); await mkdir(path.join(root, 'motions'), { recursive: true }); await mkdir(path.join(root, 'groups'), { recursive: true });
const defs = `<defs><linearGradient id="hair" x2=".25" y2="1"><stop stop-color="#233777"/><stop offset=".58" stop-color="#365bbb"/><stop offset="1" stop-color="#69c5fa"/></linearGradient><linearGradient id="dress" x2=".8" y2="1"><stop stop-color="#283e73"/><stop offset="1" stop-color="#101e44"/></linearGradient><linearGradient id="eye" x2="0" y2="1"><stop stop-color="#13295e"/><stop offset=".55" stop-color="#338fde"/><stop offset="1" stop-color="#a9f0ff"/></linearGradient></defs>`;
const stroke = `stroke="#172950" stroke-width="3.2" stroke-linejoin="round" stroke-linecap="round"`;
const hairBack = `<path d="M-80-302 Q-132-251-109-177 Q-135-131-139-74 Q-137-48-116-65 Q-123-29-84-53 Q-46-25 0-51 Q60-25 100-51 Q130-28 144-64 Q117-51 125-91 Q137-158 103-206 Q114-297 54-324Z" fill="url(#hair)" ${stroke}/><g fill="none" stroke="#739bdf" stroke-width="3" opacity=".6"><path d="M-88-210Q-58-144-105-74Q-117-57-95-62"/><path d="M94-206Q67-118 111-85"/><path d="M-72-209Q-24-132-69-59"/><path d="M77-205Q34-118 83-62"/></g>`;
const body = `<g ${stroke}><path d="M-30-68L-30-18Q-21-7-9-17L-7-67M9-67L10-18Q23-7 31-19L31-68" fill="#ffe7df"/><path d="M-32-23L-9-21L-7-9Q-11 5-33-1Q-42-6-32-23M11-22L32-24Q42-6 33-1Q10 5 8-9Z" fill="#192d5a"/><path d="M-31-16L-10-14M12-15L32-17" stroke="#faf9ff" stroke-width="6"/><path d="M-42-206Q-63-191-57-152L-99-70Q-104-56-77-52Q-6-29 80-51Q102-54 103-69L60-157Q61-191 41-204Z" fill="url(#dress)"/><path d="M-96-68Q-102-55-82-55Q-76-38-60-47Q-49-32-33-43Q-18-28 0-40Q17-28 34-43Q48-32 62-47Q77-38 86-54Q105-53 99-68Q0-34-96-68" fill="#f9f5ff"/><path d="M-35-199L-29-153L-49-84Q-40-64 0-64Q43-65 48-85L28-153L35-199" fill="#f8f6ff"/><path d="M-37-201Q-50-201-41-187Q-51-180-37-175Q-47-165-32-163M38-201Q51-201 42-187Q51-181 37-175Q46-165 32-163" fill="white"/><path d="M-52-150Q0-140 55-150L57-136Q0-125-57-137Z" fill="#f9f4ff"/><path d="M-35-196L-4-186L-27-171Z M34-196L4-186L25-171Z" fill="#477dcc"/><circle cy="-185" r="8" fill="#55ccff" stroke="#efce87"/><path d="M-92-73Q0-42 94-73" fill="none" stroke="#e7c785" stroke-width="2"/></g><g transform="translate(0 -99)" fill="#528ee9"><path d="M-23 2C-21-25 20-20 23-1Q29 2 29-10Q39-14 39-2Q34 11 23 10C8 29-20 17-23 2"/><path d="M-21 1Q-6 12 13 11Q-5 21-21 1" fill="#d9f5ff"/><circle cx="-10" cy="-5" r="2" fill="#18396b"/><path d="M-3-21Q-12-39-2-31L1-20Q6-37 11-28L5-20"/></g>`;
const armLeft = `<g ${stroke}><path d="M-47-202Q-77-202-76-174L-87-140L-63-127L-44-161Z" fill="url(#dress)"/><path d="M-86-146L-61-132L-66-123Q-81-121-91-134Z" fill="#fbf5ff"/><path d="M-86-132Q-101-116-89-109Q-85-108-81-114Q-74-105-71-118L-68-124" fill="#ffe5d8"/><path d="M-87-147L-61-134" stroke="#96bff0" stroke-width="2"/></g>`;
const armRight = `<g transform="scale(-1 1)">${armLeft}</g>`;
const head = `<path d="M-94-292Q-104-211-71-196Q0-166 73-197Q105-215 95-291Q0-348-94-292Z" fill="#ffe9db" ${stroke}/><ellipse cx="-62" cy="-218" rx="18" ry="8" fill="#f3a7b2" opacity=".4"/><ellipse cx="62" cy="-218" rx="18" ry="8" fill="#f3a7b2" opacity=".4"/>`;
const hairFront = `<g ${stroke}><path d="M-104-260Q-126-319-68-348Q0-378 64-347Q118-321 105-245L94-204Q75-190 57-199Q93-219 81-265Q69-286 64-308Q70-275 50-248Q30-253 18-274Q31-250 15-240Q-24-256-24-305Q-30-266-53-246L-74-258Q-90-229-65-202Q-103-193-109-230Z" fill="url(#hair)"/><path d="M-101-321Q-112-331-98-337Q-103-351-87-352Q-85-369-68-363Q-61-378-44-371Q-31-386-17-375Q-2-388 12-375Q27-385 40-372Q60-379 65-364Q82-367 86-352Q105-354 105-338Q118-332 105-321Q82-348 45-353Q-43-375-101-321" fill="#fff9ff"/><path d="M-92-307Q-76-333-46-337M-38-346Q-15-356 11-348M45-338Q73-328 88-304" fill="none" stroke="#85a8ef" stroke-width="7" opacity=".55"/><path d="M87-294L116-310L119-275L89-285L91-263L77-270L82-290L62-286L64-314Z" fill="#42b3ed"/><circle cx="88" cy="-293" r="6" fill="#ffe3a1"/></g>`;
const eyes = `<g ${stroke}><path d="M-73-250Q-48-269-25-251Q-23-212-46-211Q-71-211-73-250M26-251Q50-269 74-250Q71-211 48-211Q24-212 26-251" fill="white"/><ellipse cx="-47" cy="-235" rx="18" ry="24" fill="url(#eye)"/><ellipse cx="49" cy="-235" rx="18" ry="24" fill="url(#eye)"/><path d="M-78-253Q-51-270-25-253M26-253Q53-271 79-253" fill="none" stroke="#202345" stroke-width="6"/></g><g fill="#fff"><circle cx="-52" cy="-247" r="7"/><circle cx="44" cy="-247" r="7"/><circle cx="-40" cy="-224" r="3"/><circle cx="56" cy="-224" r="3"/></g>`;
const mouth = `<path d="M-5-208Q0-211 5-208" fill="none" stroke="#b1787c" stroke-width="2.6" stroke-linecap="round"/>`;
const parts = { hairBack, body, armLeft, armRight, head, eyes, mouth, hairFront };
function svg(content: string) { return `<svg xmlns="http://www.w3.org/2000/svg" width="340" height="420" viewBox="-170 -390 340 420">${defs}${content}</svg>`; }
for (const [name, content] of Object.entries(parts)) await sharp(Buffer.from(svg(content))).png().toFile(path.join(root, 'assets', `${name}.png`));
for (let i = 0; i < 4; i++) { const content = `<g transform="translate(0 ${-i * 3}) rotate(${[0,-4,0,4][i]} 0 -120)">${hairBack}${body}${armLeft}<g transform="rotate(${-i * 10} 48 -194)">${armRight}</g>${head}${eyes}${mouth}${hairFront}</g><g fill="#77dafa">${Array.from({ length: 5 }, (_, j) => `<circle cx="${-110 + j * 55}" cy="${-320 - ((i + j) % 3) * 12}" r="${3 + (i+j)%3}"/>`).join('')}</g>`; await sharp(Buffer.from(svg(content))).png().toFile(path.join(root, 'assets', `frame-${i}.png`)); }
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256"><rect width="256" height="256" rx="70" fill="#213c7f"/><path d="M42 136C34 49 190 45 183 139Q199 150 202 115Q239 97 235 132Q231 164 195 168C161 226 62 210 42 136" fill="#79ceff"/><path d="M46 143Q101 179 164 167Q85 205 46 143" fill="white"/><circle cx="88" cy="113" r="9" fill="#182d60"/></svg>`)).png().toFile('resources/icon.png');
type TrackSpec = [string, string, number[]];
const motions: string[] = []; const groups: string[] = [];
async function json(file: string, value: unknown) { await writeFile(path.join(root, file), JSON.stringify(value, null, 2)); }
async function motion(id: string, durationMs: number, specs: TrackSpec[]) { motions.push(`motions/${id}.json`); await json(`motions/${id}.json`, { schemaVersion: 1, id, name: id, kind: 'rig_timeline', avatarId: 'deepblue-chibi-v1', durationMs, channels: ['pose'], tracks: specs.map(([targetId, property, values]) => ({ targetId, property, keyframes: values.map((value, index) => ({ timeMs: Math.round(index * durationMs / (values.length - 1)), value, easing: 'easeInOut' })) })) }); }
await motion('wave', 1400, [['armRight','rotationDeg',[0,-105,-60,-110,-65,0]], ['head','rotationDeg',[0,5,0]]]);
await motion('sway', 2200, [['root','rotationDeg',[0,-3,3,0]],['hairBack','rotationDeg',[0,5,-4,0]]]);
await motion('look', 2100, [['head','rotationDeg',[0,-12,0,12,0]],['head','offsetX',[0,-5,0,5,0]]]);
await motion('hop', 1100, [['root','offsetY',[0,5,-34,0,-12,0]],['armLeft','rotationDeg',[0,35,0]],['armRight','rotationDeg',[0,-35,0]]]);
await motion('shy', 1800, [['head','rotationDeg',[0,12,10,0]],['armLeft','rotationDeg',[0,-22,0]],['armRight','rotationDeg',[0,22,0]]]);
await motion('shake', 1000, [['head','rotationDeg',[0,-10,10,-10,8,0]]]);
await motion('sleep', 9000, [['head','rotationDeg',[0,12,13,12,0]],['body','scaleY',[1,.98,1,.98,1]]]);
await motion('walk_right', 800, [['root','offsetY',[0,-7,0,-7,0]],['armLeft','rotationDeg',[0,22,-22,22,0]],['armRight','rotationDeg',[0,-22,22,-22,0]],['root','scaleX',[1,1,1]]]);
await motion('walk_left', 800, [['root','offsetY',[0,-7,0,-7,0]],['armLeft','rotationDeg',[0,22,-22,22,0]],['armRight','rotationDeg',[0,-22,22,-22,0]],['root','scaleX',[-1,-1,-1]]]);
await motion('pat', 1200, [['head','offsetY',[0,7,0,5,0]],['hairFront','rotationDeg',[0,-4,4,0]]]);
await motion('boop', 900, [['body','scaleY',[1,.90,1.06,1]],['armLeft','rotationDeg',[0,20,0]],['armRight','rotationDeg',[0,-20,0]]]);
await motion('settle', 750, [['root','rotationDeg',[0,-8,6,-3,0]],['hairBack','rotationDeg',[0,10,-6,0]]]);
motions.push('motions/frame_magic.json'); await json('motions/frame_magic.json', { schemaVersion:1,id:'frame_magic',name:'水光逐帧',kind:'frame_animation',avatarId:'deepblue-chibi-v1',durationMs:800,channels:['pose','face'],frames:[0,1,2,3].map(i=>`assets/frame-${i}.png`),fps:5,canvas:{width:340,height:420},anchor:{x:.5,y:390/420} });
const mn = (id: string, repeat = 1) => ({type:'motion',motionId:`builtin.deepblue:${id}`,repeat});
const expression = (expressionId: string, durationMs: number) => ({type:'expression',expressionId,durationMs});
const effect = (effectId: string, durationMs: number) => ({type:'effect',effectId,durationMs});
async function group(id: string, name: string, description: string, duration: number, children: unknown[], random = true, weight = 3, roaming = false) { groups.push(`groups/${id}.json`); await json(`groups/${id}.json`, { schemaVersion:1,id,name,description,tags:[roaming?'散步':random?'日常':'互动'],enabled:true,random:{eligible:random,weight,cooldownMs:id==='sleep_short'?60000:12000},conditions:{minIdleMs:roaming?5000:2000,requiresRoaming:roaming,requiresPointerAway:roaming},maxDurationMs:duration+500,timeline:children.length===1?children[0]:{type:'parallel',children} }); }
await group('idle_sway','微风摇摇','随着微风轻轻摆动，发梢也跟着晃一晃。',2200,[mn('sway')],true,10);
await group('look_around','看看四周','歪歪脑袋，看看你在不在身边。',2100,[mn('look')],true,6);
await group('greet_wave','向你招手','抬起右手，带着微笑和星光打个招呼。',1400,[mn('wave'),expression('smile',1400),effect('sparkles',1400)]);
await group('happy_hop','开心跳跳','轻盈地跳起来，落地后再弹一下。',1100,[mn('hop'),expression('smile',1100),effect('sparkles',1100)]);
await group('shy_pose','有点害羞','双手收拢，红着脸轻轻歪头。',1800,[mn('shy'),expression('shy',1800)]);
await group('annoyed_shake','小小抗议','摇摇头，表达一点小小的不满。',1000,[mn('shake'),expression('annoyed',1000)],false);
await group('sleep_short','打个盹儿','闭上眼睛小憩九秒，之后自动醒来。',9000,[mn('sleep'),expression('sleep',9000),effect('sleepy',9000)],true,1);
for(const direction of ['left','right']) await group(`walk_${direction}`,direction==='left'?'向左散步':'向右散步','迈着小步移动桌面位置，遇到边界自动停下。',2400,[mn(`walk_${direction}`,3),{type:'move_by',dxDip:direction==='left'?-120:120,dyDip:0,durationMs:2400,easing:'linear'}],true,1,true);
await group('head_touch','摸摸头','被摸头时轻轻低头，冒出一颗小爱心。',1200,[mn('pat'),expression('smile',1200),effect('hearts',1200)],false);
await group('body_touch','戳戳肚子','被戳到后缩一下身子，露出惊讶的表情。',900,[mn('boop'),expression('surprised',900)],false);
await group('drag_release','站稳啦','被放下后晃一晃身体，重新站稳。',750,[mn('settle')],false);
await group('water_magic','水光变奏','真实 PNG 序列帧动画；结束或打断后恢复分层角色。',1600,[mn('frame_magic',2)],false);
await json('pack.json',{schemaVersion:1,id:'builtin.deepblue',name:'DeepBlue · 日常',version:'1.0.0',avatarId:'deepblue-chibi-v1',description:'内置分层演示角色与十三个动作组。',motions,groups});
console.log(`Created ${motions.length} motions, ${groups.length} groups, layered PNGs and 4 frames.`);

}
void main();


