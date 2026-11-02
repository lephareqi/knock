'use strict';
const http=require('http');
const fs=require('fs');
const path=require('path');

const CFG={
PORT:parseInt(process.env.PORT||'3000',10),
HOST:process.env.HOST||'0.0.0.0',
RPC_URL:process.env.RPC_URL||'',
GITHUB_TOKEN:process.env.GITHUB_TOKEN||'',
DOMAIN:process.env.DOMAIN||'',
CACHE_TTL:parseInt(process.env.CACHE_TTL||'600',10),
CACHE_FILE:process.env.CACHE_FILE||'data/cache.json',
MAX_JOBS:parseInt(process.env.MAX_JOBS||'3',10),
MAX_QUEUE:parseInt(process.env.MAX_QUEUE||'15',10),
HEAVY_PER_MIN:parseInt(process.env.HEAVY_PER_MIN||'8',10),
REQ_PER_MIN:parseInt(process.env.REQ_PER_MIN||'120',10),
MAX_SSE:parseInt(process.env.MAX_SSE||'400',10),
NODE_ENV:process.env.NODE_ENV||'development'
};

const log=(lvl,msg,x)=>{if(CFG.NODE_ENV!=='test'){console.log(JSON.stringify({t:Date.now(),lvl:lvl,msg:msg,...x}))}};

const cache=new Map();
const cset=(k,v,ttl=CFG.CACHE_TTL)=>{cache.set(k,{v:v,e:Date.now()+ttl*1000})};
const cget=k=>{const c=cache.get(k);if(!c)return undefined;if(Date.now()>c.e){cache.delete(k);return undefined}return c.v};

const persist=()=>{try{const d=path.dirname(CFG.CACHE_FILE);if(d&&!fs.existsSync(d)){fs.mkdirSync(d,{recursive:true})}const tmp=CFG.CACHE_FILE+'.tmp';const arr=[];cache.forEach((v,k)=>{if(Date.now()<v.e){arr.push([k,v.v,v.e])}});fs.writeFileSync(tmp,JSON.stringify(arr));fs.renameSync(tmp,CFG.CACHE_FILE)}catch(e){log('error','cache_persist',{e:e.message})}};
setInterval(persist,30000);

const buckets=new Map();
const allow=(ip,type='req')=>{
const now=Date.now();
const b=buckets.get(ip)||{r:0,n:0,h:0,hn:0};
const lim=type==='heavy'?CFG.HEAVY_PER_MIN:CFG.REQ_PER_MIN;
let base,cnt;
if(type==='heavy'){base=b.h;cnt=b.hn}else{base=b.r;cnt=b.n};
if(now-base>60000){if(type==='heavy'){b.h=now;b.hn=1}else{b.r=now;b.n=1};buckets.set(ip,b);return true}
if(cnt>=lim){return false}
if(type==='heavy'){b.hn++}else{b.n++};
buckets.set(ip,b);
return true
};

let running=0;
const queue=[];
const job=fn=>new Promise((res,rej)=>{
const run=()=>{
running++;
Promise.resolve().then(fn).then(res).catch(rej).finally(()=>{
running--;
processNext()
})
};
const processNext=()=>{
if(running<CFG.MAX_JOBS&&queue.length){const n=queue.shift();n()}
};
if(running<CFG.MAX_JOBS){run()}
else{if(queue.length>=CFG.MAX_QUEUE){rej(new Error('busy'))}else{queue.push(run)}}
});

const rpc=(method,params,timeout=15000)=>{
return new Promise((res,rej)=>{
const body=JSON.stringify({jsonrpc:'2.0',id:1,method:method,params:params});
const u=new URL(CFG.RPC_URL);
const opts={method:'POST',headers:{'Content-Type':'application/json'},body:body};
const timer=setTimeout(()=>rej(new Error('rpc_timeout')),timeout);
fetch(u.toString(),opts).then(r=>r.text()).then(t=>{clearTimeout(timer);try{const d=JSON.parse(t);if(d.error){rej(new Error(d.error.message||'rpc_error'))}else{res(d.result)}}catch(e){rej(e)}}).catch(e=>{clearTimeout(timer);rej(e)})
})
};
const getSigs=(addr,limit=50)=>rpc('getSignaturesForAddress',[addr,{limit:limit}]);
const getTx=(sig)=>rpc('getTransaction',[sig,{encoding:'jsonParsed',maxSupportedTransactionVersion:0}]);
const parseTx=tx=>{
const edges=[];
if(!tx||!tx.transaction)return edges;
const msg=tx.transaction.message;
const instructions=msg.instructions||[];
instructions.forEach(ix=>{
const p=ix.parsed||{};
if(p.type==='transfer'){
const info=p.info||{};
const from=info.source;const to=info.destination;const amt=info.lamports;
if(from&&to){edges.push({from:from,to:to,amt:amt})}
}
});
return edges
};

const gh=(endpoint)=>{
const u='https://api.github.com/'+endpoint;
const h={Accept:'application/vnd.github+json','User-Agent':'soxo'};
if(CFG.GITHUB_TOKEN){h.Authorization='Bearer '+CFG.GITHUB_TOKEN}
return fetch(u,{headers:h}).then(r=>r.json())
};
const larpGit=(user)=>{
if(!user||!/^[a-zA-Z0-9-]+$/.test(user)){return Promise.resolve({score:0,findings:[{msg:'invalid github user',sev:'l'}]})}
return Promise.all([gh('users/'+user),gh('users/'+user+'/repos?per_page=100')]).then(([u,r])=>{
const findings=[];let score=100;
if(!u||u.message){score-=40;findings.push({msg:'github user not found',sev:'m'})}
else{const created=new Date(u.created_at||0).getTime();const age=Date.now()-created;if(age<86400000*30){score-=30;findings.push({msg:'account <30 days old',sev:'h'})}if(u.public_repos===0){score-=20;findings.push({msg:'no public repos',sev:'m'})}}
if(!Array.isArray(r)||r.length===0){score-=20;findings.push({msg:'no repos',sev:'l'})}
return {score:Math.max(0,Math.min(100,score)),findings:findings}
})
};

