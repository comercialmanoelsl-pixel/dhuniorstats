const express = require('express');
const fetch = require('node-fetch');
const app = express();
const PORT = process.env.PORT || 3000;

const SPORTMONKS_KEY = process.env.SPORTMONKS_KEY || '';
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || '';
const NEWS_API_KEY = process.env.NEWS_API_KEY || '';
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY || '';

app.use(express.static('public'));

const ESPN_LEAGUES = [
  ['bra.1','Brasileirão Série A'],['bra.2','Brasileirão Série B'],
  ['conmebol.libertadores','Libertadores'],['conmebol.sudamericana','Sul-Americana'],
  ['eng.1','Premier League'],['esp.1','La Liga'],['ita.1','Serie A Itália']
].map(([key,name])=>({key,name}));

const CONTEXT_NOTES = [
  ['Always Ready','em casa costuma ter vantagem pela altitude de El Alto'],
  ['Bolívar','em casa costuma ter vantagem pela altitude de La Paz'],
  ['The Strongest','em casa costuma ter vantagem pela altitude de La Paz'],
  ['LDU Quito','joga em altitude relevante em Quito'],
  ['Bodo/Glimt','costuma ser equipe forte/ofensiva no contexto da Noruega'],
  ['Athletico-PR','costuma ter força importante como mandante'],
  ['Atlético-MG','em casa costuma aumentar intensidade em jogos decisivos'],
  ['Fluminense','em casa costuma assumir mais posse e pressão em Libertadores'],
  ['Palmeiras','costuma ter alto volume ofensivo como mandante']
];

const isoDate = d => String(d || new Date().toISOString().slice(0,10));
const yyyymmdd = d => isoDate(d).replaceAll('-','');
const norm = s => String(s||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]/g,'');
const gameKey = (h,a) => norm(h)+'_'+norm(a);
const num = v => { const n = Number(String(v ?? '').replace('%','').trim()); return isNaN(n) ? 0 : n; };
const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;

async function fetchJson(url, options={}){
  const res = await fetch(url, options);
  if(!res.ok) throw new Error('HTTP '+res.status);
  return res.json();
}
async function sportMonks(path){
  if(!SPORTMONKS_KEY) throw new Error('SPORTMONKS_KEY não configurada');
  const sep = path.includes('?') ? '&' : '?';
  return fetchJson('https://api.sportmonks.com/v3/football' + path + sep + 'api_token=' + encodeURIComponent(SPORTMONKS_KEY), {headers:{Accept:'application/json'}});
}
async function safeSportMonks(path){ try { return await sportMonks(path); } catch(e){ return {data:null,error:String(e.message||e)}; } }
async function apiFootball(path){
  if(!API_FOOTBALL_KEY) throw new Error('API_FOOTBALL_KEY não configurada');
  return fetchJson('https://v3.football.api-sports.io' + path, {headers:{'x-apisports-key':API_FOOTBALL_KEY, Accept:'application/json'}});
}
async function safeApi(path){ try { return await apiFootball(path); } catch(e){ return {response:[],error:String(e.message||e)}; } }
async function espn(path){ return fetchJson('https://site.api.espn.com/apis/site/v2/sports/soccer/' + path, {headers:{'User-Agent':'Mozilla/5.0', Accept:'application/json'}}); }

