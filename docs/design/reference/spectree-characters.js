(async()=>{
 const root=document.getElementById('spectree-characters'),$=s=>root.querySelector(s);
 const canvas=$('[data-canvas]'),world=$('.ap-world'),audio=$('[data-audio]');
 const play=$('[data-play]'),playText=play.querySelector('span'),motion=$('[data-motion]');
 const clips=/*__CHARACTER_AUDIO__*/[];
 const cueSheets=[
  [[0,'Olá, Gilson. Eu sou o Invoker.'],[6,'Para planejar sua próxima ideia, vou chamar o Architect.']],
  [[0,'Sou o Architect. Vamos transformar essa ideia em uma estrutura clara.']],
  [[0,'E juntos, vamos dar forma ao que você imagina.']]
 ];
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let playing=false,exploring=false,started=false,finished=false,joined=false,turn=0,token=0,gap=0,captionTurn=0,lastCue=-1;
 let context,analyser,source,wave,bins,energy=0,bass=0,treble=0,rms=0;
 let renderer,scene,camera,raf=0,visible=true,dirty=true,disposed=false,failed=false,last=0,time=7,join=0;
 let primary,secondary,draw,resizeObserver,intersection,removal,tweak;
 const resources=new Set(),keep=v=>(resources.add(v),v),targets=[];
 const look={intensity:1,detail:1,size:.72};
 const agents={invoker:{name:'Invoker',color:0xffffff,label:'Branco'},architect:{name:'Architect',color:0x2470ff,label:'Azul · arquitetura'},developer:{name:'Developer',color:0xff253a,label:'Vermelho · implementação'},quality:{name:'Quality',color:0xffc600,label:'Amarelo · qualidade'}};
 let selected='invoker';
 const pointer={x:0,y:0,active:false},orientation={x:0,y:0};
 let faceTime=0;
 const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
 function save(){window.openai?.setWidgetState?.({modelContent:{study:'Spectree Presence — personagens',palette:'Invoker branco; Architect azul; Developer vermelho; Quality amarelo',selected,refinement:'Menor, mais nítido e expressivo; olhar acompanha o cursor'},privateContent:{intensity:look.intensity,size:look.size,transcript:!$('.ap-transcript').hidden}})?.catch(()=>{});}
 function restore(value){const p=value?.privateContent;if(!p)return;if(Number.isFinite(p.intensity))look.intensity=clamp(p.intensity,.6,1.5);if(Number.isFinite(p.size))look.size=clamp(p.size,.72,1);$('.ap-transcript').hidden=!p.transcript;$('[data-transcript]').setAttribute('aria-expanded',String(!!p.transcript));dirty=true;}
 restore(window.openai?.widgetState);const globals=e=>restore(e.detail?.globals?.widgetState);window.addEventListener('openai:set_globals',globals);
 $('[data-transcript]').onclick=()=>{$('.ap-transcript').hidden=!$('.ap-transcript').hidden;$('[data-transcript]').setAttribute('aria-expanded',String(!$('.ap-transcript').hidden));save();};
 function labels(){
  playText.textContent=playing?'Pausar voz':finished?'Ouvir novamente':started?'Continuar':'Ouvir Invoker';play.setAttribute('aria-pressed',String(playing));
  motion.querySelector('span').textContent=exploring?'Pausar movimento':'Explorar movimento';motion.setAttribute('aria-pressed',String(exploring));
  $('[data-state]').textContent=playing?(turn===1?'ARCHITECT · FALANDO':'INVOKER · FALANDO'):exploring?(reduced.matches?'MOVIMENTO REDUZIDO':'PRESENÇA EM MOVIMENTO'):selected==='invoker'?'INVOKER · BRANCO':('INVOKER + '+agents[selected].name.toUpperCase());
  root.dataset.speaker=playing?(turn===1?'architect':'invoker'):'none';root.dataset.playing=String(playing);root.dataset.motion=String(exploring);root.dataset.agent=selected;
  $('[data-label-main]').style.color=playing&&turn===1?'#a49ab8':'#eee5fa';$('[data-label-specialist]').style.color=playing&&turn===1?'#ffdeb8':'#a49ab8';
 }
 function pause(){playing=false;token++;clearTimeout(gap);audio.pause();energy=bass=treble=rms=0;dirty=true;labels();}
 function restart(){pause();audio.removeAttribute('src');audio.load();turn=0;started=false;finished=false;joined=false;join=0;$('[data-progress]').style.width='0%';}
 function selectAgent(key){selected=key;joined=key!=='invoker';if(secondary){secondary.uniforms.tint.value.setHex(agents[key].color);secondary.halo.material.color.setHex(agents[key].color);}root.querySelectorAll('[data-agent]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.agent===key)));dirty=true;labels();}
 root.querySelectorAll('button[data-agent]').forEach(button=>{button.onclick=()=>{restart();selectAgent(button.dataset.agent);$('[data-title]').textContent=agents[selected].name+'.';$('[data-caption]').textContent=selected==='invoker'?'Uma presença para a nossa conversa.':agents[selected].label+' · prévia visual';save();};});
 async function initAudio(){if(!context){context=new(window.AudioContext||window.webkitAudioContext)();analyser=context.createAnalyser();analyser.fftSize=1024;analyser.smoothingTimeConstant=.3;wave=new Float32Array(analyser.fftSize);bins=new Uint8Array(analyser.frequencyBinCount);source=context.createMediaElementSource(audio);source.connect(analyser);analyser.connect(context.destination);}await context.resume();}
 async function speak(index,id){
  if(id!==token||!playing||disposed)return;turn=index;if(index===1)selectAgent('architect');
  captionTurn=index;lastCue=-1;$('[data-title]').textContent=index===1?'Architect.':'Invoker.';$('[data-caption]').textContent=cueSheets[index][0][1];
  audio.src=clips[index];labels();dirty=true;
  try{await audio.play();}catch(e){if(id!==token)return;pause();$('[data-note]').textContent='Áudio indisponível. A transcrição está disponível.';}
 }
 play.onclick=async()=>{
  if(playing){pause();return;}if(finished)restart();if(!started)selectAgent('invoker');const id=++token;
  try{await initAudio();if(id!==token||disposed)return;playing=started=true;exploring=false;
   if(audio.src&&audio.currentTime>0&&!audio.ended){await audio.play();labels();}else await speak(turn,id);
   save();dirty=true;
  }catch(e){pause();$('[data-note]').textContent='O navegador não liberou o áudio. Tente novamente.';}
 };
 motion.onclick=()=>{if(playing)pause();exploring=!exploring;labels();dirty=true;};
 audio.addEventListener('ended',()=>{if(!playing)return;if(turn<2){turn++;const id=token;gap=setTimeout(()=>speak(turn,id),550);}else{finished=true;pause();$('[data-title]').textContent='Vamos imaginar o próximo passo.';$('[data-caption]').textContent='Muitas perspectivas. Uma conversa.';$('[data-progress]').style.width='100%';}});
 audio.addEventListener('timeupdate',()=>{if(!started||finished)return;const cues=cueSheets[captionTurn];let next=0;for(let i=1;i<cues.length;i++)if(audio.currentTime>=cues[i][0])next=i;if(next!==lastCue){$('[data-caption]').textContent=cues[next][1];lastCue=next;}});
 function analyse(dt){rms=0;bass=treble=0;if(playing&&!audio.paused&&analyser){analyser.getFloatTimeDomainData(wave);analyser.getByteFrequencyData(bins);for(const x of wave)rms+=x*x;rms=Math.sqrt(rms/wave.length);const band=(a,b)=>{const f=context.sampleRate/analyser.fftSize;let s=0,n=0;for(let i=Math.ceil(a/f);i<=Math.floor(b/f)&&i<bins.length;i++){s+=bins[i]/255;n++;}return n?s/n:0;};bass=band(80,350);treble=band(2000,6500);}
  const goal=clamp((rms-.004)*8);energy+=(goal-energy)*(1-Math.exp(-dt*(goal>energy?27:13)));if(energy<.001)energy=0;
  root.dataset.audioRms=rms.toFixed(4);root.dataset.visualEnergy=energy.toFixed(4);
  if(playing&&Number.isFinite(audio.duration))$('[data-progress]').style.width=((turn+audio.currentTime/audio.duration)/3*100)+'%';
 }
 function unavailable(){failed=true;pause();exploring=false;$('.ap-fallback').hidden=false;motion.disabled=true;labels();root.dataset.engine='unavailable';}
 try{
  const T=await import('https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js');if(disposed)return;
  renderer=new T.WebGLRenderer({canvas,antialias:false,alpha:false,powerPreference:'high-performance'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.NoToneMapping;
  scene=new T.Scene();camera=new T.OrthographicCamera(-4,4,2.55,-2.55,.1,40);camera.position.z=8;
  function presence(hex){
   const group=new T.Group();scene.add(group);
   const uniforms={time:{value:7},power:{value:0},bass:{value:0},treble:{value:0},detail:{value:1},tint:{value:new T.Color(hex)}};
   const vertex=`varying vec3 n;varying vec3 p;uniform float time,power;void main(){p=position;n=normalize(normalMatrix*normal);float w=sin(position.y*4.+time*.48)*sin(position.x*3.-time*.35)*sin(position.z*3.+time*.26);vec3 pos=position*(1.+w*(.008+power*.010));gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.);}`;
   const fragment=`varying vec3 n;varying vec3 p;uniform float time,power;uniform vec3 tint;
   void main(){vec3 N=normalize(n);float facing=max(0.,N.z);float rim=pow(1.-facing,3.2);float angle=atan(p.y,p.x);float arc=.5+.5*sin(angle+time*.24);float arc2=pow(.5+.5*sin(angle*2.-time*.20),6.);float soft=pow(max(0.,dot(N,normalize(vec3(-.55,.7,1.3)))),38.);float sheen=exp(-pow((p.y+.3*p.x-.18*sin(time*.2))/.060,2.))*.007;vec3 c=tint*(.005+.012*(1.-facing)+rim*(.32+arc*.48+arc2*.55)+sheen+power*(rim*.65+.012));c+=vec3(soft*.025);c+=tint*.014*pow(max(0.,-p.y),2.);gl_FragColor=vec4(c,1.);}`;
   const body=new T.Mesh(keep(new T.SphereGeometry(1,112,80)),keep(new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,toneMapped:false})));group.add(body);
   const veils=[];
   for(let layer=0;layer<3;layer++){
    const positions=[],uvs=[],indices=[];const segments=220,cross=18;
    for(let i=0;i<=segments;i++)for(let j=0;j<=cross;j++){
     const u=i/segments*Math.PI*2,v=(j/cross-.5)*2;const r=1.005+.035*v+.019*Math.sin(u*3+layer*1.9);
     positions.push(Math.cos(u)*r,Math.sin(u)*r,.06*Math.sin(u*2+layer));uvs.push(i/segments,j/cross);
     if(i<segments&&j<cross){const k=i*(cross+1)+j;indices.push(k,k+cross+1,k+1,k+1,k+cross+1,k+cross+2);}
    }
    const geo=keep(new T.BufferGeometry());geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geo.setIndex(indices);
    const mat=keep(new T.ShaderMaterial({uniforms:{...uniforms,offset:{value:layer*2.1}},transparent:true,side:T.DoubleSide,blending:T.AdditiveBlending,depthWrite:false,depthTest:true,toneMapped:false,
     vertexShader:'varying vec2 v;uniform float time,offset,power;void main(){v=uv;vec3 p=position;float a=uv.x*6.28318;p*=1.+.015*sin(a*3.+time*.55+offset)+power*.02*sin(a*6.-time*2.);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
     fragmentShader:'varying vec2 v;uniform vec3 tint;uniform float time,power,offset;void main(){float soft=pow(sin(v.y*3.14159),2.2);float glow=.45+.55*sin(v.x*6.28318-time*.25+offset);float edge=exp(-pow((v.y-.72)*26.,2.));float a=soft*(.07+glow*.30+power*.20);gl_FragColor=vec4(tint*(.65+edge*.8+power*.9),a);}'
    }));
    const veil=new T.Mesh(geo,mat);veil.rotation.set([.20,-.34,.15][layer],[.18,.14,-.26][layer],layer*1.3);group.add(veil);veils.push(veil);
   }
   const eyeGroup=new T.Group();eyeGroup.position.set(0,.045,1.02);group.add(eyeGroup);
   const eyeGeometry=keep(new T.CapsuleGeometry(.033,.098,8,18));const eyeMaterial=keep(new T.MeshBasicMaterial({color:0xffffff,toneMapped:false}));
   for(const x of [-.19,.19]){const eye=new T.Mesh(eyeGeometry,eyeMaterial);eye.position.x=x;eyeGroup.add(eye);}
   const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=128;const cx=glowCanvas.getContext('2d');const gradient=cx.createRadialGradient(64,64,37,64,64,64);gradient.addColorStop(0,'rgba(255,255,255,.04)');gradient.addColorStop(.35,'rgba(255,255,255,.09)');gradient.addColorStop(1,'rgba(255,255,255,0)');cx.fillStyle=gradient;cx.fillRect(0,0,128,128);
   const halo=new T.Sprite(keep(new T.SpriteMaterial({map:keep(new T.CanvasTexture(glowCanvas)),color:hex,blending:T.AdditiveBlending,transparent:true,depthWrite:false,depthTest:false,opacity:.16})));halo.scale.set(2.5,2.5,1);halo.position.z=-.5;group.add(halo);
   return{group,uniforms,eyes:eyeGroup,halo,veils,gaze:{x:0,y:0},blinkStart:-1,nextBlink:3.4,expression:0};
  }
  primary=presence(0xffffff);secondary=presence(agents[selected].color);secondary.group.visible=false;
  const backdrop=new T.Mesh(keep(new T.PlaneGeometry(30,20)),keep(new T.ShaderMaterial({depthWrite:false,uniforms:{power:{value:0}},vertexShader:'varying vec2 p;void main(){p=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 p;uniform float power;void main(){vec2 q=p-vec2(0.,.4);float a=exp(-dot(q,q)*.8);vec3 c=vec3(.001,.0012,.0016)+vec3(.002,.0024,.0033)*a;gl_FragColor=vec4(c,1.);}',toneMapped:false})));backdrop.position.z=-4;scene.add(backdrop);
  const targetOptions={type:T.HalfFloatType,minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:true};
  const base=new T.WebGLRenderTarget(1,1,targetOptions),a=new T.WebGLRenderTarget(1,1,targetOptions),b=new T.WebGLRenderTarget(1,1,targetOptions);base.samples=2;targets.push(base,a,b);
  const post=new T.Scene(),ortho=new T.OrthographicCamera(-1,1,1,-1,0,1),quad=new T.Mesh(keep(new T.PlaneGeometry(2,2)));post.add(quad);
  const vs='varying vec2 uvp;void main(){uvp=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const blur=keep(new T.ShaderMaterial({uniforms:{tex:{value:null},stepUV:{value:new T.Vector2()},threshold:{value:0}},vertexShader:vs,fragmentShader:'varying vec2 uvp;uniform sampler2D tex;uniform vec2 stepUV;uniform float threshold;vec3 tap(vec2 uv){return max(vec3(0.),texture2D(tex,uv).rgb-threshold);}void main(){vec3 c=tap(uvp)*.227027;c+=(tap(uvp+stepUV*1.384615)+tap(uvp-stepUV*1.384615))*.316216;c+=(tap(uvp+stepUV*3.230769)+tap(uvp-stepUV*3.230769))*.070270;gl_FragColor=vec4(c,1.);}',depthTest:false,depthWrite:false}));
  const finish=keep(new T.ShaderMaterial({uniforms:{tex:{value:base.texture},bloom:{value:b.texture},intensity:{value:1}},vertexShader:vs,fragmentShader:`varying vec2 uvp;uniform sampler2D tex,bloom;uniform float intensity;void main(){vec3 c=texture2D(tex,uvp).rgb+texture2D(bloom,uvp).rgb*.38;c*=intensity; c=vec3(1.)-exp(-c*.88);c=pow(c,vec3(1./2.2));float v=smoothstep(.84,.22,length((uvp-.5)*vec2(1.1,.9)));c=mix(vec3(.0196,.0235,.0314),c,v);gl_FragColor=vec4(c,1.);}`,depthTest:false,depthWrite:false,toneMapped:false}));
  draw=()=>{renderer.setRenderTarget(base);renderer.render(scene,camera);quad.material=blur;blur.uniforms.tex.value=base.texture;blur.uniforms.threshold.value=.23;blur.uniforms.stepUV.value.set(1.15/a.width,0);renderer.setRenderTarget(a);renderer.render(post,ortho);blur.uniforms.tex.value=a.texture;blur.uniforms.threshold.value=0;blur.uniforms.stepUV.value.set(0,1.15/a.height);renderer.setRenderTarget(b);renderer.render(post,ortho);quad.material=finish;finish.uniforms.intensity.value=look.intensity;renderer.setRenderTarget(null);renderer.render(post,ortho);};
  function size(){const w=world.clientWidth,h=world.clientHeight;renderer.setSize(w,h,false);camera.left=-2.55*w/h;camera.right=2.55*w/h;camera.updateProjectionMatrix();const ratio=renderer.getPixelRatio();base.setSize(Math.round(w*ratio),Math.round(h*ratio));a.setSize(Math.round(w*ratio/2),Math.round(h*ratio/2));b.setSize(a.width,a.height);dirty=true;}
  resizeObserver=new ResizeObserver(size);resizeObserver.observe(world);size();
  canvas.addEventListener('pointermove',e=>{if(reduced.matches)return;const rect=canvas.getBoundingClientRect();pointer.active=true;pointer.x=clamp((e.clientX-rect.left)/rect.width-.5,-.5,.5);pointer.y=clamp((e.clientY-rect.top)/rect.height-.5,-.5,.5);dirty=true;});canvas.addEventListener('pointerleave',()=>{pointer.active=false;pointer.x=pointer.y=0;dirty=true;});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();unavailable();});
  function tick(now){if(disposed)return;raf=requestAnimationFrame(tick);const dt=Math.min(.3,(now-(last||now))/1000);last=now;if(!visible||document.hidden||failed)return;
   const moving=Math.abs(join-(joined?1:0))>.001||Math.abs(orientation.x-pointer.x)>.001||Math.abs(orientation.y-pointer.y)>.001;
   const facesMoving=[primary,secondary].some(o=>o.blinkStart>=0||Math.abs(o.expression-(pointer.active?.1:0))>.002||Math.abs(o.gaze.x)>.002||Math.abs(o.gaze.y)>.002);
   if(!playing&&!exploring&&!dirty&&!moving&&energy===0&&!pointer.active&&!facesMoving)return;
   analyse(Math.max(.016,dt));if((playing||exploring)&&!reduced.matches)time+=dt*(.7+energy*.45);
   if(!reduced.matches)faceTime+=dt;
   join=reduced.matches?(joined?1:0):join+((joined?1:0)-join)*(1-Math.exp(-dt*3));
   orientation.x+=(pointer.x-orientation.x)*(1-Math.exp(-dt*4));orientation.y+=(pointer.y-orientation.y)*(1-Math.exp(-dt*4));
   const mobile=world.clientWidth<600;const baseScale=mobile?Math.min(.90,camera.right*.8):1.24;const paired=mobile?Math.min(.62,camera.right*.45):.95;
   primary.group.scale.setScalar((baseScale+(paired-baseScale)*join)*look.size);primary.group.position.set(-(mobile?camera.right*.44:.90)*join,.43,0);
   secondary.group.visible=join>.001;secondary.group.scale.setScalar((mobile?Math.min(.41,camera.right*.32):.70)*join*look.size);secondary.group.position.set(mobile?camera.right*.54:1.45,.43,0);
   [primary,secondary].forEach((object,i)=>{
    const active=playing&&(i===0?turn!==1:turn===1),listening=playing&&!active&&joined;
    const power=active?energy:0,engaged=playing||exploring||pointer.active;
    object.uniforms.time.value=time+i*4;object.uniforms.power.value=reduced.matches?power*.22:power;
    object.uniforms.bass.value=bass;object.uniforms.treble.value=treble;object.uniforms.detail.value=look.detail;
    const targetX=pointer.active?clamp((pointer.x*(camera.right-camera.left)-object.group.position.x)*.12,-.16,.16):listening?(i===0?.085:-.085):0;
    const targetY=pointer.active?clamp((-pointer.y*5.1-object.group.position.y)*.09,-.10,.10):0;
    const gazeEase=1-Math.exp(-dt*10),faceEase=1-Math.exp(-dt*7);
    object.gaze.x+=(targetX-object.gaze.x)*gazeEase;object.gaze.y+=(targetY-object.gaze.y)*gazeEase;
    const expression=pointer.active?.1:0;object.expression+=(expression-object.expression)*faceEase;
    if(!reduced.matches&&engaged&&object.blinkStart<0&&faceTime>=object.nextBlink)object.blinkStart=faceTime;
    let blink=0;
    if(object.blinkStart>=0){const progress=(faceTime-object.blinkStart)/.19;if(progress>=1||reduced.matches){object.blinkStart=-1;object.nextBlink=faceTime+3.8+i*.7+Math.sin(faceTime)*.55;}else blink=Math.sin(progress*Math.PI);}
    object.group.rotation.x=reduced.matches?0:-object.gaze.y*.25;
    object.group.rotation.y=reduced.matches?0:object.gaze.x*.28;
    object.group.rotation.z=reduced.matches?0:object.expression*object.gaze.x*.65;
    object.eyes.position.x=reduced.matches?0:object.gaze.x;object.eyes.position.y=.045+(reduced.matches?0:object.gaze.y);
    object.eyes.children.forEach((eye,eyeIndex)=>{const side=eyeIndex===0?-1:1;const curiosity=object.expression*(side*object.gaze.x>0?1:-.45);eye.scale.y=reduced.matches?1:Math.max(.10,(1+curiosity-power*.10)*(1-blink*.92));eye.scale.x=reduced.matches?1:1+power*.10;eye.position.y=reduced.matches?0:curiosity*.06;eye.rotation.z=reduced.matches?0:-side*object.expression*.16;});
    object.halo.material.opacity=.16+power*.14;
   });
   backdrop.material.uniforms.power.value=energy;draw();root.dataset.frames=String(+(root.dataset.frames||0)+1);root.dataset.join=join.toFixed(3);dirty=false;
  }
  intersection=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;if(!visible){if(playing)pause();exploring=false;labels();}dirty=true;},{threshold:.01});intersection.observe(root);
  const visibility=()=>{if(document.hidden){pause();exploring=false;labels();}dirty=true;};document.addEventListener('visibilitychange',visibility);
  const motionPreference=()=>{if(reduced.matches){pointer.active=false;pointer.x=pointer.y=0;primary.blinkStart=secondary.blinkStart=-1;}dirty=true;labels();};reduced.addEventListener('change',motionPreference);
  root.dataset.engine='three-webgl2';play.disabled=false;labels();raf=requestAnimationFrame(tick);
  if(globalThis.Tweak){tweak=new Tweak({container:root,onChange:()=>{dirty=true;save();}});tweak.addSlider(look,'intensity',{label:'Intensidade da luz',min:.6,max:1.5,step:.1});tweak.addSlider(look,'size',{label:'Tamanho da presença',min:.72,max:1,step:.02});}
  const cleanup=()=>{if(disposed)return;disposed=true;pause();cancelAnimationFrame(raf);resizeObserver.disconnect();intersection.disconnect();removal.disconnect();tweak?.dispose();audio.removeAttribute('src');audio.load();source?.disconnect();analyser?.disconnect();context?.close().catch(()=>{});targets.forEach(x=>x.dispose());resources.forEach(x=>x.dispose());renderer.dispose();window.removeEventListener('openai:set_globals',globals);document.removeEventListener('visibilitychange',visibility);reduced.removeEventListener('change',motionPreference);};
  removal=new MutationObserver(()=>{if(!root.isConnected)cleanup();});removal.observe(document.documentElement,{childList:true,subtree:true});window.addEventListener('pagehide',cleanup,{once:true});
 }catch(e){console.error('Astra renderer:',e);unavailable();play.disabled=false;}
})();
