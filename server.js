
const express = require("express");
const fetch = require("node-fetch");
const app = express();
const PORT = process.env.PORT || 3000;

const SPORTMONKS_KEY = process.env.SPORTMONKS_KEY || "";
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";
const NEWS_API_KEY = process.env.NEWS_API_KEY || "";
const OPENWEATHER_KEY = process.env.OPENWEATHER_KEY || "";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

app.use((req,res,next)=>{res.set("Cache-Control","no-store, no-cache, must-revalidate, proxy-revalidate");res.set("Pragma","no-cache");res.set("Expires","0");next();});
app.use(express.static("public"));

const ESPN_LEAGUES = [
  ["bra.1","Brasileirão Série A"],
  ["conmebol.libertadores","Libertadores"],
  ["conmebol.sudamericana","Sul-Americana"],
  ["eng.1","Premier League"],
  ["ita.1","Serie A Itália"],
  ["esp.1","La Liga"]
].map(([key,name])=>({key,name}));

const TEAM_PROFILES = {
  "palmeiras": {power:89, style:"muito forte em casa, posse alta, pressão e volume ofensivo"},
  "flamengo": {power:89, style:"elenco forte, muita presença ofensiva e pressão em jogos grandes"},
  "botafogo": {power:85, style:"time forte, competitivo e com boa transição ofensiva"},
  "fluminense": {power:82, style:"posse, construção curta e pressão em jogos de Libertadores"},
  "atletico mineiro": {power:85, style:"muito forte em casa, costuma pressionar em jogos decisivos"},
  "atlético mineiro": {power:85, style:"muito forte em casa, costuma pressionar em jogos decisivos"},
  "athletico pr": {power:81, style:"mandante forte, Arena aumenta intensidade e escanteios"},
  "sao paulo": {power:81, style:"forte em casa e tende a controlar posse"},
  "são paulo": {power:81, style:"forte em casa e tende a controlar posse"},
  "juventus": {power:87, style:"time grande, elenco superior e forte quando precisa de vaga europeia"},
  "milan": {power:86, style:"elenco forte e tendência ofensiva quando precisa vencer"},
  "inter": {power:89, style:"controle, eficiência e superioridade técnica"},
  "internazionale": {power:89, style:"controle, eficiência e superioridade técnica"},
  "torino": {power:71, style:"mandante competitivo, mas inferior aos grandes italianos"},
  "como": {power:73, style:"pode aumentar intensidade quando precisa pontuar"},
  "arsenal": {power:89, style:"pressão alta, posse e volume ofensivo"},
  "manchester city": {power:92, style:"posse dominante, controle territorial e muitas finalizações"},
  "liverpool": {power:90, style:"pressão alta, intensidade e volume ofensivo"},
  "always ready": {power:69, style:"em casa ganha força pela altitude; fora perde bastante força"},
  "bolivar": {power:78, style:"muito forte em casa pela altitude"},
  "bolívar": {power:78, style:"muito forte em casa pela altitude"}
};

const NEED_WORDS = ["precisa vencer","classificação","champions","libertadores","rebaixamento","mata-mata","decisivo","pressionado","pressão","crise","vaga","g4","g6"];

const clean = s => String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();
const num = v => { const n = Number(String(v ?? "").replace("%","").replace(",",".").trim()); return isNaN(n)?0:n; };
const isoDate = d => String(d || new Date().toISOString().slice(0,10));
const yyyymmdd = d => isoDate(d).replaceAll("-","");
const gameKey = (h,a) => clean(h)+"_"+clean(a);
const avg = a => a.length ? a.reduce((x,y)=>x+y,0)/a.length : 0;

