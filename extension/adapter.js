/* Desktop DOM adapter; see the verification report for test coverage. */
(() => {
  'use strict';
  const C = SCWaveCore;
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const text = e => (e?.textContent || '').trim();
  const CARD = '.soundList__item,.soundBadgeList__item,.sound,.soundBadge,.trackItem,.trackList__item,.compactTrackList__item,.compactTrackListItem,.playableTile,.soundTile,.trackTile,.collection__item';
  const TITLE = 'a.soundTitle__title,a.soundTitle__titleLink,a.trackItem__trackTitle,a.compactTrackListItem__trackTitle,a.playableTile__heading,a.playableTile__mainHeading';
  const EXCLUDE = '.playControls,.queue,.l-sidebar,.sidebarModule,.relatedSoundsModule,#scwave-host';
  const label = a => a?.title || text(a) || a?.querySelector('[aria-label]')?.getAttribute('aria-label') || '';
  function fromCard(card) {
    const a = card.querySelector(TITLE) || [...card.querySelectorAll('a[href]')].find(a=>C.canonical(a.getAttribute('href')));
    return C.clean({url: a?.getAttribute('href'), title: label(a),
      artist: text(card.querySelector('.soundTitle__usernameText,.soundTitle__username,.playableTile__username,.trackItem__username,.compactTrackListItem__user')),
      tag: text(card.querySelector('.soundTitle__tag')), date: card.querySelector('time[datetime]')?.getAttribute('datetime')});
  }
  function cards(scope = document) {
    const found = new Map();
    const quality=t=>(t.title!==t.url.split('/').pop()?2:0)+(t.artist!==C.artistKey(t)?1:0);
    const add=t=>{if(t && (!found.has(t.url)||quality(t)>quality(found.get(t.url))))found.set(t.url,t);};
    for (const card of scope.querySelectorAll(CARD)) {
      const t = fromCard(card);
      if(!card.closest(EXCLUDE) || scope.closest?.('.relatedSoundsModule'))add(t);
    }
    // Library grids have changed class names several times. Their normal track
    // links remain useful; profile/navigation routes are rejected by canonical.
    for(const a of scope.querySelectorAll('a[href]')){
      if(a.closest(EXCLUDE) && !scope.closest?.('.relatedSoundsModule'))continue;
      const url=C.canonical(a.getAttribute('href'));
      if(!url)continue;
      const card=a.closest(CARD);
      add(C.clean({url,title:label(a),artist:card?text(card.querySelector('.soundTitle__usernameText,.soundTitle__username,.playableTile__username,.trackItem__username')):''}));
    }
    return [...found.values()];
  }
  let resolvedPlayerLink=null;
  function current() {
    const a = document.querySelector('.playbackSoundBadge__titleLink');
    if (!a){resolvedPlayerLink=null;return null;}
    const title=a.title || text(a.querySelector('[aria-hidden="true"]')) || text(a);
    const raw=C.canonical(a.getAttribute('href'));
    let url=raw;
    // The new player sometimes renders /undefined/<slug>. Repair only this
    // malformed uploader, with matching slug/title and an actively paused-icon
    // track header on the actual page. Never equate two valid uploader URLs.
    if(raw && /^https:\/\/soundcloud\.com\/(?:undefined|null)\//.test(raw)){
      const identity=raw+'\n'+normalize(title);
      if(resolvedPlayerLink?.identity!==identity)resolvedPlayerLink=null;
      const page=C.canonical(location.href), slug=raw.split('/').pop();
      const confirmed=!resolvedPlayerLink && page && !/^https:\/\/soundcloud\.com\/(?:undefined|null)\//.test(page) && page.split('/').pop()===slug && progress().playing && headers().some(header=>{
        const heading=header.querySelector('h1,[role="heading"][aria-level="1"],h2');
        return normalize(text(heading))===normalize(title) && isPause(playControl(header));
      });
      // Keep the confirmed identity while paused or browsing another page.
      // Drop it as soon as the mini-player actually selects a different song.
      if(confirmed)resolvedPlayerLink={identity,url:page};
      url=resolvedPlayerLink?.url || raw;
    }else resolvedPlayerLink=null;
    return C.clean({url,title,artist:text(document.querySelector('.playbackSoundBadge__lightLink'))});
  }
  function pageTrack() {
    const heading=pageHeading();
    if(!heading)return null;
    return C.clean({url:location.href,title:text(heading),artist:text(document.querySelector('.fullHero h2'))});
  }
  function progress() {
    const bar = document.querySelector('.playbackTimeline__progressWrapper[role="progressbar"]');
    const play = document.querySelector('.playControls__play');
    return {time: Number(bar?.getAttribute('aria-valuenow')) || 0,
      duration: Number(bar?.getAttribute('aria-valuemax')) || 0,
      playing: Boolean(play?.classList.contains('playing') || /pause|приостанов|пауза/i.test(play?.getAttribute('aria-label') || play?.title || '')),
      ad: Boolean(document.querySelector('.playControls.m-ad, .playControls.m-advertisement, .playControls .advertisement, .playControls .audioAd'))};
  }
  function playlists() {
    const found=new Map();
    for(const a of document.querySelectorAll('a[href*="/sets/"]')) {
      const url=C.playlist(a.getAttribute('href'));
      if(!url)continue;
      const title=a.getAttribute('title') || text(a) || a.querySelector('[aria-label]')?.getAttribute('aria-label') || '';
      if(!found.has(url) || title.length>found.get(url).title.length)found.set(url,{url,title:title.slice(0,200)});
    }
    return [...found.values()].slice(0,6);
  }
  async function collect(kind = 'related') {
    let result = [], stable = 0, last = 0;
    let collections=[];
    const limit=kind==='likes'?240:80;
    const start = Date.now();
    const found=new Map();
    while (Date.now() - start < 17500) {
      const scope=kind==='playlist' ? document.querySelector('.trackList,.compactTrackList,#content,.l-content') || document : kind==='likes' ? document.querySelector('#content,.collectionSection,.l-content,main,[role="main"]') || document : document;
      for(const t of cards(scope))found.set(t.url,t);
      result=[...found.values()]; collections=playlists();
      const count=kind==='discover'?collections.length:result.length;
      if (count && count === last) stable++; else stable = 0;
      last = count;
      if ((kind==='discover' && collections.length>=6) || result.length>=limit || (count && stable>=5)) break;
      if(count || Date.now()-start>2000){
        const bottom=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
        window.scrollTo(0,bottom);
        for(const pane of scope.querySelectorAll('.g-scrollable,.g-scrollable-inner,[class*="scrollContainer"]'))if(pane.scrollHeight>pane.clientHeight)pane.scrollTop=pane.scrollHeight;
      }
      await wait(750);
    }
    const signedOut=Boolean(document.querySelector('.header__loginButton, .header .loginButton')) && !document.querySelector('.header__userNavUsername, .header__userNavAvatar, .header__userNavButton');
    const emptyText=text(document.querySelector('#content') || document.body);
    const emptyConfirmed=kind==='likes' && /you (?:haven.t|have not) liked (?:any )?(?:tracks|songs)|no (?:liked tracks|likes) yet|haven.t liked any|нет (?:понравившихся|отмеченных) треков|ещ[её] не понравил/i.test(emptyText);
    return {tracks:result.slice(0,limit),playlists:collections,signedOut,emptyConfirmed,
      diagnostics:{kind,path:location.pathname,title:document.title,links:document.querySelectorAll('#content a[href]').length,knownCards:document.querySelectorAll(CARD).length,tracks:result.length}};
  }
  let lastAttempt = null;
  const normalize=s=>String(s || '').normalize('NFKC').replace(/\s+/g,' ').trim().toLowerCase();
  const usable=b=>b && !b.disabled && b.getAttribute('aria-disabled')!=='true' && !b.classList.contains('disabled');
  const CONTROLS='.playControls,.queue,[aria-label="miniplayer"],#scwave-host,.sidebarModule,.relatedSoundsModule';
  // A legacy #content can remain empty while the new track header is mounted
  // elsewhere. Discover only browser-accessible roots; inaccessible frames and
  // closed shadow roots are deliberately left alone.
  function pageRoots(){
    const roots=[document], seen=new Set(roots);
    for(let i=0;i<roots.length && i<40;i++){
      for(const el of roots[i].querySelectorAll('*')){
        if(el.id==='scwave-host' || el.closest?.('#scwave-host'))continue;
        let frame=null;
        if(el.tagName==='IFRAME'){try{frame=el.contentDocument;}catch{}}
        for(const root of [el.shadowRoot,frame])if(root && !seen.has(root) && roots.length<40){seen.add(root);roots.push(root);}
      }
    }
    return roots;
  }
  function headers(){return pageRoots().flatMap(root=>[...root.querySelectorAll('section[aria-label="Track header" i]')]).filter(e=>!e.closest(CONTROLS));}
  function pageRoot(){
    const header=headers().find(e=>playControl(e));
    if(header)return header;
    for(const root of pageRoots())for(const main of root.querySelectorAll('#content,main,[role="main"]')){
      if(main.querySelector('h1,[role="heading"][aria-level="1"],h2'))return main;
    }
    return document.body;
  }
  function pageHeading(){return pageRoot().querySelector('h1,[role="heading"][aria-level="1"],h2');}
  function controlLabel(b){
    return [b.getAttribute('aria-label'),b.title,b.getAttribute('data-testid'),b.getAttribute('data-test'),b.textContent?.slice(0,100)].filter(Boolean).join(' ').replace(/([a-z])([A-Z])/g,'$1 $2').replace(/[_-]+/g,' ').toLowerCase();
  }
  function isPause(b){return Boolean(b?.classList.contains('playing') || /\bpause\b|приостанов|пауза/.test(b?controlLabel(b):''));}
  function playControl(scope){
    for(const b of scope.querySelectorAll('button,[role="button"],a.playButton,.sc-button-play')){
      if(b.closest(CONTROLS) || !usable(b))continue;
      const name=controlLabel(b);
      if(/\b(next|previous|playlist|station|shuffle|queue)\b|следующ|предыдущ|плейлист|очеред/.test(name))continue;
      if(b.classList.contains('playButton') || b.classList.contains('sc-button-play') || /\bplay\b|\bpause\b|воспроиз|слушать|приостанов|пауза/.test(name))return b;
    }
    return null;
  }
  function cardButton(track){
    for(const a of document.querySelectorAll('a[href]')){
      if(C.canonical(a.getAttribute('href'))!==track.url || a.closest('.playControls,.queue,#scwave-host'))continue;
      const card=a.closest(CARD);
      const b=card?.querySelector('.playButton,.sc-button-play,button[aria-label^="Play"]');
      if(usable(b))return b;
    }
    return null;
  }
  function heroButton(track){
    if(C.canonical(location.href)!==track.url)return null;
    for(const header of headers()){
      const button=playControl(header);
      if(button)return button;
    }
    const heading=pageHeading();
    if(!heading || !text(heading)){
      return C.canonical(document.querySelector('link[rel="canonical"]')?.getAttribute('href'))===track.url?playControl(pageRoot()):null;
    }
    // The new track page has no .fullHero/.playButton. Match the accessible
    // control near the track heading. Profile permalinks and display artists
    // may differ from the track URL (renames/collaborations); never reject that.
    const title=normalize(text(heading)), expected=normalize(track.title), old=current();
    const canonicalPage=C.canonical(document.querySelector('link[rel="canonical"]')?.getAttribute('href'));
    if(old?.url!==track.url && title===normalize(old?.title) && title!==expected && canonicalPage!==track.url)return null;
    const root=pageRoot();
    for(let scope=heading.parentElement;scope;scope=scope.parentElement){
      const button=playControl(scope);
      if(button)return button;
      if(scope===root || scope===document.body)break;
    }
    return null;
  }
  function diagnostics(){return {...lastAttempt,page:location.href,current:current()?.url || null,progress:progress(),
    rawCurrent:document.querySelector('.playbackSoundBadge__titleLink')?.getAttribute('href') || null,
    heading:text(pageHeading()).slice(0,200),hasLegacyHero:Boolean(document.querySelector('.fullHero')),accessibleRoots:pageRoots().length,trackHeaders:headers().length,
    controls:[...pageRoot().querySelectorAll('button,[role="button"],a.playButton')].filter(b=>!b.closest(CONTROLS)).slice(0,20).map(b=>({tag:b.tagName,label:controlLabel(b).slice(0,180),class:String(b.className).slice(0,150),disabled:!usable(b)}))};}
  function playError(code,message){const e=new Error('['+code+'] '+message);e.code=code;e.diagnostics=diagnostics();return e;}
  async function play(track,signal){
    const start=Date.now();
    lastAttempt={target:track.url,stage:'locate',clicks:0,navigated:false};
    let lastClick=-Infinity, resumed=false, fallback=false;
    while(Date.now()-start<18000){
      if(signal?.aborted)throw new Error('Волна остановлена.');
      const cur=current(), p=progress(), elapsed=Date.now()-start;
      if(cur?.url===track.url && p.playing){lastAttempt.stage='playing';return;}
      if(p.ad){lastAttempt.stage='advertisement';await wait(300);continue;}
      let button;
      if(cur?.url===track.url){button=document.querySelector('.playControls__play');lastAttempt.stage='resume';}
      else {button=cardButton(track) || heroButton(track);lastAttempt.stage=button?'play-button':'waiting-for-track';}
      // Check current playback before each retry, so retrying never pauses a
      // song that already started. Reused hero DOM nodes are fully supported.
      if(usable(button) && !isPause(button) && Date.now()-lastClick>=1300 && lastAttempt.clicks<4){
        button.click();lastClick=Date.now();lastAttempt.clicks++;resumed=true;
      }
      if(!button && !lastAttempt.navigated && C.canonical(location.href)!==track.url){
        lastAttempt.navigated=true;lastAttempt.stage='navigate-link';
        const existing=[...document.querySelectorAll('a[href]')].find(a=>C.canonical(a.getAttribute('href'))===track.url && !a.closest('.playControls,.queue,#scwave-host'));
        if(existing)existing.click();
        else {const a=document.createElement('a');a.href=track.url;a.hidden=true;document.body.append(a);a.click();a.remove();}
      }
      if(!fallback && elapsed>=8000 && C.canonical(location.href)!==track.url){
        fallback=true;lastAttempt.stage='reload-once';
        // Background validates the pending target and persists a one-reload
        // budget. Never loop forever when navigation/autoplay is unavailable.
        const reply=await chrome.runtime.sendMessage({type:'navigate',url:track.url});
        if(reply?.error)throw playError('NAVIGATION',reply.error);
      }
      await wait(250);
    }
    if(current()?.url===track.url)throw playError('PLAYBACK_PAUSED','Нужный трек выбран, но плеер остался на паузе. Нажми Play на SoundCloud: возможно, Chrome требует пользовательское нажатие.');
    if(!resumed)throw playError('PLAY_BUTTON_MISSING','Не найдена готовая кнопка Play нужного трека. Открой его страницу; диагностика доступна в панели.');
    throw playError('PLAYBACK_NOT_STARTED','Нажатие Play не запустило нужный трек. Проверь доступность трека и открой диагностику в панели.');
  }
  globalThis.SCWaveAdapter = {cards,current,pageTrack,progress,collect,play,wait,diagnostics,heroButton,cardButton};
})();
