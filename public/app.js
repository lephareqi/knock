'use strict';
const $=s=>document.querySelector(s),short=a=>a.slice(0,4)+'…'+a.slice(-4);
const store={get:(k,d)=>{try{return localStorage.getItem(k)||d}catch{return d}},set:(k,v)=>{try{localStorage.setItem(k,v)}catch{}}};
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
function fit(c){const d=devicePixelRatio||1,r=c.getBoundingClientRect();c.width=r.width*d;c.height=r.height*d;c.W=r.width;c.H=r.height;c.getContext('2d').setTransform(d,0,0,d,0,0)}
/* tabs */
for(const k of['trace','larp','war'])$('#t-'+k).onclick=()=>{for(const j of['trace','larp','war']){$('#'+j).hidden=j!==k;$('#t-'+j).classList.toggle('on',j===k)}fit($('#g'));fit($('#w'));if(k==='war')loadWar()};
/* ---------- Drainer map ---------- */
const B58=/^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
let nodes=new Map(),edges=new Map(),pulses=[],busy=false;
function node(a){if(!nodes.has(a)){const c=$('#g');nodes.set(a,{id:a,x:c.W/2+(Math.random()-.5)*80,y:c.H/2+(Math.random()-.5)*80,vx:0,vy:0,from:new Set(),to:new Set(),sol:0})}return nodes.get(a)}
function link(a,b,amt,sym,sig){if(a===b||!a||!b)return;const k=a+'>'+b;let e=edges.get(k);if(!e){e={a,b,n:0,amt:{},sigs:[]};edges.set(k,e)}
  e.n++;e.amt[sym]=(e.amt[sym]||0)+amt;if(e.sigs.length<3)e.sigs.push(sig);node(a).to.add(b);node(b).from.add(a);if(sym==='SOL')node(b).sol+=amt;pulses.push({e,t:Math.random()})}
let es=null;
function flash(a){node(a).fl=performance.now()}
function trace(addr){
  if(!B58.test(addr)){$('#stat').textContent='Not a valid Solana address.';return}
  if(es)es.close();node(addr);flash(addr);
  const n=Math.min(100,Math.max(5,+$('#lim').value||25));
  es=new EventSource('/api/stream?addr='+addr+'&limit='+n);
  es.addEventListener('edge',e=>{const d=JSON.parse(e.data);link(d.a,d.b,d.amt,d.sym,d.sig);flash(d.b);list()});
  es.addEventListener('status',e=>{$('#stat').textContent=e.data});
  es.addEventListener('done',e=>{$('#stat').textContent=e.data;es.close();es=null;list()});
  es.onerror=()=>{if(es){$('#stat').textContent='Backend unreachable. Start it with: node server.js';es.close();es=null}}}
function score(n){return n.from.size*2+n.sol/10}
function list(){const ol=$('#sus');const arr=[...nodes.values()].filter(n=>n.from.size>=3).sort((a,b)=>score(b)-score(a)).slice(0,12);
  ol.innerHTML=arr.length?'':'<li class="muted">No hub pattern found yet.</li>';
  for(const n of arr){const li=document.createElement('li');li.className='hot suspect-row';
    const a=document.createElement('a');a.href='https://solscan.io/account/'+encodeURIComponent(n.id);a.target='_blank';a.rel='noopener noreferrer';a.textContent=n.id;a.setAttribute('aria-label','Open wallet '+n.id+' in Solscan');
    const details=document.createElement('span');details.textContent=`${n.from.size} senders, ${n.sol.toFixed(2)} SOL in`;
    const button=document.createElement('button');button.type='button';button.className='trace-wallet';button.textContent='Trace';button.setAttribute('aria-label','Trace wallet '+n.id);button.onclick=()=>trace(n.id);
    li.append(a,details,button);ol.append(li)}}
