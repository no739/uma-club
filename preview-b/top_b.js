(() => {
  'use strict';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const header = document.querySelector('.header');
  const hero = document.querySelector('[data-anim="hero"]');
  const canvas = document.getElementById('orb');
  const ctx = canvas.getContext('2d');
  const counters = [...document.querySelectorAll('[data-count]')];
  const active = new Map(), completed = new Set(), timers = new Set(), plans = new Map();
  let width=0, height=0, points=[], visible=false, raf=0, previous=0, elapsed=0, lastY=scrollY;
  const format = (el,n) => n.toLocaleString('en-US',{minimumFractionDigits:(el.dataset.count.split('.')[1]||'').length,maximumFractionDigits:(el.dataset.count.split('.')[1]||'').length,useGrouping:el.dataset.format==='comma'});
  const finish = el => {el.textContent=format(el,Number(el.dataset.count));completed.add(el);active.delete(el);};
  const later = (fn,ms) => { const id=setTimeout(()=>{timers.delete(id);fn();},ms);timers.add(id); };
  function prepare(el,x=0,y=28,duration=850) {
    el.classList.add('anim');el.style.setProperty('--x',`${x}px`);el.style.setProperty('--y',`${y}px`);el.style.setProperty('--duration',`${duration}ms`);
    return {el,duration};
  }
  function enter(item,delay=0) {
    later(()=>{
      if(reduced.matches) {item.el.classList.add('in');return;}
      item.el.style.willChange='transform, opacity';
      requestAnimationFrame(()=>requestAnimationFrame(()=>{
        item.el.classList.add('in');
        later(()=>item.el.style.removeProperty('will-change'),item.duration+50);
      }));
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
        later(()=>{el.classList.add('preparing');requestAnimationFrame(()=>requestAnimationFrame(()=>el.classList.add('in')));later(()=>el.classList.remove('preparing'),750);},i*200);
        enter(time,i*200+150);enter(description,i*200+250);
      });
    });
    if(kind==='races') block.querySelectorAll('.race-card').forEach((el,i)=>{
      const item=prepare(el,48,0),arrow=prepare(el.querySelector('.arrow'),0,0,300);
      watch(el,()=>{enter(item,i*150);enter(arrow,i*150+900);});
    });
  });
  function draw() {
    if (!ctx) return;
    ctx.clearRect(0,0,width,height);
    const angle = elapsed / 40000 * Math.PI * 2;
    const tilt = 12 * Math.PI / 180;
    const radius = Math.min(width,height) * (innerWidth<=640 ? .30 : .24);
    const projected = points.map(([x,y,z]) => {
      const rx=x*Math.cos(angle)+z*Math.sin(angle), rz=z*Math.cos(angle)-x*Math.sin(angle);
      const ry=y*Math.cos(tilt)-rz*Math.sin(tilt), depth=y*Math.sin(tilt)+rz*Math.cos(tilt);
      return [rx,ry,depth];
    }).sort((a,b)=>a[2]-b[2]);
    for (const [x,y,z] of projected) {
      const depth=(z+1)/2, perspective=1, edge=1-Math.abs(z);
      const base=[9,111,200], shade=z<0?[3,60,120]:base;
      const rgb=shade.map((v,i)=>Math.round(v+([120,190,255][i]-v)*edge));
      ctx.fillStyle=`rgba(${rgb.join(',')},${.12+.78*depth})`;
      ctx.beginPath(); ctx.arc(width*(innerWidth<=640?.5:.70)+x*radius*perspective,height*(innerWidth<=640?.26:.5)+y*radius*perspective,(.6+1.2*depth)*perspective,0,Math.PI*2); ctx.fill();
    }
  }
  function resize() {
    width=canvas.clientWidth; height=canvas.clientHeight;
    const dpr=devicePixelRatio || 1; canvas.width=Math.round(width*dpr); canvas.height=Math.round(height*dpr);
    if(ctx) ctx.setTransform(dpr,0,0,dpr,0,0);
    const count=innerWidth<=640?1200:2400;
    points=Array.from({length:count},(_,i)=>{const y=1-2*(i+.5)/count,r=Math.sqrt(1-y*y),a=i*Math.PI*(3-Math.sqrt(5));return [Math.cos(a)*r,y,Math.sin(a)*r];});
    draw();
  }

  function tick(now) {
    raf=0;if(document.hidden||reduced.matches) return;
    const delta=previous?Math.min(now-previous,64):0;previous=now;
    if(visible) {elapsed+=delta;draw();}
    for(const [el,state] of active) {
      state.elapsed+=delta;const t=Math.min(state.elapsed/1200,1);
      el.textContent=format(el,Number(el.dataset.count)*(1-Math.pow(1-t,3)));
      if(t===1) finish(el);
    }
    start();
  }
  function start() {if(!raf&&!document.hidden&&!reduced.matches&&(visible||active.size)) raf=requestAnimationFrame(tick);}
  function stop() {cancelAnimationFrame(raf);raf=0;previous=0;}
  function updateScroll() {
    const rect=hero.getBoundingClientRect();visible=rect.bottom>0&&rect.top<innerHeight;
    header.classList.toggle('scrolled',scrollY>=80);
    const hide=!reduced.matches&&rect.bottom<=0&&scrollY>lastY;
    if(header.classList.contains('hidden')!==hide) {
      header.style.willChange='transform';header.classList.toggle('hidden',hide);
      later(()=>header.style.removeProperty('will-change'),350);
    }
    lastY=scrollY;
    if(visible&&!reduced.matches) canvas.style.setProperty('--parallax',`${scrollY*.25}px`);
    if(!visible&&!active.size) stop();else start();
  }
  function staticFrame() {
    timers.forEach(clearTimeout);timers.clear();observer.disconnect();plans.clear();
    document.querySelectorAll('.anim,#orb,.schedule>div').forEach(el=>{el.classList.add('in');el.classList.remove('preparing');el.style.removeProperty('will-change');});
    canvas.classList.add('settled');canvas.style.setProperty('--parallax','0px');
    counters.forEach(finish);elapsed=0;draw();
  }
  reduced.addEventListener('change',()=>{
    stop();document.documentElement.classList.toggle('motion',!reduced.matches);
    if(reduced.matches) staticFrame();updateScroll();
  });
  document.addEventListener('visibilitychange',()=>{stop();start();});
  addEventListener('scroll',updateScroll,{passive:true});
  addEventListener('resize',()=>{resize();updateScroll();},{passive:true});
  resize();if(reduced.matches) staticFrame();updateScroll();
})();
