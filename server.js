const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';
const NEWS_API_KEY = process.env.NEWS_API_KEY || '';
app.use(express.static('public'));

const cache = new Map();
const TTL = { games: 45_000, details: 60_000, context: 30*60_000, news: 30*60_000 };
const now = () => Date.now();
function getCache(k){ const v=cache.get(k); if(v && v.exp>now()) return v.data; return null; }
function setCache(k,data,ttl){ cache.set(k,{data,exp:now()+ttl}); return data; }
const num = v => { const n=Number(String(v??'').replace('%','').trim()); return isNaN(n)?0:n; };
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;

const ESPN_LEAGUES = ['bra.1','bra.2','conmebol.libertadores','conmebol.sudamericana','eng.1','esp.1','ita.1','ger.1','fra.1','ned.1','nor.1','por.1','ksa.1'];
const ESPN_NAMES = {'bra.1':'Brasileirão Série A','bra.2':'Brasileirão Série B','conmebol.libertadores':'Libertadores','conmebol.sudamericana':'Sul-Americana','eng.1':'Premier League','esp.1':'La Liga','ita.1':'Serie A Itália','ger.1':'Bundesliga','fra.1':'Ligue 1','ned.1':'Eredivisie','nor.1':'Noruega','por.1':'Portugal','ksa.1':'Saudita'};
const INTERNAL = { rivalries:[['Palmeiras','Corinthians'],['Athletico Paranaense','Coritiba'],['Athletico-PR','Coritiba'],['São Paulo','Santos'],['São Paulo','Corinthians'],['Flamengo','Fluminense'],['Flamengo','Vasco'],['Grêmio','Internacional'],['Atlético-MG','Cruzeiro'],['Barcelona','Real Madrid']], notes:[['Always Ready','em casa costuma ter vantagem física pela altitude de El Alto'],['Bolívar','em casa costuma ter vantagem física pela altitude de La Paz'],['The Strongest','em casa costuma ter vantagem física pela altitude de La Paz'],['LDU Quito','joga em altitude relevante em Quito'],['Bodo/Glimt','costuma ser equipe forte/ofensiva no contexto da Noruega']] };

