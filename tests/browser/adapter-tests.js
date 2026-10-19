/* Test only: a tiny SPA implements the observed SoundCloud DOM behavior.
   Calls the actual adapter; no replacement of SCWaveAdapter.play. */
const originalCanonical=SCWaveCore.canonical;
SCWaveCore.canonical=value=>{
  if(typeof value==='string' && value.startsWith(location.origin+'/'))return originalCanonical('https://soundcloud.com'+new URL(value).pathname);
  return originalCanonical(value);
};
const box=document.getElementById('sandbox'), results=document.getElementById('results');
const metrics={passed:0,failed:0};
const check=(value,message)=>{if(!value)throw new Error(message)};
async function test(name,fn){const li=document.createElement('li');li.textContent='… '+name;results.append(li);try{await fn();metrics.passed++;li.className='ok';li.textContent='✓ '+name}catch(e){metrics.failed++;li.className='bad';li.textContent='✗ '+name+' — '+e.message}document.body.dataset.results=JSON.stringify(metrics);}
function player(url,title,playing=false){return `<div class="playControls"><div class="playbackSoundBadge"><a class="playbackSoundBadge__titleLink" title="${title}" href="${url}">${title}</a><a class="playbackSoundBadge__lightLink">Artist</a></div><button class="playControls__play ${playing?'playing':''}" aria-label="${playing?'Pause current':'Play current'}">Play</button><div class="playbackTimeline__progressWrapper" role="progressbar" aria-valuenow="1" aria-valuemax="180"></div></div>`}
function markPlaying(url,title){const a=box.querySelector('.playbackSoundBadge__titleLink');a.href=url;a.title=title;a.textContent=title;const b=box.querySelector('.playControls__play');b.classList.add('playing');b.setAttribute('aria-label','Pause current')}
window.chrome={runtime:{sendMessage:async()=>({error:'Неожиданная перезагрузка в тесте'})}};
(async()=>{
 await test('Карточки библиотеки разных видов и фильтрация профиля/плеера',()=>{
  box.innerHTML=`<div id="content"><a href="/my-user/likes">Likes</a><div class="sound"><a class="soundTitle__username" href="/artist">Artist</a><a class="soundTitle__title" href="/artist/classic">Classic</a></div><div class="playableTile"><a class="playableTile__mainHeading" href="/artist/grid">Grid</a></div><article class="new-library-row"><a href="/artist/fallback">Fallback</a></article><aside class="sidebarModule"><a href="/artist/sidebar">Sidebar</a></aside></div>`+player('/artist/old','Old');
  const tracks=SCWaveAdapter.cards(box.querySelector('#content'));
  check(tracks.length===3,'Ожидалось 3 трека, получено '+tracks.length);check(tracks.some(x=>x.title==='Fallback'),'Новая карточка не распознана');
 });
 await test('Явно запрошенный блок похожих треков не исключён фильтром сайдбара',()=>{
  box.innerHTML='<article class="sidebarModule relatedSoundsModule"><div class="soundBadge"><a class="soundTitle__title" href="/artist/related">Related</a></div></article>';
  check(SCWaveAdapter.cards(box.firstElementChild).length===1,'Похожие треки потерялись');
 });
 await test('Импорт лайков читает новую сетку реальным collect()',async()=>{
  box.innerHTML='<div id="content"><div class="playableTile"><a class="playableTile__mainHeading" href="/artist/liked-grid">Liked Grid</a></div><div class="new-row"><a href="/other/liked-fallback">Liked Fallback</a></div></div>';
  const data=await SCWaveAdapter.collect('likes');check(data.tracks.length===2,'Лайки не прочитались');check(!data.emptyConfirmed,'Неправильно определена пустая библиотека');
 });
 await test('Переход без замены hero и повтор Play после поздней привязки обработчика',async()=>{
  history.replaceState({},'','/artist/first');
  box.innerHTML='<div id="content"><div class="fullHero"><h1>First</h1><h2><a href="/artist">Artist</a></h2><div class="soundTitle__playButton"><a href="" class="playButton" role="button">Play</a></div></div></div>'+player('/artist/first','First');
  const hero=box.querySelector('.fullHero'),btn=hero.querySelector('.playButton');let clicks=0,navigations=0;
  const nav=e=>{const a=e.target.closest('a[href]');if(a?.href==='https://soundcloud.com/artist/second'){e.preventDefault();navigations++;history.pushState({},'','/artist/second');hero.querySelector('h1').textContent='Second';}};
  document.addEventListener('click',nav);
  btn.onclick=e=>{e.preventDefault();if(++clicks>=2)markPlaying('https://soundcloud.com/artist/second','Second')};
  try{await SCWaveAdapter.play({url:'https://soundcloud.com/artist/second',title:'Second'});check(clicks===2,'Play должен повториться ровно один раз');check(navigations===1,'Неожиданное количество переходов');check(box.querySelector('.fullHero')===hero,'Тест обязан переиспользовать прежний hero');check(SCWaveAdapter.current().url.endsWith('/second'),'Не включился второй трек');}finally{document.removeEventListener('click',nav)}
 });
 await test('Видимый трек запускается кнопкой карточки без навигации',async()=>{
  const before=location.pathname;
  box.innerHTML='<div id="content"><div class="sound"><a class="soundTitle__title" href="/other/third">Third</a><button class="playButton">Play Third</button></div></div>'+player('/artist/second','Second',true);
  box.querySelector('.playButton').onclick=()=>markPlaying('https://soundcloud.com/other/third','Third');
  await SCWaveAdapter.play({url:'https://soundcloud.com/other/third',title:'Third'});check(location.pathname===before,'Зачем переходить, если кнопка трека уже есть');check(SCWaveAdapter.current().url.endsWith('/third'),'Не включился трек из карточки');
 });
 await test('Уже играющий трек не ставится на паузу повторным кликом',async()=>{
  let clicks=0;box.querySelector('.playControls__play').onclick=()=>clicks++;
  await SCWaveAdapter.play({url:'https://soundcloud.com/other/third',title:'Third'});check(clicks===0,'Играющий трек получил лишний клик');
 });
 await test('Новый интерфейс без fullHero/playButton, изменённый профиль и составной исполнитель',async()=>{
  const url='https://soundcloud.com/example-artist/collaboration';history.replaceState({},'','/example-artist/collaboration');
  box.innerHTML='<main id="content"><section class="TrackHeader_new"><div><button class="Button_new" aria-label="Play" title="Play Collaboration">▶</button><div><h1>Collaboration</h1><a href="/example-renamed">Example, Collaborator</a></div></div></section></main>'+player('/previous-artist/Previous song','Previous song');
  const b=box.querySelector('.Button_new');let clicks=0;b.onclick=()=>{clicks++;markPlaying(url,'Collaboration')};
  const t={url,title:'Example, Collaborator — Collaboration'};
  check(SCWaveAdapter.heroButton(t)===b,'Не найдена новая кнопка Play');
  await SCWaveAdapter.play(t);check(clicks===1,'Должен быть ровно один клик');check(SCWaveAdapter.current().url===url,'Трек не запущен');check(!SCWaveAdapter.diagnostics().hasLegacyHero,'Тест не должен содержать старый hero');
 });
 await test('Новый Pause не получает лишнего клика до обновления мини-плеера',async()=>{
  const url='https://soundcloud.com/modern/paused-button';history.replaceState({},'','/modern/paused-button');
  box.innerHTML='<main id="content"><section><button class="new-toggle" aria-label="Pause">Ⅱ</button><h1>Paused Button</h1></section></main>'+player('/artist/old','Old');
  let clicks=0;box.querySelector('.new-toggle').onclick=()=>clicks++;
  setTimeout(()=>markPlaying(url,'Paused Button'),500);
  await SCWaveAdapter.play({url,title:'Paused Button'});check(clicks===0,'Pause был ошибочно нажат');
 });
 await test('Новый Play находится по data-testid без старых CSS-классов',async()=>{
  const url='https://soundcloud.com/modern/test-control';history.replaceState({},'','/modern/test-control');
  box.innerHTML='<main id="content"><section><button data-testid="track-play-button"><svg aria-hidden="true"></svg></button><h1>Test Control</h1></section></main>'+player('/artist/old','Old');
  let clicks=0;box.querySelector('[data-testid]').onclick=()=>{clicks++;markPlaying(url,'Test Control')};
  await SCWaveAdapter.play({url,title:'Test Control'});check(clicks===1,'Не нажат семантический Play');
 });
 const muiHeader='<section class="MuiStack-root mui-6280wb" aria-label="Track header"><div class="MuiStack-root"><span aria-label="Play"><button class="MuiButtonBase-root MuiButton-root MuiButton-outlined MuiButton-sizeMedium MuiButton-colorContrast MuiButton-disableElevation mui-1ucb9o7" tabindex="0" type="button" aria-label="Play"><svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path fill="currentColor" d="m19.653 11.367-11-7A.75.75 0 0 0 7.5 5v14a.75.75 0 0 0 1.153.633l11-7a.75.75 0 0 0 0-1.266Z"></path></svg></button></span><h1>Example song</h1></div></section>';
 await test('Новый MUI Track header: Track header вне пустого #content',async()=>{
  const url='https://soundcloud.com/example-artist/example-song';history.replaceState({},'','/example-artist/example-song');
  box.innerHTML='<div id="content"></div><div id="modern-page">'+muiHeader+'</div>'+player('/example-old-artist/previous-song','Previous song',true);
  const b=box.querySelector('button.MuiButton-root');let clicks=0;b.onclick=()=>{clicks++;markPlaying(url,'Example song')};
  check(SCWaveAdapter.heroButton({url,title:'Example song'})===b,'Выбран пустой старый контейнер вместо настоящего Track header');
  await SCWaveAdapter.play({url,title:'Example song'});check(clicks===1,'Настоящий MuiButton не нажат');
 });
 await test('Track header внутри доступного iframe, мини-плеер снаружи',async()=>{
  const url='https://soundcloud.com/modern/frame-song';history.replaceState({},'','/modern/frame-song');
  box.innerHTML='<div id="content"></div>'+player('/artist/old','Old',true);
  const frame=document.createElement('iframe');frame.srcdoc=muiHeader;
  const loaded=new Promise((resolve,reject)=>{frame.onload=resolve;frame.onerror=reject});box.append(frame);await loaded;
  const b=frame.contentDocument.querySelector('button');let clicks=0;b.onclick=()=>{clicks++;markPlaying(url,'Example song')};
  check(SCWaveAdapter.heroButton({url,title:'Example song'})===b,'Недоступен Play в same-origin iframe');
  await SCWaveAdapter.play({url,title:'Example song'});check(clicks===1,'Play внутри iframe не нажат');
 });
 await test('Track header внутри открытого Shadow DOM',async()=>{
  const url='https://soundcloud.com/modern/shadow-song';history.replaceState({},'','/modern/shadow-song');
  box.innerHTML='<div id="content"></div><div id="web-component"></div>'+player('/artist/old','Old',true);
  const root=box.querySelector('#web-component').attachShadow({mode:'open'});root.innerHTML=muiHeader;
  const b=root.querySelector('button');let clicks=0;b.onclick=()=>{clicks++;markPlaying(url,'Example song')};
  check(SCWaveAdapter.heroButton({url,title:'Example song'})===b,'Недоступен Play в открытом Shadow DOM');
  await SCWaveAdapter.play({url,title:'Example song'});check(clicks===1,'Play в Shadow DOM не нажат');
 });
 await test('Играющий трек: /undefined/ восстанавливается по странице, slug и Pause',async()=>{
  const url='https://soundcloud.com/example-uploader/sample-track';history.replaceState({},'','/example-uploader/sample-track');
  box.innerHTML=muiHeader.replace('Example song','Sample track').replaceAll('aria-label="Play"','aria-label="Pause"')+player('/undefined/sample-track','Sample track',true);
  check(SCWaveAdapter.current()?.url===url,'Играющий трек ошибочно считается другим');
  let clicks=0;box.querySelector('section button').onclick=()=>clicks++;
  await SCWaveAdapter.play({url,title:'Sample track'});check(clicks===0,'Уже играющий трек получил лишнее нажатие');
  check(SCWaveAdapter.diagnostics().rawCurrent.includes('/undefined/'),'В диагностике потеряна исходная ссылка');
 });
 await test('Подтверждённый трек сохраняет адрес при паузе и уходе со страницы',()=>{
  history.replaceState({},'','/discover');box.querySelector('section').remove();box.querySelector('.playControls__play').classList.remove('playing');box.querySelector('.playControls__play').setAttribute('aria-label','Play current');
  check(SCWaveAdapter.current()?.url==='https://soundcloud.com/example-uploader/sample-track','Пауза/навигация сбросили адрес трека');
 });
 await test('Валидный другой автор с тем же slug не подменяется',()=>{
  history.replaceState({},'','/example-uploader/sample-track');
  box.innerHTML=muiHeader.replace('Example song','Sample track').replaceAll('aria-label="Play"','aria-label="Pause"')+player('/another-artist/sample-track','Sample track',true);
  check(SCWaveAdapter.current()?.url==='https://soundcloud.com/another-artist/sample-track','Подменён валидный трек другого автора');
 });
 await test('Неподтверждённые slug, название и Play не исправляют ссылку',()=>{
  const mini='/undefined/sample-track';
  history.replaceState({},'','/example-uploader/different-slug');box.innerHTML=muiHeader.replace('Example song','Sample track').replaceAll('aria-label="Play"','aria-label="Pause"')+player(mini,'Sample track',true);
  check(SCWaveAdapter.current()?.url.endsWith(mini),'Совпал только заголовок, но другой slug принят');
  history.replaceState({},'','/example-uploader/sample-track');box.querySelector('h1').textContent='Different song';
  check(SCWaveAdapter.current()?.url.endsWith(mini),'Несовпадающее название принято');
  box.querySelector('h1').textContent='Sample track';box.querySelector('section button').setAttribute('aria-label','Play');
  check(SCWaveAdapter.current()?.url.endsWith(mini),'Страница ещё не играет, но принята');
 });
 const done=document.createElement('p');done.id='done';done.textContent=`ГОТОВО: ${metrics.passed} успешно, ${metrics.failed} ошибок`;document.body.append(done);
})();