async function fetchJson(url, options={}){
  const r = await fetch(url, options);
  if(!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}
async function sm(path){
  if(!SPORTMONKS_KEY) throw new Error("SPORTMONKS_KEY ausente");
  const sep = path.includes("?") ? "&" : "?";
  return fetchJson("https://api.sportmonks.com/v3/football"+path+sep+"api_token="+encodeURIComponent(SPORTMONKS_KEY), {headers:{Accept:"application/json"}});
}
async function safeSm(path){ try{return await sm(path)}catch(e){return {data:null,error:String(e.message||e)}}}
async function api(path){
  if(!API_FOOTBALL_KEY) throw new Error("API_FOOTBALL_KEY ausente");
  return fetchJson("https://v3.football.api-sports.io"+path, {headers:{"x-apisports-key":API_FOOTBALL_KEY,Accept:"application/json"}});
}
async function safeApi(path){ try{return await api(path)}catch(e){return {response:[],error:String(e.message||e)}}}
async function espn(path){
  return fetchJson("https://site.api.espn.com/apis/site/v2/sports/soccer/"+path, {headers:{"User-Agent":"Mozilla/5.0",Accept:"application/json"}});
}

function normalizeSportMonksGame(fx){
  const parts = fx.participants || [];
  const home = parts.find(p=>p.meta?.location==="home" || p.pivot?.location==="home") || parts[0] || {};
  const away = parts.find(p=>p.meta?.location==="away" || p.pivot?.location==="away") || parts[1] || {};
  const scores = fx.scores || [];
  const stateRaw = fx.state?.state || fx.state?.name || "";
  const st = String(stateRaw).toUpperCase();
  const live = ["LIVE","HT","1ST_HALF","2ND_HALF","INPLAY"].includes(st);
  const finished = ["FT","AET","FT_PEN","FULLTIME","FINISHED","ENDED"].includes(st);

  function scoreOf(participant){
    const pid = participant.id;
    if(!pid) return "";

    const own = scores.filter(s => s.participant_id === pid);

    // Para jogo finalizado: prioriza placar final/fulltime, nunca placar parcial antigo.
    if(finished){
      const finalScore = own.find(s => {
        const d = String(s.description || "").toUpperCase();
        const n = String(s.type?.name || s.score?.description || "").toUpperCase();
        return ["CURRENT","FULLTIME","FT","2ND_HALF","REGULAR_TIME"].includes(d) || ["CURRENT","FULLTIME","FT"].includes(n);
      });
      if(finalScore?.score?.goals !== undefined) return finalScore.score.goals;
    }

    // Para jogo ao vivo: prioriza CURRENT.
    const current = own.find(s => String(s.description || "").toUpperCase() === "CURRENT");
    if(current?.score?.goals !== undefined) return current.score.goals;

    // Se não houver CURRENT, pega o score mais recente conhecido, evitando HT quando tiver 2º tempo/FT.
    const priority = ["FULLTIME","FT","2ND_HALF","CURRENT","1ST_HALF","HT"];
    for(const p of priority){
      const row = own.find(s => String(s.description || "").toUpperCase() === p);
      if(row?.score?.goals !== undefined) return row.score.goals;
    }

    return "";
  }

  return {
    source:"SportMonks", id:"sm_"+fx.id, sportmonksId:fx.id, fixtureId:"",
    league:fx.league?.name || "", leagueId:fx.league_id || "", season:fx.season_id || "",
    date:fx.starting_at || "", venue:fx.venue?.name || "", city:fx.venue?.city_name || "",
    time:fx.starting_at ? new Date(fx.starting_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}) : "",
    status:fx.state?.name || stateRaw || "", state:live?"in":finished?"post":"pre", live,
    minute:fx.periods?.find(p=>p.minutes)?.minutes ? String(fx.periods.find(p=>p.minutes).minutes)+"'" : "",
    home:{id:home.id || "", name:home.name || "", logo:home.image_path || "", score:scoreOf(home)},
    away:{id:away.id || "", name:away.name || "", logo:away.image_path || "", score:scoreOf(away)}
  };
}
function normalizeApiGame(m){
  const f=m.fixture||{}, l=m.league||{}, t=m.teams||{}, g=m.goals||{}, s=f.status||{};
  const short=s.short||"";
  const live=["1H","2H","HT","ET","BT","P","SUSP","INT","LIVE"].includes(short);
  const finished=["FT","AET","PEN"].includes(short);
  return {
    source:"API-Football", id:String(f.id||""), fixtureId:f.id||"", sportmonksId:"",
    league:l.name||"", leagueId:l.id||"", season:l.season||"", date:f.date||"",
    venue:f.venue?.name||"", city:f.venue?.city||"",
    time:f.date ? new Date(f.date).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}) : "",
    status:s.long||short||"", state:live?"in":finished?"post":"pre", live,
    minute:s.elapsed ? String(s.elapsed)+"'" : "",
    home:{id:t.home?.id||"", name:t.home?.name||"", logo:t.home?.logo||"", score:g.home??""},
    away:{id:t.away?.id||"", name:t.away?.name||"", logo:t.away?.logo||"", score:g.away??""}
  };
}
function normalizeEspnGame(event, league){
  const comp=event.competitions?.[0]||{}, c=comp.competitors||[];
  const home=c.find(x=>x.homeAway==="home")||c[0]||{}, away=c.find(x=>x.homeAway==="away")||c[1]||{};
  const type=event.status?.type||{};
  return {
    source:"ESPN", id:event.id, fixtureId:"", sportmonksId:"",
    league:league.name, date:event.date||"", venue:comp.venue?.fullName||"", city:comp.venue?.address?.city||"",
    time:event.date ? new Date(event.date).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}) : "",
    status:type.description||type.detail||type.name||"", state:type.state||"", live:type.state==="in", minute:event.status?.displayClock||"",
    home:{id:"", name:home.team?.displayName||home.team?.name||"", logo:home.team?.logo||"", score:home.score??""},
    away:{id:"", name:away.team?.displayName||away.team?.name||"", logo:away.team?.logo||"", score:away.score??""}
  };
}