async function api(path){
  if(!API_FOOTBALL_KEY) throw new Error('API_FOOTBALL_KEY não configurada');
  const r = await fetch('https://v3.football.api-sports.io'+path,{headers:{'x-apisports-key':API_FOOTBALL_KEY,'Accept':'application/json'}});
  if(!r.ok) throw new Error('API-Football HTTP '+r.status);
  const j = await r.json();
  if(j.errors && Object.keys(j.errors).length) throw new Error(JSON.stringify(j.errors));
  return j;
}
async function safe(path){ try{return await api(path)}catch(e){return {response:[],error:String(e.message||e)}} }
async function espn(league,date){
  const ymd = date.replaceAll('-','');
  const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/scoreboard?dates=${ymd}&limit=200`,{headers:{'User-Agent':'Mozilla/5.0'}});
  if(!r.ok) throw new Error('ESPN HTTP '+r.status);
  return r.json();
}
function gameKey(g){ return norm(g.home.name)+'_'+norm(g.away.name); }
function normApi(m){
  const f=m.fixture||{}, l=m.league||{}, t=m.teams||{}, g=m.goals||{}, s=f.status||{}; const short=s.short||'';
  const live=['1H','2H','HT','ET','BT','P','SUSP','INT','LIVE'].includes(short); const post=['FT','AET','PEN'].includes(short);
  return {source:'API-Football',id:String(f.id||''),fixtureId:f.id||'',leagueId:l.id||'',season:l.season||'',league:l.name||'',date:f.date||'',time:f.date?new Date(f.date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'',status:s.long||short||'',state:live?'in':post?'post':'pre',live,minute:s.elapsed?String(s.elapsed)+"'":'',home:{id:t.home?.id||'',name:t.home?.name||'',logo:t.home?.logo||'',score:g.home??''},away:{id:t.away?.id||'',name:t.away?.name||'',logo:t.away?.logo||'',score:g.away??''}};
}
function normEspn(ev,league){
  const comp=ev.competitions?.[0]||{}, cs=comp.competitors||[], h=cs.find(c=>c.homeAway==='home')||cs[0]||{}, a=cs.find(c=>c.homeAway==='away')||cs[1]||{}, type=ev.status?.type||{};
  return {source:'ESPN',id:String(ev.id),fixtureId:'',leagueId:'',season:'',league:ESPN_NAMES[league]||league,date:ev.date||'',time:ev.date?new Date(ev.date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'',status:type.description||type.detail||type.name||'',state:type.state||'',live:type.state==='in',minute:ev.status?.displayClock||'',home:{id:'',name:h.team?.displayName||h.team?.name||'',logo:h.team?.logo||'',score:h.score??''},away:{id:'',name:a.team?.displayName||a.team?.name||'',logo:a.team?.logo||'',score:a.score??''}};
}
app.get('/api/health',(req,res)=>res.json({ok:true,apiFootball:!!API_FOOTBALL_KEY,news:!!NEWS_API_KEY,cache:cache.size}));
app.get('/api/games',async(req,res)=>{
  const date=String(req.query.date||new Date().toISOString().slice(0,10)); const ck='games:'+date; const cached=getCache(ck); if(cached) return res.json({...cached,cached:true});
  const out=[],errors=[];
  try{ const j=await api(`/fixtures?date=${date}`); (j.response||[]).forEach(m=>out.push(normApi(m))); }catch(e){errors.push({source:'API-Football',error:String(e.message||e)})}
  await Promise.all(ESPN_LEAGUES.map(async l=>{try{const j=await espn(l,date); (j.events||[]).forEach(ev=>out.push(normEspn(ev,l)));}catch(e){errors.push({source:'ESPN',league:l,error:String(e.message||e)})}}));
  const map=new Map(); for(const g of out){const k=gameKey(g); if(!k||k==='_') continue; const old=map.get(k); if(!old||g.source==='API-Football') map.set(k,{...old,...g});}
  const data={ok:true,date,total:map.size,games:[...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date)),errors}; res.json(setCache(ck,data,TTL.games));
});
function normalizeStats(resp){const rows=[];(resp||[]).forEach(tb=>{const team=tb.team?.name||'';(tb.statistics||[]).forEach(s=>rows.push({team,label:s.type||'',value:s.value??''}))});return rows;}
function normalizeEvents(events){return (events||[]).map(e=>({minute:e.time?.elapsed?String(e.time.elapsed)+"'":'',team:e.team?.name||'',player:e.player?.name||'',type:e.type||'',detail:e.detail||''}));}
function split(stats){const teams=[...new Set(stats.map(s=>s.team).filter(Boolean))]; const home=teams[0]||'Casa', away=teams[1]||'Fora'; const hs={},as={}; stats.forEach(s=>(s.team===home?hs:as)[String(s.label).toLowerCase()]=s.value); return {home,away,hs,as};}
function find(obj, labels){const k=Object.keys(obj).find(k=>labels.some(l=>k.includes(l))); return k?obj[k]:'';}
async function recent(teamId,venue,last=10){if(!teamId)return[]; const j=await safe(`/fixtures?team=${teamId}&last=${last}`); return (j.response||[]).filter(f=>!venue || ((f.teams?.home?.id==teamId)===(venue==='home'))).slice(0,last);}
function sumRecent(fixtures,teamId){const gs=fixtures.map(f=>{const h=f.teams?.home?.id==teamId; const gf=num(h?f.goals?.home:f.goals?.away), ga=num(h?f.goals?.away:f.goals?.home); return {gf,ga,win:gf>ga,draw:gf===ga,loss:gf<ga}}); return {played:gs.length,wins:gs.filter(g=>g.win).length,draws:gs.filter(g=>g.draw).length,losses:gs.filter(g=>g.loss).length,gf:Number(avg(gs.map(g=>g.gf)).toFixed(2)),ga:Number(avg(gs.map(g=>g.ga)).toFixed(2))};}
async function h2h(h,a){ if(!h||!a)return[]; const j=await safe(`/fixtures/headtohead?h2h=${h}-${a}&last=10`); return j.response||[]; }
async function standings(league,season){if(!league||!season)return[]; const j=await safe(`/standings?league=${league}&season=${season}`); return j.response?.[0]?.league?.standings?.[0]||[];}
async function teamStats(team,league,season){if(!team||!league||!season)return null; const j=await safe(`/teams/statistics?team=${team}&league=${league}&season=${season}`); return j.response||null;}
async function players(team,league,season){if(!team||!league||!season)return[]; const j=await safe(`/players?team=${team}&league=${league}&season=${season}`); return j.response||[];}
function topShooters(ps){const rows=[]; for(const p of ps||[]){const st=p.statistics?.[0]||{}, shots=num(st.shots?.total), on=num(st.shots?.on), goals=num(st.goals?.total); if(p.player?.name&&(shots||on||goals)) rows.push({player:p.player.name,shots,on,goals});} return rows.sort((a,b)=>b.shots-a.shots).slice(0,8);}
function internal(game){const home=game?.home?.name||'', away=game?.away?.name||''; const base=[]; const rivalry=INTERNAL.rivalries.some(([a,b])=>(norm(a)===norm(home)&&norm(b)===norm(away))||(norm(a)===norm(away)&&norm(b)===norm(home))); if(rivalry) base.push('Clássico/rivalidade detectado: confiança da análise reduzida.'); for(const [team,note] of INTERNAL.notes){if(norm(team)===norm(home)||norm(team)===norm(away))base.push(`${team}: ${note}.`)} return {rivalry,base};}
function makeLive(stats){const t=split(stats), hs=t.hs, as=t.as; const fh=num(find(hs,['total shots','shots total'])), fa=num(find(as,['total shots','shots total'])), th=num(find(hs,['shots on goal','shots on target'])), ta=num(find(as,['shots on goal','shots on target'])), ch=num(find(hs,['corner'])), ca=num(find(as,['corner'])), ph=num(find(hs,['ball possession','possession'])), pa=num(find(as,['ball possession','possession'])); const has=!!(fh||fa||th||ta||ch||ca||ph||pa); if(!has)return{hasEnoughData:false,confidence:'Baixa',reading:'Sem estatísticas ao vivo suficientes para leitura forte.',finalizations:{home:0,away:0},shotsOnGoal:{home:0,away:0},corners:{home:0,away:0},possession:{home:0,away:0},base:['A API não entregou estatísticas ao vivo completas para essa partida.']}; const hp=fh*2+th*4+ch*2+ph*.25, ap=fa*2+ta*4+ca*2+pa*.25, leader=hp>=ap?t.home:t.away; return{hasEnoughData:true,confidence:(fh+fa+ch+ca)>=10?'Alta':'Moderada',reading:`${leader} pressiona mais neste momento com base nas estatísticas ao vivo.`,pressureTeam:leader,finalizations:{home:fh,away:fa},shotsOnGoal:{home:th,away:ta},corners:{home:ch,away:ca},possession:{home:ph,away:pa},base:[`Finalizações: ${fh} x ${fa}.`,`Chutes no gol: ${th} x ${ta}.`,`Escanteios: ${ch} x ${ca}.`,`Posse: ${ph||'-'}% x ${pa||'-'}%.`]};}
function makePre(game,ctx){const home=game.home.name, away=game.away.name; const base=[]; let hs=0,as=0,e=0; if(ctx.hr.played>=3&&ctx.ar.played>=3){e++; const hp=ctx.hr.wins*3+ctx.hr.draws, ap=ctx.ar.wins*3+ctx.ar.draws; hs+=hp; as+=ap; base.push(`Forma recente: ${home} ${ctx.hr.wins}V/${ctx.hr.draws}E/${ctx.hr.losses}D; ${away} ${ctx.ar.wins}V/${ctx.ar.draws}E/${ctx.ar.losses}D.`)} if(ctx.hhr.played>=2&&ctx.aar.played>=2){e++; const hp=ctx.hhr.wins*3+ctx.hhr.draws, ap=ctx.aar.wins*3+ctx.aar.draws; hs+=hp*1.2; as+=ap*1.2; base.push(`Casa/fora: ${home} em casa ${ctx.hhr.wins}V/${ctx.hhr.draws}E/${ctx.hhr.losses}D; ${away} fora ${ctx.aar.wins}V/${ctx.aar.draws}E/${ctx.aar.losses}D.`)} if(ctx.hs&&ctx.as){e++; const hg=num(ctx.hs.goals?.for?.total?.total), ag=num(ctx.as.goals?.for?.total?.total), hga=num(ctx.hs.goals?.against?.total?.total), aga=num(ctx.as.goals?.against?.total?.total); hs+=hg*.25-hga*.12; as+=ag*.25-aga*.12; base.push(`Temporada: ${home} marcou ${hg||'-'} e sofreu ${hga||'-'}; ${away} marcou ${ag||'-'} e sofreu ${aga||'-'}.`)} const inn=internal(game); if(inn.base.length){e++; base.push(...inn.base)} const can=e>=2, leader=hs>=as?home:away; return{hasEnoughData:can,confidence:e>=4?'Alta':e>=2?'Moderada':'Baixa',reading:can?`${leader} aparece melhor no contexto pré-jogo com base nos dados disponíveis.`:'Dados reais insuficientes para afirmar tendência pré-jogo.',base:base.length?base:['Sem base real suficiente para tendência pré-jogo.']};}
async function news(game){if(!NEWS_API_KEY)return[]; try{const q=encodeURIComponent(`"${game.home.name}" "${game.away.name}" futebol`); const r=await fetch(`https://newsapi.org/v2/everything?q=${q}&language=pt&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`); const j=await r.json(); return (j.articles||[]).slice(0,5).map(a=>({title:a.title,source:a.source?.name||''}))}catch(e){return[]}}
app.get('/api/game-details',async(req,res)=>{try{const fixtureId=req.query.fixtureId, game=req.query.game?JSON.parse(req.query.game):null; const ck='details:'+(fixtureId||game?.id||'')+':'+(game?.date||''); const cached=getCache(ck); if(cached)return res.json({...cached,cached:true}); let teamStats=[],events=[]; if(fixtureId){const [sj,ej]=await Promise.all([safe(`/fixtures/statistics?fixture=${fixtureId}`),safe(`/fixtures/events?fixture=${fixtureId}`)]); teamStats=normalizeStats(sj.response); events=normalizeEvents(ej.response);} let pre,ph=[],pa=[],ns=[]; if(game?.home?.id&&game?.away?.id){const h=game.home.id,a=game.away.id,l=game.leagueId,s=game.season; const [hr,ar,hhr,aar,hs,ass,p1,p2,nw]=await Promise.all([recent(h,null),recent(a,null),recent(h,'home'),recent(a,'away'),teamStats?h2h(h,a):[],teamStats?standings(l,s):[],players(h,l,s),players(a,l,s),news(game)]); ph=topShooters(p1); pa=topShooters(p2); ns=nw; const [hst,ast]=await Promise.all([teamStats(h,l,s),teamStats(a,l,s)]); pre=makePre(game,{hr:sumRecent(hr,h),ar:sumRecent(ar,a),hhr:sumRecent(hhr,h),aar:sumRecent(aar,a),hs:hst,as:ast}); if(ph.length||pa.length)pre.base.push('Jogadores: principais finalizadores carregados pela API-Football.');}else pre={hasEnoughData:false,confidence:'Baixa',reading:'Esse jogo não possui IDs suficientes da API-Football para montar contexto real.',base:['Sem IDs de time/competição vindos da API-Football.']}; const live=makeLive(teamStats); const data={ok:true,teamStats,events,players:{home:ph,away:pa},news:ns,analysis:{live,pregame:pre,contextSource:'API-Football + ESPN + base interna + notícias opcionais',main:live.hasEnoughData?live:pre}}; res.json(setCache(ck,data,TTL.details));}catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}});
app.listen(PORT,()=>console.log('DhuniorStats V13 completo rodando '+PORT));
