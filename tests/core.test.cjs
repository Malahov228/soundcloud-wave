const {test} = require('node:test');
const assert = require('node:assert/strict');
const C = require('../extension/core.js');
const t = (artist, slug) => ({url:`https://soundcloud.com/${artist}/${slug}`,title:slug,artist});
test('accept only exact SoundCloud track URLs and strip tracking', () => {
  assert.equal(C.canonical('https://soundcloud.com/artist/song?si=private#comments'), 'https://soundcloud.com/artist/song');
  assert.equal(C.canonical('/artist/song/'), 'https://soundcloud.com/artist/song');
  for (const value of ['https://evil.test/artist/song', 'https://soundcloud.com.evil.test/a/b', 'javascript:alert(1)', 'http://soundcloud.com/a/b', 'https://soundcloud.com:999/a/b', 'https://user:pass@soundcloud.com/a/b', '/you/likes', '/tags/house', '/artist/sets', '/artist/sets/mix', '/a/b/recommended', '/a/b%2Fc', 'https://on.soundcloud.com/test', '/search/sounds']) assert.equal(C.canonical(value), null, value);
});
test('merge overlapping recommendations, count sources, keep best rank', () => {
  const pool = new Map(); C.merge(pool,[t('a','x'),t('a','x'),t('b','y')],'seed-1'); C.merge(pool,[t('b','y')],'seed-2',1);
  assert.equal(pool.size,2); assert.deepEqual(pool.get(t('b','y').url).sources,['seed-1','seed-2']); assert.equal(pool.get(t('b','y').url).rank,0);
});
test('exclude seeds, history, current, dislikes and blocked artists', () => {
  const tracks=['seed','heard','current','reject','okay'].map(s=>t('artist',s)); tracks.push(t('blocked','other'));
  const prefs=C.defaults(); prefs.seeds=[tracks[0]]; C.remember(prefs,tracks[1]); prefs.rejected=[tracks[3].url]; prefs.blockedArtists=['blocked'];
  const pool=new Map(); C.merge(pool,tracks,'source');
  assert.deepEqual(C.rank(pool,prefs,tracks[2],()=>.5).map(x=>x.url),[tracks[4].url]);
});
test('prefer diversity over recently repeated uploader', () => {
  const p=C.defaults(); C.remember(p,t('same','heard')); const pool=new Map(); C.merge(pool,[t('same','new'),t('different','new')],'s');
  assert.equal(C.rank(pool,p,null,()=>.5)[0].artist,'different');
});
test('exploration changes direct/deeper ranking without allowing repeats', () => {
  const p=C.defaults(), pool=new Map(); C.merge(pool,[t('a','direct')],'s',0); C.merge(pool,[t('b','deeper')],'s2',2);
  p.exploration=0; assert.equal(C.rank(pool,p,null,()=>.5)[0].title,'direct');
  p.exploration=100; assert.equal(C.rank(pool,p,null,()=>.5)[0].title,'deeper');
});
test('load prunes old history, validates data, honors exploration zero', () => {
  const loaded=C.load({history:[{url:t('a','old').url,at:Date.now()-31*864e5},{url:t('a','new').url,at:Date.now()}],exploration:0,seeds:[t('a','valid'),{url:'https://evil.test/a/b'}]});
  assert.equal(loaded.history.length,1); assert.equal(loaded.seeds.length,1); assert.equal(loaded.exploration,0); assert.equal(C.load().exploration,40);
});
test('history remains bounded and deduplicates', () => {
  const p=C.defaults(); for(let i=0;i<1600;i++) C.remember(p,t('a','s'+i)); C.remember(p,t('a','s1599'));
  assert.equal(p.history.length,1500); assert.equal(p.history.filter(x=>x.url.endsWith('/s1599')).length,1);
});
test('profile navigation URLs are not mistaken for track links',()=>{
  for(const leaf of ['likes','followers','following','tracks','albums','popular-tracks','reposts'])assert.equal(C.canonical('https://soundcloud.com/user/'+leaf),null);
});
