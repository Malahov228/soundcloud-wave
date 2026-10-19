/* Integration harness: mock Chrome services and the SoundCloud UI only.
   The extension's core, adapter and content scripts are loaded unchanged. */
const tracks=[{url:'https://soundcloud.com/test/start',title:'Start'},
 {url:'https://soundcloud.com/example-uploader/sample-track',title:'Sample track'},
 {url:'https://soundcloud.com/artist-two/second',title:'Second'},
 {url:'https://soundcloud.com/artist-three/third',title:'Third'},
 {url:'https://soundcloud.com/artist-four/fourth',title:'Fourth'}].map(t=>({...t,artist:'Artist'}));
const realCanonical=SCWaveCore.canonical;
SCWaveCore.canonical=value=>typeof value==='string' && value.startsWith(location.origin+'/')?realCanonical('https://soundcloud.com'+new URL(value).pathname):realCanonical(value);
const storage={preferences:{...SCWaveCore.defaults(),seeds:[tracks[0]],autoSync:false,playlists:[{url:'https://soundcloud.com/discover/sets/mix',title:'Mix',tracks:tracks.slice(1)}]}};
let waveState=null,releaseCount=0,heroClicks=0;
window.chrome={runtime:{getManifest:()=>({version:'0.2.4'}),onMessage:{addListener:()=>{}},sendMessage:async m=>{
 if(m.type==='mode')return {collector:false};
 if(m.type==='state')waveState=structuredClone(m.state);
 if(m.type==='release'){releaseCount++;waveState=null;}
 if(m.type==='collect')return {tracks:tracks.slice(1)};
 if(m.type==='navigate')return {error:'Неожиданная перезагрузка'};
 return {ok:true};
}},storage:{local:{get:async key=>({[key]:structuredClone(storage[key])}),set:async values=>Object.assign(storage,structuredClone(values))}}};
function setPlayer(t,broken=false){
 const a=document.querySelector('.playbackSoundBadge__titleLink');a.href=broken?'https://soundcloud.com/undefined/'+t.url.split('/').pop():t.url;a.title=t.title;a.textContent=t.title;
 const b=document.querySelector('.playControls__play');b.classList.add('playing');b.setAttribute('aria-label','Pause current');
 document.querySelector('[role="progressbar"]').setAttribute('aria-valuenow','1');
}
function showPage(t,playing=false){
 history.replaceState({},'',new URL(t.url).pathname);
 const page=document.getElementById('page');page.innerHTML='<div id="content"></div><section aria-label="Track header"><button class="MuiButton-root" aria-label="'+(playing?'Pause':'Play')+'">▶</button><h1></h1></section>';
 page.querySelector('h1').textContent=t.title;
 page.querySelector('button').onclick=()=>{heroClicks++;setPlayer(t,true);page.querySelector('button').setAttribute('aria-label','Pause');};
}
setPlayer(tracks[0]);showPage(tracks[0],true);
document.addEventListener('click',e=>{
 const a=e.target.closest('a[href]');if(!a || a.closest('#scwave-host'))return;
 const t=tracks.find(t=>t.url===SCWaveCore.canonical(a.href));if(t){e.preventDefault();showPage(t);}
},true);
const results=document.getElementById('results'),check=(ok,msg)=>{if(!ok)throw new Error(msg);};
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,msg,timeout=5000){const start=Date.now();while(!fn()){if(Date.now()-start>timeout)throw new Error(msg);await wait(50);}}
async function test(name,fn){const li=document.createElement('li');li.textContent='… '+name;results.append(li);try{await fn();li.className='ok';li.textContent='✓ '+name;return true;}catch(e){li.className='bad';li.textContent='✗ '+name+' — '+e.message;return false;}}
function load(src){return new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=reject;document.body.append(s);});}
(async()=>{
 await load('/extension/adapter.js');await load('/extension/content.js');
 await until(()=>document.getElementById('scwave-host')?.shadowRoot?.getElementById('start'),'Панель не появилась');
 const root=document.getElementById('scwave-host').shadowRoot,$=id=>root.getElementById(id);
 $('launch').click();
 let ok=await test('Запуск волны сохраняет текущую песню и включает Дальше',async()=>{
  $('start').click();await until(()=>waveState?.now?.url===tracks[0].url&&!waveState.pending,'Запуск не завершён');
  await wait(100);check(!$('next').disabled,'Дальше заблокирована');
 });
 if(ok)ok=await test('Следующий трек с /undefined/ принят; волна продолжает работать после проверки',async()=>{
  $('next').click();await until(()=>waveState?.now?.url!==tracks[0].url&&!waveState?.pending,'Трек играет, но волна не признала запуск',21000);
  check(waveState?.now,'Волна выключилась');await wait(1300);
  check(releaseCount===0,'Проверка текущего трека выключила волну');check(!$('next').disabled,'Дальше заблокирована');
  check(SCWaveAdapter.current().url===waveState.now.url,'Адрес текущего трека не восстановлен');
 });
 if(ok)ok=await test('Оценка использует настоящий адрес, повторное Дальше запускает ещё одну песню',async()=>{
  const previous=waveState.now.url;$('favorite').click();await wait(100);
  check(storage.preferences.favorites.includes(previous),'Лайк записан на ошибочный адрес');
  $('next').click();await until(()=>waveState?.now?.url!==previous&&!waveState?.pending,'Второй переход не завершён');await wait(1100);
  check(waveState?.now&&!$('next').disabled,'После второго перехода очередь остановилась');
  check(!storage.preferences.history.some(x=>x.url.includes('/undefined/')),'Ошибочный адрес попал в историю');
 });
 if(ok)ok=await test('Окончание песни автоматически запускает следующую',async()=>{
  const previous=waveState.now.url,bar=document.querySelector('[role="progressbar"]');bar.setAttribute('aria-valuenow','179');await wait(1100);bar.setAttribute('aria-valuenow','180');
  window.dispatchEvent(new CustomEvent('scwave:ended',{detail:JSON.stringify({time:180,duration:180})}));
  await until(()=>waveState?.now?.url!==previous&&!waveState?.pending,'Переход в конце песни не завершён');await wait(1100);
  check(waveState?.now&&!$('next').disabled,'Волна выключилась после окончания');check(heroClicks===3,'Лишние клики по Play: '+heroClicks);
 });
 if(ok)await test('Ручной выбор действительно другой песни по-прежнему останавливает волну',async()=>{
  setPlayer({url:'https://soundcloud.com/manual/chosen',title:'Manual choice'});
  await until(()=>releaseCount>0,'Ручной выбор не обнаружен');check($('next').disabled,'Кнопка не отражает ручную остановку');
 });
 const done=document.createElement('p');done.id='done';done.textContent='ГОТОВО: '+results.querySelectorAll('.ok').length+' успешно, '+results.querySelectorAll('.bad').length+' ошибок';document.body.append(done);
})();