$('#go').onclick=()=>trace($('#addr').value.trim());$('#addr').onkeydown=e=>{if(e.key==='Enter')$('#go').click()};
$('#clr').onclick=()=>{nodes.clear();edges.clear();pulses=[];list();$('#stat').textContent='Cleared.'};
$('#exp').onclick=()=>{const o={nodes:[...nodes.values()].map(n=>({id:n.id,senders:n.from.size,solIn:n.sol})),edges:[...edges.values()]};
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(o,null,2)],{type:'application/json'}));a.download='soxo-trace.json';a.click()};
const gc=$('#g'),gx=gc.getContext('2d');let hover=null,drag=null;
gc.onclick=e=>{const r=gc.getBoundingClientRect(),n=pick(e.clientX-r.left,e.clientY-r.top);if(n){$('#addr').value=n.id;trace(n.id)}};
gc.onmousemove=e=>{const r=gc.getBoundingClientRect();hover=pick(e.clientX-r.left,e.clientY-r.top);gc.style.cursor=hover?'pointer':'default'};
function pick(x,y){let b=null,d=14;for(const n of nodes.values()){const k=Math.hypot(n.x-x,n.y-y);if(k<d){d=k;b=n}}return b}
function step(){const N=[...nodes.values()],W=gc.W,H=gc.H;
  for(const a of N){for(const b of N)if(a!==b){let dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy)||1;if(d<160){const f=1400/(d*d);a.vx+=dx/d*f;a.vy+=dy/d*f}}
    a.vx+=(W/2-a.x)*.002;a.vy+=(H/2-a.y)*.002}
  for(const e of edges.values()){const a=nodes.get(e.a),b=nodes.get(e.b),dx=b.x-a.x,dy=b.y-a.y,d=Math.hypot(dx,dy)||1,f=(d-90)*.01;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f}
  for(const n of N){n.vx*=.8;n.vy*=.8;n.x=Math.max(20,Math.min(W-20,n.x+n.vx));n.y=Math.max(20,Math.min(H-20,n.y+n.vy))}}
function drawG(t){gx.fillStyle='rgba(4,6,11,.35)';gx.fillRect(0,0,gc.W,gc.H);
  gx.strokeStyle='rgba(20,241,149,.05)';for(let x=0;x<gc.W;x+=40){gx.beginPath();gx.moveTo(x,0);gx.lineTo(x,gc.H);gx.stroke()}for(let y=0;y<gc.H;y+=40){gx.beginPath();gx.moveTo(0,y);gx.lineTo(gc.W,y);gx.stroke()}
  {const cx=gc.W/2,cy=gc.H/2,R=Math.hypot(cx,cy),a=reduce?0:t/1800;gx.lineWidth=1;gx.strokeStyle='rgba(20,241,149,.06)';for(let r=100;r<R;r+=100){gx.beginPath();gx.arc(cx,cy,r,0,7);gx.stroke()}gx.strokeStyle='rgba(20,241,149,.3)';gx.lineWidth=1.5;gx.beginPath();gx.moveTo(cx,cy);gx.lineTo(cx+Math.cos(a)*R,cy+Math.sin(a)*R);gx.stroke()}
  if(!nodes.size){gx.fillStyle='#7f93ad';gx.font='15px Segoe UI';gx.textAlign='center';gx.fillText('Paste a wallet above to map where the funds went.',gc.W/2,gc.H/2)}
  step();for(const e of edges.values()){const a=nodes.get(e.a),b=nodes.get(e.b);gx.strokeStyle=`rgba(153,69,255,${Math.min(.8,.2+e.n*.1)})`;gx.lineWidth=Math.min(4,1+e.n*.4);gx.beginPath();gx.moveTo(a.x,a.y);gx.lineTo(b.x,b.y);gx.stroke()}
  for(const p of pulses){p.t=(p.t+(reduce?0:.006))%1;const a=nodes.get(p.e.a),b=nodes.get(p.e.b);gx.fillStyle='#14f195';gx.shadowColor='#14f195';gx.shadowBlur=10;gx.beginPath();gx.arc(a.x+(b.x-a.x)*p.t,a.y+(b.y-a.y)*p.t,2.5,0,7);gx.fill();gx.shadowBlur=0}
  for(const n of nodes.values()){const hub=n.from.size>=3,age=t-(n.fl||-1e9),ring=age<1200&&(gx.strokeStyle='rgba(20,241,149,'+(1-age/1200)+')',gx.lineWidth=2,gx.beginPath(),gx.arc(n.x,n.y,8+age/30,0,7),gx.stroke()),r=hub?6+Math.min(14,n.from.size*1.2):5+Math.min(6,n.to.size),c=hub?'#ff4d6d':'#14f195';
    gx.shadowColor=c;gx.shadowBlur=14;gx.fillStyle=c;gx.beginPath();gx.arc(n.x,n.y,r+(hub&&!reduce?Math.sin(t/260)*1.5:0),0,7);gx.fill();gx.shadowBlur=0}
  if(hover){gx.fillStyle='#fff';gx.font='12px Consolas';gx.textAlign='left';gx.fillText(`${hover.id}  in:${hover.from.size} out:${hover.to.size}`,12,gc.H-12)}}