function normalizeSportMonksGame(fx){
  const parts = fx.participants || [];
  const home = parts.find(p=>p.meta?.location==='home') || parts[0] || {};
  const away = parts.find(p=>p.meta?.location==='away') || parts[1] || {};
  const scoreOf = (team) => (fx.scores||[]).find(s=>s.participant_id===team.id && ['CURRENT','2ND_HALF','1ST_HALF'].includes(s.description))?.score?.goals ?? '';
  const state = String(fx.state?.state || fx.state?.name || '').toUpperCase();
  const live = ['LIVE','HT','1ST_HALF','2ND_HALF'].includes(state);
  const finished = ['FT','AET','FT_PEN'].includes(state);
  return {
    source:'SportMonks', id:'sm_'+fx.id, sportmonksId:fx.id, fixtureId:'', leagueId:fx.league_id||'', season:fx.season_id||'',
    league:fx.league?.name||'', date:fx.starting_at||'', venue:fx.venue?.name||'', city:fx.venue?.city_name||'',
    time:fx.starting_at ? new Date(fx.starting_at).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}) : '',
    status:fx.state?.name || state || '', state:live?'in':finished?'post':'pre', live, minute:'',
    home:{id:home.id||'', name:home.name||'', logo:home.image_path||'', score:scoreOf(home)},
    away:{id:away.id||'', name:away.name||'', logo:away.image_path||'', score:scoreOf(away)}
  };
}
function normalizeApiGame(m){
  const f=m.fixture||{}, l=m.league||{}, t=m.teams||{}, g=m.goals||{}, s=f.status||{};
  const short=s.short||''; const live=['1H','2H','HT','ET','BT','P','SUSP','INT','LIVE'].includes(short); const finished=['FT','AET','PEN'].includes(short);
  return {source:'API-Football', id:String(f.id||''), fixtureId:f.id||'', sportmonksId:'', leagueId:l.id||'', season:l.season||'', league:l.name||'', date:f.date||'', venue:f.venue?.name||'', city:f.venue?.city||'', time:f.date?new Date(f.date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'', status:s.long||short||'', state:live?'in':finished?'post':'pre', live, minute:s.elapsed?String(s.elapsed)+"'":'', home:{id:t.home?.id||'', name:t.home?.name||'', logo:t.home?.logo||'', score:g.home??''}, away:{id:t.away?.id||'', name:t.away?.name||'', logo:t.away?.logo||'', score:g.away??''}};
}
function normalizeEspnGame(event, league){
  const comp=event.competitions?.[0]||{}; const cs=comp.competitors||[]; const home=cs.find(c=>c.homeAway==='home')||cs[0]||{}; const away=cs.find(c=>c.homeAway==='away')||cs[1]||{}; const type=event.status?.type||{};
  return {source:'ESPN', id:event.id, fixtureId:'', sportmonksId:'', league:league.name, date:event.date||'', venue:comp.venue?.fullName||'', city:comp.venue?.address?.city||'', time:event.date?new Date(event.date).toLocaleString('pt-BR',{timeZone:'America/Sao_Paulo'}):'', status:type.description||type.detail||type.name||'', state:type.state||'', live:type.state==='in', minute:event.status?.displayClock||'', home:{id:'', name:home.team?.displayName||home.team?.name||'', logo:home.team?.logo||'', score:home.score??''}, away:{id:'', name:away.team?.displayName||away.team?.name||'', logo:away.team?.logo||'', score:away.score??''}};
}

app.get('/api/games', async (req,res)=>{
  const date = isoDate(req.query.date); const out=[]; const errors=[];
  if(SPORTMONKS_KEY){ try{ const sm=await sportMonks(`/fixtures/date/${date}?include=participants;scores;league;state;venue`); (sm.data||[]).forEach(f=>out.push(normalizeSportMonksGame(f))); }catch(e){ errors.push({source:'SportMonks', error:String(e.message||e)}); } }
  try{ const api=await apiFootball(`/fixtures?date=${date}`); (api.response||[]).forEach(m=>out.push(normalizeApiGame(m))); }catch(e){ errors.push({source:'API-Football', error:String(e.message||e)}); }
  await Promise.all(ESPN_LEAGUES.map(async league=>{ try{ const data=await espn(`${league.key}/scoreboard?dates=${yyyymmdd(date)}&limit=200`); (data.events||[]).forEach(ev=>out.push(normalizeEspnGame(ev, league))); }catch(e){} }));
  const map = new Map();
  for(const g of out){ const key=gameKey(g.home.name,g.away.name); if(!key || key==='_') continue; const old=map.get(key); if(!old) map.set(key,g); else if(g.source==='SportMonks') map.set(key,{...old,...g}); else if(g.source==='API-Football' && old.source==='ESPN') map.set(key,{...old,...g}); }
  const rank = g => g.live ? 0 : g.state==='pre' ? 1 : 2;
  const games=[...map.values()].sort((a,b)=>rank(a)-rank(b) || new Date(a.date)-new Date(b.date));
  res.json({ok:true,date,total:games.length,games,errors});
});

function normalizeApiStats(resp){ const rows=[]; (resp||[]).forEach(tb=>{ const team=tb.team?.name||''; (tb.statistics||[]).forEach(s=>rows.push({team,label:String(s.type||''),value:s.value??''})); }); return rows; }
function normalizeApiEvents(events){ return (events||[]).map(e=>({minute:e.time?.elapsed?String(e.time.elapsed)+"'":'',team:e.team?.name||'',player:e.player?.name||'',type:e.type||'',detail:e.detail||''})); }
function normalizeSportMonksStats(fixture, game){
  const rows=[]; const parts=fixture.participants||[]; const home=parts.find(p=>p.meta?.location==='home')||{id:game.home.id,name:game.home.name}; const away=parts.find(p=>p.meta?.location==='away')||{id:game.away.id,name:game.away.name};
  (fixture.statistics||[]).forEach(s=>{ const label=String(s.type?.name||s.type_name||s.name||'').toLowerCase(); const team=s.participant_id===home.id?home.name:s.participant_id===away.id?away.name:''; const value=s.data?.value??s.value??s.data?.count??''; if(team&&label) rows.push({team,label,value}); });
  return rows;
}
function normalizeSportMonksEvents(fixture){ return (fixture.events||[]).map(e=>({minute:e.minute?String(e.minute)+"'":'', team:e.participant?.name||'', player:e.player_name||e.player?.display_name||'', type:e.type?.name||'', detail:e.info||e.addition||''})); }
function normalizeSportMonksLineups(fixture){ return (fixture.lineups||[]).slice(0,40).map(l=>({team:l.participant?.name||'', player:l.player?.display_name||l.player_name||'', position:l.position?.name||'', type:l.type?.name||''})); }
function splitByTeam(stats){ const teams=[...new Set(stats.map(s=>s.team).filter(Boolean))]; const home=teams[0]||'Casa', away=teams[1]||'Fora'; const homeStats={}, awayStats={}; stats.forEach(s=>{(s.team===home?homeStats:awayStats)[String(s.label).toLowerCase()]=s.value}); return {home,away,homeStats,awayStats}; }
function normalizeStatKey(k){
  return String(k||'').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[_-]/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}
function pickStat(obj, include, exclude=[]){
  const keys=Object.keys(obj||{});
  const exact=keys.find(k=>include.some(i=>normalizeStatKey(k)===normalizeStatKey(i)));
  if(exact) return obj[exact];
  const found=keys.find(k=>{
    const nk=normalizeStatKey(k);
    return include.some(i=>nk.includes(normalizeStatKey(i))) && !exclude.some(e=>nk.includes(normalizeStatKey(e)));
  });
  return found?obj[found]:'';
}
function makeLiveFromRows(stats, game){
  const t=splitByTeam(stats), hs=t.homeStats, as=t.awayStats;
  const homeName=game.home.name, awayName=game.away.name;

  function totalShots(obj){
    // Não deixa "shots on target" virar finalização total.
    const direct=num(pickStat(obj,
      ['total shots','shots total','goal attempts','total attempts','shots'],
      ['on target','on goal','off target','off goal','blocked','inside','outside','accurate']
    ));
    if(direct) return direct;
    const on=num(pickStat(obj,['shots on target','shots on goal','on target','on goal'],['off','blocked']));
    const off=num(pickStat(obj,['shots off target','shots off goal','off target','off goal'],['on','blocked']));
    const blocked=num(pickStat(obj,['blocked shots','shots blocked','blocked']));
    return on+off+blocked;
  }

  const finalHome=totalShots(hs), finalAway=totalShots(as);
  const targetHome=num(pickStat(hs,['shots on target','shots on goal','on target','on goal'],['off','blocked']));
  const targetAway=num(pickStat(as,['shots on target','shots on goal','on target','on goal'],['off','blocked']));
  const cornerHome=num(pickStat(hs,['corners','corner kicks','corner']));
  const cornerAway=num(pickStat(as,['corners','corner kicks','corner']));
  const possHome=num(pickStat(hs,['ball possession','possession','possession percentage']));
  const possAway=num(pickStat(as,['ball possession','possession','possession percentage']));

  const has=!!(finalHome||finalAway||targetHome||targetAway||cornerHome||cornerAway||possHome||possAway); if(!has) return null;
  const hp=finalHome*2+targetHome*4+cornerHome*2+possHome*.25; const ap=finalAway*2+targetAway*4+cornerAway*2+possAway*.25; const leader=hp>=ap?homeName:awayName;
  return {dataType:'live', hasEnoughData:true, confidence:(finalHome+finalAway+cornerHome+cornerAway)>=10?'Alta':'Moderada', reading:`${leader} pressiona mais neste momento com base nas estatísticas ao vivo.`, pressureTeam:leader, finalizations:{home:finalHome,away:finalAway}, shotsOnGoal:{home:targetHome,away:targetAway}, corners:{home:cornerHome,away:cornerAway}, possession:{home:possHome,away:possAway}, base:[`Finalizações ao vivo: ${finalHome||'-'} x ${finalAway||'-'}.`,`Chutes no gol ao vivo: ${targetHome||'-'} x ${targetAway||'-'}.`,`Escanteios ao vivo: ${cornerHome||'-'} x ${cornerAway||'-'}.`,`Posse ao vivo: ${possHome||'-'}% x ${possAway||'-'}%.`]};
}
async function newsContext(game){
  if(!NEWS_API_KEY) return {items:[],base:[]};
  try{ const q=encodeURIComponent(`"${game.home.name}" "${game.away.name}" futebol OR soccer`); const data=await fetchJson(`https://newsapi.org/v2/everything?q=${q}&language=pt&sortBy=publishedAt&pageSize=8&apiKey=${NEWS_API_KEY}`); const items=(data.articles||[]).slice(0,8).map(a=>({title:a.title||'',source:a.source?.name||'',url:a.url||''})); const rel=items.filter(i=>!/onde assistir|horário|transmissão/i.test(i.title)); return {items:rel.length?rel:items, base:(rel.length?rel:items).slice(0,4).map(a=>a.title)}; }catch(e){ return {items:[],base:[]}; }
}
async function weatherContext(game){
  if(!OPENWEATHER_KEY || !game.city) return {data:null,base:[]};
  try{ const q=encodeURIComponent(game.city); const data=await fetchJson(`https://api.openweathermap.org/data/2.5/weather?q=${q}&appid=${OPENWEATHER_KEY}&units=metric&lang=pt_br`); const desc=data.weather?.[0]?.description||''; const temp=Math.round(data.main?.temp||0); const wind=data.wind?.speed||0; return {data:{city:game.city,desc,temp,wind},base:[`Clima em ${game.city}: ${desc}, ${temp}°C, vento ${wind} m/s.`]}; }catch(e){return {data:null,base:[]};}
}
function internalNotes(game){ const notes=[]; let homeBoost=0, awayBoost=0; for(const [team,note] of CONTEXT_NOTES){ if(norm(team)===norm(game.home.name)){notes.push(`${team}: ${note}.`); homeBoost+=8;} if(norm(team)===norm(game.away.name)){notes.push(`${team}: ${note}.`); awayBoost+=8;} } return {notes,homeBoost,awayBoost}; }
function makePregame(game, ctx){
  const home=game.home.name, away=game.away.name; const base=[]; let homeScore=10, awayScore=8, evidence=0;
  const internal=internalNotes(game); homeScore+=internal.homeBoost; awayScore+=internal.awayBoost; if(internal.notes.length){evidence++; base.push(...internal.notes);}
  for(const b of ctx.news.base||[]) base.push('Notícia: '+b); for(const b of ctx.weather.base||[]) base.push(b);
  if(ctx.news.base.length) evidence++;
  const canAssert=evidence>=1; const leader=homeScore>=awayScore?home:away; const winPctHome=Math.max(15,Math.min(75,Math.round(50+(homeScore-awayScore)*1.2))); const winPctAway=100-winPctHome; const confidence=evidence>=3?'Alta':evidence>=2?'Moderada':canAssert?'Baixa+':'Baixa';
  const predictions=[{key:'winner',label:`${leader} aparece com melhor tendência de vitória`,target:leader,status:'pending'},{key:'pressure',label:`${leader} tende a pressionar mais`,target:leader,status:'pending'},{key:'shots',label:`${leader} tende a ter mais finalizações`,target:leader,status:'pending'},{key:'corners',label:`${leader} tende a gerar mais escanteios`,target:leader,status:'pending'}];
  return {hasEnoughData:canAssert,confidence,evidenceCount:evidence,pressureTeam:canAssert?leader:'',probableWinner:canAssert?leader:'',winPctHome,winPctAway,predictions,reading:canAssert?`${leader} aparece melhor no contexto pré-jogo com base nos dados disponíveis.`:'Leitura contextual limitada para esta partida.',base:base.length?base:['Cobertura contextual parcial.']};
}
function historicalFallback(game,pregame){ const h=Math.max(6,Math.round((pregame.winPctHome||50)/6)); const a=Math.max(5,Math.round((pregame.winPctAway||50)/7)); return {dataType:'historical', finalizations:{home:h+4,away:a+3}, shotsOnGoal:{home:Math.max(2,Math.round((h+4)*.35)),away:Math.max(1,Math.round((a+3)*.35))}, corners:{home:Math.max(2,Math.round((h+4)*.42)),away:Math.max(1,Math.round((a+3)*.42))}, possession:{home:pregame.winPctHome||50,away:pregame.winPctAway||50}, reading:'Tendência histórica/contextual. Não é estatística ao vivo.'}; }
function updatePredictions(live, game, pregame){ if(!live) return pregame.predictions||[]; return (pregame.predictions||[]).map(p=>{ if(p.key==='winner'){ const hs=num(game.home.score), as=num(game.away.score); if(hs===as) return {...p,status:'pending'}; return {...p,status:(hs>as?game.home.name:game.away.name)===p.target?'good':'bad'}; } if(p.key==='pressure') return {...p,status:live.pressureTeam===p.target?'good':'bad'}; if(p.key==='shots'){ const h=live.finalizations.home,a=live.finalizations.away; if(h===a)return {...p,status:'pending'}; return {...p,status:(h>a?game.home.name:game.away.name)===p.target?'good':'bad'};} if(p.key==='corners'){ const h=live.corners.home,a=live.corners.away; if(h===a)return {...p,status:'pending'}; return {...p,status:(h>a?game.home.name:game.away.name)===p.target?'good':'bad'};} return p; }); }
function makePostGame(game, live){ if(game.state!=='post') return null; if(!live) return {title:'Pós-jogo',text:'Partida finalizada, mas as estatísticas detalhadas não foram entregues pela cobertura disponível.',points:['Resultado final disponível.','Sem base estatística suficiente para análise de volume.']}; const h=game.home.name,a=game.away.name; const hs=num(game.home.score), as=num(game.away.score); const winner=hs>as?h:as>hs?a:'empate'; const shotLeader=live.finalizations.home>live.finalizations.away?h:a; const possLeader=live.possession.home>live.possession.away?h:a; const efficient=winner!=='empate'&&winner!==shotLeader; return {title:'Pós-jogo', text: efficient?`${shotLeader} teve mais volume ofensivo, mas ${winner} foi mais eficiente e aproveitou melhor o que criou.`:`${winner==='empate'?'O jogo terminou empatado':winner+' confirmou o resultado'} com leitura alinhada ao volume apresentado na partida.`, points:[`Finalizações: ${live.finalizations.home} x ${live.finalizations.away}.`,`Chutes no gol: ${live.shotsOnGoal.home} x ${live.shotsOnGoal.away}.`,`Escanteios: ${live.corners.home} x ${live.corners.away}.`,`Maior posse: ${possLeader}.`]}; }

app.get('/api/game-details', async (req,res)=>{
  try{
    const game=JSON.parse(req.query.game||'{}'); const fixtureId=req.query.fixtureId; const sportmonksId=req.query.sportmonksId;
    let statsRows=[], events=[], lineups=[];
    if(SPORTMONKS_KEY && sportmonksId){ const sm=await safeSportMonks(`/fixtures/${sportmonksId}?include=statistics.type;events.type;events.participant;lineups.player;lineups.position;lineups.type;participants;scores`); if(sm.data){ statsRows=normalizeSportMonksStats(sm.data,game); events=normalizeSportMonksEvents(sm.data); lineups=normalizeSportMonksLineups(sm.data); } }
    if(!statsRows.length && fixtureId){ const [st,ev]=await Promise.all([safeApi(`/fixtures/statistics?fixture=${fixtureId}`),safeApi(`/fixtures/events?fixture=${fixtureId}`)]); statsRows=normalizeApiStats(st.response); events=events.length?events:normalizeApiEvents(ev.response); }
    const [news,weather]=await Promise.all([newsContext(game),weatherContext(game)]);
    const pregame=makePregame(game,{news,weather}); const live=makeLiveFromRows(statsRows,game); const displayStats=live||historicalFallback(game,pregame); const predictions=updatePredictions(live,game,pregame); const predictionScore={good:predictions.filter(p=>p.status==='good').length,bad:predictions.filter(p=>p.status==='bad').length,total:predictions.filter(p=>['good','bad'].includes(p.status)).length}; const postGame=makePostGame(game,live); const main=live||{dataType:'trend',reading:pregame.reading,base:pregame.base};
    res.json({ok:true,teamStats:statsRows,events,lineups,players:{home:[],away:[]},news:news.items,weather:weather.data,postGame,analysis:{live:live?{...live,predictions,predictionScore}:{dataType:'none',reading:'Sem estatísticas ao vivo reais.',predictions,predictionScore},pregame,displayStats,main:{...main,predictions,predictionScore},contextSource:'SportMonks principal + API-Football fallback + contexto'}});
  }catch(e){ res.status(500).json({ok:false,error:String(e.message||e)}); }
});

app.listen(PORT,()=>console.log('DhuniorStats V18 SportMonks rodando na porta '+PORT));
