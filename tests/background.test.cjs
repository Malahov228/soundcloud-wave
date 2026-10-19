const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm=require('node:vm'), fs=require('node:fs'), path=require('node:path');
const root=path.resolve(__dirname,'../extension');
function setup({delayed=false, data=null}={}) {
  const session={}, callbacks={}, live=new Map(), sent=[], created=[];
  let lastId=100,maxLive=0;
  const context=vm.createContext({URL,console,setTimeout,clearTimeout,structuredClone});
  const request=(m,id=1,url='https://soundcloud.com/artist/track')=>new Promise(resolve=>callbacks.message(m,{id:'extension-id',tab:{id},url},resolve));
  context.chrome={runtime:{id:'extension-id',onMessage:{addListener:f=>callbacks.message=f},onStartup:{addListener:f=>callbacks.start=f}},storage:{session:{get:async key=>({[key]:session[key]}),set:async obj=>Object.assign(session,structuredClone(obj)),remove:async keys=>{for(const key of [keys].flat())delete session[key]}}},tabs:{create:async args=>{const tab={id:++lastId,...args};live.set(tab.id,tab);created.push(tab);maxLive=Math.max(maxLive,live.size);return tab;},update:async(id,args)=>{if(live.has(id))Object.assign(live.get(id),args);if(args.url&&live.has(id)&&!delayed)setTimeout(async()=>{const mode=await request({type:'mode'},id,args.url);assert.equal(mode.collector,true); await request({type:'collected',...(data||{tracks:[{url:'https://soundcloud.com/other/new-song',title:'New Song',artist:'Other'}]})},id,args.url);},5);},remove:async id=>{live.delete(id); callbacks.remove?.(id);},sendMessage:async(id,m)=>sent.push({id,m}),reload:async()=>{},onRemoved:{addListener:f=>callbacks.remove=f}},action:{onClicked:{addListener:f=>callbacks.action=f}}};
  context.importScripts=file=>vm.runInContext(fs.readFileSync(path.join(root,file),'utf8'),context);
  vm.runInContext(fs.readFileSync(path.join(root,'background.js'),'utf8'),context);
  return {request,session,live,sent,created,get maxLive(){return maxLive}};
}
test('collector reads via registered helper, mutes it, closes it and caches results',async()=>{
  const x=setup(); await x.request({type:'claim'});
  const r=await x.request({type:'collect',url:'https://soundcloud.com/a/b'});
  assert.equal(r.tracks[0].title,'New Song'); assert.equal(x.created[0].muted,true); assert.equal(x.live.size,0); assert.deepEqual(x.session.helpers,[]);
  await x.request({type:'collect',url:'https://soundcloud.com/a/b'}); assert.equal(x.created.length,1);
});
test('reject invalid destination and unauthorized sender before opening tabs',async()=>{
  const x=setup(); await x.request({type:'claim'});
  assert.match((await x.request({type:'collect',url:'https://evil.test/a/b'})).error,/ссылка/);
  assert.match((await x.request({type:'collect',url:'https://soundcloud.com/a/b'},1,'https://evil.test/')).error,/источник/);
  assert.equal(x.created.length,0);
});
test('serialize concurrent collections to at most one helper',async()=>{
  const x=setup();await x.request({type:'claim'});
  const results=await Promise.all([x.request({type:'collect',url:'https://soundcloud.com/a/b'}),x.request({type:'collect',url:'https://soundcloud.com/c/d'})]);
  assert.equal(results.filter(x=>x.tracks).length,2);assert.equal(x.maxLive,1);assert.equal(x.live.size,0);
});
test('second tab claims ownership and tells the previous tab to stop',async()=>{
  const x=setup();await x.request({type:'claim'},1);await x.request({type:'claim'},2);
  assert.equal(x.session.owner,2);assert.equal(x.sent[0].id,1);assert.equal(x.sent[0].m.type,'stop');
  const r=await x.request({type:'collect',url:'https://soundcloud.com/a/b'},1);assert.match(r.error,/остановлена/);
});
test('stop cancels outstanding collection and closes helper',async()=>{
  const x=setup({delayed:true});await x.request({type:'claim'});
  const result=x.request({type:'collect',url:'https://soundcloud.com/a/b'});
  await new Promise(r=>setTimeout(r,15));await x.request({type:'release'});
  assert.match((await result).error,/остановлена/);assert.equal(x.live.size,0);
});
test('restore pending navigation only for the tab that saved it',async()=>{
  const x=setup();await x.request({type:'claim'},1);await x.request({type:'state',state:{running:true,pending:{url:'https://soundcloud.com/a/b'}}},1);
  assert.equal((await x.request({type:'mode'},1)).state.running,true);
  await x.request({type:'claim'},2);assert.equal((await x.request({type:'mode'},2)).state,null);
  assert.equal((await x.request({type:'mode'},1)).state,null);
});
test('library uses only own likes, Discover and validated playlist pages',async()=>{
  const x=setup({data:{emptyConfirmed:true,tracks:[],playlists:[{url:'https://soundcloud.com/discover/sets/weekly',title:'Weekly'},{url:'https://evil.test/a/sets/b',title:'Invalid'}]}});await x.request({type:'claim'});
  const likes=await x.request({type:'library',kind:'likes',url:'https://evil.test/'});assert.equal(likes.tracks.length,0);assert.equal(x.created[0].url,'https://soundcloud.com/you/likes');
  const discover=await x.request({type:'library',kind:'discover'});assert.equal(discover.playlists.length,1);assert.equal(x.created[1].url,'https://soundcloud.com/discover');
  await x.request({type:'library',kind:'playlist',url:discover.playlists[0].url});assert.equal(x.created[2].url,'https://soundcloud.com/discover/sets/weekly');
  assert.match((await x.request({type:'library',kind:'playlist',url:'https://evil.test/a/sets/b'})).error,/источник/);assert.equal(x.created.length,3);
});
test('signed-out library reports login requirement and still cleans helper',async()=>{
  const x=setup({data:{signedOut:true,tracks:[]}});await x.request({type:'claim'});const result=await x.request({type:'library',kind:'likes'});assert.match(result.error,/Войди/);assert.equal(x.live.size,0);
});
test('zero unrecognized likes are an error, not a successful empty import',async()=>{
  const x=setup({data:{tracks:[],signedOut:false}});await x.request({type:'claim'});
  const result=await x.request({type:'library',kind:'likes'});assert.match(result.error,/LIKES_NOT_READ/);assert.equal(x.live.size,0);
});
test('navigation fallback is restricted to the pending song and at most once',async()=>{
  const x=setup();await x.request({type:'claim'});
  await x.request({type:'state',state:{running:true,pending:{url:'https://soundcloud.com/a/b'}}});
  assert.equal((await x.request({type:'navigate',url:'https://soundcloud.com/a/b'})).ok,true);
  assert.equal(x.session.waveState.pending.navigationAttempts,1);
  assert.match((await x.request({type:'navigate',url:'https://soundcloud.com/a/b'})).error,/перезагрузка/);
  assert.match((await x.request({type:'navigate',url:'https://soundcloud.com/c/d'})).error,/изменился/);
  assert.match((await x.request({type:'navigate',url:'https://soundcloud.com/a/b'},2)).error,/изменился/);
});

