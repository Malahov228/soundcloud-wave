/* Pure ranking and validation. No network, cookies, account tokens or audio files. */
(function (root) {
  'use strict';
  const reserved = new Set(['you', 'discover', 'feed', 'search', 'tags', 'pages', 'settings', 'upload', 'stream', 'charts', 'stations', 'messages', 'notifications', 'terms-of-use', 'jobs', 'company', 'logout', 'login', 'oauth', 'connect', 'activate', 'premium', 'subscriptions', 'subscription', 'imprint', 'mobile', 'for-artists', 'pro', 'n']);
  function canonical(value) {
    try {
      const u = new URL(value, 'https://soundcloud.com');
      if (u.protocol !== 'https:' || u.hostname !== 'soundcloud.com' || u.port || u.username || u.password) return null;
      const parts = u.pathname.split('/').filter(Boolean);
      if (parts.length !== 2 || reserved.has(parts[0].toLowerCase()) || parts[1] === 'sets') return null;
      if (['likes','following','followings','followers','tracks','albums','reposts','popular-tracks','recommended'].includes(parts[1].toLowerCase())) return null;
      if (parts.some(p => !/^[a-zA-Z0-9_-]+$/.test(p))) return null;
      return 'https://soundcloud.com/' + parts.join('/');
    } catch { return null; }
  }
  function artistKey(track) { return canonical(track.url)?.split('/')[3] || ''; }
  function playlist(value) {
    try {
      const u = new URL(value, 'https://soundcloud.com');
      if (u.protocol !== 'https:' || u.hostname !== 'soundcloud.com' || u.port || u.username || u.password) return null;
      const parts = u.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (parts.length !== 3 || parts[1] !== 'sets' || (reserved.has(parts[0].toLowerCase()) && parts[0] !== 'discover') || !/^[\w-]+$/.test(parts[0]) || !/^[\w:-]+$/.test(parts[2])) return null;
      // Personalized collections use colon-separated slugs (new-for-you::user).
      return 'https://soundcloud.com/' + parts.map(encodeURIComponent).join('/');
    } catch { return null; }
  }
  function clean(track) {
    const url = canonical(track?.url);
    if (!url) return null;
    return { url, title: String(track.title || url.split('/').pop()).slice(0, 250),
      artist: String(track.artist || url.split('/')[3]).slice(0, 160),
      tag: String(track.tag || '').slice(0, 100), date: String(track.date || '').slice(0, 40) };
  }
  function defaults() { return {seeds: [], history: [], rejected: [], blockedArtists: [], favorites: [], exploration: 40, likes: [], playlists: [], feedback: {}, autoSync: true, lastSync: 0}; }
  function load(raw = {}) {
    const p = defaults();
    p.seeds = (Array.isArray(raw.seeds) ? raw.seeds : []).map(clean).filter(Boolean).slice(0, 20);
    p.history = (Array.isArray(raw.history) ? raw.history : []).filter(x => canonical(x?.url) && Number.isFinite(x.at) && Date.now() - x.at < 30 * 864e5).slice(-1500);
    for (const k of ['rejected', 'favorites']) p[k] = [...new Set((Array.isArray(raw[k]) ? raw[k] : []).map(canonical).filter(Boolean))].slice(-2000);
    p.blockedArtists = (Array.isArray(raw.blockedArtists) ? raw.blockedArtists : []).filter(x => typeof x === 'string' && /^[\w-]+$/.test(x)).slice(-500);
    p.exploration = Math.max(0, Math.min(100, Number(raw.exploration ?? 40) || 0));
    p.likes = (Array.isArray(raw.likes) ? raw.likes : []).map(clean).filter(Boolean).slice(0, 240);
    p.playlists = (Array.isArray(raw.playlists) ? raw.playlists : []).filter(x => playlist(x?.url)).slice(0, 6).map(x => ({url:playlist(x.url),title:String(x.title || 'Рекомендованный плейлист').slice(0,200),tracks:(x.tracks || []).map(clean).filter(Boolean).slice(0,80)}));
    p.autoSync = raw.autoSync !== false;
    p.lastSync = Number(raw.lastSync) || 0;
    p.syncError = String(raw.syncError || '').slice(0,1000);
    for (const [url, f] of Object.entries(raw.feedback || {}).slice(-1500)) {
      if (canonical(url) && Number.isFinite(f?.score) && Number.isFinite(f.at) && Date.now()-f.at<90*864e5) p.feedback[url]={score:Math.max(-1,Math.min(1,f.score)),at:f.at,heard:Math.max(0,Number(f.heard)||0),duration:Math.max(0,Number(f.duration)||0),reason:String(f.reason||'').slice(0,25),explicit:Boolean(f.explicit),origins:(Array.isArray(f.origins)?f.origins:[]).map(x=>canonical(x)||playlist(x)).filter(Boolean).slice(0,20)};
    }
    return p;
  }
  function merge(pool, tracks, source, depth = 0, kind = 'related') {
    for (let i = 0; i < tracks.length; i++) {
      const t = clean(tracks[i]);
      if (!t) continue;
      const old = pool.get(t.url);
      const sources = [...new Set([...(old?.sources || []), source])].slice(0, 20);
      pool.set(t.url, {...t, sources, kind:old?.kind === 'playlist' ? 'playlist' : kind, rank: Math.min(old?.rank ?? i, i), depth: Math.min(old?.depth ?? depth, depth)});
    }
    // Bound memory even in a long session.
    while (pool.size > 1000) pool.delete(pool.keys().next().value);
  }
  function rank(pool, prefs, current, rng = Math.random) {
    const exclude = new Set([...prefs.history.map(x => x.url), ...prefs.rejected, ...prefs.seeds.map(x => x.url), ...(prefs.likes || []).map(x=>x.url), current?.url]);
    const recentArtists = prefs.history.slice(-5).map(x => x.artistKey);
    const seedSources = new Set(prefs.seeds.map(x => x.url));
    const exploration = prefs.exploration / 100;
    return [...pool.values()].filter(t => !exclude.has(t.url) && !prefs.blockedArtists.includes(artistKey(t))).map(t => {
      const sameArtist = recentArtists.filter(x => x === artistKey(t)).length;
      const allowedSources = t.sources.filter(x => sourceAllowed(prefs, {url:x}));
      if (t.sources.length && !allowedSources.length) return {...t,score:-Infinity};
      const seedAffinity = allowedSources.filter(x => seedSources.has(x)).length;
      const favoriteAffinity = allowedSources.filter(x => prefs.favorites.includes(x)).length;
      const learned = allowedSources.reduce((sum,x)=>sum+sourceScore(prefs,x),0)/Math.max(1,allowedSources.length);
      const score = 5 / (1 + t.rank / 8) + seedAffinity * 1.8 + favoriteAffinity * 2 + learned * 3 + artistScore(prefs,artistKey(t)) * 2 + (t.kind === 'playlist' ? 1.2 : 0)
        - sameArtist * 4 - (artistKey(t) === artistKey(current || {}) ? 3 : 0)
        + t.depth * (exploration * 5 - 2) + rng() * (0.5 + exploration * 6);
      return {...t, score};
    }).filter(t=>Number.isFinite(t.score)).sort((a, b) => b.score - a.score);
  }
  function sourceAllowed(p, t) {
    return !p.rejected.includes(t.url) && !p.blockedArtists.includes(artistKey(t)) && (p.feedback?.[t.url]?.score ?? 0) > -0.65;
  }
  function sourceScore(p, url) {
    const direct=p.feedback?.[url];
    if (direct) return direct.score;
    if ((p.likes || []).some(t=>t.url===url)) return 0.65;
    const observations=Object.values(p.feedback || {}).filter(f=>f.origins?.includes(url));
    return observations.reduce((sum,f)=>sum+f.score,0)/(3+observations.length);
  }
  function artistScore(p, key) {
    const observations=Object.entries(p.feedback || {}).filter(([url])=>artistKey({url})===key);
    return observations.reduce((sum,[,f])=>sum+f.score*(f.explicit?2:1),0)/(3+observations.length);
  }
  function newSession(track, progress, at=Date.now()) {
    return {track,heard:0,duration:progress.duration||0,last:{...progress,at},scored:false};
  }
  function sample(session, p, at=Date.now()) {
    if (!session || session.scored) return;
    const prev=session.last, wall=(at-prev.at)/1000, delta=p.time-prev.time;
    // Only actual forward playback. Seeking, buffering, pauses and sleep gaps
    // are not listening. Starting in the middle does not count the unseen half.
    if (wall>0 && wall<=10 && prev.playing && !prev.ad && !p.ad && delta>0 && delta<=wall*1.8+0.6) session.heard+=Math.min(delta,wall*1.3);
    if(p.duration>0)session.duration=p.duration;
    session.last={...p,at};
  }
  function feedbackValue(session, reason) {
    const duration=session.duration, heard=session.heard;
    if(reason==='like')return 1;
    if(reason==='reject')return -1;
    if(!['skip','ended'].includes(reason) || duration<=0)return null;
    const ratio=Math.min(1,heard/duration);
    // Seeking to the end is not a completed listen and should not punish a track.
    if(reason==='ended' && ratio<0.65)return null;
    if(reason==='ended' && ratio>=0.8)return 1;
    if(heard<=10 || ratio<=0.15)return -1;
    if(ratio<0.5)return (ratio-0.5)/0.35;
    return Math.min(1,(ratio-0.5)/0.4);
  }
  function learn(p, session, reason, at=Date.now()) {
    if(!session || (session.scored && !['like','reject'].includes(reason)))return null;
    const score=feedbackValue(session,reason);
    if(!['like','reject'].includes(reason))session.scored=true;
    if(score===null)return null;
    const explicit=['like','reject'].includes(reason), old=p.feedback?.[session.track.url];
    p.feedback ||= {};
    // Explicit judgments retain priority; an accidental skip cannot erase a like.
    const combined=explicit ? score : old?.explicit ? old.score*0.7+score*0.3 : old ? old.score*0.35+score*0.65 : score;
    p.feedback[session.track.url]={score:combined,at,heard:Math.round(session.heard),duration:session.duration,reason,explicit:explicit||Boolean(old?.explicit),origins:[...(session.track.sources || [])].slice(0,20)};
    const all=Object.entries(p.feedback).sort((a,b)=>a[1].at-b[1].at);
    for(const [url] of all.slice(0,Math.max(0,all.length-1500)))delete p.feedback[url];
    return score;
  }
  function remember(prefs, t, now = Date.now()) {
    prefs.history = prefs.history.filter(x => x.url !== t.url && now - x.at < 30 * 864e5);
    prefs.history.push({url: t.url, artistKey: artistKey(t), at: now});
    prefs.history = prefs.history.slice(-1500);
  }
  const api = {canonical, playlist, clean, artistKey, defaults, load, merge, rank, remember,sourceAllowed,sourceScore,artistScore,newSession,sample,feedbackValue,learn};
  root.SCWaveCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
