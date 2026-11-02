'use strict';
const http=require('http'),fs=require('fs'),path=require('path');
const E=process.env;
const CFG={port:+E.PORT||8080,rpc:E.RPC_URL||'https://api.mainnet-beta.solana.com',gh:E.GITHUB_TOKEN||'',ttl:(+E.CACHE_TTL||600)*1000,
  file:E.CACHE_FILE||path.join(__dirname,'data','cache.json'),jobs:+E.MAX_JOBS||3,queue:+E.MAX_QUEUE||15,heavyPerMin:+E.HEAVY_PER_MIN||8,
  reqPerMin:+E.REQ_PER_MIN||120,maxSse:+E.MAX_SSE||400,proxy:E.TRUST_PROXY==='1',hsts:E.HSTS==='1'};
const DAY=864e5,PUB=path.join(__dirname,'public');
const B58=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/,GHU=/^[a-z\d](?:[a-z\d-]{0,38})$/i,sleep=ms=>new Promise(r=>setTimeout(r,ms)),short=a=>a.slice(0,4)+'…'+a.slice(-4);
const log=(lvl,msg,x)=>{if(E.NODE_ENV!=='test')console.log(JSON.stringify({t:new Date().toISOString(),lvl,msg,...x}))};
/* ---- cache: memory + atomic persistence ---- */
const cache=new Map();let dirty=false;
try{for(const[k,v]of Object.entries(JSON.parse(fs.readFileSync(CFG.file,'utf8'))))if(v.exp>Date.now())cache.set(k,v)}catch{}
const cget=k=>{const v=cache.get(k);return v&&v.exp>Date.now()?v.val:undefined};
const cset=(k,val,ttl=CFG.ttl)=>{cache.delete(k);cache.set(k,{exp:Date.now()+ttl,val});while(cache.size>5000)cache.delete(cache.keys().next().value);dirty=true};
function save(){if(!dirty)return;dirty=false;try{fs.mkdirSync(path.dirname(CFG.file),{recursive:true});const n=Date.now(),o={};for(const[k,v]of cache)if(v.exp>n)o[k]=v;
  const t=CFG.file+'.tmp';fs.writeFileSync(t,JSON.stringify(o));fs.renameSync(t,CFG.file)}catch(e){log('error','cache save failed',{err:e.message})}}
/* ---- limits: heavy-job queue + per-IP buckets ---- */
let running=0;const q=[];
function job(fn){return new Promise((ok,no)=>{const run=async()=>{running++;try{ok(await fn())}catch(e){no(e)}finally{running--;const n=q.shift();if(n)n()}};
  if(running<CFG.jobs)run();else if(q.length<CFG.queue)q.push(run);else no(Object.assign(new Error('busy'),{busy:true}))})}
const rl=new Map();
function allow(ip,kind,max){const k=kind+ip,n=Date.now();if(rl.size>50000)rl.clear();let b=rl.get(k);if(!b||n-b.t>60000)b={t:n,n:0};b.n++;rl.set(k,b);return b.n<=max}
const clientIp=req=>(CFG.proxy&&(req.headers['x-forwarded-for']||'').split(',')[0].trim())||req.socket.remoteAddress||'?';
/* ---- Solana RPC ---- */
async function rpc(method,params){for(let i=0;i<4;i++){
  try{const r=await fetch(CFG.rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(15000)});
    if(r.status===429||r.status>=500){await sleep(700*(i+1));continue}if(!r.ok)throw new Error('RPC '+r.status);
    const j=await r.json();if(j.error)throw new Error(j.error.message);return j.result}
  catch(e){if(i===3||/RPC 4|Invalid|not/i.test(e.message))throw e;await sleep(500*(i+1))}}
  throw new Error('RPC rate limited. Set RPC_URL to a private endpoint.')}
