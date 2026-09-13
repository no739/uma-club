(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const header = document.querySelector('.header');
  const hero = document.querySelector('[data-anim="hero"]');
  const canvas = document.getElementById('orb');
  const ctx = canvas.getContext('2d');
  const counters = [...document.querySelectorAll('[data-count]')];
  const active = new Map(), completed = new Set(), timers = new Set(), plans = new Map();
  let width=0, height=0, points=[],  raf=0, previous=0, elapsed=0, lastY=scrollY, progress=0; 
  const format = (el,n) => n.toLocaleString('en-US',{minimumFractionDigits:(el.dataset.count.split('.')[1]||'').length,maximumFractionDigits:(el.dataset.count.split('.')[1]||'').length,useGrouping:el.dataset.format==='comma'});
  const finish = el => {el.textContent=format(el,Number(el.dataset.count));completed.add(el);active.delete(el);};
  const later = (fn,ms) => { const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id); };
  function prepare(el,x=0,y=28,duration=850) {
    el.classList.add('anim');el.style.setProperty('--x',`${x}px`);el.style.setProperty('--y',`${y}px`);el.style.setProperty('--duration',`${duration}ms`);
    return {el,duration};
  }
  const frameJobs=[];
  const afterPaint=fn=>{frameJobs.push({fn,frames:2});start();};
  function enter(item,delay=0) {
    later(()=>{
      if(reduced.matches) {item.el.classList.add('in');return;}
      item.el.style.willChange='transform, opacity';
      afterPaint(()=>{
        item.el.classList.add('in');
        later(()=>item.el.style.removeProperty('will-change'),item.duration+50);
      });
    },delay);
  }
  function watch(el,fn) {plans.set(el,fn);observer.observe(el);}
  const observer = new IntersectionObserver(entries=>{
    for(const entry of entries) {
      if(!entry.isIntersecting) continue;
      const fn=plans.get(entry.target);if(fn) fn();
      plans.delete(entry.target);observer.unobserve(entry.target);
    }
  },{threshold:0.15,rootMargin:"0px 0px -12% 0px"});
  if(!reduced.matches) document.documentElement.classList.add('motion');
  document.querySelectorAll('[data-anim]').forEach(block=>{
    const kind=block.dataset.anim;
    if(kind==='hero') {
      [...block.querySelector('.hero-copy').children].forEach((el,i)=>enter(prepare(el,i===1?-32:0,i===1?0:28),200+i*110));
      enter({el:canvas,duration:1200});later(()=>canvas.classList.add('settled'),1300);return;
    }
    if(kind==='quiet') {const item=prepare(block,0,16);watch(block,()=>enter(item));return;}
    const english=block.querySelector('.english'),heading=block.querySelector('h2');
    const group=[[prepare(english,-40,0,800),0],[prepare(heading),120]];
    block.querySelectorAll('.results-heading>p:not(.english),.race-date').forEach(el=>group.push([prepare(el),120]));
    const link=block.querySelector('.section-heading a');if(link) group.push([prepare(link,40,0,800),0]);
    watch(english,()=>group.forEach(([item,delay])=>enter(item,delay)));
    if(kind==='stats') block.querySelectorAll('.metric').forEach((el,i)=>{
      const item=prepare(el,i%2?32:-32,0);watch(el,()=>{
        enter(item,i*140);
        later(()=>{el.querySelectorAll('[data-count]').forEach(counter=>{
          if(reduced.matches) finish(counter);
          else if(!completed.has(counter)) {counter.textContent=format(counter,0);active.set(counter,{elapsed:0});}
        });start();},i*140+850+300);
      });
    });
    if(kind==='cards') block.querySelectorAll('.features article').forEach((el,i)=>{
      const item=prepare(el,0,40),title=prepare(el.querySelector('h3'),0,12),body=prepare(el.querySelector('p'),0,12);
      watch(el,()=>{enter(item,i*160);enter(title,i*160);enter(body,i*160+80);});
    });
    if(kind==='steps') block.querySelectorAll('.schedule>div').forEach((el,i)=>{
      const time=prepare(el.querySelector('dt'),-32,0),description=prepare(el.querySelector('dd'));
      watch(el,()=>{
        later(()=>{el.classList.add('preparing');afterPaint(()=>el.classList.add('in'));later(()=>el.classList.remove('preparing'),750);},i*200);
        enter(time,i*200+150);enter(description,i*200+250);
      });
    });
    if(kind==='races') block.querySelectorAll('.race-card').forEach((el,i)=>{
      const item=prepare(el,48,0),arrow=prepare(el.querySelector('.arrow'),0,0,300);
      watch(el,()=>{enter(item,i*150);enter(arrow,i*150+900);});
    });
  });
  // Validate the entire frame-major Uint16 LE payload and permutation once.
  function decodeRun(data) {
    try {
      if(!data || data.w!==300 || data.h!==200 || data.n!==2400 || data.frames!==12 ||
        !Array.isArray(data.perm) || data.perm.length!==2400 ||
        data.perm.some(i=>!Number.isInteger(i)||i<0||i>=2400) || new Set(data.perm).size!==2400) return null;
      const bytes=Uint8Array.from(atob(data.b64),c=>c.charCodeAt(0));
      if(bytes.length!==12*2400*4) return null;
      const view=new DataView(bytes.buffer),coords=new Uint16Array(12*2400*2);
      for(let i=0;i<coords.length;i++) coords[i]=view.getUint16(i*2,true);
      const inverse=new Uint16Array(2400);data.perm.forEach((v,i)=>inverse[v]=i);
      return {...data,coords,inverse};
    } catch { return null; }
  }
  const run=decodeRun(window.HORSE_RUN);
  const slots=Uint16Array.from({length:2400},(_,i)=>i);
  const clamp=n=>Math.max(0,Math.min(1,n));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const ease=t=>t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  const pointer={x:Infinity,y:Infinity};
  const scrollSamples=[],costs=[];
  let runTime=0,sphereTime=0,dotScale=1,sprites=[];
  const entering=()=>clamp((progress-.10)/.14);
  const leaving=()=>clamp((progress-.72)/.14);
  function morph() {return run?entering()*(1-leaving()):0;}
  function advanceRun(delta,now) {
    while(scrollSamples.length && scrollSamples[0].time<=now-300) scrollSamples.shift();
    const speed=scrollSamples.reduce((sum,s)=>sum+s.distance,0)/.3;
    if(!run || progress<=.184 || progress>=.86) return;
    // 走行の進み: 1周 1.05s。スクロール中は最大 2.2 倍
    const boost=1+1.2*clamp(speed/1500);
    const step=delta/1050*boost*ease(clamp((entering()-.6)/.4));
    const cycles=Math.floor(runTime+step)-Math.floor(runTime);
    for(let c=0;c<cycles;c++) for(let i=0;i<slots.length;i++) slots[i]=run.perm[slots[i]];
    runTime+=step;
  }
  function sample(slot,frame,axis) {
    if(frame>=12) {frame-=12;slot=run.perm[slot];}
    return run.coords[(frame*2400+slot)*2+axis]/65535;
  }
  // コマ間は smoothstep(3t²−2t³) の連続移動。飛び越え・消失は行わない
  function horseCoord(slot,k,f,axis) {
    const s=f*f*(3-2*f);
    return lerp(sample(slot,k,axis),sample(slot,k+1,axis),s);
  }
  function makeSprites(dpr) {
    sprites=['9,111,200','120,190,255','3,60,120'].map(rgb=>
      [2,2.6,3.2].map(size=>{
        const sprite=document.createElement('canvas');
        sprite.width=sprite.height=Math.ceil(size*dpr);
        const c=sprite.getContext('2d'),r=sprite.width/2;
        const fade=c.createRadialGradient(r,r,0,r,r,r);
        fade.addColorStop(0,`rgba(${rgb},1)`);fade.addColorStop(1,`rgba(${rgb},0)`);
        c.fillStyle=fade;c.beginPath();c.arc(r,r,r,0,Math.PI*2);c.fill();return sprite;
      }));
  }
  function dot(x,y,size,alpha,color=0) {
    ctx.globalAlpha=alpha;
    ctx.drawImage(sprites[color][size<=2?0:size<=2.6?1:2],x-size/2,y-size/2,size,size);
  }
  function draw() {
    if(!ctx || document.hidden) return;
    const began=performance.now();
    ctx.clearRect(0,0,width,height);
    const mobile=width<640,entry=entering(),exit=leaving();
    const transitioning=run&&((progress>.10&&progress<.24)||(progress>.72&&progress<.86));
    const end=ease(exit),time=reduced.matches?0:sphereTime;
    const angle=time*2*Math.PI/28,tilt=reduced.matches?0:Math.sin(time*2*Math.PI/9)*Math.PI/10;
    // 真球: 半径は全粒子共通。呼吸(±3%/6s)と脈打ち(+5%、4.5s ごとに2連)だけ
    const pulse=t=>t<0||t>=.78?0:t<.18?ease(t/.18):1-ease((t-.18)/.6);
    const beat=reduced.matches?0:.05*Math.max(pulse(time%4.5),pulse(time%4.5-.9));
    const breath=reduced.matches?0:.03*Math.sin(time*2*Math.PI/6);
    const radius=Math.min(width,height)*lerp(mobile?.30:.28,.26,end)*(1+beat+breath);
    const sx=width*lerp(mobile?.5:.70,mobile?.5:.62,end);
    const sy=height*lerp(mobile?.26:.50,mobile?.60:.55,end);
    const horseWidth=width*(mobile?1.08:.62),horseHeight=horseWidth*2/3;
    const runX=width*(mobile?.5:.60)+width*lerp(-.08,.08,clamp((progress-.24)/.48));
    const ground=height*(mobile?.60:.70);
    // 1周 = 13.5 単位(通常区間 1、コマ11→0 は 2.5)
    const units=(reduced.matches?0:runTime%1)*13.5,k=Math.min(11,Math.floor(units)),f=k===11?(units-11)/2.5:units-k;
    const wavePos=(time%3.2)/3.2*(Math.PI+.7)-.35;
    const projected=points.map((point,i)=>{
      const e=run?ease(clamp((entry-point.delay)/.65))*(1-ease(clamp((exit-point.delay)/.65))):0;
      // 明るさの波(半径は変えない)
      const wave=reduced.matches?0:Math.max(0,1-Math.abs(point.phi-wavePos)/.175);
      // 差動回転: 赤道 1.0、極 0.55
      const a=angle*(.55+.45*(1-Math.abs(point.y)));
      const rx=point.x*Math.cos(a)+point.z*Math.sin(a),rz=point.z*Math.cos(a)-point.x*Math.sin(a);
      const ry=point.y*Math.cos(tilt)-rz*Math.sin(tilt),depth=point.y*Math.sin(tilt)+rz*Math.cos(tilt);
      let x=sx+rx*radius,y=sy+ry*radius;
      const dx=x-pointer.x,dy=y-pointer.y,dist=Math.hypot(dx,dy);
      const push=!reduced.matches&&dist<90?16*(1-dist/90):0;
      point.pushX+=((dist>0?dx/dist*push:0)-point.pushX)*.08;
      point.pushY+=((dist>0?dy/dist*push:0)-point.pushY)*.08;
      if(!Number.isFinite(point.pushX)) point.pushX=0;
      if(!Number.isFinite(point.pushY)) point.pushY=0;
      x+=point.pushX*(1-e);y+=point.pushY*(1-e);
      if(run) {
        const slot=reduced.matches?i:slots[i];
        const hx=horseCoord(slot,k,f,0),hy=horseCoord(slot,k,f,1);
        const targetX=runX+(hx-.5)*horseWidth,targetY=ground+(hy-1)*horseHeight;
        const follow=!transitioning&&!reduced.matches&&Number.isFinite(point.horseX)?.45:1;
        const oldHorseX=point.horseX??targetX,oldHorseY=point.horseY??targetY;
        point.horseX=oldHorseX+(targetX-oldHorseX)*follow;
        point.horseY=oldHorseY+(targetY-oldHorseY)*follow;
        x=lerp(x,point.horseX,e);y=lerp(y,point.horseY,e);
      }
      const oldX=point.posX,oldY=point.posY;
      if(!transitioning&&e===0&&!reduced.matches&&Number.isFinite(oldX)) {x=lerp(oldX,x,.45);y=lerp(oldY,y,.45);}
      point.posX=x;point.posY=y;
      const twinkleSlot=(i+point.twinkleOffset)%points.length;
      const twinkle=!reduced.matches&&twinkleSlot<Math.floor(points.length*.03)?Math.sin(Math.PI*(time% .8)/.8):0;
      const front=clamp((depth+1)/2);
      // 走行中、速く移動している粒子(脚)は薄くする(空中を横切る点を目立たせない。点滅はしない)
      const speed=Number.isFinite(oldX)?Math.hypot(x-oldX,y-oldY):0;
      const calm=e>0?1/(1+Math.max(0,speed-2)/5):1;
      const alpha=lerp(Math.min(.85,.15+.7*front+.35*wave+.25*twinkle),.40*calm,e);
      const size=lerp((1.6+1.4*front)*(1+.4*wave),2.2+.4*(1-Math.abs(point.y)),e)*dotScale;
      return {x,y,alpha,size,color:depth<-.3?2:Math.abs(depth)<.3?1:0};
    });
    for(const p of projected) dot(p.x,p.y,p.size,p.alpha,p.color);
    ctx.globalAlpha=1;
    costs.push(performance.now()-began);if(costs.length>30) costs.shift();
    if(costs.length===30&&costs.reduce((a,b)=>a+b,0)/30>22&&dotScale===1) {dotScale=.9;costs.length=0;}
  }
  function resize() {
    width=canvas.clientWidth;height=canvas.clientHeight;
    const dpr=devicePixelRatio||1;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    if(ctx) ctx.setTransform(dpr,0,0,dpr,0,0);
    makeSprites(dpr);
    const count=2400;
    if(points.length!==count) points=Array.from({length:count},(_,i)=>{
      const y=1-2*(i+.5)/count,r=Math.sqrt(1-y*y),theta=i*Math.PI*(3-Math.sqrt(5));
      return {x:Math.cos(theta)*r,y,z:Math.sin(theta)*r,theta,phi:Math.acos(y),delay:Math.random()*.35,pushX:0,pushY:0,twinkleOffset:0};
    });
  }

  function tick(now) {
    raf=0;if(document.hidden||reduced.matches) return;
    const delta=previous?Math.min(now-previous,64):0;previous=now;
    advanceRun(delta,now);
    for(let i=frameJobs.length-1;i>=0;i--) if(--frameJobs[i].frames<=0) frameJobs.splice(i,1)[0].fn();
    elapsed+=delta;
    const oldTwinkle=Math.floor(sphereTime/.8);
    sphereTime+=delta/1000*(1-ease(morph()));
    if(Math.floor(sphereTime/.8)!==oldTwinkle) {
      const offset=Math.floor(Math.random()*points.length);for(const p of points) p.twinkleOffset=offset;
    }
    draw();
    for(const [el,state] of active) {
      state.elapsed+=delta;const t=Math.min(state.elapsed/1200,1);
      el.textContent=format(el,Number(el.dataset.count)*(1-Math.pow(1-t,3)));
      if(t===1) finish(el);
    }
    start();
  }
  function start() {if(!raf&&!document.hidden&&!reduced.matches) raf=requestAnimationFrame(tick);}
  function stop() {cancelAnimationFrame(raf);raf=0;previous=0;}
  function updateScroll() {
    const rect=hero.getBoundingClientRect();
    progress=clamp(scrollY/Math.max(1,document.documentElement.scrollHeight-innerHeight));
    if(run && progress<=.10) {runTime=0;for(let i=0;i<slots.length;i++) slots[i]=i;}
    header.classList.toggle('scrolled',scrollY>=80);
    const hide=!reduced.matches&&rect.bottom<=0&&scrollY>lastY;
    if(header.classList.contains('hidden')!==hide) {
      header.style.willChange='transform';header.classList.toggle('hidden',hide);
      later(()=>header.style.removeProperty('will-change'),350);
    }
    scrollSamples.push({time:performance.now(),distance:Math.abs(scrollY-lastY)});
    lastY=scrollY;
    if(reduced.matches) draw();else start();
  }
  function staticFrame() {
    timers.forEach(clearTimeout);timers.clear();observer.disconnect();plans.clear();
    document.querySelectorAll('.anim,#orb,.schedule>div').forEach(el=>{el.classList.add('in');el.classList.remove('preparing');el.style.removeProperty('will-change');});
    canvas.classList.add('settled');
    counters.forEach(finish);elapsed=0;
    for(const p of points) p.pushX=p.pushY=0;
    draw();
  }
  reduced.addEventListener('change',()=>{
    stop();document.documentElement.classList.toggle('motion',!reduced.matches);
    if(reduced.matches) staticFrame();updateScroll();
  });
  document.addEventListener('visibilitychange',()=>{stop();if(reduced.matches) draw();else start();});
  addEventListener('pointermove',event=>{pointer.x=event.clientX;pointer.y=event.clientY;},{passive:true});
  addEventListener('pointerout',event=>{if(!event.relatedTarget) pointer.x=pointer.y=Infinity;},{passive:true});
  addEventListener('pointercancel',()=>{pointer.x=pointer.y=Infinity;},{passive:true});
  addEventListener('scroll',updateScroll,{passive:true});
  addEventListener('resize',()=>{resize();updateScroll();},{passive:true});
  resize();if(reduced.matches) staticFrame();updateScroll();
})();