/* ---------- Battlefield ---------- */
const wc=$('#w'),wx=wc.getContext('2d');let units=[],shots=[],booms=[],bull=0,bear=0,loaded=false;
let lastP=0;
function loadWar(){if(loaded)return;loaded=true;const m=new EventSource('/api/market');m.onmessage=e=>apply(JSON.parse(e.data));m.onerror=()=>{$('#wstat').textContent='Market stream offline. Is the backend running?'}}
function apply(m){const c=m.candles,price=n=>Number.isFinite(n)?'$'+n.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}):'—',
  compact=n=>Number.isFinite(n)?n.toLocaleString(undefined,{notation:'compact',maximumFractionDigits:2}):'—';
  $('#wp').textContent=price(m.price);
  for(const[id,n]of[['wc24',m.change24h],['wc1',m.change1h]]){const el=$('#'+id);el.textContent=Number.isFinite(n)?(n>0?'+':'')+n.toFixed(2)+'%':'—';el.classList.toggle('positive',Number.isFinite(n)&&n>=0);el.classList.toggle('negative',Number.isFinite(n)&&n<0)}
  $('#wrange').textContent=Number.isFinite(m.high24h)&&Number.isFinite(m.low24h)?price(m.high24h)+' / '+price(m.low24h):'—';
  $('#wvol').textContent=Number.isFinite(m.volume24h)?compact(m.volume24h)+' SOL':'—';
  $('#wquotevol').textContent=Number.isFinite(m.quoteVolume24h)?'$'+compact(m.quoteVolume24h)+' USDT':'24-hour traded volume';
  $('#wstat').textContent='Live SOL/USDT · 60 one-minute candles · updated '+new Date(m.updatedAt).toLocaleTimeString();
  if(lastP&&m.price!==lastP){const sd=m.price>lastP?1:-1;for(const u of units.filter(u=>u.side===sd).slice(0,3))fire(u)}lastP=m.price;
  bull=bear=0;let bv=0,rv=0;for(const k of c){if(k.c>=k.o){bull++;bv+=k.v}else{bear++;rv+=k.v}}
  $('#bn').textContent=bull;$('#rn').textContent=bear;$('#bv').textContent='vol '+Math.round(bv).toLocaleString()+' SOL';$('#rv').textContent='vol '+Math.round(rv).toLocaleString()+' SOL';
  $('#mb').style.width=(bv/(bv+rv||1)*100)+'%';
  const mk=(side,n)=>{const have=units.filter(u=>u.side===side);for(let i=have.length;i<Math.min(24,4+n);i++)units.push(spawn(side,i%3===2))};mk(1,bull/3);mk(-1,bear/3);
  units=units.filter(u=>units.filter(v=>v.side===u.side&&v.air===u.air).indexOf(u)<(u.side>0?bull:bear)/(u.air?4:2)+3)}
function spawn(side,air){const W=wc.W||800,H=wc.H||500;return{side,air,x:side>0?30+Math.random()*W*.25:W-30-Math.random()*W*.25,y:air?40+Math.random()*H*.35:H*.78+Math.random()*H*.1,dir:1,cd:Math.random()*80,ph:Math.random()*6}}
function fire(u,t){const W=wc.W,e=units.filter(v=>v.side!==u.side);if(!e.length)return;const q=e[Math.random()*e.length|0];
  shots.push({x:u.x,y:u.y,tx:q.x,ty:q.y,t:0,side:u.side,q,air:u.air})}
