/** Reconstruct the inner locks previously hidden behind the resting arms.
 * Continuous curved strands, ink, shadows and blue highlights replace the
 * coarse old fill. Outer hair and its original silhouette remain intact.
 */
export function paintInnerHair(ctx: CanvasRenderingContext2D): void {
  for(const side of [-1,1]){
    ctx.save();if(side===1){ctx.translate(608,0);ctx.scale(-1,1);}
    const base=ctx.createLinearGradient(120,460,245,660);
    base.addColorStop(0,'#3c5089');base.addColorStop(.5,'#5679b7');base.addColorStop(1,'#6891ca');
    ctx.fillStyle=base;
    ctx.fill(new Path2D('M170 421 C207 426 231 467 244 511 L245 587 L209 649 L185 696 L112 701 L112 664 L131 620 L143 553 L132 482 Z'));
    const lock=(path:string,light:number)=>{
      const g=ctx.createLinearGradient(115,480,234,633);
      g.addColorStop(0,'#354b87');g.addColorStop(.33,light?'#6389c3':'#4d6ba6');
      g.addColorStop(.59,light?'#769ed2':'#6489c3');g.addColorStop(.85,'#4d6caa');g.addColorStop(1,'#324b84');
      const p=new Path2D(path);ctx.fillStyle=g;ctx.fill(p);ctx.strokeStyle='#1b294a';ctx.lineWidth=2.4;ctx.lineJoin='round';ctx.stroke(p);
    };
    lock('M179 432 C208 448 234 475 228 510 C222 542 194 552 180 579 C162 609 177 640 151 665 C139 678 124 685 112 682 C136 673 145 657 141 639 C134 607 145 580 162 555 C179 529 159 507 158 482 C157 462 165 445 179 432 Z',0);
    lock('M197 462 C229 482 239 511 228 538 C218 566 187 582 180 605 C170 633 184 657 161 679 C148 692 131 695 120 689 C143 691 159 677 159 662 C155 639 150 617 162 593 C174 568 201 558 205 534 C210 512 193 495 197 462 Z',1);
    lock('M223 512 C239 538 230 562 211 584 C193 604 187 623 195 645 C204 671 188 693 167 703 C151 711 136 708 130 700 C153 705 174 691 178 674 C183 656 165 636 174 613 C181 590 208 579 216 557 C222 541 222 528 223 512 Z',0);
    ctx.strokeStyle='rgba(155,194,235,.60)';ctx.lineWidth=2.1;ctx.lineCap='round';
    for(const path of [
      'M182 454 C195 479 197 501 188 521 C178 543 164 550 157 568',
      'M210 495 C224 527 206 549 186 568 C170 584 164 599 165 614',
      'M169 622 C168 638 173 654 169 666',
      'M217 571 C199 591 185 608 186 625 C184 644 195 664 181 681'
    ])ctx.stroke(new Path2D(path));
    ctx.strokeStyle='rgba(38,58,103,.65)';ctx.lineWidth=1.2;
    for(const path of [
      'M174 476 C171 502 187 518 175 540 C153 573 144 600 150 628',
      'M219 512 C221 537 199 560 181 580 C167 599 170 614 174 629',
      'M219 583 C204 604 195 613 200 635',
      'M184 654 C190 680 167 696 150 699'
    ])ctx.stroke(new Path2D(path));
    ctx.fillStyle='rgba(149,190,234,.5)';
    ctx.fill(new Path2D('M185 544 C175 553 169 565 168 574 C168 561 174 550 185 544 Z'));
    ctx.fill(new Path2D('M183 596 C174 607 175 618 177 625 C171 614 174 603 183 596 Z'));
    ctx.restore();
  }
}