function parseTx(tx,sig){const v={edges:[],mints:[],payer:''};if(!tx||!tx.meta||tx.meta.err)return v;
  const m=tx.transaction.message,k=m.accountKeys[0];v.payer=k.pubkey||k;
  const ins=[...m.instructions];for(const i of tx.meta.innerInstructions||[])ins.push(...i.instructions);
  for(const i of ins){const p=i.parsed;if(!p)continue;
    if(i.program==='system'&&p.type==='transfer')v.edges.push({a:p.info.source,b:p.info.destination,amt:p.info.lamports/1e9,sym:'SOL',sig});
    if(i.program==='spl-token'&&/^initializeMint/.test(p.type))v.mints.push(p.info.mint)}
  const d={},add=(arr,sg)=>{for(const b of arr||[]){if(!b.owner)continue;const k=b.mint+'|'+b.owner;(d[k]=d[k]||{m:b.mint,o:b.owner,v:0}).v+=sg*(+b.uiTokenAmount.uiAmount||0)}};
  add(tx.meta.preTokenBalances,-1);add(tx.meta.postTokenBalances,1);
  const rows=Object.values(d).filter(x=>x.v),src=rows.filter(x=>x.v<0),dst=rows.filter(x=>x.v>0);
  for(const s of src.slice(0,3))for(const t of dst.slice(0,3))if(s.m===t.m)v.edges.push({a:s.o,b:t.o,amt:Math.min(-s.v,t.v),sym:short(s.m),sig});
  return v}
async function txInfo(sig){let v=cget('tx:'+sig);if(v)return v;
  v=parseTx(await rpc('getTransaction',[sig,{encoding:'jsonParsed',maxSupportedTransactionVersion:0}]),sig);cset('tx:'+sig,v,DAY);return v}
const tkey=(a,l)=>'trace:'+a+':'+l;
async function trace(addr,limit,send,alive){
  const hit=cget(tkey(addr,limit));
  if(hit){send('status','Served from SoXo cache');for(const e of hit){if(!alive())return;send('edge',e);await sleep(30)}return send('done','Done (cached): '+hit.length+' transfers.')}
  const out=[];send('status','Fetching signatures…');const sigs=await rpc('getSignaturesForAddress',[addr,{limit}]);
  for(let i=0;i<sigs.length&&alive()&&out.length<3000;i++){send('status','Reading transaction '+(i+1)+'/'+sigs.length+'…');
    try{for(const e of(await txInfo(sigs[i].signature)).edges){out.push(e);send('edge',e)}}catch(e){if(/rate/i.test(e.message))throw e}await sleep(80)}
  if(alive()){cset(tkey(addr,limit),out);send('done','Done: '+out.length+' transfers.')}}
/* ---- larp dev check ---- */
async function gh(p){const r=await fetch('https://api.github.com'+p,{headers:{'user-agent':'soxo',accept:'application/vnd.github+json',...(CFG.gh?{authorization:'Bearer '+CFG.gh}:{})},signal:AbortSignal.timeout(10000)});
  if(r.status===404)return null;if(!r.ok)throw new Error('GitHub '+r.status+(r.status===403?' (rate limited, set GITHUB_TOKEN)':''));return r.json()}
async function larpGit(u,add){const p=await gh('/users/'+u);if(!p)return add('bad','GitHub user not found.',30);
  const days=Math.floor((Date.now()-Date.parse(p.created_at))/DAY);
  add('info','GitHub account is '+days+' days old, with '+p.public_repos+' public repos and '+p.followers+' followers.');
  if(days<90)add('bad','GitHub account is under 90 days old.',20);
  const repos=await gh('/users/'+u+'/repos?per_page=100&sort=pushed')||[],own=repos.filter(r=>!r.fork);
  if(!repos.length)add('bad','No public repositories.',25);
  else if(!own.length)add('bad','Every public repo is a fork. No original code.',20);
  else{const stars=own.reduce((n,r)=>n+r.stargazers_count,0),idle=Math.floor((Date.now()-Date.parse(repos[0].pushed_at))/DAY);
    add('ok',own.length+' original repos, '+stars+' stars in total.');if(idle>180)add('warn','No push in '+idle+' days.',10);
    if(own.filter(r=>r.size<5).length>=own.length/2)add('warn','Most original repos are nearly empty.',10)}
  if(!p.followers)add('warn','No followers.',5)}
