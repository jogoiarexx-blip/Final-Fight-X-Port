(() => {
  'use strict';
  const canvas = document.getElementById('game-canvas');
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
  const frameCanvas = document.createElement('canvas');
  const frameCtx = frameCanvas.getContext('2d', { alpha: false, desynchronized: true });
  let frameComplete = true;
  const shell = document.getElementById('game-shell');
  const boot = document.getElementById('boot');
  const bootStatus = document.getElementById('boot-status');
  const bootBar = document.getElementById('boot-bar');
  const runtimeState = document.getElementById('runtime-state');
  const scanlines = document.getElementById('scanlines');
  const fullscreenBtn = document.getElementById('fullscreen-btn');
  const muteBtn = document.getElementById('mute-btn');
  const diagBtn = document.getElementById('diag-btn');
  const diagPanel = document.getElementById('diag-panel');
  const diagClose = document.getElementById('diag-close');
  const diagRun = document.getElementById('diag-run');
  const diagSummary = document.getElementById('diag-summary');
  const diagOutput = document.getElementById('diag-output');
  const mobileTouch = navigator.maxTouchPoints>0 && matchMedia('(pointer:coarse)').matches && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);
  document.documentElement.classList.toggle('mobile-touch', mobileTouch);

  const imageCache = new Map();
  const remapCache = new Map();
  const prefetchQueue = [];
  const prefetchQueued = new Set();
  const prefetchedPaths = new Set();
  const assetDirIndex = new Map();
  let prefetchActive = 0, prefetchIndexedCount = 0, hdTexturesEnabled = true;
  const PREFETCH_CONCURRENCY = 4, PREFETCH_NEIGHBORS = 20, PREFETCH_BUDGET = 160;
  const keys = new Uint8Array(256);
  const keyLatchUntil = new Float64Array(256);
  const KEY_LATCH_MS = 80;
  const keyQueue = [];
  let logicalW = 320, logicalH = 240, internalScale = 4;
  let muted = localStorage.getItem('ffx-web-muted')==='1', booted = false, pendingFullscreen = null;
  const renderMetrics={framesBegun:0,framesPresented:0,framesHeld:0,pendingDraws:0,lastFramePending:0,maxFramePending:0,lastPresentAt:0,prefetchBatches:0};
  let framePendingDraws=0;
  const runtimeErrors=[];
  const failedAssets=new Set();
  const requiredConfigFiles=['levels.txt','models.txt','menu.txt','levels/ff64th/64th.1.txt'];
  const isFileProtocol=location.protocol==='file:';
  const absUrl=rel=>new URL(rel,document.baseURI).href;
  async function fetchChecked(rel,opts={}){
    const url=absUrl(rel);
    let res;
    try{res=await fetch(url,{cache:'no-store',...opts});}
    catch(err){throw new Error(`${rel}: fetch bloqueado (${err?.message||err})`);}
    if(!res.ok)throw new Error(`${rel}: HTTP ${res.status} ${res.statusText||''}`.trim());
    return res;
  }

  function setStatus(text, pct) {
    if (text) bootStatus.textContent = text;
    if (Number.isFinite(pct)) bootBar.style.width = `${Math.max(4, Math.min(100, pct))}%`;
    runtimeState.textContent = text || 'Pronto';
  }

  function rgba(r,g,b,a=1){
    const R=Math.round(Math.max(0,Math.min(1,r))*255),G=Math.round(Math.max(0,Math.min(1,g))*255),B=Math.round(Math.max(0,Math.min(1,b))*255);
    return `rgba(${R},${G},${B},${Math.max(0,Math.min(1,a))})`;
  }

  function resizeCanvas(w=logicalW,h=logicalH){
    logicalW=w;logicalH=h;
    const pw=Math.round(w*internalScale),ph=Math.round(h*internalScale);
    if(frameCanvas.width!==pw||frameCanvas.height!==ph){frameCanvas.width=pw;frameCanvas.height=ph;}
    shell.style.aspectRatio=`${w}/${h}`;
  }

  function presentFrame(){
    if(!frameComplete)return false;
    const pw=frameCanvas.width,ph=frameCanvas.height;
    if(canvas.width!==pw||canvas.height!==ph){canvas.width=pw;canvas.height=ph;}
    ctx.save();
    ctx.setTransform(1,0,0,1,0,0);
    ctx.globalAlpha=1;
    ctx.globalCompositeOperation='copy';
    ctx.imageSmoothingEnabled=false;
    ctx.drawImage(frameCanvas,0,0);
    ctx.restore();
    return true;
  }

  function logicalAssetPath(path){
    if(path.startsWith('assets/data_hd/')&&path.endsWith('.png'))return path.slice('assets/data_hd/'.length,-4)+'.gif';
    if(path.startsWith('assets/data/'))return path.slice('assets/data/'.length);
    return null;
  }

  function physicalAssetPath(logical,useHd){
    if(useHd&&logical.endsWith('.gif'))return 'assets/data_hd/'+logical.slice(0,-4)+'.png';
    return 'assets/data/'+logical;
  }

  function refreshAssetDirIndex(){
    const meta=window.FFXWeb?.assetMeta;
    if(!meta)return;
    const count=Object.keys(meta).length;
    if(count===prefetchIndexedCount)return;
    assetDirIndex.clear();
    for(const p of Object.keys(meta)){
      const cut=p.lastIndexOf('/');
      if(cut<0)continue;
      const dir=p.slice(0,cut);
      let arr=assetDirIndex.get(dir);
      if(!arr){arr=[];assetDirIndex.set(dir,arr);}
      arr.push(p);
    }
    for(const arr of assetDirIndex.values())arr.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    prefetchIndexedCount=count;
  }

  function pumpPrefetch(){
    while(prefetchActive<PREFETCH_CONCURRENCY&&prefetchQueue.length){
      const p=prefetchQueue.shift();
      prefetchQueued.delete(p);
      if(imageCache.has(p))continue;
      prefetchActive++;
      const rec=ensureImage(p,false);
      Promise.resolve(rec?.promise).finally(()=>{prefetchActive--;pumpPrefetch();});
    }
  }

  function scheduleNeighborPrefetch(path){
    if(prefetchedPaths.size>=PREFETCH_BUDGET)return;
    refreshAssetDirIndex();
    const logical=logicalAssetPath(path);
    if(!logical)return;
    const cut=logical.lastIndexOf('/');
    if(cut<0)return;
    const dir=logical.slice(0,cut),arr=assetDirIndex.get(dir);
    if(!arr||arr.length<2)return;
    const idx=Math.max(0,arr.indexOf(logical));
    const half=Math.floor(PREFETCH_NEIGHBORS/2);
    const start=Math.max(0,Math.min(idx-half,Math.max(0,arr.length-PREFETCH_NEIGHBORS)));
    for(const logicalNeighbor of arr.slice(start,start+PREFETCH_NEIGHBORS)){
      if(prefetchedPaths.size>=PREFETCH_BUDGET)break;
      const p=physicalAssetPath(logicalNeighbor,path.startsWith('assets/data_hd/'));
      if(p===path||imageCache.has(p)||prefetchQueued.has(p))continue;
      prefetchQueued.add(p);prefetchedPaths.add(p);prefetchQueue.push(p);
    }
    if(prefetchQueue.length){
      renderMetrics.prefetchBatches++;
      if('requestIdleCallback' in window)requestIdleCallback(()=>pumpPrefetch(),{timeout:120});
      else setTimeout(pumpPrefetch,0);
    }
  }

  function ensureImage(path,prefetchNeighbors=true){
    if(!path) return null;
    let rec=imageCache.get(path);
    if(rec) return rec;
    const img=new Image();
    rec={img,ready:false,failed:false,promise:null};
    rec.promise=new Promise(resolve=>{
      img.onload=async()=>{try{if(img.decode)await img.decode();}catch{}rec.ready=true;resolve(rec)};
      img.onerror=()=>{
        if(path.startsWith('assets/data_hd/')&&path.endsWith('.png')&&!rec.fallbackTried){
          rec.fallbackTried=true;rec.failed=false;
          img.src='assets/data/'+path.slice('assets/data_hd/'.length,-4)+'.gif';
          return;
        }
        rec.failed=true;failedAssets.add(path);resolve(rec);
      };
    });
    img.decoding='async';
    img.src=path;
    imageCache.set(path,rec);
    if(prefetchNeighbors)scheduleNeighborPrefetch(path);
    return rec;
  }

  const paletteCache=new Map();
  async function loadAct(path){
    if(paletteCache.has(path))return paletteCache.get(path);
    const p=fetchChecked(path).then(r=>r.arrayBuffer()).then(buf=>{
      const b=new Uint8Array(buf), colors=[];
      for(let i=0;i+2<b.length&&colors.length<256;i+=3)colors.push([b[i],b[i+1],b[i+2]]);
      return colors;
    }).catch(()=>null);
    paletteCache.set(path,p);return p;
  }

  async function makeRemap(srcPath,basePath,altPath){
    const key=`${srcPath}|${basePath}|${altPath}`;
    const existing=remapCache.get(key);if(existing)return existing.promise;
    const rec={ready:false,failed:false,canvas:null,promise:null};
    rec.promise=(async()=>{
      const src=ensureImage(srcPath);const [base,alt]=await Promise.all([loadAct(basePath),loadAct(altPath)]);await src?.promise;
      if(!src?.ready||!base||!alt){rec.failed=true;return null;}
      const sw=src.img.naturalWidth,sh=src.img.naturalHeight;
      const off=document.createElement('canvas');off.width=sw;off.height=sh;
      const oc=off.getContext('2d',{willReadFrequently:true});oc.imageSmoothingEnabled=false;oc.drawImage(src.img,0,0);
      const map=new Map();for(let i=0;i<Math.min(base.length,alt.length);++i){const c=base[i],a=alt[i];map.set((c[0]<<16)|(c[1]<<8)|c[2],a);}
      const id=oc.getImageData(0,0,sw,sh),d=id.data;
      for(let i=0;i<d.length;i+=4){if(d[i+3]===0)continue;const v=map.get((d[i]<<16)|(d[i+1]<<8)|d[i+2]);if(v){d[i]=v[0];d[i+1]=v[1];d[i+2]=v[2];}}
      oc.putImageData(id,0,0);rec.canvas=off;rec.ready=true;return off;
    })().catch(err=>{rec.failed=true;console.warn('Palette remap failed',srcPath,err);return null;});
    remapCache.set(key,rec);return rec.promise;
  }

  const input = {
    keyDown(code){ return code>=0&&code<256&&(keys[code]!==0||performance.now()<keyLatchUntil[code]); },
    takeLastKey(){ return keyQueue.length?keyQueue.shift():-1; },
    padCodeDown(index,code){
      const gp=navigator.getGamepads?.()[index];if(!gp)return false;
      const b=i=>!!gp.buttons[i]?.pressed || (gp.buttons[i]?.value||0)>.45;
      const ax=i=>gp.axes[i]||0;
      switch(code){
        case 1:return b(12);case 2:return b(13);case 3:return b(14);case 4:return b(15);
        case 5:return b(0);case 6:return b(1);case 7:return b(2);case 8:return b(3);
        case 9:return b(4);case 10:return b(5);case 11:return b(8);case 12:return b(9);
        case 13:return b(10);case 14:return b(11);case 15:return b(6);case 16:return b(7);
        case 17:return ax(1)<-.45;case 18:return ax(1)>.45;case 19:return ax(0)<-.45;case 20:return ax(0)>.45;
        case 21:return ax(3)<-.45;case 22:return ax(3)>.45;case 23:return ax(2)<-.45;case 24:return ax(2)>.45;
        case 25:return b(12)||ax(1)<-.45;case 26:return b(13)||ax(1)>.45;case 27:return b(14)||ax(0)<-.45;case 28:return b(15)||ax(0)>.45;
        default:return false;
      }
    }
  };

  const audio = {
    ctx:null, cache:new Map(), music:null, musicPath:'', musicLoop:true, musicVolume:.75, paused:false,
    async unlock(){
      if(!this.ctx)this.ctx=new (window.AudioContext||window.webkitAudioContext)();
      if(this.ctx.state==='suspended')await this.ctx.resume().catch(()=>{});
      if(this.music&&!this.paused&&!muted&&this.music.paused)await this.music.play().catch(()=>{});
      else if(this.musicPath&&!this.music&&!this.paused)this.playMusic(this.musicPath,this.musicLoop,this.musicVolume);
    },
    async buffer(path){
      if(this.cache.has(path))return this.cache.get(path);
      const p=fetchChecked(path).then(r=>r.arrayBuffer()).then(b=>this.ctx.decodeAudioData(b)).catch(()=>null);
      this.cache.set(path,p);return p;
    },
    async playSfx(path,volume){
      if(muted)return;await this.unlock();const b=await this.buffer(path);if(!b)return;
      const src=this.ctx.createBufferSource(),gain=this.ctx.createGain();src.buffer=b;gain.gain.value=Math.max(0,Math.min(1,volume));src.connect(gain).connect(this.ctx.destination);src.start();
    },
    playMusic(path,loop,volume){
      this.stopMusic();this.musicPath=path;this.musicLoop=loop;this.musicVolume=volume;this.paused=false;
      if(muted)return;
      const el=new Audio(path);el.loop=loop;el.volume=Math.max(0,Math.min(1,volume));el.preload='auto';this.music=el;el.play().catch(()=>{});
    },
    stopMusic(){if(this.music){this.music.pause();this.music.src='';this.music=null;}this.musicPath='';this.paused=false;},
    pauseMusic(v){this.paused=v;if(!this.music)return;if(v)this.music.pause();else this.music.play().catch(()=>{});}
  };

  window.FFXWeb = {
    input,audio,ensureImage,assetMeta:{},configFileCount:0,presentFrame,renderMetrics,
    debugState(){
      let ready=0,pending=0,failed=0;
      for(const rec of imageCache.values()){if(rec.ready)ready++;else if(rec.failed)failed++;else pending++;}
      let saveMounted=false;
      try{saveMounted=!!(window.FS&&FS.analyzePath('/save').exists);}catch{}
      return {
        booted,logicalW,logicalH,internalScale,
        images:{total:imageCache.size,ready,pending,failed,prefetched:prefetchedPaths.size,prefetchQueued:prefetchQueue.length,prefetchActive},
        input:{latched:Array.from(keyLatchUntil).filter(t=>t>performance.now()).length,latchMs:KEY_LATCH_MS},
        failedAssets:[...failedAssets],
        runtimeErrors:[...runtimeErrors],
        saveMounted,
        render:{...renderMetrics},
        href:location.href
      };
    },
    beginFrame(w,h,post,upscale,filter,strength,integerScale){
      resizeCanvas(w,h);
      frameComplete=true;
      framePendingDraws=0;
      renderMetrics.framesBegun++;
      frameCtx.setTransform(internalScale,0,0,internalScale,0,0);
      frameCtx.globalAlpha=1;
      frameCtx.globalCompositeOperation='source-over';
      frameCtx.imageSmoothingEnabled=upscale!==0;
      canvas.style.imageRendering=upscale===0?'pixelated':'auto';
      const s=Math.max(0,Math.min(1,strength/100));canvas.style.filter=filter===3?`contrast(${1+.10*s}) saturate(${1+.08*s})`:filter===2?`contrast(${1+.16*s}) saturate(${1+.05*s})`:'none';
      scanlines.style.opacity=(filter===1||filter===2||filter===3)?String(.14+.18*s):'0';
    },
    endFrame(){
      frameCtx.globalAlpha=1;
      renderMetrics.lastFramePending=framePendingDraws;
      renderMetrics.maxFramePending=Math.max(renderMetrics.maxFramePending,framePendingDraws);
      if(presentFrame()){renderMetrics.framesPresented++;renderMetrics.lastPresentAt=performance.now();}
      else renderMetrics.framesHeld++;
    },
    clear(r,g,b,a){frameCtx.save();frameCtx.setTransform(1,0,0,1,0,0);frameCtx.fillStyle=rgba(r,g,b,a);frameCtx.fillRect(0,0,frameCanvas.width,frameCanvas.height);frameCtx.restore();},
    fillRect(x,y,w,h,r,g,b,a,opacity){frameCtx.save();frameCtx.globalAlpha=Math.max(0,Math.min(1,opacity));frameCtx.fillStyle=rgba(r,g,b,a);frameCtx.fillRect(x,y,w,h);frameCtx.restore();},
    drawImage(path,x,y,w,h,flip,opacity){
      const rec=ensureImage(path);
      if(!rec?.ready){if(rec&&!rec.failed){frameComplete=false;framePendingDraws++;renderMetrics.pendingDraws++;}return;}
      frameCtx.save();
      frameCtx.globalAlpha=Math.max(0,Math.min(1,opacity));
      if(flip){frameCtx.translate(x+w,y);frameCtx.scale(-1,1);frameCtx.drawImage(rec.img,0,0,w,h);}
      else frameCtx.drawImage(rec.img,x,y,w,h);
      frameCtx.restore();
    },
    drawCover(path,opacity){
      const rec=ensureImage(path);
      if(!rec?.ready){if(rec&&!rec.failed){frameComplete=false;framePendingDraws++;renderMetrics.pendingDraws++;}return;}
      const iw=rec.img.naturalWidth||1,ih=rec.img.naturalHeight||1,s=Math.max(logicalW/iw,logicalH/ih),w=iw*s,h=ih*s;
      this.drawImage(path,(logicalW-w)/2,(logicalH-h)/2,w,h,false,opacity);
    },
    drawRemapped(src,base,alt,x,y,w,h,flip,opacity){
      const key=`${src}|${base}|${alt}`;const rec=remapCache.get(key);
      if(!rec){makeRemap(src,base,alt);frameComplete=false;framePendingDraws++;renderMetrics.pendingDraws++;return;}
      if(!rec.ready||!rec.canvas){
        if(rec.failed){this.drawImage(src,x,y,w,h,flip,opacity);return;}
        frameComplete=false;framePendingDraws++;renderMetrics.pendingDraws++;return;
      }
      const off=rec.canvas;frameCtx.save();frameCtx.globalAlpha=opacity;
      if(flip){frameCtx.translate(x+w,y);frameCtx.scale(-1,1);frameCtx.drawImage(off,0,0,w,h);}
      else frameCtx.drawImage(off,x,y,w,h);
      frameCtx.restore();
    },
    text(s,x,y,size,r,g,b,a,center,centerX,width){frameCtx.save();frameCtx.globalAlpha=a;frameCtx.fillStyle=rgba(r,g,b,1);frameCtx.font=`600 ${Math.max(4,size)}px "Arial Narrow","Roboto Condensed",Arial,sans-serif`;frameCtx.textBaseline='top';frameCtx.textAlign=center?'center':'left';let tx=x;if(center)tx=width>0?centerX:logicalW/2;frameCtx.fillText(s,tx,y,width>0?width:undefined);frameCtx.restore();},
    configure(wide,hd){hdTexturesEnabled=!!hd;resizeCanvas(wide?426:320,240);},
    onNativeResize(){},
    async setFullscreen(enabled){
      pendingFullscreen=!!enabled;
      try{
        if(enabled&&!document.fullscreenElement){
          if(navigator.userActivation&&!navigator.userActivation.isActive)return;
          await shell.requestFullscreen();
        }else if(!enabled&&document.fullscreenElement)await document.exitFullscreen();
        pendingFullscreen=null;
      }catch{}
    },
    requestExit(){runtimeState.textContent='Jogo encerrado';boot.style.display='grid';bootStatus.textContent='Sessão encerrada. Recarregue a página para jogar novamente.';bootBar.style.width='100%';},
    bootReady(){booted=true;setStatus('Pronto',100);setTimeout(()=>boot.style.display='none',250);canvas.focus();if(window.Module?.FS){setInterval(()=>{try{FS.syncfs(false,()=>{});}catch{}},5000);}setTimeout(()=>{if(new URLSearchParams(location.search).has('diagnostics'))runDiagnostics(true);},450);},
    bootError(msg){setStatus(msg||'Erro ao iniciar',100);boot.classList.add('error');runtimeState.textContent='Erro de inicialização';}
  };

  const blockKeys=new Set([37,38,39,40,32,13]);
  addEventListener('keydown',e=>{const c=e.keyCode||e.which;if(c>=0&&c<256){if(!keys[c])keyQueue.push(c);keys[c]=1;keyLatchUntil[c]=Math.max(keyLatchUntil[c],performance.now()+KEY_LATCH_MS);}if(blockKeys.has(c))e.preventDefault();audio.unlock();if(pendingFullscreen!==null)FFXWeb.setFullscreen(pendingFullscreen);},{passive:false});
  addEventListener('keyup',e=>{const c=e.keyCode||e.which;if(c>=0&&c<256)keys[c]=0;if(blockKeys.has(c))e.preventDefault();},{passive:false});
  addEventListener('blur',()=>{keys.fill(0);keyLatchUntil.fill(0);});
  addEventListener('pointerdown',()=>{audio.unlock();if(pendingFullscreen!==null)FFXWeb.setFullscreen(pendingFullscreen);},{once:false});

  document.querySelectorAll('#touch-controls [data-key]').forEach(btn=>{
    const c=Number(btn.dataset.key);const down=e=>{e.preventDefault();try{btn.setPointerCapture(e.pointerId)}catch{}if(!keys[c])keyQueue.push(c);keys[c]=1;keyLatchUntil[c]=Math.max(keyLatchUntil[c],performance.now()+KEY_LATCH_MS);audio.unlock();};const up=e=>{e.preventDefault();keys[c]=0;try{btn.releasePointerCapture(e.pointerId)}catch{}};
    btn.addEventListener('pointerdown',down);btn.addEventListener('pointerup',up);btn.addEventListener('pointercancel',up);btn.addEventListener('lostpointercapture',up);
  });

  fullscreenBtn.addEventListener('click',()=>FFXWeb.setFullscreen(!document.fullscreenElement));
  muteBtn.textContent=muted?'Som desligado':'Som';
  muteBtn.addEventListener('click',()=>{muted=!muted;localStorage.setItem('ffx-web-muted',muted?'1':'0');muteBtn.textContent=muted?'Som desligado':'Som';if(muted){if(audio.music)audio.music.pause();}else{audio.unlock();if(audio.music&&!audio.paused)audio.music.play().catch(()=>{});}});
  document.addEventListener('fullscreenchange',()=>{fullscreenBtn.textContent=document.fullscreenElement?'Sair da tela cheia':'Tela cheia';});
  addEventListener('pagehide',()=>{try{if(window.FS)FS.syncfs(false,()=>{});}catch{}});
  addEventListener('error',e=>{runtimeErrors.push(String(e.error?.stack||e.message||e));if(runtimeErrors.length>20)runtimeErrors.shift();});
  addEventListener('unhandledrejection',e=>{runtimeErrors.push(String(e.reason?.stack||e.reason||e));if(runtimeErrors.length>20)runtimeErrors.shift();});


  async function runDiagnostics(auto=false){
    diagPanel.hidden=false;
    diagSummary.textContent='Executando verificações…';
    diagOutput.textContent='';
    const rows=[];
    const add=(name,status,detail='')=>rows.push({name,status,detail});
    const ok=(n,d='')=>add(n,'OK',d), warn=(n,d='')=>add(n,'AVISO',d), fail=(n,d='')=>add(n,'FALHA',d);

    try{
      typeof WebAssembly==='object'?ok('WebAssembly','disponível'):fail('WebAssembly','não disponível');
      canvas.getContext('2d')?ok('Canvas 2D',`${canvas.width}×${canvas.height}`):fail('Canvas 2D');
      (window.AudioContext||window.webkitAudioContext)?ok('Web Audio'):warn('Web Audio','API indisponível');
      ('getGamepads' in navigator)?ok('Gamepad API',`${[...(navigator.getGamepads?.()||[])].filter(Boolean).length} conectado(s)`):warn('Gamepad API');
      document.fullscreenEnabled?ok('Fullscreen API'):warn('Fullscreen API','browser bloqueia ou não suporta');
      ('indexedDB' in window)?ok('IndexedDB'):warn('IndexedDB','save persistente pode não funcionar');
      navigator.maxTouchPoints>0?ok('Touch',`${navigator.maxTouchPoints} ponto(s)`):ok('Touch','desktop/sem touch');

      ok('Protocolo da página',location.protocol);
      if(isFileProtocol){
        fail('Servidor HTTP/HTTPS','A página foi aberta como file://. Fetch, WASM e áudio exigem HTTP/HTTPS.');
      }else{
        ok('Servidor HTTP/HTTPS',location.origin);
      }

      const checkJson=async(rel,label)=>{
        try{
          const r=await fetchChecked(rel);
          const data=await r.json();
          ok(label,`${Object.keys(data).length} entrada(s)`);
          return data;
        }catch(e){fail(label,String(e.message||e));return null;}
      };
      const meta=await checkJson('asset-meta.json','asset-meta.json');
      const cfg=await checkJson('webfs-config.json','webfs-config.json');
      try{
        const r=await fetchChecked('ffx.wasm');
        const size=r.headers.get('content-length');
        ok('ffx.wasm',size?`${size} bytes`:'acessível');
        try{await r.body?.cancel();}catch{}
      }catch(e){fail('ffx.wasm',String(e.message||e));}

      if(meta){
        const count=Object.keys(meta).length;
        count>=1000?ok('Manifesto de imagens',`${count} entradas`):warn('Manifesto de imagens',`${count} entradas`);
        for(const p of ['bgs/title.gif','bgs/select.gif','bgs/ff64th/64th.1/1.gif']){
          meta[p]?ok(`Metadata ${p}`,`${meta[p].w}×${meta[p].h}`):fail(`Metadata ${p}`);
        }
      }
      if(cfg){
        const count=Object.keys(cfg).length;
        count>=140?ok('Arquivos de configuração',`${count} embutidos`):warn('Arquivos de configuração',`${count}`);
        for(const k of requiredConfigFiles)(k in cfg)?ok(`Config ${k}`):fail(`Config ${k}`);
      }

      const essentials=[
        'assets/data/bgs/title.gif',
        'assets/data/bgs/select.gif',
        'assets/data/bgs/ff64th/64th.1/1.gif',
        'assets/data_hd/bgs/ff64th/64th.1/1.png'
      ];
      for(const p of essentials){
        try{
          const rec=ensureImage(p);await Promise.race([rec.promise,new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),5000))]);
          rec.ready?ok(`Imagem ${p}`):fail(`Imagem ${p}`,'falhou');
        }catch(e){fail(`Imagem ${p}`,String(e.message||e));}
      }

      try{
        const r=await fetchChecked('assets/data/music/start.ogg');
        ok('Áudio OGG','start.ogg acessível');
        try{await r.body?.cancel();}catch{}
      }catch(e){
        (isFileProtocol?fail:warn)('Áudio OGG',String(e.message||e));
      }

      if(booted)ok('Core WASM','engine sinalizou bootReady');
      else if(isFileProtocol)fail('Core WASM','não inicia em file://; use GitHub Pages ou INICIAR-LOCAL.bat');
      else warn('Core WASM','engine ainda inicializando ou não sinalizou bootReady');

      try{
        if(window.FS&&FS.analyzePath('/save').exists){
          const p='/save/.ffx_diag';
          FS.writeFile(p,'ok');const rd=new TextDecoder().decode(FS.readFile(p));FS.unlink(p);
          rd==='ok'?ok('Filesystem de save','leitura/escrita OK'):fail('Filesystem de save','conteúdo divergente');
        }else if(isFileProtocol)fail('Filesystem de save','depende do core WASM iniciado via HTTP/HTTPS');
        else warn('Filesystem de save','/save ainda não montado');
      }catch(e){fail('Filesystem de save',String(e.message||e));}

      failedAssets.size?warn('Assets que falharam nesta sessão',`${failedAssets.size}`):ok('Assets que falharam nesta sessão','0');
      runtimeErrors.length?warn('Erros JavaScript/WASM capturados',`${runtimeErrors.length}`):ok('Erros JavaScript/WASM capturados','0');

      const bad=rows.filter(r=>r.status==='FALHA').length;
      const warnings=rows.filter(r=>r.status==='AVISO').length;
      diagSummary.innerHTML=bad
        ? `<span class="diag-fail">${bad} falha(s)</span> • ${warnings} aviso(s)`
        : warnings
          ? `<span class="diag-warn">Sem falhas críticas • ${warnings} aviso(s)</span>`
          : `<span class="diag-ok">Tudo aprovado nesta verificação</span>`;
      diagOutput.textContent=rows.map(r=>`${r.status==='OK'?'✅':r.status==='AVISO'?'⚠️':'❌'} ${r.name}${r.detail?' — '+r.detail:''}`).join('\n')
        +(runtimeErrors.length?'\n\nÚltimos erros:\n'+runtimeErrors.slice(-5).join('\n---\n'):'');
    }catch(err){
      diagSummary.innerHTML='<span class="diag-fail">Diagnóstico interrompido</span>';
      diagOutput.textContent=String(err?.stack||err);
    }
    if(auto&&rows.every(r=>r.status!=='FALHA'))setTimeout(()=>{diagPanel.hidden=true;},1400);
  }

  diagBtn.addEventListener('click',()=>runDiagnostics(false));
  diagRun.addEventListener('click',()=>runDiagnostics(false));
  diagClose.addEventListener('click',()=>{diagPanel.hidden=true;canvas.focus();});

  async function clearOldServiceWorker(){
    if(!('serviceWorker' in navigator)||isFileProtocol)return;
    try{
      const regs=await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(r=>r.unregister()));
      const keys=await caches.keys();
      await Promise.all(keys.filter(k=>k.startsWith('ffx-web-')).map(k=>caches.delete(k)));
    }catch(e){console.warn('SW cleanup',e);}
  }

  // Emscripten module configuration and persistent /save mount.
  window.Module = {
    canvas,
    locateFile(path){return absUrl(path);},
    print: text=>console.log('[FFX]',text),
    printErr: text=>console.error('[FFX]',text),
    monitorRunDependencies(left){if(left>0)setStatus(`Preparando engine… ${left} pendência(s)`,Math.max(38,82-left*3));},
    setStatus(text){
      const m=/\((\d+)\/(\d+)\)/.exec(text||'');
      setStatus(text||'Carregando…',m?Number(m[1])/Number(m[2])*100:undefined);
    },
    preRun: [function(){
      addRunDependency('ffx-web-data');
      (async()=>{
        try{
          if(isFileProtocol)throw new Error('file:// não é suportado; abra via HTTP/HTTPS');
          const metaRes=await fetchChecked('asset-meta.json');
          const cfgRes=await fetchChecked('webfs-config.json');
          FFXWeb.assetMeta=await metaRes.json();const cfg=await cfgRes.json();
          FFXWeb.configFileCount=Object.keys(cfg).length;
          const missingRequired=requiredConfigFiles.filter(k=>!(k in cfg));
          if(missingRequired.length)throw new Error('configs obrigatórios ausentes: '+missingRequired.join(', '));
          if(Object.keys(FFXWeb.assetMeta).length<1000)throw new Error('asset-meta incompleto');
          for(const [rel,b64] of Object.entries(cfg)){
            const full='/assets/data/'+rel,slash=full.lastIndexOf('/'),dir=full.slice(0,slash);
            FS.mkdirTree(dir);const raw=atob(b64),bytes=new Uint8Array(raw.length);for(let i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);FS.writeFile(full,bytes);
          }
        }catch(err){console.error('Web data bootstrap',err);runtimeErrors.push(String(err?.stack||err));FFXWeb.bootError(isFileProtocol?'Abra pelo GitHub Pages ou execute INICIAR-LOCAL.bat.':`Falha ao carregar dados: ${err?.message||err}`);}
        finally{removeRunDependency('ffx-web-data');}
})();
      try{
        if(!FS.analyzePath('/save').exists)FS.mkdir('/save');FS.mount(FS.filesystems.IDBFS,{autoPersist:true},'/save');addRunDependency('ffx-idbfs');
        FS.syncfs(true,err=>{if(err)console.warn('IDBFS',err);removeRunDependency('ffx-idbfs');});
      }catch(err){console.warn('Save persistence disabled',err);}
    }]
  };

  // Warm only the first UI assets; gameplay textures remain lazy.
  Promise.all(['assets/data/scenes/logo/jiam.gif','assets/data/scenes/logo/v100.gif','assets/data/bgs/title.gif','assets/data/bgs/select.gif'].map(p=>ensureImage(p)?.promise))
    .then(()=>setStatus(isFileProtocol?'Servidor HTTP necessário':'Iniciando engine…',35));

  async function startRuntime(){
    await clearOldServiceWorker();
    if(isFileProtocol){
      FFXWeb.bootError('Este port não pode iniciar por file://. Use GitHub Pages ou dê dois cliques em INICIAR-LOCAL.bat.');
      if(new URLSearchParams(location.search).has('diagnostics'))setTimeout(()=>runDiagnostics(false),100);
      return;
    }
    const s=document.createElement('script');
    s.src=absUrl('ffx.js');
    s.async=false;
    s.onerror=()=>FFXWeb.bootError('Não foi possível carregar ffx.js. Verifique a publicação no GitHub Pages.');
    document.body.appendChild(s);
  }

  startRuntime();
})();
