'use strict';
const VIDEO_CACHE='dengxi-videos-mobile-v2';
const videoSources=new Map();
let allVideosReady=false,loadingVideos=false,videoManifest={};
const videoNames={C01:'逆影扑击',C02:'站台追逐',C03:'光束破甲',C04:'车厢遭遇',C05:'折骨定光',C07:'车厢异变',C08:'末班车开场',C09:'隙核封存'};
const loadProgress=new Map(),partialDownloads=new Map();
let expectedBytes=0,transferBytes=0,transferStarted=Date.now();
function renderLoad(message){
 const done=videoSources.size,total=Object.keys(videoNames).length,bytes=[...loadProgress.values()].reduce((a,b)=>a+b,0);
 const percent=allVideosReady?100:expectedBytes?Math.min(99,Math.floor(bytes/expectedBytes*100)):0;
 document.getElementById('loadPercent').textContent=`${percent}%`;
 document.getElementById('loadBar').value=percent;
 document.getElementById('loadCount').textContent=`影片就绪 ${done} / ${total}`;
 document.getElementById('loadMessage').textContent=message;
 const metrics=document.getElementById('loadMetrics');
 if(metrics&&expectedBytes){const speed=transferBytes/Math.max(1,(Date.now()-transferStarted)/1000);metrics.textContent=`${(bytes/1e6).toFixed(1)} / ${(expectedBytes/1e6).toFixed(1)} MB${transferBytes?` · 平均 ${(speed/1000).toFixed(0)} KB/s`:''}`;}
}
function invalid(message){const e=new Error(message);e.resetDownload=true;return e;}
async function verifyBlob(blob,item){
 if(blob.size!==item.bytes)throw invalid('影片长度校验失败');
 if(await blob.slice(4,8).text()!=='ftyp')throw invalid('影片格式校验失败');
 if(globalThis.crypto?.subtle){const hash=await crypto.subtle.digest('SHA-256',await blob.arrayBuffer());const hex=Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');if(hex!==item.sha256)throw invalid('影片内容校验失败');}
 // iPhone may defer loadeddata until user playback; complete bytes, not first-frame events, define download readiness.
 return URL.createObjectURL(blob);
}
async function loadVideo(id,cache){
 const item=videoManifest[id],path=item.src;
 if(cache){try{const hit=await cache.match(path);if(hit){const blob=await hit.blob();const url=await verifyBlob(blob,item);videoSources.set(id,url);loadProgress.set(id,item.bytes);renderLoad(`缓存已就绪：${videoNames[id]}`);return;}}catch{}await cache.delete(path).catch(()=>{});}
 let part=partialDownloads.get(id)||{chunks:[],received:0};partialDownloads.set(id,part);
 for(let attempt=0;attempt<3;attempt++){
  const controller=new AbortController();let timeout;
  const reset=()=>{clearTimeout(timeout);timeout=setTimeout(()=>controller.abort(),90000);};
  try{
   if(!navigator.onLine)throw new Error('网络已断开');
   reset();const offset=part.received;
   renderLoad(`${offset?'继续下载':'正在下载'}：${videoNames[id]}${attempt?`（第 ${attempt+1} 次尝试）`:''}`);
   const res=await fetch(path,{signal:controller.signal,cache:'no-cache',headers:offset?{Range:`bytes=${offset}-`}:undefined});
   if(res.status!==200&&res.status!==206)throw new Error(`下载请求失败 (${res.status})`);
   if(res.status===206){const range=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(res.headers.get('Content-Range')||'');if(!range||+range[1]!==offset||+range[3]!==item.bytes)throw invalid('续传校验失败');}
   else if(offset){part={chunks:[],received:0};partialDownloads.set(id,part);loadProgress.set(id,0);}
   const accept=chunk=>{part.chunks.push(chunk);part.received+=chunk.byteLength;transferBytes+=chunk.byteLength;loadProgress.set(id,part.received);if(part.received>item.bytes)throw invalid('影片长度超出预期');renderLoad(`正在下载：${videoNames[id]}`);};
   if(res.body){const reader=res.body.getReader();try{while(true){reset();const {done,value}=await reader.read();if(done)break;accept(value);}}finally{reader.releaseLock();}}
   else accept(new Uint8Array(await res.arrayBuffer()));
   clearTimeout(timeout);
   if(part.received<item.bytes)throw new Error('连接中断，保留已下载部分');
   const blob=new Blob(part.chunks,{type:'video/mp4'}),url=await verifyBlob(blob,item);
   videoSources.set(id,url);partialDownloads.delete(id);loadProgress.set(id,item.bytes);renderLoad(`已就绪：${videoNames[id]}`);
   if(cache)cache.put(path,new Response(blob,{headers:{'Content-Type':'video/mp4','Content-Length':String(item.bytes)}})).catch(()=>{});
   return;
  }catch(e){
   controller.abort();
   if(e.resetDownload){part={chunks:[],received:0};partialDownloads.set(id,part);loadProgress.delete(id);}
   if(attempt===2)throw new Error(`${videoNames[id]}：${e.name==='AbortError'?'连接长时间无响应，已保留下载进度':e.message}`);
   renderLoad(`${videoNames[id]}连接中断，正在自动重试，已下载部分会保留。`);
   await new Promise(resolve=>setTimeout(resolve,700*(attempt+1)));
  }finally{clearTimeout(timeout);}
 }
}
async function preloadAllVideos(){
 if(loadingVideos||allVideosReady)return;
 loadingVideos=true;document.getElementById('loadRetry').hidden=true;document.getElementById('loadEnter').hidden=true;
 let cache=null;try{if(location.protocol!=='file:'&&'caches'in window)cache=await caches.open(VIDEO_CACHE);}catch{}
 try{
  const res=await fetch('media-manifest-v2.json',{cache:'no-cache'});if(!res.ok)throw new Error(`清单请求失败 (${res.status})`);
  const manifest=await res.json();
  for(const id of Object.keys(videoNames)){const item=manifest[id];if(!item||!/^media\/mobile-v2\/C\d+\.mp4$/.test(item.src)||!Number.isSafeInteger(item.bytes)||item.bytes<=0||!/^[a-f0-9]{64}$/.test(item.sha256))throw new Error('影片清单不完整');}
  videoManifest=manifest;expectedBytes=Object.keys(videoNames).reduce((sum,id)=>sum+manifest[id].bytes,0);
 }catch(e){loadingVideos=false;renderLoad(`无法取得影片清单：${e.message}。请检查网络后重试。`);document.getElementById('loadRetry').hidden=false;return;}
 const pending=Object.keys(videoNames).filter(id=>!videoSources.has(id));let index=0;const failures=[];
 renderLoad('正在准备全部影片，请保持页面打开。');
 async function worker(){while(index<pending.length){const id=pending[index++];try{await loadVideo(id,cache);}catch(e){failures.push(e.message);}}}
 await Promise.all([worker(),worker()]);loadingVideos=false;
 if(failures.length){renderLoad(`加载未完成。${failures.join('；')}。可继续下载，不必重头开始。`);document.getElementById('loadRetry').hidden=false;return;}
 allVideosReady=true;renderLoad('全部影片已下载并校验完成，末班车等你登车。');document.getElementById('loadEnter').hidden=false;
 if(cache)caches.delete('dengxi-videos-full-v1').catch(()=>{});
}
document.getElementById('loadRetry').onclick=preloadAllVideos;
document.getElementById('loadEnter').onclick=()=>{if(!allVideosReady)return;document.getElementById('loadingScreen').hidden=true;document.getElementById('gameShell').inert=false;document.getElementById('gameShell').removeAttribute('aria-hidden');document.querySelector('#panel button')?.focus();};
if(location.protocol==='file:')document.getElementById('loadMessage').textContent='请通过网页地址打开此版本，以便完整加载全部影片。';else preloadAllVideos();
