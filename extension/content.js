(() => {
  'use strict';
  const C = SCWaveCore, A = SCWaveAdapter;
  const send = async m => {
    const r = await chrome.runtime.sendMessage(m);
    if (r?.error) throw new Error(r.error);
    return r || {};
  };
  async function boot() {
    const mode = await send({type: 'mode'});
    if (mode.collector) {
      const banner = document.createElement('div');
      banner.textContent = 'Волна для SoundCloud · собираю похожие треки. Вкладка закроется автоматически.';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:2147483647;padding:14px;background:#1b1a20;color:#ffd1b7;font:14px system-ui;text-align:center';
      document.body.append(banner);
      await send({type: 'collected', ...await A.collect(mode.task)});
      return;
    }
    if (document.getElementById('scwave-host')) return;
    let prefs = C.load((await chrome.storage.local.get('preferences')).preferences);
    let running = false, busy = false, fetching = null, now = null, pending = null;
    let abort = new AbortController(), generation = 0, last = null, status = 'Добавь любимые треки — и включай волну.';
    let sources = [], fetched = new Set(), pool = new Map(), open = false;
    let saveChain = Promise.resolve();
    let listening = null, syncing = false, ticks = 0;
    let issue=(await chrome.storage.local.get('lastIssue')).lastIssue || null;
    const host = document.createElement('div');
    host.id = 'scwave-host';
    const shadow = host.attachShadow({mode: 'open'});
    // All interpolated track text is inserted with textContent below.
    shadow.innerHTML = `<style>
      :host{all:initial;display:block;position:fixed;z-index:2147483000;right:22px;bottom:82px;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif;color:#f4f1f6;color-scheme:dark}
      *{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible,a:focus-visible{outline:2px solid #ffaf86;outline-offset:3px}
      button{border:1px solid #403943;border-radius:10px;background:#29252e;color:#f6f1f7;padding:9px 12px;transition:background .15s}button:hover{background:#3c323d}button:disabled{opacity:.45;cursor:default}
      .launch{display:flex;align-items:center;gap:9px;border:1px solid #ff8952;background:#f76b2c;color:#1e110b;font-weight:750;border-radius:100px;box-shadow:0 6px 26px #0006;padding:12px 19px}
      .launch:hover{background:#ff955a}.dot{width:8px;height:8px;border-radius:50%;background:#2b170d}.live .dot{background:#d5ffb5;box-shadow:0 0 0 4px #d5ffb52a}
      .panel{width:390px;max-width:calc(100vw - 28px);max-height:calc(100vh - 170px);overflow:auto;border:1px solid #4d3c46;background:#19171e;border-radius:20px;box-shadow:0 20px 80px #0009;margin-bottom:12px;scrollbar-width:thin}
      [hidden]{display:none!important}.head{padding:22px 22px 17px;background:radial-gradient(ellipse at 90% -50%,#923e2890,transparent 75%);border-bottom:1px solid #342d38}.top{display:flex;align-items:center;justify-content:space-between}.eyebrow{font-size:10px;letter-spacing:2px;font-weight:700;color:#fca47b}.close{border:0;background:transparent;padding:3px 7px;font-size:23px;color:#b8aebd}
      h2{margin:5px 0 5px;font-size:27px;line-height:1.2;letter-spacing:-.8px}.sub{color:#aea3b4;font-size:12px}.body{padding:18px 22px}.status{font-size:12px;color:#ffd1b8;background:#31251f;border:1px solid #523829;padding:10px 12px;border-radius:10px;margin-bottom:16px;overflow-wrap:anywhere}
      .label{font-size:11px;font-weight:750;text-transform:uppercase;letter-spacing:1.4px;color:#b8aebf;margin:16px 0 9px}.row{display:flex;gap:7px;align-items:center}.row>*{min-width:0}.grow{flex:1}.small{font-size:12px;padding:7px 9px}.primary{background:#f6773c;border-color:#f6773c;color:#21130b;font-weight:750}.primary:hover{background:#ff9a69}.wide{width:100%;margin-top:12px;padding:12px;font-size:15px}
      .count{color:#fdab83;float:right}.grow{min-width:0}.seeds{display:flex;flex-wrap:wrap;gap:6px}.seed{display:flex;gap:6px;align-items:center;max-width:100%;padding:5px 8px 5px 11px;border:1px solid #48404f;border-radius:9px;background:#28232d;font-size:12px}.seed span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.seed button{border:0;background:transparent;padding:0 3px;color:#ad9daf}
      input[type=url]{width:100%;background:#211d27;border:1px solid #443a4c;border-radius:9px;color:#f4f1f6;padding:9px;font-size:12px;margin:10px 0 7px}input[type=range]{width:100%;accent-color:#ff8d55;margin:8px 0}.ends{display:flex;justify-content:space-between;font-size:11px;color:#a79cad}.empty{font-size:12px;color:#9c91a3;padding:6px 0}.divider{height:1px;background:#352d3c;margin:17px 0}
      .track-title{font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.artist{font-size:12px;color:#aa9bb3;margin-top:3px}.playing{padding:12px;border:1px solid #61402f;background:linear-gradient(130deg,#37251e,#241f2c);border-radius:12px}.playing .label{color:#fcaa80;margin:0 0 7px}
      #setup>summary{cursor:pointer;list-style:none}#setup>summary::before{content:'▸ ';color:#ffac84}#setup[open]>summary::before{content:'▾ '}#setup>summary::-webkit-details-marker{display:none}
      .queue{list-style:none;padding:0;margin:0}.queue li{display:flex;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid #302936}.num{color:#796c84;font-size:11px;width:14px}.queue a{display:block;max-width:100%;font-size:12px;color:#e1d8e9;text-decoration:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.why{font-size:10px;color:#8e7f9a}.note{font-size:11px;color:#908397;margin:14px 0 0}.tools{display:flex;flex-wrap:wrap;gap:6px;margin-top:13px}.danger{color:#ffb0a2}.detail{color:#b4a6bd;font-size:12px}.settings{margin-top:15px}.settings summary{cursor:pointer;font-size:12px;color:#c8b9d3}.settings p{color:#95899f;font-size:11px} .blocks{padding:8px 0;display:flex;flex-wrap:wrap;gap:5px}
      @media(max-width:520px){:host{right:14px;bottom:74px}.panel{max-height:calc(100vh - 160px)}}
      @media(prefers-reduced-motion:reduce){*{transition:none!important}}
    </style>
    <section class="panel" hidden aria-label="Моя волна для SoundCloud">
      <header class="head"><div class="top"><span class="eyebrow">SOUNDCLOUD · НЕОФИЦИАЛЬНОЕ РАСШИРЕНИЕ</span><button class="close" id="close" aria-label="Свернуть волну">×</button></div><h2>Твоя волна<span style="color:#ff8d55">.</span></h2><div class="sub">Любимый звук. Новые имена. Меньше повторов.</div></header>
      <div class="body"><div id="status" class="status" role="status" aria-live="polite"></div>
        <div id="library-counts" class="detail"></div><button class="small" id="sync-library" style="width:100%;margin-top:9px">Обновить мои лайки и рекомендации</button>
        <div class="note danger" id="sync-warning" role="status" hidden></div><button class="small" id="import-visible-likes" style="width:100%;margin-top:7px">Взять лайки с этой страницы</button>
        <details id="setup" open><summary class="label">Основа вкуса <span class="count" id="seed-count"></span></summary><div class="seeds" id="seeds"></div>
        <input id="url" type="url" placeholder="https://soundcloud.com/artist/track" aria-label="Ссылка на любимый трек">
        <div class="row"><button class="small grow" id="add-url">Добавить ссылку</button><button class="small grow" id="add-current">Текущий в основу</button></div>
        <div class="tools"><button class="small" id="add-page">Взять треки со страницы</button></div>
        <div class="label"><label for="explore">Разнообразие</label> <span class="count" id="explore-value"></span></div><input type="range" id="explore" min="0" max="100" step="5"><div class="ends"><span>Ближе к любимому</span><span>Больше открытий</span></div></details>
        <button class="primary wide" id="start">▶ Включить волну</button>
        <div class="divider"></div><div class="playing"><div class="label">Сейчас на SoundCloud</div><div id="now-title" class="track-title">Пока тихо</div><div id="now-artist" class="artist">Включи любой любимый трек</div><div id="learning" class="note">Учусь на реальном времени прослушивания.</div><div class="tools"><button class="small" id="favorite">♡ В мой вкус</button><button class="small" id="reject">Не нравится</button><button class="small primary" id="next">Дальше →</button></div><button class="small danger" id="block" style="margin-top:8px">Не предлагать исполнителя</button></div>
        <div class="label">Дальше в волне <span class="count" id="queue-count"></span></div><ol id="queue" class="queue"></ol>
        <div class="tools"><button class="small" id="refresh">Пополнить подборку</button></div>
        <details class="settings"><summary>Настройки и данные</summary><p><label><input type="checkbox" id="auto-sync"> Автоматически обновлять основу раз в сутки при запуске</label></p><p>Дослушал — плюс. Пропустил за первые 10 секунд или 15% — сильный минус. На середине — нейтрально. Паузы и перемотки не считаются прослушиванием; при выключении волны оценку не ставим.</p><p>Не повторяем треки из истории расширения за 30 дней (до 1500 треков). Старая история SoundCloud не импортируется. Реакции меняют только локальный подбор, а не лайки аккаунта.</p><div id="blocks" class="blocks"></div><button class="small" id="reset-history">Разрешить повторы снова</button><button class="small" id="reset-learning" style="margin-top:8px">Сбросить обучение</button><p>Для основы читаем до 240 лайков и до 6 плейлистов, показанных на твоей странице Discover, во временных фоновых вкладках. Звук воспроизводит сам SoundCloud.</p></details>
        <details class="settings" id="diagnostics" hidden><summary>Диагностика последней ошибки</summary><pre id="diagnostic-text" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:11px;color:#cdbdd6;user-select:text"></pre></details>
        <p class="note">Экспериментальная версия 0.2.4 · Подбор зависит от рекомендаций SoundCloud. Недоступные треки и окна входа могут остановить запуск.</p>
      </div></section>
      <button class="launch" id="launch" aria-expanded="false"><span class="dot"></span><span>Моя волна</span></button>`;
    document.documentElement.append(host);
    const $ = id => shadow.getElementById(id);
    const note = s => { status = s; $('status').textContent = s; };
    function toggle(value = !open) { open = value; shadow.querySelector('.panel').hidden = !value; $('launch').setAttribute('aria-expanded', String(value)); if (value) render(); }
    function savePrefs() {
      const value = structuredClone(prefs);
      saveChain = saveChain.catch(() => {}).then(() => chrome.storage.local.set({preferences: value}));
      return saveChain;
    }
    function persist() {
      return send({type: 'state', state: {running, now, pending, listening, sources, fetched: [...fetched], pool: [...pool.values()].slice(-500)}});
    }
    function ranked() { return C.rank(pool, prefs, now, () => 0.5); }
    function seedSources() {
      const likes=prefs.likes.filter(t=>C.sourceAllowed(prefs,t));
      // Sample across the imported likes, not just the first few newest likes.
      const sample=Array.from({length:Math.min(12,likes.length)},(_,i)=>likes[Math.floor(i*likes.length/Math.min(12,likes.length))]);
      return [...prefs.seeds,...sample].filter((t,i,all)=>all.findIndex(x=>x.url===t.url)===i && C.sourceAllowed(prefs,t)).map(t=>({...t,depth:0}));
    }
    function importPlaylists() {
      for(const p of prefs.playlists)C.merge(pool,p.tracks,p.url,0,'playlist');
    }
    function finish(reason) {
      if(!listening || listening.scored)return;
      const cur=A.current();
      if(cur?.url===listening.track.url)C.sample(listening,A.progress());
      const score=C.learn(prefs,listening,reason);
      if(score!==null){savePrefs(); if(score<=-0.65)sources=sources.filter(s=>s.url!==listening.track.url);}
    }
    async function syncLibrary() {
      if(syncing || busy)return;
      syncing=true; const activeAtStart=running, gen=generation;
      const warnings=[];
      try {
        await send({type:'claim'}); render();
        note('Читаю твои лайки SoundCloud…');
        try {const data=await send({type:'library',kind:'likes'});prefs.likes=data.tracks || [];}catch(e){warnings.push(e.message);}
        if(gen!==generation)return;
        note('Читаю плейлисты, предлагаемые на твоей странице Discover…');
        let collections;
        try {collections=(await send({type:'library',kind:'discover'})).playlists || [];}catch(e){warnings.push(e.message);}
        if(gen!==generation)return;
        if(collections){
          const imported=[];
          for(let i=0;i<collections.length;i++){
            const p=collections[i];note('Плейлист '+(i+1)+' / '+collections.length+': '+p.title);
            try {const data=await send({type:'library',kind:'playlist',url:p.url});imported.push({...p,tracks:data.tracks || []});}catch(e){warnings.push(e.message);}
            if(gen!==generation)return;
          }
          if(imported.length || !collections.length)prefs.playlists=imported;
        }
        prefs.syncError=warnings.join('\n');
        if(!warnings.length)prefs.lastSync=Date.now();
        sources=seedSources();fetched=new Set();importPlaylists();
        await savePrefs();if(running)await persist();
        note('Основа: '+prefs.likes.length+' лайков, '+prefs.playlists.length+' плейлистов.'+(warnings.length?' Часть данных не прочиталась: '+warnings[0]:' Готово.'));
      }finally{
        syncing=false;if(!activeAtStart)await send({type:'release'}).catch(()=>{});render();
      }
    }
    function source(track, depth = 0) {
      if (track && !sources.some(x => x.url === track.url)) sources.push({...track, depth});
      if (sources.length > 80) sources.splice(20, sources.length - 80);
    }
    function addSeed(t) {
      const track = C.clean(t);
      if (!track || prefs.seeds.some(x => x.url === track.url)) return false;
      if (prefs.seeds.length >= 20) { note('В основе уже 20 треков. Удали один, чтобы добавить другой.'); return false; }
      prefs.seeds.push(track); source(track); return true;
    }
    function render() {
      $('status').textContent = status;
      $('library-counts').textContent='Основа SoundCloud: '+prefs.likes.length+' лайков · '+prefs.playlists.length+' плейлистов';
      $('sync-warning').hidden=!prefs.syncError;$('sync-warning').textContent=prefs.syncError || '';
      $('diagnostics').hidden=!issue;$('diagnostic-text').textContent=issue?JSON.stringify(issue,null,2):'';
      $('sync-library').disabled=syncing || busy;
      $('sync-library').textContent=syncing?'Синхронизирую основу…':'Обновить мои лайки и рекомендации';
      $('start').disabled=syncing && !running;
      $('auto-sync').checked=prefs.autoSync;
      $('seed-count').textContent = prefs.seeds.length + ' / 20';
      $('explore').value = prefs.exploration;
      $('explore-value').textContent = prefs.exploration + '%';
      $('start').textContent = running ? '■ Выключить волну' : '▶ Включить волну';
      $('launch').classList.toggle('live', running);
      $('seeds').replaceChildren();
      if (!prefs.seeds.length) { const e = document.createElement('div'); e.className = 'empty'; e.textContent = 'Начни с 3–5 треков, которые тебе нравятся.'; $('seeds').append(e); }
      prefs.seeds.forEach(t => {
        const chip = document.createElement('div'); chip.className = 'seed';
        const name = document.createElement('span'); name.textContent = t.title; name.title = t.artist + ' — ' + t.title;
        const remove = document.createElement('button'); remove.textContent = '×'; remove.setAttribute('aria-label', 'Убрать ' + t.title);
        remove.onclick = () => { prefs.seeds = prefs.seeds.filter(x => x.url !== t.url); sources = sources.filter(x => x.url !== t.url); savePrefs(); render(); };
        chip.append(name, remove); $('seeds').append(chip);
      });
      const playing = A.current();
      $('now-title').textContent = playing?.title || 'Пока тихо';
      $('now-artist').textContent = playing?.artist || 'Включи любой любимый трек';
      for (const id of ['favorite', 'reject', 'block']) $(id).disabled = !playing;
      $('favorite').textContent = prefs.favorites.includes(playing?.url) ? '♥ В моём вкусе' : '♡ В мой вкус';
      $('next').disabled = !running || busy;
      const tracks = ranked();
      $('queue-count').textContent = String(tracks.length);
      $('queue').replaceChildren();
      tracks.slice(0, 5).forEach((t, i) => {
        const li = document.createElement('li'), n = document.createElement('span'), body = document.createElement('div'), a = document.createElement('a'), why = document.createElement('div');
        n.className = 'num'; n.textContent = String(i + 1).padStart(2, '0'); body.className = 'grow';
        a.href = t.url; a.textContent = t.artist + ' — ' + t.title; a.title = a.textContent;
        a.onclick = e => { e.preventDefault(); if (running) playTrack(t,'skip').catch(fail); else note('Сначала включи волну.'); };
        why.className = 'why'; why.textContent = t.kind==='playlist' ? 'Из плейлиста, предложенного тебе SoundCloud' : t.depth ? 'Открытие через похожий трек' : 'По лайкам и трекам из основы';
        body.append(a, why); li.append(n, body); $('queue').append(li);
      });
      if (!tracks.length) { const e = document.createElement('li'); e.className = 'empty'; e.textContent = fetching ? 'Собираю новые треки…' : 'Очередь появится после запуска волны.'; $('queue').append(e); }
      $('blocks').replaceChildren();
      prefs.blockedArtists.forEach(key => {
        const b = document.createElement('button'); b.className = 'small'; b.textContent = key + ' ×'; b.title = 'Снять блокировку';
        b.onclick = () => { prefs.blockedArtists = prefs.blockedArtists.filter(x => x !== key); savePrefs(); render(); };
        $('blocks').append(b);
      });
    }
    async function stop(message = 'Волна выключена. Текущий трек продолжает играть.') {
      // Stopping listening is not a dislike. Drop the unfinished observation.
      listening=null;
      running = false; generation++; abort.abort(); busy = false; pending = null;
      await send({type: 'release'}).catch(() => {}); note(message); render();
    }
    function fail(e) {
      issue={version:chrome.runtime.getManifest().version,at:new Date().toISOString(),message:e.message,code:e.code || null,...(e.diagnostics || A.diagnostics?.() || {})};
      chrome.storage.local.set({lastIssue:issue}).catch(()=>{});
      stop(e.message || 'Не удалось запустить волну.').catch(() => {});
    }
    async function refill(force = false) {
      if (fetching) return fetching;
      const gen = generation;
      fetching = (async () => {
        let attempts = 0, lastError = '';
        const needsInitialBlend = () => {
          const initial = seedSources().slice(0, 3);
          return initial.some(t => !fetched.has(t.url));
        };
        while (running && gen === generation && (ranked().length < 15 || force || needsInitialBlend()) && attempts < 3) {
          const src = sources.filter(s => !fetched.has(s.url) && C.sourceAllowed(prefs,s)).sort((a,b)=>C.sourceScore(prefs,b.url)-C.sourceScore(prefs,a.url))[0];
          if (!src) break;
          fetched.add(src.url); attempts++;
          note('Ищу похожее на «' + src.title + '»…');
          try {
            const r = await send({type: 'collect', url: src.url});
            if (!running || gen !== generation) return;
            if (!C.sourceAllowed(prefs,src)) continue;
            C.merge(pool, r.tracks || [], src.url, src.depth || 0);
            render();
          } catch (e) { lastError = e.message; }
          force = false;
        }
        if (!running || gen !== generation) return;
        if (!ranked().length && lastError) note(lastError);
        else note('Волна включена · ' + ranked().length + ' треков ждут впереди.');
        await persist();
      })().finally(() => { fetching = null; render(); });
      render(); return fetching;
    }
    async function playTrack(t, reason = null) {
      if (busy || !running) return;
      if(reason)finish(reason);
      busy = true; pending = t; render();
      const gen = generation;
      try {
        await persist();
        await A.play(t, abort.signal);
        if (!running || gen !== generation) return;
        now = t; pending = null;
        listening=C.newSession(t,A.progress());
        C.remember(prefs, t); pool.delete(t.url);
        // Do not expand a new branch before the listener has reacted to it.
        await savePrefs(); await persist();
        note('Играет «' + t.title + '». Подбираю продолжение.');
      } finally { busy = false; render(); }
      refill().catch(fail);
    }
    async function next(reason = 'skip') {
      if (!running || busy) return;
      finish(reason);
      if(now && C.sourceAllowed(prefs,now) && (prefs.feedback[now.url]?.score || 0)>0.2)source(now,Math.min(2,(now.depth||0)+1));
      let nextTrack = ranked()[0];
      if (!nextTrack) { await refill(true); nextTrack = ranked()[0]; }
      if (!running) return;
      if (!nextTrack) { await stop('Новые рекомендации закончились. Добавь ещё любимые треки или разреши повторы в настройках.'); return; }
      await playTrack(nextTrack);
    }
    async function start() {
      if (running) return stop();
      if(syncing)return;
      if (fetching) { note('Предыдущий сбор ещё завершается. Повтори запуск через несколько секунд.'); return; }
      if(prefs.autoSync && (!prefs.lastSync || Date.now()-prefs.lastSync>864e5))await syncLibrary();
      const playing = A.current() || A.pageTrack();
      if (!prefs.seeds.length && playing) addSeed(playing);
      const basis=seedSources();
      if (!basis.length && !prefs.playlists.some(p=>p.tracks.length)) { note('Не удалось собрать основу. Войди в SoundCloud, обнови лайки и рекомендации или добавь любимые треки вручную.'); return; }
      await send({type: 'claim'});
      running = true; generation++; abort = new AbortController(); fetched = new Set();
      $('setup').open = false;
      sources = basis; importPlaylists(); now = null;
      await savePrefs(); render();
      const related = document.querySelector('.relatedSoundsModule');
      if (related && playing) C.merge(pool, A.cards(related), playing.url, 0);
      // Keep the user's current song, then generate the continuation in the background.
      await playTrack(playing || ranked()[0] || basis[0]);
      shadow.querySelector('.panel').scrollTop = 0;
      refill().catch(fail);
    }
    $('launch').onclick = () => toggle(); $('close').onclick = () => toggle(false);
    $('sync-library').onclick=()=>syncLibrary().catch(e=>{note(e.message);render();});
    $('import-visible-likes').onclick=async()=>{
      if(!/\/(?:you|[\w-]+)\/likes\/?$/.test(location.pathname)){note('Открой свою страницу лайков SoundCloud, прокрути до треков и нажми эту кнопку.');return;}
      const found=A.cards(document.querySelector('#content,.l-content,main,[role="main"]') || document);
      if(!found.length){note('Карточки лайков пока не распознаны. Дождись загрузки и прокрути страницу.');return;}
      const byUrl=new Map([...prefs.likes,...found].map(t=>[t.url,t]));
      prefs.likes=[...byUrl.values()].slice(-240);prefs.syncError='';sources=seedSources();fetched=new Set();await savePrefs();
      note('Лайки с открытой страницы импортированы: '+found.length+'. Всего в основе: '+prefs.likes.length+'.');render();
      if(running)refill().catch(fail);
    };
    $('auto-sync').onchange=()=>{prefs.autoSync=$('auto-sync').checked;savePrefs();};
    $('add-url').onclick = () => {
      const url = C.canonical($('url').value.trim());
      if (!url) return note('Нужна полная ссылка soundcloud.com/исполнитель/трек. Плейлисты и короткие ссылки пока не поддерживаются.');
      if (addSeed({url})) { $('url').value = ''; savePrefs(); note('Трек добавлен в основу.'); render(); if (running) refill().catch(fail); }
    };
    $('url').onkeydown = e => { if (e.key === 'Enter') $('add-url').click(); };
    $('add-current').onclick = () => {
      if (addSeed(A.current() || A.pageTrack())) { savePrefs(); note('Текущий трек добавлен в основу.'); render(); if (running) refill().catch(fail); }
      else if (!A.current() && !A.pageTrack()) note('Сначала открой или включи любимый трек.');
    };
    $('add-page').onclick = () => {
      let n = 0;
      for (const t of A.cards().slice(0, 10)) if (addSeed(t)) n++;
      savePrefs(); note(n ? 'Добавлено треков в основу: ' + n + '. Можно включать волну.' : 'Новых треков не нашлось. Открой лайки или плейлист и прокрути до треков.'); render();
      if (running) refill().catch(fail);
    };
    $('explore').oninput = () => { prefs.exploration = Number($('explore').value); $('explore-value').textContent = prefs.exploration + '%'; };
    $('explore').onchange = () => { savePrefs(); render(); if (running && now && prefs.exploration >= 25) source(now, 1); };
    $('start').onclick = () => start().catch(fail);
    $('next').onclick = () => next().catch(fail);
    $('favorite').onclick = () => {
      const t = A.current(); if (!t) return;
      if (!prefs.favorites.includes(t.url)) prefs.favorites.push(t.url);
      C.learn(prefs,listening?.track.url===t.url?listening:C.newSession(t,A.progress()),'like');
      prefs.rejected = prefs.rejected.filter(x => x !== t.url);
      source(t, 0); savePrefs(); note('Учту этот трек при подборе. Лайки SoundCloud не меняются.'); render();
      if (running) refill().catch(fail);
    };
    $('reject').onclick = () => {
      const t = A.current(); if (!t) return;
      if (!prefs.rejected.includes(t.url)) prefs.rejected.push(t.url);
      C.learn(prefs,listening?.track.url===t.url?listening:C.newSession(t,A.progress()),'reject');
      if(listening)listening.scored=true;
      prefs.favorites = prefs.favorites.filter(x => x !== t.url);
      sources = sources.filter(x => x.url !== t.url); pool.delete(t.url);
      // Discard recommendations obtained only from this rejected source.
      for (const [url, item] of pool) if (item.sources.every(s => s === t.url)) pool.delete(url);
      savePrefs(); render(); if (running) next().catch(fail); else note('Больше не предложу этот трек.');
    };
    $('block').onclick = () => {
      const t = A.current(); if (!t) return;
      const key = C.artistKey(t); if (!prefs.blockedArtists.includes(key)) prefs.blockedArtists.push(key);
      sources = sources.filter(x => C.artistKey(x) !== key);
      savePrefs(); render(); if (running) next().catch(fail); else note('Исполнитель исключён из волны. Блокировку можно снять в настройках.');
    };
    $('refresh').onclick = async () => {
      if (!running) return note('Сначала включи волну.');
      if (!sources.some(s => !fetched.has(s.url))) note('Все источники уже проверены. Добавь трек в основу или нажми «В мой вкус» на новом треке.');
      else refill(true).catch(fail);
    };
    $('reset-history').onclick = () => { prefs.history = []; savePrefs(); note('История расширения очищена. Прослушанные треки снова могут попасть в волну.'); render(); };
    $('reset-learning').onclick=()=>{prefs.feedback={};savePrefs();note('Оценки прослушиваний сброшены. Явные дизлайки и блокировки сохранены.');render();};
    chrome.runtime.onMessage.addListener((m, _sender, respond) => {
      if (m.type === 'toggle') toggle();
      if (m.type === 'stop') stop(m.reason).catch(() => {});
      respond({ok: true});
    });
    // A manual track selection takes precedence over the wave.
    document.addEventListener('click', e => {
      if (!running || !e.isTrusted) return;
      const el = e.target instanceof Element ? e.target : null;
      if(el?.closest('.skipControl__next')){e.preventDefault();e.stopImmediatePropagation();next('skip').catch(fail);return;}
      const button=el?.closest('.playButton');
      if(button){
        const card=button.closest('.sound,.soundBadge,.trackItem,.compactTrackListItem,.fullHero');
        const same=button.classList.contains('playing') || (card?.matches('.fullHero')? A.pageTrack()?.url===A.current()?.url : C.canonical(card?.querySelector('a.soundTitle__title,a.trackItem__trackTitle,a.compactTrackListItem__trackTitle')?.getAttribute('href'))===A.current()?.url);
        if(same)return;
        finish('skip');stop('Ты выбрал другую музыку. Нажми «Включить волну», чтобы продолжить.').catch(() => {});
      }else if(el?.closest('.skipControl__previous'))stop('Ты вернулся к предыдущему треку. Волна выключена.').catch(()=>{});
    }, true);
    window.addEventListener('scwave:ended', e => {
      if (!running || busy || !now || last?.progress.ad) return;
      try {
        const media = JSON.parse(e.detail);
        // Do not react to previews, videos, ads or unrelated media elements.
        if (last?.url === now.url && last.progress.duration > 0 && Math.abs(media.duration - last.progress.duration) < 2 && media.time >= media.duration - 0.5) {C.sample(listening,{time:media.time,duration:media.duration,playing:false,ad:false});next('ended').catch(fail);}
      } catch { /* untrusted page event */ }
    });
    setInterval(() => {
      const cur = A.current(), p = A.progress();
      const naturalChange=last?.url===now?.url && last?.progress.duration>0 && last.progress.time>=last.progress.duration-2;
      if(running && !busy && now && cur && cur.url!==now.url && !p.ad && !last?.progress.ad && !naturalChange){
        finish('skip');stop('Трек переключён вне волны. Учёл прослушивание; волну можно включить снова.').catch(()=>{});
      }
      if(running && !busy && listening && cur?.url===listening.track.url){
        C.sample(listening,p);
        if(open)$('learning').textContent='Прослушано '+Math.round(listening.heard)+' сек. · '+Math.min(100,Math.round(listening.heard/Math.max(1,listening.duration)*100))+'%';
        if(++ticks%6===0)persist().catch(()=>{});
      }
      if (running && !busy && now && last && last.url === now.url && !last.progress.ad && last.progress.playing && last.progress.duration > 0 && last.progress.time >= last.progress.duration - 2) {
        const ended = cur?.url !== now.url || (p.time < 2 && last.progress.time > 5) || (!p.playing && p.time >= p.duration && p.duration > 0);
        if (ended) next('ended').catch(fail);
      }
      last = {url: cur?.url, progress: p};
      if (open && $('now-title').textContent !== (cur?.title || 'Пока тихо')) render();
    }, 900);
    prefs.seeds.forEach(t => source(t));
    render();
    // Resume only this tab's explicit wave after a full SoundCloud navigation.
    if (mode.state?.running) {
      const s = mode.state;
      running = true; abort = new AbortController();
      $('setup').open = false;
      sources = Array.isArray(s.sources) ? s.sources : sources; fetched = new Set(s.fetched || []);
      pool = new Map((s.pool || []).map(t => [t.url, t])); now = s.now;
      listening=s.listening || null;
      if (s.pending) playTrack(s.pending).catch(fail);
      else { note('Волна продолжает играть.'); refill().catch(fail); }
      render();
    }
  }
  boot().catch(e => console.warn('[SoundCloud Wave]', e.message));
})();
