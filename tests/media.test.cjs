const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('bridge observes detached media without changing play behavior, only latest element ends',async()=>{
  const sent=[];
  class Media extends EventTarget {play(){return Promise.resolve('native-return')}duration=120;currentTime=120;}
  const window={dispatchEvent:e=>sent.push(e)};
  const context=vm.createContext({window,HTMLMediaElement:Media,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},WeakSet,Reflect,JSON});
  vm.runInContext(fs.readFileSync('extension/media-bridge.js','utf8'),context);
  const a=new Media(),b=new Media();assert.equal(await a.play(),'native-return');a.dispatchEvent(new Event('playing'));a.dispatchEvent(new Event('ended'));assert.equal(sent.length,1);
  await b.play();b.dispatchEvent(new Event('playing'));a.dispatchEvent(new Event('ended'));assert.equal(sent.length,1);b.dispatchEvent(new Event('ended'));assert.equal(sent.length,2);
  assert.equal(JSON.parse(sent[1].detail).duration,120);
});
