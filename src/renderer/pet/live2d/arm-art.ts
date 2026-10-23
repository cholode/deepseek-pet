import { paintInnerHair } from './hair-fill';

/** The source cutouts include hair outside the sleeve and a second sleeve in
 * the torso. This alternate atlas cleans those areas only while articulating
 * the arm. Resting/waving poses keep the original atlas, byte for byte.
 * Paths are traced in the original 640 × 915 character coordinates.
 */
export function articulatedTexture(image: HTMLImageElement): HTMLCanvasElement {
  const canvas = document.createElement('canvas'); canvas.width=image.width;canvas.height=image.height;
  const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0);
  const tiles = {
    BackHair: {source:[16,400,611,322],tile:[886,8]},
    Dress: {source:[107,474,399,338],tile:[471,8]},
    ArmL: {source:[130,490,113,157],tile:[899,389]},
    ArmR: {source:[377,490,104,159],tile:[779,389]},
    HandL: {source:[130,623,53,43],tile:[546,640]},
    HandR: {source:[427,623,55,52],tile:[475,640]}
  };
  const edit=(id:keyof typeof tiles,draw:(restore:()=>void)=>void)=>{
    const {source:[sx,sy,w,h],tile:[tx,ty]}=tiles[id];
    ctx.save();ctx.beginPath();ctx.rect(tx,ty,w,h);ctx.clip();ctx.clearRect(tx,ty,w,h);ctx.translate(tx-sx,ty-sy);
    draw(()=>ctx.drawImage(image,tx,ty,w,h,sx,sy,w,h));ctx.restore();
  };
  edit('BackHair',restore=>{restore();paintInnerHair(ctx);});
  edit('Dress',restore=>{
    ctx.clip(new Path2D('M243 474 L370 474 L375 552 Q378 586 402 625 L506 695 L506 812 L107 812 L107 695 L205 625 Q230 585 234 550 Z'));
    restore();
  });
  for(const side of ['L','R'] as const){
    edit(`Arm${side}`,restore=>{
      // Reconstruct the sleeve hidden by the front hair; retain the painted cuff.
      const left=side==='L';ctx.save();if(!left){ctx.translate(608,0);ctx.scale(-1,1);}
      const sleeve=new Path2D('M210 495 C226 492 239 505 236 522 C234 545 219 566 208 587 L186 626 L140 605 L153 577 C163 563 173 551 177 535 C179 514 192 499 210 495 Z');
      const shade=ctx.createLinearGradient(159,520,233,564);shade.addColorStop(0,'#25345e');shade.addColorStop(.48,'#303e70');shade.addColorStop(.78,'#344276');shade.addColorStop(1,'#202c54');
      ctx.fillStyle=shade;ctx.fill(sleeve);ctx.strokeStyle='#11162d';ctx.lineWidth=3.2;ctx.lineJoin='round';ctx.stroke(sleeve);
      ctx.fillStyle='#27335f';ctx.fill(new Path2D('M196 550 Q215 551 215 563 Q210 572 196 566 L185 563 Q192 559 196 550 Z'));
      ctx.strokeStyle='#26335f';ctx.lineWidth=2;ctx.stroke(new Path2D('M190 513 Q184 529 188 540 M221 524 Q220 543 214 551 M175 580 Q186 575 198 582'));
      ctx.restore();
      ctx.save();
      ctx.clip(new Path2D(left?'M148 589 L192 617 L178 645 L130 617 Z':'M416 616 L460 589 L481 620 L434 648 Z'));
      restore();ctx.restore();
    });
    edit(`Hand${side}`,()=>{
      // An open, cupped palm replaces the source's tiny resting fist. Keep
      // the same wrist, warm skin palette, ink and separate finger creases.
      if(side==='R'){ctx.translate(609,6);ctx.scale(-1,1);}
      // Match the palm's long axis to the source forearm (wrist - elbow),
      // rather than adding an independent sideways bend at the wrist.
      ctx.translate(155,634);ctx.rotate(24*Math.PI/180);ctx.translate(-155,-634);
      const hand=new Path2D('M144 631 Q153 628 163 632 Q167 635 169 640 L178 648 Q181 652 177 654 Q174 655 169 649 L167 648 L172 658 Q174 663 170 664 Q167 665 164 660 L161 654 L164 660 Q166 665 162 665 Q159 666 157 661 L153 654 L155 660 Q157 665 153 665 Q149 666 147 661 L142 652 Q138 644 144 631 Z');
      const skin=ctx.createLinearGradient(145,631,170,664);skin.addColorStop(0,'#f4d6c6');skin.addColorStop(.4,'#fff0e7');skin.addColorStop(.75,'#fbe7dc');skin.addColorStop(1,'#edc3bb');
      ctx.fillStyle=skin;ctx.fill(hand);ctx.strokeStyle='#202136';ctx.lineWidth=2.3;ctx.lineCap='round';ctx.lineJoin='round';ctx.stroke(hand);
      ctx.strokeStyle='#d49a98';ctx.lineWidth=1.1;ctx.stroke(new Path2D('M146 642 Q152 639 157 643 M148 651 L151 656 M154 649 L158 656 M160 647 L164 653 M165 642 Q162 645 163 649'));
      ctx.strokeStyle='rgba(255,255,255,.65)';ctx.lineWidth=1.5;ctx.stroke(new Path2D('M148 635 Q145 638 145 642 M150 647 L153 651'));
    });
  }
  return canvas;
}
