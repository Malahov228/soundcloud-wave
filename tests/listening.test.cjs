const {test}=require('node:test'),assert=require('node:assert/strict');
const C=require('../extension/core.js');
const track={url:'https://soundcloud.com/artist/song',artist:'Artist',title:'Song',sources:['https://soundcloud.com/discover/sets/mix']};
const p=(time,playing=true)=>({time,duration:200,playing,ad:false});
function listen(seconds,start=0){const s=C.newSession(track,p(start),0);for(let i=1;i<=seconds;i++)C.sample(s,p(start+i),i*1000);return s;}
test('completed playback is positive, immediate skip negative, half neutral',()=>{
  assert.equal(C.feedbackValue(listen(200),'ended'),1);assert.equal(C.feedbackValue(listen(4),'skip'),-1);assert.equal(C.feedbackValue(listen(100),'skip'),0);assert.ok(C.feedbackValue(listen(150),'skip')>0);
});
test('pause time does not contribute to listening',()=>{
  const s=listen(10);C.sample(s,p(10,false),11000);C.sample(s,p(10,false),60000);C.sample(s,p(10,true),61000);C.sample(s,p(11),62000);
  assert.equal(s.heard,11);assert.equal(C.feedbackValue(s,'pause'),null);assert.equal(C.feedbackValue(s,'stop'),null);
});
test('seeking to the end is not a completed listen or negative training',()=>{
  const s=listen(4);C.sample(s,p(199),5000);C.sample(s,p(200,false),6000);assert.equal(s.heard,5);assert.equal(C.feedbackValue(s,'ended'),null);
});
test('starting halfway does not count the unheard beginning',()=>{const s=listen(50,100);assert.equal(s.heard,50);assert.equal(C.feedbackValue(s,'skip'),(0.25-0.5)/0.35);});
test('buffering, ads and long sleep gaps do not count',()=>{
  const s=listen(3);C.sample(s,p(3),4000);C.sample(s,{...p(4),ad:true},5000);C.sample(s,p(5),6000);C.sample(s,p(65),66000);assert.equal(s.heard,3);
});
test('feedback is recorded once and affects the source branch',()=>{
  const prefs=C.defaults(),s=listen(3);assert.equal(C.learn(prefs,s,'skip'),-1);assert.equal(C.learn(prefs,s,'skip'),null);assert.equal(C.sourceAllowed(prefs,track),false);
  assert.equal(prefs.feedback[track.url].origins[0],track.sources[0]);const pool=new Map();C.merge(pool,[{url:'https://soundcloud.com/other/related',title:'Related'}],track.url);assert.equal(C.rank(pool,prefs,null).length,0);
});
test('explicit like retains priority over one later skip',()=>{const prefs=C.defaults(),s=listen(2);C.learn(prefs,s,'like');C.learn(prefs,s,'skip');assert.ok(prefs.feedback[track.url].score>0);});
test('playlist parsing accepts personalized collections but refuses foreign URLs',()=>{
  assert.equal(C.playlist('https://soundcloud.com/discover/sets/mix?si=test'),'https://soundcloud.com/discover/sets/mix');assert.equal(C.playlist('/artist/sets/name'),'https://soundcloud.com/artist/sets/name');assert.equal(C.playlist('https://evil.test/artist/sets/mix'),null);assert.equal(C.playlist('/you/sets/secret'),null);
  assert.equal(C.playlist('/discover/sets/new-for-you::user-123'),'https://soundcloud.com/discover/sets/new-for-you%3A%3Auser-123');
  assert.equal(C.playlist('/discover/sets/new-for-you%3A%3Auser-123'),'https://soundcloud.com/discover/sets/new-for-you%3A%3Auser-123');
  assert.equal(C.playlist('/discover/sets/bad%2Fpath'),null);
});
test('likes act as preference anchors and are excluded from discovery repeats',()=>{
  const prefs=C.defaults();prefs.likes=[track];assert.equal(C.sourceScore(prefs,track.url),0.65);const pool=new Map();C.merge(pool,[track,{url:'https://soundcloud.com/other/song',title:'Other'}],track.url);assert.equal(C.rank(pool,prefs,null).length,1);
});