app.get("/api/games", async (req,res)=>{
  const date=isoDate(req.query.date);
  const out=[], errors=[];
  if(SPORTMONKS_KEY){
    try{ const data=await sm(`/fixtures/date/${date}?include=participants;scores;league;state;venue;periods`); (data.data||[]).forEach(x=>out.push(normalizeSportMonksGame(x))); }catch(e){errors.push({source:"SportMonks",error:String(e.message||e)})}
  }
  try{ const data=await api(`/fixtures?date=${date}`); (data.response||[]).forEach(x=>out.push(normalizeApiGame(x))); }catch(e){errors.push({source:"API-Football",error:String(e.message||e)})}
  await Promise.all(ESPN_LEAGUES.map(async league=>{
    try{ const data=await espn(`${league.key}/scoreboard?dates=${yyyymmdd(date)}&limit=120`); (data.events||[]).forEach(ev=>out.push(normalizeEspnGame(ev,league))); }catch(e){}
  }));
  const map=new Map();
  for(const g of out){
    const k=gameKey(g.home.name,g.away.name); if(!k||k==="_") continue;
    const old=map.get(k);
    if(!old) map.set(k,g);
    else {
      const oldComplete = (old.home.score !== "" && old.away.score !== "" ? 1 : 0) + (old.state==="post" ? 1 : 0);
      const newComplete = (g.home.score !== "" && g.away.score !== "" ? 1 : 0) + (g.state==="post" ? 1 : 0);

      // SportMonks continua principal, mas se API-Football trouxer jogo finalizado mais completo,
      // mantém nomes/logos do SportMonks e atualiza placar/status.
      if(g.source==="SportMonks"){
        map.set(k,{...old,...g});
      } else if(g.source==="API-Football" && (old.source==="ESPN" || (g.state==="post" && newComplete>=oldComplete))){
        map.set(k,{...old, state:g.state, live:g.live, status:g.status, minute:g.minute, home:{...old.home, score:g.home.score}, away:{...old.away, score:g.away.score}, fixtureId:g.fixtureId || old.fixtureId, source:old.source==="SportMonks"?"SportMonks":"API-Football"});
      }
    }
  }
  const games=[...map.values()].sort((a,b)=>{
    const p=g=>g.live?0:/brasileir|libertadores|sudamericana|premier/i.test(g.league)?1:2;
    return p(a)-p(b)||new Date(a.date)-new Date(b.date);
  });
  res.json({ok:true,date,total:games.length,games,errors});
});

