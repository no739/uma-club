(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const header = document.querySelector('.header');
  const hero = document.querySelector('[data-anim="hero"]');
  const canvas = document.getElementById('orb');
  const ctx = canvas.getContext('2d');
  const counters = [...document.querySelectorAll('[data-count]')];
  const active = new Map(), completed = new Set(), timers = new Set(), plans = new Map();
  let width=0, height=0, points=[],  raf=0, previous=0, elapsed=0, lastY=scrollY, progress=0, rotation=0; 
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
  const horse = window.HORSE_POINTS;
  // Decode once; invalid data leaves the B3 E-horse animation available.
  function decodeRun(data) {
    try {
      if(!data || data.w!==300 || data.h!==200 || data.n!==2400 || data.frames!==12 ||
        !Array.isArray(data.perm) || data.perm.length!==2400 ||
        data.perm.some(i=>!Number.isInteger(i)||i<0||i>=2400) || new Set(data.perm).size!==2400) return null;
      const bytes=Uint8Array.from(atob(data.b64),c=>c.charCodeAt(0));
      if(bytes.length!==12*2400*2*2) return null;
      const coords=new Uint16Array(bytes.buffer);
      if(new Uint8Array(new Uint16Array([1]).buffer)[0]!==1) {
        const view=new DataView(bytes.buffer);
        for(let i=0;i<coords.length;i++) coords[i]=view.getUint16(i*2,true);
      }
      return {...data,coords};
    } catch { return null; }
  }
  const run=decodeRun(window.HORSE_RUN);
  const slots=Uint16Array.from({length:2400},(_,i)=>i);
  let runTime=0, dustBudget=0, dustCursor=0;
  const dust=Array.from({length:120},()=>({life:0,x:0,y:0}));
  const scrollSamples=[];
  function advanceRun(delta,now) {
    while(scrollSamples.length && scrollSamples[0].time<=now-300) scrollSamples.shift();
    const speed=scrollSamples.reduce((sum,s)=>sum+s.distance,0)/.3;
    if(!run || progress<.30 || progress>=.80) return;
    const step=delta/900*(1+1.2*Math.min(speed/2000,1));
    const cycles=Math.floor(runTime+step)-Math.floor(runTime);
    for(let c=0;c<cycles;c++) for(let i=0;i<slots.length;i++) slots[i]=run.perm[slots[i]];
    runTime+=step;dustBudget=Math.min(4,dustBudget+step*40);
  }
  const clamp = n => Math.max(0,Math.min(1,n));
  const lerp = (a,b,t) => a+(b-a)*t;
  const ease = t => t<.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
  const pointer={x:0,y:0,tx:0,ty:0};
  function morph() {
    if(!horse || !Array.isArray(horse.pts)) return 0;
    if(reduced.matches && !run) return progress>=.22&&progress<.78?1:0;
    if(progress<.10) return 0;
    if(progress<.22) return ease(clamp((progress-.10)/.12));
    const exit=run?.80:.78;
    if(progress<=exit) return 1;
    return 1-ease(clamp((progress-exit)/(.90-exit)));
  }
  function draw() {
    if (!ctx || document.hidden) return;
    ctx.clearRect(0,0,width,height);
    const exit=run?.80:.78;
    const mobile=innerWidth<640, t=morph(), returning=progress>exit;
    const end=ease(clamp((progress-exit)/(.90-exit)));
    const angle=reduced.matches?0:rotation, tilt=12*Math.PI/180;
    const time=reduced.matches?0:elapsed/1000;
    const radius=Math.min(width,height)*lerp(mobile?.30:.24,.22,end)*(1+.018*Math.sin(time*2));
    const sx=width*(mobile?.5:.70), sy=height*lerp(mobile?.26:.5,.70,end);
    const horseWidth=width*(mobile?1.08:.62), horseHeight=horseWidth*(horse?horse.h/horse.w:2682/5000);
    const stride=Math.sin(time*2*Math.PI/.9), lean=stride*1.5*Math.PI/180;
    const travel=lerp(-.06,.06,clamp((progress-.22)/.56))*width;
    const hx=width*(mobile?.5:.60)+travel+(reduced.matches?0:pointer.x);
    const hy=height*(mobile?.42:.52)+stride*height*.015+(reduced.matches?0:pointer.y);
    const blend=run?clamp((progress-.22)/.08):0;
    const frame=(reduced.matches?0:runTime%1)*12, k=Math.floor(frame), fraction=frame-k;
    const runHeight=horseWidth*2/3;
    const runX=width*(mobile?.5:.60)+width*lerp(-.08,.08,clamp((progress-.30)/.50))+
      (reduced.matches?0:width*.012*Math.sin(frame/12*Math.PI*2))+(reduced.matches?0:pointer.x);
    // Both frames share a width and bottom (ground), with no extra vertical bob.
    const ground=height*(mobile?.42:.52)+horseHeight/2+(reduced.matches?0:pointer.y);
    const projected=points.map((point,i)=>{
      const {x,y,z,hx:horseX,hy:horseY,hz,size,delay,phase}=point;
      const rx=x*Math.cos(angle)+z*Math.sin(angle), rz=z*Math.cos(angle)-x*Math.sin(angle);
      const ry=y*Math.cos(tilt)-rz*Math.sin(tilt), depth=y*Math.sin(tilt)+rz*Math.cos(tilt);
      const e=reduced.matches?t:(returning?1-clamp(((1-t)-delay)/.65):clamp((t-delay)/.65));
      const px=(horseX-.5)*horseWidth, py=(horseY-.5)*horseHeight;
      const jitter=reduced.matches?0:.8;
      let targetX=hx+px*Math.cos(lean)-py*Math.sin(lean)+Math.sin(time*9+phase)*jitter;
      let targetY=hy+px*Math.sin(lean)+py*Math.cos(lean)+Math.cos(time*11+phase)*jitter;
      let dx=0,dy=0,hoof=false;
      if(run && progress>=.22) {
        const mix=ease(clamp((blend-delay*(.3/.35))/.7));
        const slot=reduced.matches||progress<.30?i:slots[i];
        const a=((progress<.30?0:k)*2400+slot)*2;
        const next=k===11?run.perm[slot]:slot;
        const b=(((k+1)%12)*2400+next)*2;
        const f=progress<.30?0:fraction;
        const x=run.coords[a]/65535,y=run.coords[a+1]/65535;
        dx=(run.coords[b]/65535-x)*horseWidth;
        dy=(run.coords[b+1]/65535-y)*runHeight;
        // Fade the original pose's lean/bob to the aligned E frame, preserving p<.22 exactly.
        const alignedX=width*(mobile?.5:.60)-width*.06+px+(reduced.matches?0:pointer.x);
        const alignedY=ground+(horseY-1)*horseHeight;
        targetX=lerp(lerp(targetX,alignedX,blend),runX+(x-.5)*horseWidth+dx*f,mix);
        targetY=lerp(lerp(targetY,alignedY,blend),ground+(y-1)*runHeight+dy*f,mix);
        hoof=y>=.92;
      }
      return {x:lerp(sx+rx*radius,targetX,e),y:lerp(sy+ry*radius,targetY,e),
        z:lerp(depth,hz,e),e,size,depth,dx,dy,hoof};
    }).sort((a,b)=>a.z-b.z);
    const running=run && progress>=.30 && progress<.80 && !reduced.matches;
    ctx.beginPath();ctx.lineWidth=1;
    for(const p of projected) {
      const depth=clamp((p.depth+1)/2), edge=1-Math.abs(p.depth);
      const base=[9,111,200], light=[120,190,255], dark=[3,60,120];
      const shade=p.depth<0?dark:base;
      const horseColor=p.size<.5?light.map((v,i)=>lerp(v,base[i],p.size*2)):base.map((v,i)=>lerp(v,dark[i],(p.size-.5)*2));
      const rgb=shade.map((v,i)=>Math.round(lerp(lerp(v,light[i],edge),horseColor[i],p.e)));
      const alpha=Math.min(lerp(.55,.40,p.e),lerp(.12+.78*depth,.35+.55*clamp((p.z+.06)/.12),p.e));
      ctx.fillStyle=`rgba(${rgb.join(',')},${alpha})`;
      const radius=Math.min(lerp(2.8,2.4,p.e),lerp(.6+1.2*depth,1.2+p.size*1.6,p.e));
      ctx.fillRect(p.x-radius,p.y-radius,radius*2,radius*2);
      if(running && Math.hypot(p.dx,p.dy)>=1.5) {
        ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.dx*.6,p.y-p.dy*.6);
      }
      if(running && p.hoof && dustBudget>=1) {
        const d=dust[dustCursor++%dust.length];d.x=p.x;d.y=p.y;d.life=.5;dustBudget--;
      }
    }
    // At full horse morph every point is capped at .40, so trails are exactly 35%.
    ctx.strokeStyle='rgba(9,111,200,.14)';ctx.stroke();
    if(!reduced.matches) for(const d of dust) if(d.life>0) {
      ctx.fillStyle=`rgba(107,111,115,${.25*d.life/.5*(1-end)})`;
      ctx.fillRect(d.x,d.y,1.5,1.5);
    }
  }
  function resize() {
    width=canvas.clientWidth; height=canvas.clientHeight;
    const dpr=devicePixelRatio || 1; canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr);
    if(ctx) ctx.setTransform(dpr,0,0,dpr,0,0);
    const count=innerWidth<640?1400:2400;
    if(points.length!==count) points=Array.from({length:count},(_,i)=>{
      const y=1-2*(i+.5)/count,r=Math.sqrt(1-y*y),a=i*Math.PI*(3-Math.sqrt(5));
      const h=horse&&horse.pts&&horse.pts[i]||[.5,.5,0];
      return {x:Math.cos(a)*r,y,z:Math.sin(a)*r,hx:h[0],hy:h[1],hz:(Math.random()-.5)*.12,size:h[2],delay:Math.random()*.35,phase:Math.random()*Math.PI*2};
    });
  }

  function tick(now) {
    raf=0;if(document.hidden||reduced.matches) return;
    const delta=previous?Math.min(now-previous,64):0;previous=now;
    advanceRun(delta,now);
    for(const d of dust) if(d.life>0) {d.life=Math.max(0,d.life-delta/1000);d.x-=delta*.04;d.y-=delta*.006;}
    for(let i=frameJobs.length-1;i>=0;i--) if(--frameJobs[i].frames<=0) frameJobs.splice(i,1)[0].fn();
    elapsed+=delta;rotation+=delta/40000*Math.PI*2*(1-morph())*(progress>=.9?.5:1);
    pointer.x+=(pointer.tx-pointer.x)*.05;pointer.y+=(pointer.ty-pointer.y)*.05;draw();
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
    if(run && progress<.30) {runTime=0;dustBudget=0;for(let i=0;i<slots.length;i++) slots[i]=i;}
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
    counters.forEach(finish);elapsed=0;draw();
  }
  reduced.addEventListener('change',()=>{
    stop();document.documentElement.classList.toggle('motion',!reduced.matches);
    if(reduced.matches) staticFrame();updateScroll();
  });
  document.addEventListener('visibilitychange',()=>{stop();if(reduced.matches) draw();else start();});
  addEventListener('pointermove',event=>{pointer.tx=(clamp(event.clientX/width)*2-1)*10;pointer.ty=(clamp(event.clientY/height)*2-1)*10;},{passive:true});
  addEventListener('scroll',updateScroll,{passive:true});
  addEventListener('resize',()=>{resize();updateScroll();},{passive:true});
  resize();if(reduced.matches) staticFrame();updateScroll();
})();