async function larpWallet(w,add){
  const sigs=await rpc('getSignaturesForAddress',[w,{limit:1000}]);if(!sigs.length)return add('bad','Wallet has no transactions.',30);
  const capped=sigs.length>=1000,old=sigs[sigs.length-1],age=old.blockTime?Math.floor((Date.now()/1000-old.blockTime)/86400):null;
  add('info',(capped?'1000+':sigs.length)+' transactions'+(age!=null?', oldest seen '+age+' days ago':'')+'.');
  if(!capped&&age!=null&&age<30)add('bad','Wallet is only '+age+' days old.',25);else if(!capped&&sigs.length<20)add('warn','Very little on-chain history.',15);
  if(!capped){try{const f=(await txInfo(old.signature)).edges.find(e=>e.b===w&&e.sym==='SOL');if(f)add('info','First funded by '+f.a+' ('+f.amt.toFixed(3)+' SOL). Check whether that wallet funds many fresh wallets.')}catch{}}
  const mints=new Set();
  for(const s of sigs.slice(0,40)){if(s.err)continue;try{const t=await txInfo(s.signature);if(t.payer===w)t.mints.forEach(m=>mints.add(m))}catch{}await sleep(60)}
  if(!mints.size)return add('ok','No token launches by this wallet in its last 40 transactions.');
  add(mints.size>=5?'bad':'warn','Launched '+mints.size+' token(s) in its recent activity.',mints.size>=5?20:5);
  for(const m of[...mints].slice(0,5)){try{
    const a=await rpc('getAccountInfo',[m,{encoding:'jsonParsed'}]),i=a&&a.value&&a.value.data.parsed&&a.value.data.parsed.info;if(!i)continue;const tag=short(m);
    if(i.mintAuthority)add('bad',tag+': mint authority still active, supply can be inflated.',10);
    if(i.freezeAuthority)add('warn',tag+': freeze authority still active, holders can be frozen.',5);
    const big=await rpc('getTokenLargestAccounts',[m]),sup=+i.supply/10**i.decimals,top=big.value[0]&&sup?(big.value[0].uiAmount||0)/sup:0;
    if(top>.5)add('warn',tag+': largest holder owns '+(top*100).toFixed(0)+'% (could be a liquidity pool).',5)}catch{}}}
async function larp(w,g){const f=[];let pts=0;const add=(sev,text,p=0)=>{f.push({sev,text});pts+=p};
  if(w)try{await larpWallet(w,add)}catch(e){add('warn','Wallet check failed: '+e.message)}
  if(g)try{await larpGit(g,add)}catch(e){add('warn','GitHub check failed: '+e.message)}
  add('info','Heuristics only. Many honest developers are anonymous or keep code private. Use this as a prompt to dig deeper, not as a verdict.');
  return{score:Math.min(100,pts),findings:f}}
/* ---- live market feed ---- */
const feed=new Set();let market=null;
async function pollMarket(){for(const h of['https://data-api.binance.vision','https://api.binance.com']){try{
  const [candles,ticker]=await Promise.allSettled([
    fetch(h+'/api/v3/klines?symbol=SOLUSDT&interval=1m&limit=60',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)throw new Error('Market candles unavailable');return r.json()}),
    fetch(h+'/api/v3/ticker/24hr?symbol=SOLUSDT',{signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)throw new Error('Market ticker unavailable');return r.json()})
  ]);
  if(candles.status!=='fulfilled'||!candles.value.length)continue;
  const k=candles.value,t=ticker.status==='fulfilled'?ticker.value:null,price=t?+t.lastPrice:+k[k.length-1][4],first=+k[0][1];
  const value=n=>Number.isFinite(+n)?+n:null;
  market={price,change1h:first?(price-first)/first*100:null,change24h:t?value(t.priceChangePercent):null,
    high24h:t?value(t.highPrice):null,low24h:t?value(t.lowPrice):null,volume24h:t?value(t.volume):null,
    quoteVolume24h:t?value(t.quoteVolume):null,updatedAt:Date.now(),candles:k.map(x=>({o:+x[1],c:+x[4],v:+x[5]}))};
  for(const s of feed)s.send('message',market);return}catch{}}}
/* ---- http ---- */
const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.svg':'image/svg+xml'};
const HDR={'x-content-type-options':'nosniff','referrer-policy':'no-referrer','permissions-policy':'geolocation=(), camera=(), microphone=()','cross-origin-opener-policy':'same-origin',
  'content-security-policy':"default-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",...(CFG.hsts?{'strict-transport-security':'max-age=31536000'}:{})};
const json=(res,c,o)=>{res.writeHead(c,{'content-type':'application/json',...HDR});res.end(JSON.stringify(o))};
let sseCount=0;
function sse(req,res){res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache',connection:'keep-alive','x-accel-buffering':'no',...HDR});sseCount++;let on=true;
  const hb=setInterval(()=>{if(on)res.write(':hb\n\n')},20000),end=()=>{if(on){on=false;sseCount--;clearInterval(hb)}};req.on('close',end);res.on('close',end);
  return{send:(ev,d)=>{if(on)res.write('event: '+ev+'\ndata: '+(typeof d==='string'?d:JSON.stringify(d))+'\n\n')},alive:()=>on,end}}
