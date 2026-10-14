import { AGENTS } from './state.mjs';

// Geometry/shaders ported from the Founder-approved character study; see docs/design/reference.
export function createPresenceRenderer(T, { canvas, world, read, onUnavailable }, environment = globalThis) {
 const { document, matchMedia, devicePixelRatio, ResizeObserver, requestAnimationFrame, cancelAnimationFrame, AbortController } = environment;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const look={intensity:1,detail:1,size:.72};
 const resources=new Set(),keep=value=>(resources.add(value),value),targets=[];
 const events=new AbortController();
 let sharedBodyGeometry,sharedEyeGeometry;const sharedVeilGeometry=[];
 let renderer,scene,camera,primary,secondary,draw,resizeObserver;
 let tick;
 let raf=0,disposed=false,last=0,time=7,faceTime=0,join=0,currentAgent='architect',lastDraw=0;
 const pointer={x:0,y:0,active:false};
 const clamp=(n,a=0,b=1)=>Math.min(b,Math.max(a,n));
 const measurements=[];
 function invalidate(){if(typeof tick==='function'&&!disposed&&!raf&&!document.hidden)raf=requestAnimationFrame(tick);}
 function dispose(){
  if(disposed)return;disposed=true;cancelAnimationFrame(raf);events.abort();resizeObserver?.disconnect();
  targets.forEach(x=>x.dispose());resources.forEach(x=>x.dispose());renderer?.dispose();
 }
 try {
  const options={canvas,antialias:false,alpha:false,powerPreference:'high-performance'};
  renderer=environment.createWebGLRenderer?environment.createWebGLRenderer(options):new T.WebGLRenderer(options);
  if(!renderer.extensions.has('EXT_color_buffer_float'))throw new Error('Floating-point color targets unavailable.');renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.NoToneMapping;
  scene=new T.Scene();camera=new T.OrthographicCamera(-4,4,2.55,-2.55,.1,40);camera.position.z=8;
  function presence(hex){
   const group=new T.Group();scene.add(group);
   const uniforms={time:{value:7},power:{value:0},bass:{value:0},treble:{value:0},detail:{value:1},tint:{value:new T.Color(hex)}};
   const vertex=`varying vec3 n;varying vec3 p;uniform float time,power;void main(){p=position;n=normalize(normalMatrix*normal);float w=sin(position.y*4.+time*.48)*sin(position.x*3.-time*.35)*sin(position.z*3.+time*.26);vec3 pos=position*(1.+w*(.008+power*.010));gl_Position=projectionMatrix*modelViewMatrix*vec4(pos,1.);}`;
   const fragment=`varying vec3 n;varying vec3 p;uniform float time,power;uniform vec3 tint;
   void main(){vec3 N=normalize(n);float facing=max(0.,N.z);float rim=pow(1.-facing,3.2);float angle=atan(p.y,p.x);float arc=.5+.5*sin(angle+time*.24);float arc2=pow(.5+.5*sin(angle*2.-time*.20),6.);float soft=pow(max(0.,dot(N,normalize(vec3(-.55,.7,1.3)))),38.);float axis=(p.y+.3*p.x-.18*sin(time*.2))/.060;float sheen=exp(-axis*axis)*.007;vec3 c=tint*(.005+.012*(1.-facing)+rim*(.32+arc*.48+arc2*.55)+sheen+power*(rim*.65+.012));c+=vec3(soft*.025);c+=tint*.014*pow(max(0.,-p.y),2.);gl_FragColor=vec4(c,1.);}`;
   const body=new T.Mesh((sharedBodyGeometry??=keep(new T.SphereGeometry(1,112,80))),keep(new T.ShaderMaterial({uniforms,vertexShader:vertex,fragmentShader:fragment,toneMapped:false})));group.add(body);
   const veils=[];
   for(let layer=0;layer<3;layer++){
    const positions=[],uvs=[],indices=[];const segments=220,cross=18;
    for(let i=0;i<=segments;i++)for(let j=0;j<=cross;j++){
     const u=i/segments*Math.PI*2,v=(j/cross-.5)*2;const r=1.005+.035*v+.019*Math.sin(u*3+layer*1.9);
     positions.push(Math.cos(u)*r,Math.sin(u)*r,.06*Math.sin(u*2+layer));uvs.push(i/segments,j/cross);
     if(i<segments&&j<cross){const k=i*(cross+1)+j;indices.push(k,k+cross+1,k+1,k+1,k+cross+1,k+cross+2);}
    }
    const geo=(sharedVeilGeometry[layer]??=keep(new T.BufferGeometry()));if(!geo.attributes.position){geo.setAttribute('position',new T.Float32BufferAttribute(positions,3));geo.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));geo.setIndex(indices);}
    const mat=keep(new T.ShaderMaterial({uniforms:{...uniforms,offset:{value:layer*2.1}},transparent:true,side:T.DoubleSide,blending:T.AdditiveBlending,depthWrite:false,depthTest:false,toneMapped:false,
     vertexShader:'varying vec2 v;uniform float time,offset,power;void main(){v=uv;vec3 p=position;float a=uv.x*6.28318;p*=1.+.015*sin(a*3.+time*.55+offset)+power*.02*sin(a*6.-time*2.);gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}',
     fragmentShader:'varying vec2 v;uniform vec3 tint;uniform float time,power,offset;void main(){float soft=pow(max(0.,sin(v.y*3.14159)),2.2);float glow=.45+.55*sin(v.x*6.28318-time*.25+offset);float axis=(v.y-.72)*26.;float edge=exp(-axis*axis);float a=soft*(.07+glow*.30+power*.20);gl_FragColor=vec4(tint*(.65+edge*.8+power*.9),a);}'
    }));
    const veil=new T.Mesh(geo,mat);veil.rotation.set([.20,-.34,.15][layer],[.18,.14,-.26][layer],layer*1.3);group.add(veil);veils.push(veil);
   }
   const eyeGroup=new T.Group();eyeGroup.position.set(0,.045,1.02);group.add(eyeGroup);
   const eyeGeometry=(sharedEyeGeometry??=keep(new T.CapsuleGeometry(.033,.098,8,18)));const eyeMaterial=keep(new T.MeshBasicMaterial({color:0xffffff,toneMapped:false}));
   for(const x of [-.19,.19]){const eye=new T.Mesh(eyeGeometry,eyeMaterial);eye.position.x=x;eyeGroup.add(eye);}
   const glowCanvas=document.createElement('canvas');glowCanvas.width=glowCanvas.height=128;const cx=glowCanvas.getContext('2d');const gradient=cx.createRadialGradient(64,64,37,64,64,64);gradient.addColorStop(0,'rgba(255,255,255,.04)');gradient.addColorStop(.35,'rgba(255,255,255,.09)');gradient.addColorStop(1,'rgba(255,255,255,0)');cx.fillStyle=gradient;cx.fillRect(0,0,128,128);
   const halo=new T.Sprite(keep(new T.SpriteMaterial({map:keep(new T.CanvasTexture(glowCanvas)),color:hex,blending:T.AdditiveBlending,transparent:true,depthWrite:false,depthTest:false,opacity:.16})));halo.scale.set(2.5,2.5,1);halo.position.z=-.5;group.add(halo);
   return{group,uniforms,eyes:eyeGroup,halo,veils,gaze:{x:0,y:0},blinkStart:-1,nextBlink:3.4,expression:0};
  }
  primary=presence(0xffffff);secondary=presence(AGENTS.architect.color);secondary.group.visible=false;
  const backdrop=new T.Mesh(keep(new T.PlaneGeometry(30,20)),keep(new T.ShaderMaterial({depthWrite:false,uniforms:{power:{value:0}},vertexShader:'varying vec2 p;void main(){p=position.xy;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec2 p;uniform float power;void main(){vec2 q=p-vec2(0.,.4);float a=exp(-dot(q,q)*.8);vec3 c=vec3(.001,.0012,.0016)+vec3(.002,.0024,.0033)*a;gl_FragColor=vec4(c,1.);}',toneMapped:false})));backdrop.position.z=-4;scene.add(backdrop);
  const targetOptions={type:T.HalfFloatType,minFilter:T.LinearFilter,magFilter:T.LinearFilter,depthBuffer:true};
  const base=new T.WebGLRenderTarget(1,1,targetOptions),a=new T.WebGLRenderTarget(1,1,targetOptions),b=new T.WebGLRenderTarget(1,1,targetOptions);base.samples=2;targets.push(base,a,b);
  const post=new T.Scene(),ortho=new T.OrthographicCamera(-1,1,1,-1,0,1),quad=new T.Mesh(keep(new T.PlaneGeometry(2,2)));post.add(quad);
  const vs='varying vec2 uvp;void main(){uvp=uv;gl_Position=vec4(position.xy,0.,1.);}';
  const blur=keep(new T.ShaderMaterial({uniforms:{tex:{value:null},stepUV:{value:new T.Vector2()},threshold:{value:0}},vertexShader:vs,fragmentShader:'varying vec2 uvp;uniform sampler2D tex;uniform vec2 stepUV;uniform float threshold;vec3 tap(vec2 uv){return max(vec3(0.),texture2D(tex,uv).rgb-threshold);}void main(){vec3 c=tap(uvp)*.227027;c+=(tap(uvp+stepUV*1.384615)+tap(uvp-stepUV*1.384615))*.316216;c+=(tap(uvp+stepUV*3.230769)+tap(uvp-stepUV*3.230769))*.070270;gl_FragColor=vec4(c,1.);}',depthTest:false,depthWrite:false}));
  const finish=keep(new T.ShaderMaterial({uniforms:{tex:{value:base.texture},bloom:{value:b.texture},intensity:{value:1}},vertexShader:vs,fragmentShader:`varying vec2 uvp;uniform sampler2D tex,bloom;uniform float intensity;void main(){vec3 c=texture2D(tex,uvp).rgb+texture2D(bloom,uvp).rgb*.38;c*=intensity; c=vec3(1.)-exp(-c*.88);c=pow(c,vec3(1./2.2));float v=(1.-smoothstep(.22,.84,length((uvp-.5)*vec2(1.1,.9))));c=mix(vec3(.0196,.0235,.0314),c,v);gl_FragColor=vec4(c,1.);}`,depthTest:false,depthWrite:false,toneMapped:false}));
  draw=()=>{renderer.setRenderTarget(base);renderer.render(scene,camera);quad.material=blur;blur.uniforms.tex.value=base.texture;blur.uniforms.threshold.value=.23;blur.uniforms.stepUV.value.set(1.15/a.width,0);renderer.setRenderTarget(a);renderer.render(post,ortho);blur.uniforms.tex.value=a.texture;blur.uniforms.threshold.value=0;blur.uniforms.stepUV.value.set(0,1.15/a.height);renderer.setRenderTarget(b);renderer.render(post,ortho);quad.material=finish;finish.uniforms.intensity.value=look.intensity;renderer.setRenderTarget(null);renderer.render(post,ortho);};
  function size(){const w=Math.max(1,world.clientWidth),h=Math.max(1,world.clientHeight);renderer.setSize(w,h,false);camera.left=-2.55*w/h;camera.right=2.55*w/h;camera.updateProjectionMatrix();const ratio=renderer.getPixelRatio();base.setSize(Math.round(w*ratio),Math.round(h*ratio));a.setSize(Math.round(w*ratio/2),Math.round(h*ratio/2));b.setSize(a.width,a.height);invalidate();}

  resizeObserver=new ResizeObserver(size);resizeObserver.observe(world);size();
  canvas.addEventListener('pointermove',e=>{
   if(reduced.matches||!read().motion)return;
   const rect=canvas.getBoundingClientRect();pointer.active=true;
   pointer.x=clamp((e.clientX-rect.left)/rect.width-.5,-.5,.5);
   pointer.y=clamp((e.clientY-rect.top)/rect.height-.5,-.5,.5);invalidate();
  },{signal:events.signal});
  canvas.addEventListener('pointerleave',()=>{pointer.active=false;pointer.x=pointer.y=0;invalidate();},{signal:events.signal});
  canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();dispose();onUnavailable();},{signal:events.signal});
  reduced.addEventListener('change',()=>{pointer.active=false;pointer.x=pointer.y=0;invalidate();},{signal:events.signal});
  document.addEventListener('visibilitychange',()=>{
   if(document.hidden){cancelAnimationFrame(raf);raf=0;pointer.active=false;pointer.x=pointer.y=0;last=0;}else invalidate();
  },{signal:events.signal});
  tick=function(now){
   raf=0;if(disposed||document.hidden)return;
   const view=read();if(!view.visible)return;
   const dt=Math.min(.05,(now-(last||now-16))/1000);last=now;
   const moving=view.motion&&!reduced.matches;
   const agent=view.specialist;
   if(agent&&agent!==currentAgent){currentAgent=agent;secondary.uniforms.tint.value.setHex(AGENTS[agent].color);secondary.halo.material.color.setHex(AGENTS[agent].color);}
   const goal=agent?1:0;
   join=moving?join+(goal-join)*(1-Math.exp(-dt*6)):goal;
   if(Math.abs(goal-join)<.001)join=goal;
   if(moving){time+=dt*(.7+view.energy*.45);faceTime+=dt;}
   const mobile=world.clientWidth<600,baseScale=mobile?Math.min(.90,camera.right*.8):1.24,paired=mobile?Math.min(.62,camera.right*.45):.95;
   primary.group.scale.setScalar((baseScale+(paired-baseScale)*join)*look.size);primary.group.position.set(-(mobile?camera.right*.44:.90)*join,.43,0);
   secondary.group.visible=join>.001;secondary.group.scale.setScalar((mobile?Math.min(.41,camera.right*.32):.70)*join*look.size);secondary.group.position.set(mobile?camera.right*.54:1.45,.43,0);
   [primary,secondary].forEach((object,i)=>{
    const active=view.speaker===(i===0?'invoker':agent),listening=(view.speaker&&!active&&agent)||(view.status==='delegating'&&agent);
    const focused=view.focus===(i===0?'invoker':agent);
    const power=active?view.energy:0;
    object.uniforms.time.value=time+i*4;object.uniforms.power.value=moving?power:power*.22;
    const targetX=moving&&pointer.active?clamp((pointer.x*(camera.right-camera.left)-object.group.position.x)*.12,-.16,.16):moving&&listening?(i===0?.085:-.085):0;
    const targetY=moving&&pointer.active?clamp((-pointer.y*5.1-object.group.position.y)*.09,-.10,.10):moving&&focused&&view.status==='processing'?.035:0;
    const ease=1-Math.exp(-dt*10);
    object.gaze.x=moving?object.gaze.x+(targetX-object.gaze.x)*ease:0;
    object.gaze.y=moving?object.gaze.y+(targetY-object.gaze.y)*ease:0;
    object.expression=moving&&pointer.active?.1:0;
    if(moving&&object.blinkStart<0&&faceTime>=object.nextBlink)object.blinkStart=faceTime;
    let blink=0;
    if(object.blinkStart>=0){const progress=(faceTime-object.blinkStart)/.19;if(progress>=1||!moving){object.blinkStart=-1;object.nextBlink=faceTime+3.8+i*.7+Math.sin(faceTime)*.55;}else blink=Math.sin(progress*Math.PI);}
    object.group.rotation.set(-object.gaze.y*.25,object.gaze.x*.28,object.expression*object.gaze.x*.65);
    object.eyes.position.set(object.gaze.x,.045+object.gaze.y,1.02);
    object.eyes.children.forEach((eye,eyeIndex)=>{
     const side=eyeIndex===0?-1:1,curiosity=object.expression*(side*object.gaze.x>0?1:-.45);
     const attention=!focused?0:view.status==='listening'?.12:view.status==='processing'?-.12:0;
     eye.scale.y=moving?Math.max(.10,(1+curiosity+attention-power*.10)*(1-blink*.92)):1;eye.scale.x=moving?1+power*.10:1;
     eye.position.y=moving?curiosity*.06:0;eye.rotation.z=moving?-side*object.expression*.16:0;
    });
    object.halo.material.opacity=.16+power*.14;
   });
   draw();canvas.dataset.frames=String(+(canvas.dataset.frames||0)+1);
   canvas.dataset.energy=view.energy.toFixed(4);canvas.dataset.speaker=view.speaker??'none';
   canvas.dataset.gaze=primary.gaze.x.toFixed(3);canvas.dataset.join=join.toFixed(3);
   if(lastDraw&&now-lastDraw<250){measurements.push(now-lastDraw);if(measurements.length>600)measurements.shift();}lastDraw=now;
   if(moving||view.speaker||join!==goal)invalidate();
  }
  return { invalidate, dispose, stats(){return {engine:'three-webgl2',disposed,version:T.REVISION,dpr:renderer.getPixelRatio(),
   geometries:renderer.info.memory.geometries,textures:renderer.info.memory.textures,programs:renderer.info.programs.length,
   frames:Number(canvas.dataset.frames||0),frameIntervalsMs:[...measurements]};} };
 }catch(error){dispose();throw error;}
}
