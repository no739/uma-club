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
  let runTime=0,dustBudget=0,dustCursor=0,sphereTime=0,lineQuality=1,qualityStage=0,softSprite,sprites=[],lineTexture,lineContext,linePixels;
  const dust=Array.from({length:48},()=>({life:0,x:0,y:0}));
  const entering=()=>clamp((progress-.10)/.14);
  const leaving=()=>clamp((progress-.72)/.14);
  function morph() {return run?entering()*(1-leaving()):0;}
  function advanceRun(delta,now) {
    while(scrollSamples.length && scrollSamples[0].time<=now-300) scrollSamples.shift();
    const speed=scrollSamples.reduce((sum,s)=>sum+s.distance,0)/.3;
    if(!run || progress<=.184 || progress>=.86) return;
    const step=delta/1050*ease(clamp((entering()-.6)/.4));
    const cycles=Math.floor(runTime+step)-Math.floor(runTime);
    for(let c=0;c<cycles;c++) for(let i=0;i<slots.length;i++) slots[i]=run.perm[slots[i]];
    runTime+=step;dustBudget=Math.min(4,dustBudget+step*24);
  }
  // At the seam remap the adjacent control points as well as the linear 11→0 pair.
  function sample(slot,frame,axis) {
    if(frame<0) {frame+=12;slot=run.inverse[slot];}
    if(frame>=12) {frame-=12;slot=run.perm[slot];}
    return run.coords[(frame*2400+slot)*2+axis]/65535;
  }
  function catmullRom(a,b,c,d,t) {
    return b+.5*t*(c-a+t*(2*a-5*b+4*c-d+t*(3*(b-c)+d-a)));
  }
  function horseCoord(slot,k,f,axis) {
    const b=sample(slot,k,axis),c=sample(slot,k+1,axis);
    return k===11?lerp(b,c,f):catmullRom(sample(slot,k-1,axis),b,c,sample(slot,k+2,axis),f);
  }
  function makeSprites(dpr) {
    softSprite=document.createElement('canvas');softSprite.width=softSprite.height=Math.ceil(7*dpr);
    const soft=softSprite.getContext('2d'),sr=softSprite.width/2;
    const wash=soft.createRadialGradient(sr,sr,0,sr,sr,sr);
    wash.addColorStop(0,'rgba(9,111,200,1)');wash.addColorStop(1,'rgba(9,111,200,0)');
    soft.fillStyle=wash;soft.beginPath();soft.arc(sr,sr,sr,0,Math.PI*2);soft.fill();
    sprites=['9,111,200','120,190,255','3,60,120','107,111,115'].map(rgb=>
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
    const end=ease(exit),angle=reduced.matches?0:sphereTime*2*Math.PI/28;
    const time=reduced.matches?0:sphereTime,tilt=reduced.matches?0:Math.sin(time*2*Math.PI/9)*Math.PI/10;
    const radius=Math.min(width,height)*lerp(mobile?.30:.28,.26,end);
    const sx=width*lerp(mobile?.5:.70,mobile?.5:.62,end);
    const sy=height*lerp(mobile?.26:.50,mobile?.60:.55,end);
    const horseWidth=width*(mobile?1.08:.62),horseHeight=horseWidth*2/3;
    const runX=width*(mobile?.5:.60)+width*lerp(-.08,.08,clamp((progress-.24)/.48));
    const ground=height*(mobile?.60:.70);
    const units=(reduced.matches?0:runTime%1)*13.5,k=Math.min(11,Math.floor(units)),f=k===11?(units-11)/2.5:units-k;
    const pulse=t=>t<0||t>=.78?0:t<.18?ease(t/.18):1-ease((t-.18)/.6);
    const beat=reduced.matches?0:.09*Math.max(pulse(time%4.5),pulse(time%4.5-.9));
    const projected=points.map((point,i)=>{
      const e=run?ease(clamp((entry-point.delay)/.65))*(1-ease(clamp((exit-point.delay)/.65))):0;
      const {theta,phi}=point;
      const nt=time*1.3;
      const noise=(Math.sin(2*theta+.7*nt)*Math.cos(3*phi-.5*nt)+.5*Math.sin(5*theta-1.1*nt+phi)+.25*Math.sin(9*phi+1.9*nt))/1.75;
      const wave=reduced.matches?0:Math.max(0,1-Math.abs(phi-(time%3.2)/3.2*(Math.PI+.7)+.35)/.175);
      const r=radius*(1+.16*noise+.07*wave)*(1+beat);
      const rx=point.x*Math.cos(angle)+point.z*Math.sin(angle),rz=point.z*Math.cos(angle)-point.x*Math.sin(angle);
      const ry=point.y*Math.cos(tilt)-rz*Math.sin(tilt),depth=point.y*Math.sin(tilt)+rz*Math.cos(tilt);
      const baseX=sx+rx*r,baseY=sy+ry*r;
      const flight=!reduced.matches&&point.flightEnd>time?28*Math.sin(Math.PI*clamp((time-point.flightStart)/(point.flightEnd-point.flightStart)))*(1-e):0;
      let x=baseX+rx*flight,y=baseY+ry*flight;
      const dx=x-pointer.x,dy=y-pointer.y,dist=Math.hypot(dx,dy);
      const push=!reduced.matches&&dist<90?16*(1-dist/90):0;
      point.pushX+=((dist>0?dx/dist*push:0)-point.pushX)*.08;
      point.pushY+=((dist>0?dy/dist*push:0)-point.pushY)*.08;
      // Infinity denotes an absent pointer; never multiply Infinity by zero.
      if(!Number.isFinite(point.pushX)) point.pushX=0;
      if(!Number.isFinite(point.pushY)) point.pushY=0;
      x+=point.pushX*(1-e);y+=point.pushY*(1-e);
      let hoof=false,teleport=false,visibility=1,travel=0;
      if(run) {
        const slot=reduced.matches?i:slots[i];
        const bx=sample(slot,k,0),by=sample(slot,k,1),cx=sample(slot,k+1,0),cy=sample(slot,k+1,1);
        travel=Math.hypot((cx-bx)*300,(cy-by)*200);teleport=!reduced.matches&&travel>9;
        const side=f<.5?0:1,key=`${Math.floor(runTime)}:${k}:${side}`;
        let hx=horseCoord(slot,k,f,0),hy=horseCoord(slot,k,f,1);
        if(teleport) {
          hx=side?cx:bx;hy=side?cy:by;visibility=Math.abs(2*f-1);
          // Discrete refresh rates can skip f=.5: hide the actual relocation frame.
          if(point.travelKey!==key) visibility=0;
        }
        const targetX=runX+(hx-.5)*horseWidth,targetY=ground+(hy-1)*horseHeight;
        const follow=!transitioning&&!reduced.matches&&Number.isFinite(point.horseX)?.45:1;
        const oldHorseX=point.horseX??targetX,oldHorseY=point.horseY??targetY;
        const mx=(targetX-oldHorseX)*follow,my=(targetY-oldHorseY)*follow;
        const bound=reduced.matches||transitioning?1:Math.min(1,(9*horseWidth/300)/(Math.hypot(mx,my)||1));
        point.horseX=teleport?targetX:oldHorseX+mx*bound;
        point.horseY=teleport?targetY:oldHorseY+my*bound;
        // Also hide a relocation when an interval was skipped by a slow frame.
        if(!reduced.matches&&e===1&&Number.isFinite(point.posX)&&Math.hypot(point.horseX-point.posX,point.horseY-point.posY)>9*horseWidth/300) visibility=0;
        point.travelKey=key;
        x=lerp(x,point.horseX,e);y=lerp(y,point.horseY,e);hoof=hy>.90;
      }
      const oldX=point.posX,oldY=point.posY;
      if(!transitioning&&e===0&&!reduced.matches&&Number.isFinite(oldX)) {x=lerp(oldX,x,.45);y=lerp(oldY,y,.45);}
      point.posX=x;point.posY=y;
      const twinkleSlot=(i+point.twinkleOffset)%points.length;
      const twinkle=!reduced.matches&&twinkleSlot<Math.floor(points.length*.03)?Math.sin(Math.PI*(time% .8)/.8):0;
      const front=clamp((depth+1)/2),alpha=lerp(Math.min(.85,.15+.7*front+.35*wave+.25*twinkle),.40,e)*lerp(1,visibility,e);
      const size=lerp((1.6+1.4*front)*(1+.4*wave),2.2+.4*(1-Math.abs(point.y)),e);
      point.alpha=alpha;
      return {x,y,z:depth,e,alpha,size,hoof,teleport,travel,baseX,baseY,flight,dx:Number.isFinite(oldX)?x-oldX:0,dy:Number.isFinite(oldY)?y-oldY:0,color:depth<-.3?2:Math.abs(depth)<.3?1:0};
    });
    for(const p of projected) {
      ctx.globalAlpha=.045*clamp((p.e-.8)/.2)*(p.alpha/.40);
      ctx.drawImage(softSprite,p.x-3.5,p.y-3.5,7,7);
    }
    if(!reduced.matches&&lineQuality) for(const p of projected) if(p.flight>0) {
      ctx.globalAlpha=.10*(1-p.e);ctx.strokeStyle='rgb(9,111,200)';ctx.lineWidth=.5;
      ctx.beginPath();ctx.moveTo(p.baseX,p.baseY);ctx.lineTo(p.x,p.y);ctx.stroke();
    }
    // A 20px spatial hash limits neighbour search; one combined neural stroke.
    if(!reduced.matches&&lineQuality&&morph()<1) {
      const grid=new Map(),limit=Math.max(0,Math.floor((mobile?600:900)*lineQuality)-projected.filter(p=>p.flight>0).length);let lines=0;
      ctx.beginPath();ctx.lineWidth=.6;linePixels.data.fill(0);
      for(const p of projected) {
        if(p.z<=.15||p.e>=1) continue;
        const gx=Math.floor(p.x/20),gy=Math.floor(p.y/20);
        for(let a=-1;a<=1&&lines<limit;a++) for(let b=-1;b<=1&&lines<limit;b++) {
          for(const q of grid.get(`${gx+a},${gy+b}`)||[]) {
            const distance=Math.hypot(p.x-q.x,p.y-q.y);
            if(distance<=20&&lines<limit) {
              const alpha=lerp(.22,.08,distance/20)*(1-Math.max(p.e,q.e));
              // An alpha texture gives each subpath its own opacity in one stroke.
              const steps=Math.max(1,Math.ceil(distance*2));
              for(let step=0;step<=steps;step++) {
                const x=Math.round(lerp(p.x,q.x,step/steps)),y=Math.round(lerp(p.y,q.y,step/steps));
                for(let ox=-1;ox<=1;ox++) for(let oy=-1;oy<=1;oy++) {
                  if(x+ox<0||x+ox>=lineTexture.width||y+oy<0||y+oy>=lineTexture.height) continue;
                  const index=((y+oy)*lineTexture.width+x+ox)*4;
                  linePixels.data[index]=9;linePixels.data[index+1]=111;linePixels.data[index+2]=200;
                  linePixels.data[index+3]=Math.max(linePixels.data[index+3],Math.round(alpha*255));
                }
              }
              ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);lines++;
            }
          }
        }
        const key=`${gx},${gy}`;if(!grid.has(key)) grid.set(key,[]);grid.get(key).push(p);
      }
      lineContext.putImageData(linePixels,0,0);
      ctx.globalAlpha=1;ctx.strokeStyle=ctx.createPattern(lineTexture,'no-repeat');ctx.stroke();
    }
    for(const p of projected) dot(p.x,p.y,p.size,p.alpha,p.color);
    for(const p of projected) {
      if(!reduced.matches&&qualityStage<3&&p.e>0&&!p.teleport&&p.travel>=2.5&&p.travel<=9&&p.alpha>0) {
        ctx.globalAlpha=p.alpha*.25*p.e;ctx.strokeStyle='rgb(9,111,200)';ctx.lineWidth=1;
        ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(p.x-p.dx*.5,p.y-p.dy*.5);ctx.stroke();
      }
      if(!reduced.matches&&qualityStage<2&&p.alpha>0&&p.e>.9&&p.hoof&&dustBudget>=1) {
        const d=dust[dustCursor++%dust.length];d.x=p.x;d.y=p.y;d.life=.5;dustBudget--;
      }
    }
    if(!reduced.matches&&qualityStage<2) for(const d of dust) if(d.life>0) dot(d.x,d.y,2,.18*d.life/.5*(1-end),3);
    ctx.globalAlpha=1;
    costs.push(performance.now()-began);if(costs.length>30) costs.shift();
    if(costs.length===30&&costs.reduce((a,b)=>a+b,0)/30>22&&qualityStage<3) {
      qualityStage++;lineQuality=0;costs.length=0;
    }
  }
  function resize() {
    width=canvas.clientWidth;height=canvas.clientHeight;
    const dpr=devicePixelRatio||1;canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);
    if(ctx) ctx.setTransform(dpr,0,0,dpr,0,0);
    makeSprites(dpr);
    lineTexture=document.createElement('canvas');lineTexture.width=Math.ceil(width);lineTexture.height=Math.ceil(height);
    lineContext=lineTexture.getContext('2d');linePixels=lineContext.createImageData(lineTexture.width,lineTexture.height);
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
    for(const d of dust) if(d.life>0) {d.life=Math.max(0,d.life-delta/1000);d.x-=delta*.04;d.y-=delta*.006;}
    for(let i=frameJobs.length-1;i>=0;i--) if(--frameJobs[i].frames<=0) frameJobs.splice(i,1)[0].fn();
    elapsed+=delta;
    const oldTwinkle=Math.floor(sphereTime/.8);
    sphereTime+=delta/1000*(1-ease(morph()));
    if(Math.floor(sphereTime/.8)!==oldTwinkle) {
      const offset=Math.floor(Math.random()*points.length);for(const p of points) p.twinkleOffset=offset;
    }
    if(!reduced.matches) {
      const flying=points.filter(p=>p.flightEnd>sphereTime);
      const available=points.filter(p=>!(p.flightEnd>sphereTime));
      for(let n=flying.length;n<Math.floor(points.length*.04);n++) {
        const j=Math.floor(Math.random()*available.length),p=available.splice(j,1)[0];
        p.flightStart=sphereTime;p.flightEnd=sphereTime+1.5+Math.random();
      }
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
    if(run && progress<=.10) {runTime=0;dustBudget=0;for(let i=0;i<slots.length;i++) slots[i]=i;}
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