function profile(name){
  const k=clean(name);
  return TEAM_PROFILES[k] || Object.entries(TEAM_PROFILES).find(([x])=>k.includes(x)||x.includes(k))?.[1] || {power:66,style:"perfil específico ainda não cadastrado"};
}
function statName(s){ return clean(s.type?.name || s.type_name || s.name || s.code || ""); }
function extractSmStats(fixture, game){
  const parts=fixture.participants||[];
  const home=parts.find(p=>p.meta?.location==="home"||p.pivot?.location==="home")||{id:game.home.id,name:game.home.name};
  const away=parts.find(p=>p.meta?.location==="away"||p.pivot?.location==="away")||{id:game.away.id,name:game.away.name};
  const out={home:{finalizations:"",shotsOnGoal:"",corners:"",possession:""},away:{finalizations:"",shotsOnGoal:"",corners:"",possession:""},raw:[]};
  for(const s of fixture.statistics||[]){
    const side=s.participant_id===home.id?"home":s.participant_id===away.id?"away":null;
    if(!side) continue;
    const typeId=Number(s.type_id || s.type?.id || 0);
    const name=statName(s);
    const value=num(s.data?.value ?? s.data?.count ?? s.value ?? "");
    out.raw.push({side,typeId,name,value});
    if(typeId===42 || name==="shots total" || name==="total shots") out[side].finalizations=value;
    if(typeId===86 || name.includes("shots on target") || name.includes("shots on goal")) out[side].shotsOnGoal=value;
    if(typeId===34 || name.includes("corner")) out[side].corners=value;
    if(typeId===45 || name.includes("possession")) out[side].possession=value;
  }
  return out;
}
function extractApiStats(resp, game){
  const out={home:{finalizations:"",shotsOnGoal:"",corners:"",possession:""},away:{finalizations:"",shotsOnGoal:"",corners:"",possession:""},raw:[]};
  for(const tb of resp||[]){
    const side=clean(tb.team?.name)===clean(game.home.name)?"home":clean(tb.team?.name)===clean(game.away.name)?"away":"";
    for(const st of tb.statistics||[]){
      const name=clean(st.type), value=num(st.value);
      out.raw.push({side,name,value});
      if(!side) continue;
      if((name.includes("total shots") || name.includes("shots total")) && !name.includes("on") && !name.includes("off")) out[side].finalizations=value;
      if(name.includes("shots on goal") || name.includes("shots on target")) out[side].shotsOnGoal=value;
      if(name.includes("corner")) out[side].corners=value;
      if(name.includes("possession")) out[side].possession=value;
    }
  }
  return out;
}
function liveFromStats(ex, game){
  const h=ex.home,a=ex.away;
  const has=[h.finalizations,a.finalizations,h.shotsOnGoal,a.shotsOnGoal,h.corners,a.corners,h.possession,a.possession].some(v=>v!==""&&v!==null&&v!==undefined);
  if(!has) return null;
  const hp=num(h.finalizations)*2+num(h.shotsOnGoal)*4+num(h.corners)*2+num(h.possession)*.25;
  const ap=num(a.finalizations)*2+num(a.shotsOnGoal)*4+num(a.corners)*2+num(a.possession)*.25;
  const leader=hp>=ap?game.home.name:game.away.name;
  return {
    dataType:"live", pressureTeam:leader,
    reading:`${leader} pressiona mais neste momento pelas estatísticas ao vivo.`,
    finalizations:{home:h.finalizations,away:a.finalizations},
    shotsOnGoal:{home:h.shotsOnGoal,away:a.shotsOnGoal},
    corners:{home:h.corners,away:a.corners},
    possession:{home:h.possession,away:a.possession},
    base:[
      `Finalizações: ${h.finalizations||"-"} x ${a.finalizations||"-"}.`,
      `Chutes no gol: ${h.shotsOnGoal||"-"} x ${a.shotsOnGoal||"-"}.`,
      `Escanteios: ${h.corners||"-"} x ${a.corners||"-"}.`,
      `Posse: ${h.possession||"-"}% x ${a.possession||"-"}%.`
    ]
  };
}
async function apiTeamContext(game){
  if(!game.home.id||!game.away.id||!API_FOOTBALL_KEY) return {};
  const [hr,ar,stand,hs,as]=await Promise.all([
    safeApi(`/fixtures?team=${game.home.id}&last=10`),
    safeApi(`/fixtures?team=${game.away.id}&last=10`),
    safeApi(`/standings?league=${game.leagueId}&season=${game.season}`),
    safeApi(`/teams/statistics?team=${game.home.id}&league=${game.leagueId}&season=${game.season}`),
    safeApi(`/teams/statistics?team=${game.away.id}&league=${game.leagueId}&season=${game.season}`)
  ]);
  return {hr:hr.response||[],ar:ar.response||[],standings:stand.response?.[0]?.league?.standings?.[0]||[],hs:hs.response,as:as.response};
}
function form(fixtures, id){
  const g=(fixtures||[]).slice(0,10).map(f=>{
    const home=f.teams?.home?.id==id, gf=num(home?f.goals?.home:f.goals?.away), ga=num(home?f.goals?.away:f.goals?.home);
    return {gf,ga,win:gf>ga,draw:gf===ga,loss:gf<ga};
  });
  return {played:g.length,wins:g.filter(x=>x.win).length,draws:g.filter(x=>x.draw).length,losses:g.filter(x=>x.loss).length,gf:avg(g.map(x=>x.gf)).toFixed(1),ga:avg(g.map(x=>x.ga)).toFixed(1)};
}
function standingOf(list, game, side){
  const team=game[side];
  return (list||[]).find(s=>s.team?.id==team.id || clean(s.team?.name)===clean(team.name));
}
async function news(game){
  if(!NEWS_API_KEY) return {items:[],base:[]};
  try{
    const q=encodeURIComponent(`("${game.home.name}" OR "${game.away.name}") futebol pressão classificação precisa vencer desfalque`);
    const data=await fetchJson(`https://newsapi.org/v2/everything?q=${q}&language=pt&sortBy=publishedAt&pageSize=8&apiKey=${NEWS_API_KEY}`);
    const items=(data.articles||[]).map(a=>({title:a.title||"",source:a.source?.name||"",url:a.url||""}));
    const filtered=items.filter(i=>!/onde assistir|horário|transmissão|palpite/i.test(i.title));
    return {items:filtered.length?filtered:items.slice(0,5),base:(filtered.length?filtered:items.slice(0,5)).map(x=>x.title)};
  }catch(e){ return {items:[],base:[]}; }
}
async function weather(game){
  if(!OPENWEATHER_KEY||!game.city) return null;
  try{
    const data=await fetchJson(`https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(game.city)}&appid=${OPENWEATHER_KEY}&units=metric&lang=pt_br`);
    return {city:game.city,desc:data.weather?.[0]?.description||"",temp:Math.round(data.main?.temp||0),wind:data.wind?.speed||0};
  }catch(e){return null}
}
function buildContext(game, ctx, newsCtx, weatherCtx){
  const hp=profile(game.home.name), ap=profile(game.away.name);
  let hScore=hp.power*.7+8, aScore=ap.power*.7;
  const base=[], reasonsH=[], reasonsA=[];
  hScore+=5; reasonsH.push("mando de campo ajuda, mas não decide sozinho");
  const hForm=form(ctx.hr,game.home.id), aForm=form(ctx.ar,game.away.id);
  const hPts=hForm.wins*3+hForm.draws, aPts=aForm.wins*3+aForm.draws;
  hScore+=hPts; aScore+=aPts;
  if(hForm.played) base.push(`Forma recente: ${game.home.name} ${hForm.wins}V/${hForm.draws}E/${hForm.losses}D; ${game.away.name} ${aForm.wins}V/${aForm.draws}E/${aForm.losses}D.`);
  if(aPts>hPts) reasonsA.push("melhor forma recente"); else if(hPts>aPts) reasonsH.push("melhor forma recente");
  const hs=standingOf(ctx.standings,game,"home"), as=standingOf(ctx.standings,game,"away");
  if(hs&&as){
    hScore+=Math.max(0,20-num(hs.rank)); aScore+=Math.max(0,20-num(as.rank));
    base.push(`Tabela: ${game.home.name} ${hs.rank}º; ${game.away.name} ${as.rank}º.`);
    if(num(as.rank)<num(hs.rank)) reasonsA.push("melhor posição na tabela"); else if(num(hs.rank)<num(as.rank)) reasonsH.push("melhor posição na tabela");
  }
  if(ap.power>hp.power+8) reasonsA.push("superioridade técnica"); else if(hp.power>ap.power+8) reasonsH.push("superioridade técnica");
  hScore+=Math.max(0,hp.power-ap.power)*.8; aScore+=Math.max(0,ap.power-hp.power)*.8;
  base.push(`${game.home.name}: ${hp.style}.`);
  base.push(`${game.away.name}: ${ap.style}.`);
  const allNews=clean(newsCtx.base.join(" "));
  const hToken=clean(game.home.name).split(" ")[0], aToken=clean(game.away.name).split(" ")[0];
  if(NEED_WORDS.some(w=>allNews.includes(clean(w))) && allNews.includes(hToken)){ hScore+=10; reasonsH.push("necessidade/pressão competitiva em notícias"); }
  if(NEED_WORDS.some(w=>allNews.includes(clean(w))) && allNews.includes(aToken)){ aScore+=10; reasonsA.push("necessidade/pressão competitiva em notícias"); }
  newsCtx.base.slice(0,4).forEach(n=>base.push(`Notícia: ${n}`));
  if(weatherCtx) base.push(`Clima: ${weatherCtx.desc}, ${weatherCtx.temp}°C, vento ${weatherCtx.wind} m/s.`);
  const leader=hScore>=aScore?game.home.name:game.away.name;
  const winPctHome=Math.max(14,Math.min(78,Math.round(50+(hScore-aScore)*.65)));
  const gap=Math.abs(hScore-aScore);
  const confidence=gap>18?"Alta":gap>9?"Moderada":"Baixa+";
  return {
    probableWinner:leader, pressureTeam:leader, confidence, winPctHome, winPctAway:100-winPctHome,
    reading:`${leader} aparece com melhor tendência contextual considerando força, tabela, forma e contexto externo.`,
    reasons:(leader===game.home.name?reasonsH:reasonsA).slice(0,5),
    base,
    predictions:[
      {key:"winner",label:`${leader} aparece com melhor tendência de vitória`,target:leader,status:"pending"},
      {key:"pressure",label:`${leader} tende a pressionar mais`,target:leader,status:"pending"},
      {key:"shots",label:`${leader} tende a ter mais finalizações`,target:leader,status:"pending"},
      {key:"corners",label:`${leader} tende a gerar mais escanteios`,target:leader,status:"pending"}
    ],
    payload:{homeProfile:hp,awayProfile:ap,homeForm:hForm,awayForm:aForm,homeStanding:hs,awayStanding:as,news:newsCtx.base.slice(0,5),weather:weatherCtx}
  };
}
async function gemini(game, context, live){
  if(!GEMINI_API_KEY) return null;
  try{
    const prompt=`Você é o analista do DhuniorStats. Não invente dados. Analise futebol com prioridade: estatística ao vivo, tabela/objetivo, força técnica, forma, notícias e só depois mando. Responda JSON: {"headline":"","favorite":"","confidence":"Alta|Moderada|Baixa","explanation":["","",""],"offensiveTrend":"","cornerTrend":""}. Dados: ${JSON.stringify({game,context:context.payload,base:context.base,live})}`;
    const body={contents:[{parts:[{text:prompt}]}],generationConfig:{temperature:.2,responseMimeType:"application/json"}};
    const data=await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    return JSON.parse(data.candidates?.[0]?.content?.parts?.[0]?.text||"null");
  }catch(e){return null}
}
function updatePredictions(preds, live, game){
  if(!live) return preds||[];
  return (preds||[]).map(p=>{
    if(p.key==="winner"){ const hs=num(game.home.score), as=num(game.away.score); if(hs===as)return {...p,status:"pending"}; return {...p,status:(hs>as?game.home.name:game.away.name)===p.target?"good":"bad"}; }
    if(p.key==="pressure") return {...p,status:live.pressureTeam===p.target?"good":"bad"};
    if(p.key==="shots"){ if(live.finalizations.home===""||live.finalizations.away===""||live.finalizations.home===live.finalizations.away)return {...p,status:"pending"}; return {...p,status:(num(live.finalizations.home)>num(live.finalizations.away)?game.home.name:game.away.name)===p.target?"good":"bad"}; }
    if(p.key==="corners"){ if(live.corners.home===""||live.corners.away===""||live.corners.home===live.corners.away)return {...p,status:"pending"}; return {...p,status:(num(live.corners.home)>num(live.corners.away)?game.home.name:game.away.name)===p.target?"good":"bad"}; }
    return p;
  });
}
function historical(context){
  return {
    dataType:"historical",
    finalizations:{home:Math.max(7,Math.round(context.winPctHome/5)),away:Math.max(6,Math.round(context.winPctAway/5))},
    shotsOnGoal:{home:Math.max(2,Math.round(context.winPctHome/14)),away:Math.max(2,Math.round(context.winPctAway/14))},
    corners:{home:Math.max(3,Math.round(context.winPctHome/13)),away:Math.max(2,Math.round(context.winPctAway/13))},
    possession:{home:context.winPctHome,away:context.winPctAway},
    reading:"Tendência histórica/contextual."
  };
}
function postGame(game, live){
  if(game.state!=="post") return null;
  if(!live) return {text:"Partida finalizada, mas sem estatísticas confiáveis suficientes para análise pós-jogo.",points:["Resultado final disponível.","Cobertura estatística parcial."]};
  const hs=num(game.home.score), as=num(game.away.score), winner=hs>as?game.home.name:as>hs?game.away.name:"empate";
  const shotLeader=num(live.finalizations.home)>num(live.finalizations.away)?game.home.name:game.away.name;
  return {text:winner!=="empate"&&winner!==shotLeader?`${shotLeader} teve mais volume, mas ${winner} foi mais eficiente.`:`${winner==="empate"?"O jogo terminou empatado":winner+" confirmou o resultado"} com base no volume apresentado.`,points:live.base};
}