const larp=(wallet,github)=>{
const findings=[];let score=100;
const go=()=>{
if(github){return larpGit(github).then(g=>{findings.push(...(g.findings||[]));score=Math.max(0,Math.min(100,score+(g.score-100)));return {score:score,findings:findings}})}
return Promise.resolve({score:Math.max(0,Math.min(100,score)),findings:findings})
};
if(!wallet){return go()}
if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet)){score-=50;findings.push({msg:'invalid wallet',sev:'h'});return go()}
return getSigs(wallet,20).then(sigs=>{
if(!Array.isArray(sigs)||sigs.length===0){score-=30;findings.push({msg:'no on-chain activity',sev:'m'})}
else{const uniq=new Set(sigs.map(s=>s.signature));if(uniq.length<3){score-=20;findings.push({msg:'few transactions',sev:'l'})}}
return go()
}).catch(e=>{score=Math.max(0,score-40);findings.push({msg:'trace failed',sev:'m'});return go()})
};

const marketClients=new Set();
let marketData={price:0,change:0,candles:[]};
const pollMarket=()=>{
Promise.all([
fetch('https://api.binance.com/api/v3/klines?symbol=SOLUSDT&interval=1m&limit=60').then(r=>r.json()),
fetch('https://api.binance.com/api/v3/ticker/24hr?symbol=SOLUSDT').then(r=>r.json())
]).then(([klines,ticker])=>{
const candles=klines.map(k=>({open:parseFloat(k[1]),high:parseFloat(k[2]),low:parseFloat(k[3]),close:parseFloat(k[4])}));
const price=parseFloat(ticker.lastPrice||0);const change=parseFloat(ticker.priceChangePercent||0);
marketData={price:price,change:change,candles:candles};
const msg='data:'+JSON.stringify(marketData)+'\n\n';
marketClients.forEach(c=>{try{c.write(msg)}catch(e){marketClients.delete(c)}})
}).catch(e=>{log('error','market_poll',{e:e.message})})
};
setInterval(pollMarket,3000);
pollMarket();

const createServer=()=>{
const server=http.createServer((req,res)=>{
const u=new URL(req.url,'http://localhost');
const ip=req.socket.remoteAddress||'';
const p=u.pathname;

res.setHeader('X-Content-Type-Options','nosniff');
res.setHeader('Referrer-Policy','no-referrer');
res.setHeader('Permissions-Policy','geolocation=(), microphone=(), camera=()');
res.setHeader('Cross-Origin-Opener-Policy','same-origin');
res.setHeader('Access-Control-Allow-Origin','*');
res.setHeader('Access-Control-Allow-Headers','Content-Type');
if(CFG.DOMAIN){res.setHeader('Content-Security-Policy',"default-src 'self'; connect-src 'self' http://localhost:3000 https://api.binance.com "+CFG.RPC_URL+" https://api.github.com;")}

if(!allow(ip,'req')){res.writeHead(429);res.end('rate limited');return}

if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}

if(p==='/healthz'){res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ok:true}));return}

if(p==='/api/market'){
if(marketClients.size>=CFG.MAX_SSE){res.writeHead(429);res.end('busy');return}
res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
res.write('data:'+JSON.stringify(marketData)+'\n\n');
marketClients.add(res);
req.on('close',()=>{marketClients.delete(res)});
return
}

if(p==='/api/stream'){
const addr=u.searchParams.get('addr');
const limit=parseInt(u.searchParams.get('limit')||'50',10);
if(!addr||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr)){res.writeHead(400);res.end('invalid addr');return}
if(!allow(ip,'heavy')){res.writeHead(429);res.end('heavy rate limited');return}
res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});
const send=d=>{try{res.write('data:'+JSON.stringify(d)+'\n\n')}catch(e){}}
getSigs(addr,limit).then(sigs=>{
const arr=Array.isArray(sigs)?sigs:[];let ended=false;
const process=()=>{
if(arr.length===0||ended){res.end();return}
const s=arr.shift();
job(()=>getTx(s.signature)).then(tx=>{send({sig:s.signature,edges:parseTx(tx)});process()}).catch(e=>{send({sig:s.signature,error:e.message});process()})
};
process()
}).catch(e=>{send({error:e.message});res.end()})
return
}

if(p==='/api/larp'){
const wallet=u.searchParams.get('wallet')||'';const github=u.searchParams.get('github')||'';
larp(wallet,github).then(d=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify(d))}).catch(e=>{res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({score:0,findings:[{msg:'error',sev:'l'}]}))})
return
}

res.writeHead(404);res.end('not found')
});

server.listen(CFG.PORT,CFG.HOST,()=>{log('info','server_start',{port:CFG.PORT,host:CFG.HOST})});

const shutdown=()=>{
marketClients.forEach(c=>{try{c.end()}catch(e){}});
server.close(()=>{process.exit(0)})
};
process.on('SIGINT',shutdown);
process.on('SIGTERM',shutdown);

return server
};

module.exports={createServer,parseTx,larp,larpGit,cget,cset,allow,job,CFG};

if(require.main===module){createServer()}