function drawW(t){const W=wc.W,H=wc.H;const sky=wx.createLinearGradient(0,0,0,H);sky.addColorStop(0,'#05070f');sky.addColorStop(1,'#16203a');wx.fillStyle=sky;wx.fillRect(0,0,W,H);
  wx.fillStyle='#0b1220';wx.beginPath();wx.moveTo(0,H*.72);for(let x=0;x<=W;x+=40)wx.lineTo(x,H*.72-Math.sin(x*.013)*18-Math.sin(x*.03)*8);wx.lineTo(W,H);wx.lineTo(0,H);wx.fill();
  wx.fillStyle='rgba(20,241,149,.08)';wx.fillRect(0,0,W/2,H);wx.fillStyle='rgba(255,77,109,.08)';wx.fillRect(W/2,0,W/2,H);
  for(const u of units){u.cd--;u.ph+=.04;const mid=W/2,adv=u.side>0?u.x<mid-60:u.x>mid+60;if(!reduce&&adv)u.x+=u.side*(u.air?.7:.3);if(u.air)u.y+=Math.sin(u.ph)*.4;
    if(u.cd<=0){fire(u,t);u.cd=70+Math.random()*90}
    const c=u.side>0?'#14f195':'#ff4d6d';wx.fillStyle=c;wx.shadowColor=c;wx.shadowBlur=8;wx.save();wx.translate(u.x,u.y);wx.scale(u.side,1);
    if(u.air){wx.beginPath();wx.moveTo(16,0);wx.lineTo(-10,-8);wx.lineTo(-6,0);wx.lineTo(-10,8);wx.fill();wx.fillRect(-12,-2,6,4)}
    else{wx.fillRect(-14,-3,28,9);wx.fillRect(-8,-9,16,7);wx.fillRect(8,-7,16,3);wx.fillStyle='#04060b';for(let i=-10;i<=10;i+=6){wx.beginPath();wx.arc(i,6,2,0,7);wx.fill()}}
    wx.restore();wx.shadowBlur=0}
  for(const s of shots){s.t+=.04;s.x+=(s.tx-s.x)*.08;s.y+=(s.ty-s.y)*.08;wx.fillStyle=s.side>0?'#c8ffe8':'#ffc2cd';wx.beginPath();wx.arc(s.x,s.y,2.5,0,7);wx.fill();
    if(s.t>.7){booms.push({x:s.tx,y:s.ty,r:2,side:s.side});s.dead=1;if(Math.random()<.18){const i=units.indexOf(s.q);if(i>-1&&units.filter(v=>v.side===s.q.side).length>3){units.splice(i,1);units.push(spawn(s.q.side,s.q.air))}}}}
  shots=shots.filter(s=>!s.dead);
  for(const b of booms){b.r+=1.6;wx.strokeStyle=`rgba(255,${b.side>0?200:120},60,${Math.max(0,1-b.r/28)})`;wx.lineWidth=2;wx.beginPath();wx.arc(b.x,b.y,b.r,0,7);wx.stroke()}booms=booms.filter(b=>b.r<28);
  wx.fillStyle='rgba(255,255,255,.12)';wx.fillRect(W/2-1,0,2,H)}
function loop(t){if(!$('#trace').hidden)drawG(t);else if(!$('#war').hidden)drawW(t);requestAnimationFrame(loop)}
addEventListener('resize',()=>{fit(gc);fit(wc)});fit(gc);fit(wc);requestAnimationFrame(loop);

$('#lgo').onclick=async()=>{const out=$('#lout'),q=new URLSearchParams(),w=$('#lw').value.trim(),g=$('#lg').value.trim();if(w)q.set('wallet',w);if(g)q.set('github',g);
  out.className='card muted';out.textContent='Checking, this can take up to a minute for busy wallets…';
  try{const r=await fetch('/api/larp?'+q),j=await r.json();if(!r.ok)throw new Error(j.error);
    out.className='card';out.textContent='';const h=document.createElement('div');h.className='score '+(j.score>=60?'bad':j.score>=30?'mid':'ok');h.textContent=j.score+'/100 larp risk';out.append(h);
    const ul=document.createElement('ul');for(const f of j.findings){const li=document.createElement('li');li.className=f.sev;li.textContent=f.text;ul.append(li)}out.append(ul)}
  catch(e){out.textContent='Error: '+e.message}};