app.get("/api/game-details", async (req,res)=>{
  try{
    const game=JSON.parse(req.query.game||"{}");
    const sportmonksId=req.query.sportmonksId, fixtureId=req.query.fixtureId;
    let extracted=null, live=null, events=[];
    if(SPORTMONKS_KEY&&sportmonksId){
      const data=await safeSm(`/fixtures/${sportmonksId}?include=statistics.type;participants;events.type;events.participant;scores`);
      if(data.data){
        extracted=extractSmStats(data.data,game);
        live=liveFromStats(extracted,game);
        events=(data.data.events||[]).map(e=>({minute:e.minute?String(e.minute)+"'":"",team:e.participant?.name||"",player:e.player_name||e.player?.display_name||"",type:e.type?.name||"",detail:e.info||e.addition||""}));
      }
    }
    if(!live&&fixtureId){
      const [stats,evs]=await Promise.all([safeApi(`/fixtures/statistics?fixture=${fixtureId}`),safeApi(`/fixtures/events?fixture=${fixtureId}`)]);
      extracted=extractApiStats(stats.response,game);
      live=liveFromStats(extracted,game);
      events=events.length?events:(evs.response||[]).map(e=>({minute:e.time?.elapsed?String(e.time.elapsed)+"'":"",team:e.team?.name||"",player:e.player?.name||"",type:e.type||"",detail:e.detail||""}));
    }
    const [ctx, newsCtx, weatherCtx]=await Promise.all([apiTeamContext(game),news(game),weather(game)]);
    let context=buildContext(game,ctx,newsCtx,weatherCtx);
    const ai=await gemini(game,context,live);
    if(ai&&ai.favorite){ context.probableWinner=ai.favorite; context.reading=ai.headline||context.reading; context.confidence=ai.confidence||context.confidence; context.reasons=ai.explanation||context.reasons; }
    const predictions=updatePredictions(context.predictions,live,game);
    const predictionScore={good:predictions.filter(p=>p.status==="good").length,bad:predictions.filter(p=>p.status==="bad").length,total:predictions.filter(p=>["good","bad"].includes(p.status)).length};
    const displayStats=live||historical(context);
    res.json({ok:true,live,displayStats,events,news:newsCtx.items,weather:weatherCtx,ai,postGame:postGame(game,live),analysis:{pregame:{...context,predictions},live:live?{...live,predictions,predictionScore}:{dataType:"none",reading:"Sem estatísticas ao vivo confiáveis.",predictions,predictionScore},main:live?{...live,predictions,predictionScore}:{...context,predictions,predictionScore},displayStats,contextSource:GEMINI_API_KEY?"SportMonks + contexto + Gemini":"SportMonks + contexto"}});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}
});
app.get("/api/health",(req,res)=>res.json({ok:true,sportmonks:!!SPORTMONKS_KEY,apiFootball:!!API_FOOTBALL_KEY,news:!!NEWS_API_KEY,gemini:!!GEMINI_API_KEY}));

app.get("/api/debug-game", async (req,res)=>{
  try{
    const sportmonksId = req.query.sportmonksId;
    if(!sportmonksId || !SPORTMONKS_KEY) return res.json({ok:false,error:"sportmonksId ou SPORTMONKS_KEY ausente"});
    const data = await safeSm(`/fixtures/${sportmonksId}?include=participants;scores;statistics.type;state`);
    res.json({ok:true,data:data.data||data});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}
});

app.listen(PORT,()=>console.log("DhuniorStats V20 Real rodando na porta "+PORT));
