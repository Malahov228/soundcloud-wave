const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const base=__dirname,extension=path.resolve(__dirname,'../../extension');
const pages=new Set(['adapter-tests.html','adapter-tests.js','wave-integration.html','wave-integration.js']);
const scripts=new Set(['core.js','adapter.js','content.js']);
http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost');
  const name=path.basename(url.pathname==='/'?'adapter-tests.html':url.pathname);
  const isExtension=url.pathname.startsWith('/extension/');
  if(!(isExtension?scripts:pages).has(name)){res.writeHead(404);return res.end('Not found');}
  const file=path.join(isExtension?extension:base,name);
  fs.readFile(file,(err,data)=>{
    if(err){res.writeHead(404);return res.end('Not found');}
    res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript; charset=utf-8':'text/html; charset=utf-8');
    res.end(data);
  });
}).listen(4317,'127.0.0.1',()=>console.log('Browser tests: http://127.0.0.1:4317/adapter-tests.html'));
