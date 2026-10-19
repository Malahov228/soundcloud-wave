importScripts('core.js');
const C = SCWaveCore;
const jobs = new Map();
let chain = Promise.resolve();
let cache = new Map();
const readSession = async key => (await chrome.storage.session.get(key))[key];
// If Chrome suspended/restarted the worker during a request, its old helper
// cannot deliver that request anymore. Remove only registered orphan tabs.
const ready = (async () => {
  const ids = await readSession('helpers') || [];
  for (const id of ids) await chrome.tabs.remove(id).catch(() => {});
  await chrome.storage.session.set({helpers: []});
})();

async function collect(seed, owner, kind = 'related') {
  if (await readSession('owner') !== owner) throw new Error('Волна остановлена.');
  const key = kind + ':' + seed;
  const old = cache.get(key);
  if (old && Date.now() - old.at < 30 * 60e3) return old.tracks;
  let tab;
  try {
    // Register the helper before it loads, avoiding the content-script startup race.
    tab = await chrome.tabs.create({url: 'about:blank', active: false});
    const helpers = await readSession('helpers') || [];
    await chrome.storage.session.set({helpers: [...helpers, tab.id]});
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Не удалось прочитать рекомендации за 23 секунды. Проверь доступность SoundCloud и окна куки во вспомогательной вкладке.')), 23000);
      jobs.set(tab.id, {resolve, reject, owner, timer, kind});
    });
    await chrome.tabs.update(tab.id, {muted: true, url: kind === 'related' ? seed + '/recommended' : seed});
    const data = await result;
    if (data.signedOut && kind !== 'related') throw new Error('Войди в свой SoundCloud в этом же профиле браузера и повтори синхронизацию.');
    if(kind==='likes' && !data.tracks.length && !data.emptyConfirmed)throw new Error('[LIKES_NOT_READ] Страница лайков открылась, но треки не распознаны. Старые лайки сохранены. Открой свои лайки и нажми «Взять лайки с этой страницы».');
    if (kind === 'related' && !data.tracks.length) throw new Error('SoundCloud не показал похожие треки. Попробуй другой источник или собери треки с открытой страницы.');
    cache.set(key, {at: Date.now(), tracks:data});
    if (cache.size > 60) cache.delete(cache.keys().next().value);
    return data;
  } finally {
    if (tab) {
      clearTimeout(jobs.get(tab.id)?.timer);
      jobs.delete(tab.id);
      await chrome.tabs.remove(tab.id).catch(() => {});
      const helpers = await readSession('helpers') || [];
      await chrome.storage.session.set({helpers: helpers.filter(id => id !== tab.id)});
    }
  }
}

chrome.runtime.onMessage.addListener((m, sender, sendResponse) => {
  const run = async () => {
    await ready;
    if (sender.id !== chrome.runtime.id || !sender.tab || !sender.url?.startsWith('https://soundcloud.com/')) throw new Error('Недопустимый источник.');
    const id = sender.tab.id;
    switch (m.type) {
      case 'mode': {
        const helpers = await readSession('helpers') || [];
        const ownsState = await readSession('owner') === id && await readSession('waveStateOwner') === id;
        return {collector: helpers.includes(id), task: jobs.get(id)?.kind || 'related', state: ownsState ? await readSession('waveState') : null};
      }
      case 'collected': {
        const job = jobs.get(id);
        if (job) job.resolve({tracks:(Array.isArray(m.tracks) ? m.tracks : []).map(C.clean).filter(Boolean).slice(0,job.kind==='likes'?240:80),playlists:(Array.isArray(m.playlists)?m.playlists:[]).filter(x=>C.playlist(x?.url)).slice(0,6).map(x=>({url:C.playlist(x.url),title:String(x.title||'Плейлист').slice(0,200)})),signedOut:Boolean(m.signedOut),emptyConfirmed:Boolean(m.emptyConfirmed)});
        return {ok: true};
      }
      case 'claim': {
        const prev = await readSession('owner');
        await chrome.storage.session.set({owner: id});
        if (prev && prev !== id) {
          await chrome.tabs.sendMessage(prev, {type: 'stop', reason: 'Волна включена в другой вкладке.'}).catch(() => {});
          for (const job of jobs.values()) if (job.owner === prev) job.reject(new Error('Волна включена в другой вкладке.'));
        }
        return {ok: true};
      }
      case 'state': {
        if (await readSession('owner') === id) await chrome.storage.session.set({waveState: m.state, waveStateOwner: id});
        return {ok: true};
      }
      case 'navigate': {
        const url=C.canonical(m.url), state=await readSession('waveState');
        if(!url || await readSession('owner')!==id || await readSession('waveStateOwner')!==id || C.canonical(state?.pending?.url)!==url)throw new Error('Переход отменён: активный трек изменился.');
        if((state.pending.navigationAttempts || 0)>=1)throw new Error('Повторная перезагрузка не помогла. Нужна диагностика кнопки Play, дальнейшие перезагрузки остановлены.');
        state.pending.navigationAttempts=(state.pending.navigationAttempts || 0)+1;
        await chrome.storage.session.set({waveState:state});
        await chrome.tabs.update(id,{url});
        return {ok:true};
      }
      case 'release': {
        if (await readSession('owner') === id) await chrome.storage.session.remove('owner');
        for (const job of jobs.values()) if (job.owner === id) job.reject(new Error('Волна остановлена.'));
        return {ok: true};
      }
      case 'collect': {
        const seed = C.canonical(m.url);
        if (!seed) throw new Error('Нужна ссылка на отдельный трек SoundCloud.');
        const task = chain.catch(() => {}).then(() => collect(seed, id));
        chain = task.catch(() => {});
        return await task;
      }
      case 'library': {
        const url = m.kind === 'likes' ? 'https://soundcloud.com/you/likes' : m.kind === 'discover' ? 'https://soundcloud.com/discover' : m.kind === 'playlist' ? C.playlist(m.url) : null;
        if (!url) throw new Error('Недопустимый источник библиотеки.');
        // Explicit sync should refresh the user's personalized data immediately.
        cache.delete(m.kind + ':' + url);
        const task = chain.catch(() => {}).then(() => collect(url,id,m.kind));
        chain = task.catch(() => {});
        return await task;
      }
      default: throw new Error('Неизвестная команда.');
    }
  };
  run().then(sendResponse, e => sendResponse({error: e.message}));
  return true;
});

chrome.action.onClicked.addListener(async tab => {
  if (tab.url?.startsWith('https://soundcloud.com/')) {
    try { await chrome.tabs.sendMessage(tab.id, {type: 'toggle'}); }
    catch { await chrome.tabs.reload(tab.id); }
  } else await chrome.tabs.create({url: 'https://soundcloud.com/discover'});
});
chrome.tabs.onRemoved.addListener(id => {
  jobs.get(id)?.reject(new Error('Вспомогательная вкладка закрыта.'));
  for (const job of jobs.values()) if (job.owner === id) job.reject(new Error('Главная вкладка закрыта.'));
  readSession('owner').then(owner => { if (owner === id) chrome.storage.session.remove('owner'); });
});
// Session storage survives worker suspension. Clean up an interrupted helper on restart.
chrome.runtime.onStartup.addListener(async () => {
  const ids = await readSession('helpers') || [];
  for (const id of ids) await chrome.tabs.remove(id).catch(() => {});
  await chrome.storage.session.remove(['helpers', 'owner']);
});