const inflight=new Map();
async function handle(req,res){const t0=Date.now();let p='/';
  try{const u=new URL(req.url,'http://x'),ip=clientIp(req);p=u.pathname;
    res.on('finish',()=>{if(p!=='/healthz')log('info','req',{m:req.method,p,s:res.statusCode,ms:Date.now()-t0,ip})});
    if(p==='/healthz')return json(res,200,{ok:true,uptime:Math.floor(process.uptime()),cache:cache.size,market:!!market,running,queued:q.length,sse:sseCount});
    if(!allow(ip,'r',CFG.reqPerMin))return json(res,429,{error:'Too many requests. Slow down.'});
    if(p==='/api/market'){if(sseCount>=CFG.maxSse)return json(res,503,{error:'Too many live viewers. Retry shortly.'});
      const s=sse(req,res);feed.add(s);req.on('close',()=>feed.delete(s));if(market)s.send('message',market);return}
    if(p==='/api/stream'){const a=u.searchParams.get('addr')||'',l=Math.min(100,Math.max(5,+u.searchParams.get('limit')||25));
      if(!B58.test(a))return json(res,400,{error:'Invalid address'});if(sseCount>=CFG.maxSse)return json(res,503,{error:'Server busy'});
      const cached=cget(tkey(a,l))!==undefined,s=sse(req,res);
      try{if(!cached&&!allow(ip,'h',CFG.heavyPerMin))s.send('done','Too many traces. Wait a minute and retry.');
        else await(cached?trace(a,l,s.send,s.alive):job(()=>trace(a,l,s.send,s.alive)))}
      catch(e){log('warn','trace failed',{err:e.message});s.send('done',e.busy?'Server is busy. Retry in a few seconds.':'Error: '+e.message)}
      s.end();return res.end()}
    if(p==='/api/larp'){const w=u.searchParams.get('wallet')||'',g=u.searchParams.get('github')||'';
      if(!w&&!g)return json(res,400,{error:'Enter a wallet, a GitHub username, or both.'});
      if(w&&!B58.test(w))return json(res,400,{error:'Invalid wallet address'});if(g&&!GHU.test(g))return json(res,400,{error:'Invalid GitHub username'});
      const key='larp:'+w+':'+g.toLowerCase();let v=cget(key);
      if(!v){if(!allow(ip,'h',CFG.heavyPerMin))return json(res,429,{error:'Too many checks. Wait a minute and retry.'});
        let pr=inflight.get(key);if(!pr){pr=job(()=>larp(w,g)).finally(()=>inflight.delete(key));inflight.set(key,pr)}
        try{v=await pr}catch(e){if(e.busy)return json(res,503,{error:'Server is busy. Retry in a few seconds.'});throw e}
        cset(key,v,v.findings.some(f=>/failed/.test(f.text))?30000:CFG.ttl)}
      return json(res,200,v)}
    if(p.startsWith('/api/'))return json(res,404,{error:'Not found'});
    const f=path.normalize(path.join(PUB,p==='/'?'index.html':p));if(!f.startsWith(PUB+path.sep))return json(res,403,{error:'Forbidden'});
    fs.readFile(f,(e,b)=>{if(e)return json(res,404,{error:'Not found'});res.writeHead(200,{'content-type':TYPES[path.extname(f)]||'application/octet-stream','cache-control':'no-cache',...HDR});res.end(b)})
  }catch(e){log('error','handler',{p,err:e.message});if(!res.headersSent)json(res,500,{error:'Server error'});else res.end()}}
function createServer(){const s=http.createServer(handle);s.headersTimeout=15000;s.requestTimeout=30000;s.keepAliveTimeout=5000;return s}
function start(){const srv=createServer();srv.listen(CFG.port,process.env.HOST,()=>log('info','listening',{port:CFG.port,rpc:CFG.rpc.replace(/\/\/.*@|[?].*/g,'//***')}));
  setInterval(save,30000).unref();setInterval(pollMarket,3000).unref();pollMarket();
  setInterval(()=>{const n=Date.now();for(const[k,b]of rl)if(n-b.t>60000)rl.delete(k)},30000).unref();
  const stop=()=>{log('info','shutting down');srv.close(()=>{save();process.exit(0)});if(srv.closeAllConnections)srv.closeAllConnections();setTimeout(()=>{save();process.exit(0)},5000).unref()};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);process.on('unhandledRejection',e=>log('error','unhandledRejection',{err:String(e)}));return srv}
module.exports={createServer,parseTx,larp,larpGit,cget,cset,allow,job,CFG};
if(require.main===module)start();
