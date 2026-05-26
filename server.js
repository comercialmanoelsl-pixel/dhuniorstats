
const express = require("express");
const fetch = require("node-fetch");
const { matchState, normalizeCoverage, clean: engineClean } = require("./engines/coverage-engine");
const lineupEngine = require("./engines/lineup-engine");
const statsEngine = require("./engines/stats-engine");
const formEngine = require("./engines/form-engine");
const app = express();
const PORT = process.env.PORT || 3000;

const SPORTMONKS_KEY = process.env.SPORTMONKS_KEY || "";
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";
const NEWS_API_KEY = process.env.NEWS_API_KEY || "";
const ODDS_API_KEY = process.env.ODDS_API_KEY || "";
const FOOTBALL_DATA_KEY = process.env.FOOTBALL_DATA_KEY || process.env.FOOTBALL_DATA_API_KEY || "";
const THESPORTSDB_KEY = process.env.THESPORTSDB_KEY || "3";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || "";

app.use((req,res,next)=>{
  res.set("Cache-Control","no-store, no-cache, must-revalidate");
  res.set("Pragma","no-cache");
  res.set("Expires","0");
  next();
});

/* =========================
   V54 - PRODUCTION UX + API GUARD
   - esconde debug em produção
   - protege API contra spam de refresh
   - endpoint warmup para reduzir cold start
   - headers/cache leves
   ========================= */
const DHUNIOR_PROD = String(process.env.DHUNIOR_PROD || "true").toLowerCase() !== "false";
const DHUNIOR_DEBUG_TOKEN = process.env.DHUNIOR_DEBUG_TOKEN || "";
const REQUEST_GUARD = new Map();

function requestGuard(req, res, next){
  const ip = req.headers["x-forwarded-for"]?.split(",")[0]?.trim() || req.socket.remoteAddress || "ip";
  const key = `${ip}:${req.path}`;
  const now = Date.now();
  const item = REQUEST_GUARD.get(key) || {t:0,c:0};
  if(now - item.t < 1000){
    item.c += 1;
  }else{
    item.t = now;
    item.c = 1;
  }
  REQUEST_GUARD.set(key,item);
  if(item.c > 8){
    return res.status(429).json({ok:false,error:"Muitas requisições em pouco tempo. Aguarde alguns segundos."});
  }
  next();
}

function debugAllowed(req){
  if(!DHUNIOR_PROD) return true;
  if(!DHUNIOR_DEBUG_TOKEN) return false;
  return req.query.debug_token === DHUNIOR_DEBUG_TOKEN || req.headers["x-debug-token"] === DHUNIOR_DEBUG_TOKEN;
}

app.get("/api/app-config", (req,res)=>{
  res.json({
    ok:true,
    prod:DHUNIOR_PROD,
    debug:debugAllowed(req),
    poll:{
      liveMs:30000,
      preMs:90000,
      postMs:0
    },
    myLeagues:[
      {id:648,label:"BR Série A",group:"brasileirao"},
      {id:654,label:"Copa do Brasil",group:"copa_do_brasil"},
      {id:8,label:"Premier League",group:"premier"},
      {id:1116,label:"Sul-Americana",group:"sudamericana"},
      {id:1122,label:"Libertadores",group:"libertadores"}
    ]
  });
});

app.get("/api/warmup", async (req,res)=>{
  const checks = {
    app:true,
    sportmonks:!!SPORTMONKS_KEY,
    apiFootball:!!API_FOOTBALL_KEY,
    footballData:!!FOOTBALL_DATA_KEY
  };
  res.json({ok:true, ts:new Date().toISOString(), checks});
});

app.use(requestGuard);
app.use(express.static("public"));


async function footballData(path){
  if(!FOOTBALL_DATA_KEY) throw new Error("FOOTBALL_DATA_KEY ausente");
  return fetchJson("https://api.football-data.org/v4" + path, {
    headers:{ "X-Auth-Token": FOOTBALL_DATA_KEY, Accept:"application/json" }
  });
}

async function sportsDb(path){
  const key = THESPORTSDB_KEY || "3";
  return fetchJson("https://www.thesportsdb.com/api/v1/json/" + key + path, {
    headers:{Accept:"application/json"}
  });
}

async function newsSearch(q){
  if(!NEWS_API_KEY) return [];
  const url = "https://newsapi.org/v2/everything?q=" + encodeURIComponent(q) + "&language=pt&sortBy=publishedAt&pageSize=8&apiKey=" + encodeURIComponent(NEWS_API_KEY);
  const data = await safe(fetchJson(url));
  if(data.__error) return [];
  return (data.articles||[]).map(a=>({
    title:a.title||"",
    source:a.source?.name||"",
    url:a.url||"",
    publishedAt:a.publishedAt||""
  })).filter(a=>a.title);
}


const LEAGUE_MAP = {
  brasileirao:{label:"Brasileirão Série A", apiFootball:71, espn:"bra.1", footballData:"BSA"},
  libertadores:{label:"Libertadores", apiFootball:13, espn:"conmebol.libertadores", footballData:"CLI"},
  sudamericana:{label:"Sul-Americana", apiFootball:11, espn:"conmebol.sudamericana", footballData:""},
  premier:{label:"Premier League", apiFootball:39, espn:"eng.1", footballData:"PL"},
  laliga:{label:"La Liga", apiFootball:140, espn:"esp.1", footballData:"PD"},
  seriea:{label:"Serie A Itália", apiFootball:135, espn:"ita.1", footballData:"SA"},
  bundesliga:{label:"Bundesliga", apiFootball:78, espn:"ger.1", footballData:"BL1"},
  ligue1:{label:"Ligue 1", apiFootball:61, espn:"fra.1", footballData:"FL1"}
};

const ESPN_LEAGUES = [
  ["bra.1","Brasileirão"],
  ["conmebol.libertadores","Libertadores"],
  ["conmebol.sudamericana","Sul-Americana"],
  ["eng.1","Premier League"],
  ["esp.1","La Liga"],
  ["ita.1","Serie A"],
  ["ger.1","Bundesliga"],
  ["fra.1","Ligue 1"]
];

const clean = s => String(s||"")
  .toLowerCase()
  .normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"")
  .replace(/[^a-z0-9 ]/g," ")
  .replace(/\s+/g," ")
  .trim();

const num = v => {
  const n = Number(String(v ?? "").replace("%","").replace(",",".").trim());
  return Number.isFinite(n) ? n : 0;
};

const today = () => new Date().toISOString().slice(0,10);
const yyyymmdd = d => String(d||today()).replaceAll("-","");

async function fetchJson(url, options={}){
  const r = await fetch(url, options);
  const text = await r.text();
  if(!r.ok) throw new Error(`HTTP ${r.status}: ${text.slice(0,160)}`);
  try { return JSON.parse(text); } catch(e){ throw new Error("JSON inválido"); }
}

async function sm(path){
  if(!SPORTMONKS_KEY) throw new Error("SPORTMONKS_KEY ausente");
  const sep = path.includes("?") ? "&" : "?";
  return fetchJson("https://api.sportmonks.com/v3/football" + path + sep + "api_token=" + encodeURIComponent(SPORTMONKS_KEY), {
    headers: {Accept:"application/json"}
  });
}

async function api(path){
  if(!API_FOOTBALL_KEY) throw new Error("API_FOOTBALL_KEY ausente");
  return fetchJson("https://v3.football.api-sports.io" + path, {
    headers: {"x-apisports-key": API_FOOTBALL_KEY, Accept:"application/json"}
  });
}

async function safe(promise){
  try { return await promise; } catch(e){ return {__error:String(e.message||e)}; }
}

async function espn(path){
  return fetchJson("https://site.api.espn.com/apis/site/v2/sports/soccer/" + path, {
    headers: {"User-Agent":"Mozilla/5.0", Accept:"application/json"}
  });
}

function gameKey(home,away,date=""){
  return `${clean(home)}__${clean(away)}__${String(date||"").slice(0,10)}`;
}


/* =========================
   V56 - DEDUPE REAL POR FIXTURE/CANONICAL
   Corrige LDU Quito x Liga de Quito e duplica entre SportMonks/API/ESPN.
   Regra: SportMonks é fonte principal; quando o mesmo fixture vier com nomes diferentes,
   juntamos por ID SportMonks ou por assinatura canônica (liga+data+times).
   ========================= */
function canonicalTeamV56(name){
  let n = clean(name);
  const aliases = [
    [/^(ldu quito|liga de quito|ldu de quito|ldu)$/,'ldu quito'],
    [/^(ca lanus|lanus|club atletico lanus)$/,'lanus'],
    [/^(mirassol fc|mirassol)$/,'mirassol'],
    [/^(palestino|club deportivo palestino)$/,'palestino'],
    [/^(deportivo riestra|riestra)$/,'deportivo riestra'],
    [/^(montevideo city torque|city torque)$/,'montevideo city torque'],
    [/^(o higgins|ohiggins)$/,'ohiggins'],
    [/^(sao paulo|sao paulo fc)$/,'sao paulo'],
    [/^(flamengo|cr flamengo)$/,'flamengo'],
    [/^(corinthians|sc corinthians|corinthians paulista)$/,'corinthians'],
    [/^(atletico mg|atletico mineiro|atl mineiro|clube atletico mineiro)$/,'atletico mineiro'],
    [/^(athletico pr|athletico paranaense|atletico pr)$/,'athletico paranaense'],
    [/^(remo|clube do remo)$/,'remo']
  ];
  for(const [rx,val] of aliases){ if(rx.test(n)) return val; }
  return n;
}
function canonicalLeagueV56(name){
  const n = clean(name);
  if(n.includes('libertadores')) return 'libertadores';
  if(n.includes('sudamericana') || n.includes('sul americana') || n.includes('sulamericana')) return 'sudamericana';
  if(n.includes('brasileir') || n === 'serie a') return 'brasileirao';
  if(n.includes('copa do brasil')) return 'copa do brasil';
  if(n.includes('premier')) return 'premier league';
  return n;
}
function fixtureIdentityV56(g, date=''){
  const smid = g?.sportmonksId || (String(g?.id||'').startsWith('sm_') ? String(g.id).slice(3) : '');
  if(smid) return 'sm:' + smid;
  const d = String(g?.date || date || '').slice(0,10);
  const h = canonicalTeamV56(g?.home?.name || '');
  const a = canonicalTeamV56(g?.away?.name || '');
  const l = canonicalLeagueV56(g?.league || '');
  // Mantém ordem, mas tenta impedir duplicado por nome alternativo.
  return `sig:${d}:${l}:${h}:${a}`;
}
function duplicateIdentityV56(g, date=''){
  const d = String(g?.date || date || '').slice(0,10);
  const h = canonicalTeamV56(g?.home?.name || '');
  const a = canonicalTeamV56(g?.away?.name || '');
  const l = canonicalLeagueV56(g?.league || '');
  return [`sig:${d}:${l}:${h}:${a}`, `sig:${d}:${l}:${a}:${h}`];
}
function providerRankV56(g){
  const src = String(g?.source||'').toLowerCase();
  if(src.includes('sportmonks')) return 100;
  if(src.includes('api-football')) return 70;
  if(src.includes('football-data')) return 50;
  if(src.includes('espn')) return 30;
  return 10;
}
function mergeGameV56(old,g){
  if(!old) return g;
  const preferred = providerRankV56(g) > providerRankV56(old) ? g : old;
  const merged = mergeGame(old,g);
  // Mantém nome/logo/time da fonte mais confiável, mas mantém placar live mais completo.
  merged.home = {...merged.home, name: preferred.home?.name || merged.home.name, logo: preferred.home?.logo || merged.home.logo, id: preferred.home?.id || merged.home.id};
  merged.away = {...merged.away, name: preferred.away?.name || merged.away.name, logo: preferred.away?.logo || merged.away.logo, id: preferred.away?.id || merged.away.id};
  merged.league = preferred.league || merged.league;
  merged.leagueId = preferred.leagueId || merged.leagueId;
  merged.sportmonksId = old.sportmonksId || g.sportmonksId || merged.sportmonksId || '';
  merged.apiFootballId = old.apiFootballId || g.apiFootballId || merged.apiFootballId || '';
  return merged;
}
function dedupeGamesV56(list=[], date=''){
  const map = new Map();
  const aliasToKey = new Map();
  for(const g of list){
    if(!g?.home?.name || !g?.away?.name) continue;
    let key = fixtureIdentityV56(g,date);
    const sigs = duplicateIdentityV56(g,date);
    const existingKey = [key, ...sigs].map(k=>aliasToKey.get(k) || (map.has(k)?k:null)).find(Boolean);
    if(existingKey) key = existingKey;
    const merged = mergeGameV56(map.get(key), g);
    map.set(key, merged);
    aliasToKey.set(key,key);
    for(const sig of sigs) aliasToKey.set(sig,key);
    if(merged.sportmonksId) aliasToKey.set('sm:'+merged.sportmonksId,key);
  }
  return [...map.values()];
}


function isLiveStatus(short,long){
  const s = String(short||long||"").toUpperCase();
  return ["LIVE","1H","2H","HT","ET","BT","P","SUSP","INT","1ST_HALF","2ND_HALF","INPLAY"].includes(s);
}
function isFinishedStatus(short,long){
  const s = String(short||long||"").toUpperCase();
  return ["FT","AET","PEN","FT_PEN","FULLTIME","FINISHED","ENDED"].includes(s);
}

function normalizeApiFootball(m){
  const f=m.fixture||{}, l=m.league||{}, t=m.teams||{}, g=m.goals||{}, s=f.status||{};
  const live = isLiveStatus(s.short,s.long);
  const finished = isFinishedStatus(s.short,s.long);
  return {
    source:"API-Football",
    apiFootballId:f.id || "",
    sportmonksId:"",
    id:"api_" + (f.id || `${t.home?.name}_${t.away?.name}`),
    league:l.name||"",
    leagueId:l.id||"",
    season:l.season||"",
    date:f.date||"",
    time:f.date ? new Date(f.date).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}) : "",
    status:s.long||s.short||"",
    state:live?"in":finished?"post":"pre",
    live,
    minute:s.elapsed ? `${s.elapsed}'` : "",
    venue:f.venue?.name||"",
    city:f.venue?.city||"",
    home:{id:t.home?.id||"", name:t.home?.name||"", logo:t.home?.logo||"", score:g.home ?? ""},
    away:{id:t.away?.id||"", name:t.away?.name||"", logo:t.away?.logo||"", score:g.away ?? ""}
  };
}

function normalizeSportMonks(fx){
  const parts = fx.participants || [];
  const home = parts.find(p=>p.meta?.location==="home" || p.pivot?.location==="home") || parts[0] || {};
  const away = parts.find(p=>p.meta?.location==="away" || p.pivot?.location==="away") || parts[1] || {};
  const scores = fx.scores || [];
  const stRaw = fx.state?.state || fx.state?.name || "";
  const live = isLiveStatus(stRaw, fx.state?.name);
  const finished = isFinishedStatus(stRaw, fx.state?.name);

  function scoreOf(team){
    const own = scores.filter(s => s.participant_id === team.id);
    const wanted = finished
      ? ["CURRENT","FULLTIME","FT","2ND_HALF","REGULAR_TIME"]
      : ["CURRENT","2ND_HALF","1ST_HALF"];
    for(const key of wanted){
      const row = own.find(s => String(s.description||"").toUpperCase() === key);
      if(row?.score?.goals !== undefined) return row.score.goals;
    }
    const any = own.find(s => s?.score?.goals !== undefined);
    return any?.score?.goals ?? "";
  }

  return {
    source:"SportMonks",
    sportmonksId:fx.id || "",
    apiFootballId:"",
    id:"sm_" + fx.id,
    league:fx.league?.name || "",
    leagueId:fx.league_id || "",
    season:fx.season_id || "",
    date:fx.starting_at || "",
    time:fx.starting_at ? new Date(fx.starting_at).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}) : "",
    status:fx.state?.name || stRaw || "",
    state:live?"in":finished?"post":"pre",
    live,
    minute:fx.periods?.find(p=>p.minutes)?.minutes ? `${fx.periods.find(p=>p.minutes).minutes}'` : "",
    venue:fx.venue?.name || "",
    city:fx.venue?.city_name || "",
    home:{id:home.id||"", name:home.name||"", logo:home.image_path||"", score:scoreOf(home)},
    away:{id:away.id||"", name:away.name||"", logo:away.image_path||"", score:scoreOf(away)}
  };
}


function normalizeFootballData(m, leagueName){
  const h=m.homeTeam||{}, a=m.awayTeam||{}, s=m.score||{}, st=String(m.status||"");
  const live = ["LIVE","IN_PLAY","PAUSED"].includes(st);
  const finished = ["FINISHED"].includes(st);
  const homeScore = s.fullTime?.home ?? s.regularTime?.home ?? "";
  const awayScore = s.fullTime?.away ?? s.regularTime?.away ?? "";
  return {
    source:"Football-Data",
    id:"fd_" + (m.id || `${h.name}_${a.name}_${m.utcDate}`),
    sportmonksId:"",
    apiFootballId:"",
    league:leagueName || m.competition?.name || "",
    leagueId:"",
    season:"",
    date:m.utcDate || "",
    time:m.utcDate ? new Date(m.utcDate).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}) : "",
    status:st,
    state:live?"in":finished?"post":"pre",
    live,
    minute:"",
    venue:"",
    city:"",
    home:{id:h.id||"", name:h.name||"", logo:"", score:homeScore},
    away:{id:a.id||"", name:a.name||"", logo:"", score:awayScore}
  };
}

function normalizeEspn(event, leagueName){
  const comp=event.competitions?.[0]||{}, c=comp.competitors||[];
  const home=c.find(x=>x.homeAway==="home")||c[0]||{};
  const away=c.find(x=>x.homeAway==="away")||c[1]||{};
  const type=event.status?.type||{};
  return {
    source:"ESPN",
    id:"espn_" + event.id,
    sportmonksId:"",
    apiFootballId:"",
    league:leagueName,
    leagueId:"",
    season:"",
    date:event.date||"",
    time:event.date ? new Date(event.date).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}) : "",
    status:type.description||type.detail||type.name||"",
    state:type.state || "",
    live:type.state==="in",
    minute:event.status?.displayClock||"",
    venue:comp.venue?.fullName||"",
    city:comp.venue?.address?.city||"",
    home:{id:"", name:home.team?.displayName||home.team?.name||"", logo:home.team?.logo||"", score:home.score ?? ""},
    away:{id:"", name:away.team?.displayName||away.team?.name||"", logo:away.team?.logo||"", score:away.score ?? ""}
  };
}

function mergeGame(old,g){
  if(!old) return g;
  const out = {...old};

  // prefer IDs from all providers
  out.sportmonksId = old.sportmonksId || g.sportmonksId || "";
  out.apiFootballId = old.apiFootballId || g.apiFootballId || "";
  out.leagueId = old.leagueId || g.leagueId || "";
  out.season = old.season || g.season || "";
  out.venue = old.venue || g.venue || "";
  out.city = old.city || g.city || "";
  out.league = old.league || g.league || "";
  out.date = old.date || g.date || "";
  out.time = old.time || g.time || "";

  // If one source has live/final state, keep it
  if(g.live || g.state==="post" || old.source==="ESPN"){
    out.status = g.status || out.status;
    out.state = g.state || out.state;
    out.live = !!g.live;
    out.minute = g.minute || out.minute;
  }

  // Scores: prefer complete scores from non-empty provider, especially API-Football for final/current
  const gHasScore = g.home.score !== "" && g.away.score !== "";
  const oldHasScore = out.home.score !== "" && out.away.score !== "";
  if(gHasScore && (!oldHasScore || g.state==="post" || g.live)){
    out.home = {...out.home, score:g.home.score, id:out.home.id || g.home.id, logo:out.home.logo || g.home.logo};
    out.away = {...out.away, score:g.away.score, id:out.away.id || g.away.id, logo:out.away.logo || g.away.logo};
  } else {
    out.home = {...out.home, id:out.home.id || g.home.id, logo:out.home.logo || g.home.logo};
    out.away = {...out.away, id:out.away.id || g.away.id, logo:out.away.logo || g.away.logo};
  }

  out.source = [old.source,g.source].filter(Boolean).join("+");
  return out;
}

async function getAllSportMonksByDate(date){
  if(!SPORTMONKS_KEY) return [];
  const all=[];
  let page=1;
  for(let i=0;i<10;i++){
    const path = `/fixtures/date/${date}?include=participants;scores;league;state;venue;periods&page=${page}`;
    const data = await sm(path);
    all.push(...(data.data||[]));
    const pag = data.pagination || data.meta?.pagination;
    const hasMore = pag?.has_more || (pag?.current_page && pag?.total_pages && pag.current_page < pag.total_pages);
    if(!hasMore) break;
    page++;
  }
  return all;
}

app.get("/api/health",(req,res)=>res.json({
  ok:true,
  sportmonks:!!SPORTMONKS_KEY,
  apiFootball:!!API_FOOTBALL_KEY,
  footballData:!!FOOTBALL_DATA_KEY,
  theSportsDB:!!THESPORTSDB_KEY,
  odds:!!ODDS_API_KEY,
  news:!!NEWS_API_KEY,
  gemini:!!GEMINI_API_KEY
}));

app.get("/api/games", async (req,res)=>{
  const date = req.query.date || today();
  const errors=[];
  const normalized=[];

  if(SPORTMONKS_KEY){
    const smData = await safe(getAllSportMonksByDate(date));
    if(smData.__error) errors.push({source:"SportMonks", error:smData.__error});
    else normalized.push(...smData.map(normalizeSportMonks));
  }

  if(API_FOOTBALL_KEY){
    const apiData = await safe(api(`/fixtures?date=${date}`));
    if(apiData.__error) errors.push({source:"API-Football", error:apiData.__error});
    else normalized.push(...(apiData.response||[]).map(normalizeApiFootball));
  }

  // Public fallback, not authoritative, but helps avoid empty screens
  await Promise.all(ESPN_LEAGUES.map(async ([key,name])=>{
    const data = await safe(espn(`${key}/scoreboard?dates=${yyyymmdd(date)}&limit=200`));
    if(!data.__error) normalized.push(...(data.events||[]).map(ev=>normalizeEspn(ev,name)));
  }));

  const gamesBase = dedupeGamesV56(normalized, date);

  const games=gamesBase.sort((a,b)=>{
    const rank = g => g.live ? 0 : g.state==="pre" ? 1 : 2;
    return rank(a)-rank(b) || String(a.league).localeCompare(String(b.league)) || new Date(a.date||date)-new Date(b.date||date);
  });

  res.json({ok:true,date,total:games.length,games,errors});
});

function extractSportMonksStats(fixture,game){
  const out={home:{},away:{},available:false,source:"SportMonks"};
  const parts=fixture.participants||[];
  const home=parts.find(p=>p.meta?.location==="home"||p.pivot?.location==="home")||{id:game.home.id};
  const away=parts.find(p=>p.meta?.location==="away"||p.pivot?.location==="away")||{id:game.away.id};

  for(const s of fixture.statistics||[]){
    const side=s.participant_id===home.id?"home":s.participant_id===away.id?"away":null;
    if(!side) continue;
    const id=Number(s.type_id || s.type?.id || 0);
    const name=clean(s.type?.name || s.name || "");
    const value=num(s.data?.value ?? s.data?.count ?? s.value ?? "");
    if(id===42 || name.includes("total shots")) out[side].finalizations=value;
    if(id===86 || name.includes("shots on target") || name.includes("shots on goal")) out[side].shotsOnGoal=value;
    if(id===34 || name.includes("corner")) out[side].corners=value;
    if(id===45 || name.includes("possession")) out[side].possession=value;
  }
  out.available = Object.values(out.home).some(v=>v!==undefined) || Object.values(out.away).some(v=>v!==undefined);
  return out;
}

function extractApiStats(rows,game){
  const out={home:{},away:{},available:false,source:"API-Football"};
  for(const tb of rows||[]){
    const side = clean(tb.team?.name)===clean(game.home.name) ? "home" : clean(tb.team?.name)===clean(game.away.name) ? "away" : "";
    if(!side) continue;
    for(const st of tb.statistics||[]){
      const name=clean(st.type);
      const value=num(st.value);
      if(name.includes("total shots")) out[side].finalizations=value;
      if(name.includes("shots on goal") || name.includes("shots on target")) out[side].shotsOnGoal=value;
      if(name.includes("corner")) out[side].corners=value;
      if(name.includes("possession")) out[side].possession=value;
    }
  }
  out.available = Object.values(out.home).some(v=>v!==undefined) || Object.values(out.away).some(v=>v!==undefined);
  return out;
}

function buildAi(game,stats){
  if(game.state==="pre"){
    return {
      title:"Pré-jogo",
      text:"Jogo ainda não começou. As estatísticas ao vivo aparecerão quando a partida iniciar e a API entregar dados oficiais.",
      points:["Sem estatísticas ao vivo antes do início.","Escalações aparecem quando forem confirmadas pela API."]
    };
  }
  if(!stats?.available){
    return {
      title:"Dados limitados",
      text:"A partida está sem estatísticas confiáveis disponíveis no momento.",
      points:["O DhuniorStats não inventa números.","Assim que a API enviar dados, a tela atualiza automaticamente."]
    };
  }
  const hf=num(stats.home.finalizations), af=num(stats.away.finalizations);
  const hc=num(stats.home.corners), ac=num(stats.away.corners);
  const hp=num(stats.home.possession), ap=num(stats.away.possession);
  const homePower=hf*2+hc*1.5+hp*.12;
  const awayPower=af*2+ac*1.5+ap*.12;
  const leader = homePower>=awayPower ? game.home.name : game.away.name;
  return {
    title:"Leitura ao vivo",
    text:`${leader} aparece com maior volume pelos dados oficiais disponíveis.`,
    points:[
      `Finalizações: ${stats.home.finalizations ?? "-"} x ${stats.away.finalizations ?? "-"}`,
      `Escanteios: ${stats.home.corners ?? "-"} x ${stats.away.corners ?? "-"}`,
      `Posse: ${stats.home.possession ?? "-"}% x ${stats.away.possession ?? "-"}%`
    ]
  };
}


async function resolveApiFixtureId(game){
  if(game.apiFootballId) return game.apiFootballId;
  if(!API_FOOTBALL_KEY) return "";
  const date = (game.date || today()).slice(0,10);
  const data = await safe(api(`/fixtures?date=${date}`));
  if(data.__error) return "";
  const h = clean(game.home?.name||"");
  const a = clean(game.away?.name||"");
  const found = (data.response||[]).find(m=>{
    const mh = clean(m.teams?.home?.name||"");
    const ma = clean(m.teams?.away?.name||"");
    return (mh.includes(h)||h.includes(mh)) && (ma.includes(a)||a.includes(ma));
  }) || (data.response||[]).find(m=>{
    const mh = clean(m.teams?.home?.name||"");
    const ma = clean(m.teams?.away?.name||"");
    return (mh.includes(a)||a.includes(mh)) && (ma.includes(h)||h.includes(ma));
  });
  return found?.fixture?.id || "";
}

async function resolveApiTeamId(teamName){
  if(!API_FOOTBALL_KEY || !teamName) return "";
  const data = await safe(api(`/teams?search=${encodeURIComponent(teamName)}`));
  if(data.__error) return "";
  const q = clean(teamName);
  const exact = (data.response||[]).find(x=>clean(x.team?.name||"")===q);
  const partial = (data.response||[]).find(x=>{
    const n=clean(x.team?.name||"");
    return n.includes(q) || q.includes(n);
  });
  return (exact||partial)?.team?.id || "";
}

async function getApiLineups(apiFootballId){
  if(!API_FOOTBALL_KEY || !apiFootballId) return [];
  const data=await safe(api(`/fixtures/lineups?fixture=${apiFootballId}`));
  if(data.__error) return [];
  const out=[];
  for(const team of data.response||[]){
    for(const p of team.startXI||[]) out.push({team:team.team?.name||"", type:"Titular", name:p.player?.name||"", number:p.player?.number||"", pos:p.player?.pos||""});
    for(const p of team.substitutes||[]) out.push({team:team.team?.name||"", type:"Banco", name:p.player?.name||"", number:p.player?.number||"", pos:p.player?.pos||""});
  }
  return out;
}

function getSportMonksLineups(fixture){
  return (fixture.lineups||[]).map(x=>({
    team:x.participant?.name || "",
    type:x.type?.name || x.type_name || "",
    name:x.player?.display_name || x.player_name || x.player?.name || "",
    number:x.jersey_number || "",
    pos:x.position?.name || x.position_name || ""
  })).filter(x=>x.name);
}

app.get("/api/game-details", async (req,res)=>{
  try{
    const game=JSON.parse(req.query.game||"{}");
    const sportmonksId=req.query.sportmonksId || game.sportmonksId || "";
    let apiFootballId=req.query.apiFootballId || game.apiFootballId || "";
    let stats=null, events=[], lineups=[];
    apiFootballId = apiFootballId || await resolveApiFixtureId(game);

    if(SPORTMONKS_KEY && sportmonksId){
      const fx=await safe(sm(`/fixtures/${sportmonksId}?include=statistics.type;participants;events.type;events.participant;lineups.player;lineups.position;lineups.type;scores;state`));
      if(!fx.__error && fx.data){
        stats=extractSportMonksStats(fx.data,game);
        events=(fx.data.events||[]).map(e=>({
          minute:e.minute ? `${e.minute}'` : "",
          team:e.participant?.name || "",
          player:e.player_name || e.player?.display_name || "",
          type:e.type?.name || "",
          detail:e.info || e.addition || ""
        }));
        lineups=getSportMonksLineups(fx.data).map(x=>({...x, source:"SportMonks", status:"oficial"}));
      }
    }

    if((!stats || !stats.available || !events.length || !lineups.length) && API_FOOTBALL_KEY && apiFootballId){
      const [st,ev,lu]=await Promise.all([
        safe(api(`/fixtures/statistics?fixture=${apiFootballId}`)),
        safe(api(`/fixtures/events?fixture=${apiFootballId}`)),
        safe(api(`/fixtures/lineups?fixture=${apiFootballId}`))
      ]);
      if((!stats || !stats.available) && !st.__error) stats=extractApiStats(st.response||[],game);
      if(!events.length && !ev.__error){
        events=(ev.response||[]).map(e=>({
          minute:e.time?.elapsed ? `${e.time.elapsed}'` : "",
          team:e.team?.name || "",
          player:e.player?.name || "",
          type:e.type || "",
          detail:e.detail || ""
        }));
      }
      if(!lineups.length && !lu.__error){
        for(const team of lu.response||[]){
          for(const p of team.startXI||[]) lineups.push({team:team.team?.name||"", type:"Titular", name:p.player?.name||"", number:p.player?.number||"", pos:p.player?.pos||"", source:"API-Football", status:"oficial"});
          for(const p of team.substitutes||[]) lineups.push({team:team.team?.name||"", type:"Banco", name:p.player?.name||"", number:p.player?.number||"", pos:p.player?.pos||"", source:"API-Football", status:"oficial"});
        }
      }
    }

    if(!stats) stats={home:{},away:{},available:false,source:"none"};
    const ai=buildAi(game,stats);
    const news = await newsSearch(`${game.home?.name||""} ${game.away?.name||""} escalação provável futebol`);

    res.json({
      ok:true,
      game,
      stats,
      events,
      lineups,
      ai,
      hasStats:!!stats.available,
      hasEvents:events.length>0,
      hasLineups:lineups.length>0,
      news,
      lineupStatus: lineups.length ? "oficial" : "indisponivel",
      lineupNote: lineups.length ? "Escalação oficial recebida via API." : "Escalação oficial ainda não disponível. O site atualizará automaticamente quando a API liberar."
    });
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message||e)});
  }
});

app.get("/api/standings", async (req,res)=>{
  try{
    const leagueId=req.query.leagueId, season=req.query.season;
    if(!leagueId||!season) return res.json({ok:false,standings:[],error:"leagueId/season ausente"});
    if(!API_FOOTBALL_KEY) return res.json({ok:false,standings:[],error:"API_FOOTBALL_KEY ausente"});
    const data=await safe(api(`/standings?league=${leagueId}&season=${season}`));
    if(data.__error || !(data.response?.[0]?.league?.standings?.[0]||[]).length){
      // Fallback generic: Football-Data only works with its own competition code, so return clear message if mapping is absent.
      return res.json({ok:false,standings:[],error:data.__error || "Tabela não retornada pela API-Football para esse leagueId/season"});
    }
    res.json({ok:true,standings:data.response?.[0]?.league?.standings?.[0]||[]});
  }catch(e){ res.status(500).json({ok:false,standings:[],error:String(e.message||e)}); }
});

app.get("/api/team-profile", async (req,res)=>{
  try{
    let teamId=req.query.teamId, leagueId=req.query.leagueId, season=req.query.season, teamName=req.query.teamName;
    if(!teamId && teamName) teamId = await resolveApiTeamId(teamName);
    if(!API_FOOTBALL_KEY || !teamId) return res.json({ok:false,recent:[],next:[],players:[]});
    const [recent,next,players]=await Promise.all([
      safe(api(`/fixtures?team=${teamId}&last=8`)),
      safe(api(`/fixtures?team=${teamId}&next=5`)),
      leagueId&&season?safe(api(`/players?team=${teamId}&league=${leagueId}&season=${season}`)):Promise.resolve({response:[]})
    ]);
    res.json({ok:true,recent:recent.response||[],next:next.response||[],players:players.response||[]});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e),recent:[],next:[],players:[]});}
});



app.get("/api/odds", async (req,res)=>{
  try{
    if(!ODDS_API_KEY) return res.json({ok:false,odds:[],error:"ODDS_API_KEY ausente"});
    // The Odds API football soccer endpoint; returns many games, frontend filters by team/date.
    const data = await safe(fetchJson("https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu,us,uk&markets=h2h&oddsFormat=decimal&apiKey=" + encodeURIComponent(ODDS_API_KEY)));
    if(data.__error) return res.json({ok:false,odds:[],error:data.__error});
    res.json({ok:true,odds:data||[]});
  }catch(e){res.status(500).json({ok:false,odds:[],error:String(e.message||e)})}
});


app.get("/api/league-games", async (req,res)=>{
  const slug = String(req.query.slug||"").toLowerCase();
  const date = req.query.date || today();
  const map = LEAGUE_MAP[slug];
  if(!map) return res.json({ok:false,games:[],total:0,error:"Liga não mapeada"});
  const normalized=[];
  const errors=[];

  if(API_FOOTBALL_KEY && map.apiFootball){
    const d = await safe(api(`/fixtures?league=${map.apiFootball}&season=${new Date(date).getFullYear()}&date=${date}`));
    if(d.__error) errors.push({source:"API-Football",error:d.__error});
    else normalized.push(...(d.response||[]).map(normalizeApiFootball));
  }

  if(map.espn){
    const d = await safe(espn(`${map.espn}/scoreboard?dates=${yyyymmdd(date)}&limit=200`));
    if(d.__error) errors.push({source:"ESPN",error:d.__error});
    else normalized.push(...(d.events||[]).map(ev=>normalizeEspn(ev,map.label)));
  }

  if(FOOTBALL_DATA_KEY && map.footballData){
    const d = await safe(footballData(`/competitions/${map.footballData}/matches?dateFrom=${date}&dateTo=${date}`));
    if(d.__error) errors.push({source:"Football-Data",error:d.__error});
    else normalized.push(...(d.matches||[]).map(m=>normalizeFootballData(m,map.label)));
  }

  const games=dedupeGamesV56(normalized, date).sort((a,b)=>new Date(a.date||date)-new Date(b.date||date));
  res.json({ok:true,slug,label:map.label,date,total:games.length,games,errors});
});


app.get("/api/search-games", async (req,res)=>{
  const q = clean(req.query.q || "");
  const date = req.query.date || today();
  if(!q) return res.json({ok:true,games:[],total:0});

  // Search wider date window around selected date
  const baseDate = new Date(date + "T00:00:00Z");
  const dates = [];
  for(let i=-2;i<=5;i++){
    const d = new Date(baseDate);
    d.setUTCDate(baseDate.getUTCDate()+i);
    dates.push(d.toISOString().slice(0,10));
  }

  const all = [];
  for(const d of dates){
    const sub = await safe((async()=>{
      const normalized=[];
      if(API_FOOTBALL_KEY){
        const apiData=await safe(api(`/fixtures?date=${d}`));
        if(!apiData.__error) normalized.push(...(apiData.response||[]).map(normalizeApiFootball));
      }
      if(SPORTMONKS_KEY){
        const smData=await safe(getAllSportMonksByDate(d));
        if(!smData.__error) normalized.push(...smData.map(normalizeSportMonks));
      }
      for(const [key,name] of ESPN_LEAGUES){
        const ep=await safe(espn(`${key}/scoreboard?dates=${yyyymmdd(d)}&limit=200`));
        if(!ep.__error) normalized.push(...(ep.events||[]).map(ev=>normalizeEspn(ev,name)));
      }
      return normalized;
    })());
    if(!sub.__error) all.push(...sub);
  }

  const map=new Map();
  for(const g of all){
    if(!g.home?.name || !g.away?.name) continue;
    const hay=clean(`${g.home.name} ${g.away.name} ${g.league}`);
    if(!hay.includes(q)) continue;
    const k=gameKey(g.home.name,g.away.name,g.date||date);
    map.set(k, mergeGame(map.get(k), g));
  }
  const games=[...map.values()].sort((a,b)=>new Date(a.date||date)-new Date(b.date||date));
  res.json({ok:true,q:req.query.q,total:games.length,games});
});


app.get("/api/live-games", async (req,res)=>{
  const date = req.query.date || today();
  const normalized=[];
  const errors=[];

  // 1) API-Football global live
  if(API_FOOTBALL_KEY){
    const liveGlobal = await safe(api(`/fixtures?live=all`));
    if(liveGlobal.__error) errors.push({source:"API-Football live=all",error:liveGlobal.__error});
    else normalized.push(...(liveGlobal.response||[]).map(normalizeApiFootball));

    // 2) API-Football by selected date, then filter live statuses
    const byDate = await safe(api(`/fixtures?date=${date}`));
    if(byDate.__error) errors.push({source:"API-Football date",error:byDate.__error});
    else normalized.push(...(byDate.response||[]).map(normalizeApiFootball).filter(g=>g.live || g.state==="in"));
  }

  // 3) SportMonks selected date, then filter live statuses
  if(SPORTMONKS_KEY){
    const d=await safe(getAllSportMonksByDate(date));
    if(d.__error) errors.push({source:"SportMonks date",error:d.__error});
    else normalized.push(...d.map(normalizeSportMonks).filter(g=>g.live || g.state==="in"));
  }

  // 4) ESPN fallback for mapped leagues
  for(const [key,name] of ESPN_LEAGUES){
    const ep=await safe(espn(`${key}/scoreboard?dates=${yyyymmdd(date)}&limit=300`));
    if(ep.__error) errors.push({source:`ESPN ${key}`,error:ep.__error});
    else normalized.push(...(ep.events||[]).map(ev=>normalizeEspn(ev,name)).filter(g=>g.live || g.state==="in"));
  }

  const gamesBase = dedupeGamesV56(normalized, date);

  const games=gamesBase.filter(g=>g.live || g.state==="in").sort((a,b)=>{
    return String(a.league).localeCompare(String(b.league)) || new Date(a.date||date)-new Date(b.date||date);
  });

  res.json({ok:true,total:games.length,games,errors});
});


app.get("/api/debug-live", async (req,res)=>{
  const date=req.query.date||today();
  const report={date,apiFootball:false,sportmonks:false,espn:[],errors:[]};
  if(API_FOOTBALL_KEY){
    const a=await safe(api(`/fixtures?live=all`));
    report.apiFootball = !a.__error ? (a.response||[]).length : 0;
    if(a.__error) report.errors.push({source:"API-Football",error:a.__error});
  }
  if(SPORTMONKS_KEY){
    const s=await safe(getAllSportMonksByDate(date));
    report.sportmonks = !s.__error ? (s||[]).filter(x=>normalizeSportMonks(x).live).length : 0;
    if(s.__error) report.errors.push({source:"SportMonks",error:s.__error});
  }
  for(const [key,name] of ESPN_LEAGUES){
    const e=await safe(espn(`${key}/scoreboard?dates=${yyyymmdd(date)}&limit=300`));
    report.espn.push({league:key,count:!e.__error?(e.events||[]).filter(ev=>normalizeEspn(ev,name).live).length:0,error:e.__error||null});
  }
  res.json(report);
});


function statusObj(ok, note="", extra={}){
  return { ok: !!ok, note, ...extra };
}

async function findApiFootballMatchByNames(home, away, date){
  if(!API_FOOTBALL_KEY) return { ok:false, error:"API_FOOTBALL_KEY ausente" };
  const data = await safe(api(`/fixtures?date=${date}`));
  if(data.__error) return { ok:false, error:data.__error };
  const h = clean(home), a = clean(away);
  const matches = (data.response||[]).filter(m=>{
    const mh = clean(m.teams?.home?.name||"");
    const ma = clean(m.teams?.away?.name||"");
    return ((mh.includes(h)||h.includes(mh)) && (ma.includes(a)||a.includes(ma))) ||
           ((mh.includes(a)||a.includes(mh)) && (ma.includes(h)||h.includes(ma)));
  });
  return { ok:matches.length>0, matches, fixtureId:matches[0]?.fixture?.id||"", count:matches.length };
}

async function findSportMonksMatchByNames(home, away, date){
  if(!SPORTMONKS_KEY) return { ok:false, error:"SPORTMONKS_KEY ausente" };
  const data = await safe(getAllSportMonksByDate(date));
  if(data.__error) return { ok:false, error:data.__error };
  const h = clean(home), a = clean(away);
  const matches = (data||[]).filter(f=>{
    const g = normalizeSportMonks(f);
    const mh = clean(g.home?.name||"");
    const ma = clean(g.away?.name||"");
    return ((mh.includes(h)||h.includes(mh)) && (ma.includes(a)||a.includes(ma))) ||
           ((mh.includes(a)||a.includes(mh)) && (ma.includes(h)||h.includes(ma)));
  });
  return { ok:matches.length>0, matches, fixtureId:matches[0]?.id||"", count:matches.length };
}

async function diagnosticApiFootball(home, away, date){
  const found = await findApiFootballMatchByNames(home, away, date);
  const out = {
    source:"API-Football",
    fixtureFound: found.ok,
    fixtureId: found.fixtureId || "",
    errors: found.error ? [found.error] : [],
    stats: statusObj(false,"não consultado"),
    events: statusObj(false,"não consultado"),
    lineups: statusObj(false,"não consultado"),
    players: statusObj(false,"não consultado"),
    teams: statusObj(false,"não consultado")
  };

  if(!found.ok || !found.fixtureId) return out;

  const [st,ev,lu] = await Promise.all([
    safe(api(`/fixtures/statistics?fixture=${found.fixtureId}`)),
    safe(api(`/fixtures/events?fixture=${found.fixtureId}`)),
    safe(api(`/fixtures/lineups?fixture=${found.fixtureId}`))
  ]);

  out.stats = st.__error
    ? statusObj(false, st.__error)
    : statusObj((st.response||[]).length>0, `${(st.response||[]).length} blocos retornados`, {count:(st.response||[]).length});

  out.events = ev.__error
    ? statusObj(false, ev.__error)
    : statusObj((ev.response||[]).length>0, `${(ev.response||[]).length} eventos retornados`, {count:(ev.response||[]).length});

  out.lineups = lu.__error
    ? statusObj(false, lu.__error)
    : statusObj((lu.response||[]).length>0, `${(lu.response||[]).length} times com lineup retornados`, {count:(lu.response||[]).length});

  const first = found.matches?.[0];
  const homeId = first?.teams?.home?.id || "";
  const awayId = first?.teams?.away?.id || "";
  const season = first?.league?.season || new Date(date).getFullYear();
  const leagueId = first?.league?.id || "";

  if(homeId || awayId){
    const [hLast,aLast,hPlayers,aPlayers] = await Promise.all([
      homeId ? safe(api(`/fixtures?team=${homeId}&last=5`)) : Promise.resolve({response:[]}),
      awayId ? safe(api(`/fixtures?team=${awayId}&last=5`)) : Promise.resolve({response:[]}),
      homeId && leagueId ? safe(api(`/players?team=${homeId}&league=${leagueId}&season=${season}`)) : Promise.resolve({response:[]}),
      awayId && leagueId ? safe(api(`/players?team=${awayId}&league=${leagueId}&season=${season}`)) : Promise.resolve({response:[]})
    ]);

    out.teams = statusObj(
      !hLast.__error || !aLast.__error,
      `últimos jogos: casa ${(hLast.response||[]).length}, fora ${(aLast.response||[]).length}`,
      {homeLastCount:(hLast.response||[]).length, awayLastCount:(aLast.response||[]).length}
    );

    out.players = statusObj(
      (hPlayers.response||[]).length>0 || (aPlayers.response||[]).length>0,
      `jogadores: casa ${(hPlayers.response||[]).length}, fora ${(aPlayers.response||[]).length}`,
      {homePlayersCount:(hPlayers.response||[]).length, awayPlayersCount:(aPlayers.response||[]).length}
    );
  }

  return out;
}

async function diagnosticSportMonks(home, away, date){
  const found = await findSportMonksMatchByNames(home, away, date);
  const out = {
    source:"SportMonks",
    fixtureFound: found.ok,
    fixtureId: found.fixtureId || "",
    errors: found.error ? [found.error] : [],
    stats: statusObj(false,"não consultado"),
    events: statusObj(false,"não consultado"),
    lineups: statusObj(false,"não consultado")
  };

  if(!found.ok || !found.fixtureId) return out;

  const fx = await safe(sm(`/fixtures/${found.fixtureId}?include=statistics.type;participants;events.type;events.participant;lineups.player;lineups.position;lineups.type;scores;state`));
  if(fx.__error){
    out.errors.push(fx.__error);
    return out;
  }

  const data = fx.data || {};
  out.stats = statusObj((data.statistics||[]).length>0, `${(data.statistics||[]).length} estatísticas retornadas`, {count:(data.statistics||[]).length});
  out.events = statusObj((data.events||[]).length>0, `${(data.events||[]).length} eventos retornados`, {count:(data.events||[]).length});
  out.lineups = statusObj((data.lineups||[]).length>0, `${(data.lineups||[]).length} lineups retornados`, {count:(data.lineups||[]).length});

  return out;
}

async function diagnosticESPN(home, away, date){
  const out = { source:"ESPN", fixtureFound:false, count:0, errors:[], note:"fallback público para listar jogo/status; normalmente não entrega lineup/stats detalhadas no nosso backend" };
  const h=clean(home), a=clean(away);
  for(const [key,name] of ESPN_LEAGUES){
    const d = await safe(espn(`${key}/scoreboard?dates=${yyyymmdd(date)}&limit=300`));
    if(d.__error){ out.errors.push(`${key}: ${d.__error}`); continue; }
    const found = (d.events||[]).filter(ev=>{
      const g = normalizeEspn(ev,name);
      const mh=clean(g.home?.name||""), ma=clean(g.away?.name||"");
      return ((mh.includes(h)||h.includes(mh)) && (ma.includes(a)||a.includes(ma))) ||
             ((mh.includes(a)||a.includes(mh)) && (ma.includes(h)||h.includes(ma)));
    });
    if(found.length){
      out.fixtureFound=true;
      out.count += found.length;
      out.league = name;
    }
  }
  return out;
}

async function diagnosticNews(home, away){
  const news = await newsSearch(`${home} ${away} escalação provável desfalques futebol`);
  return {
    source:"NewsAPI",
    ok: news.length>0,
    count: news.length,
    note: news.length ? "notícias encontradas para contexto/provável escalação" : "nenhuma notícia encontrada",
    items: news.slice(0,5)
  };
}

async function diagnosticOdds(home, away){
  if(!ODDS_API_KEY) return {source:"Odds", ok:false, note:"ODDS_API_KEY ausente"};
  const d = await safe(fetchJson("https://api.the-odds-api.com/v4/sports/soccer/odds/?regions=eu,us,uk&markets=h2h&oddsFormat=decimal&apiKey=" + encodeURIComponent(ODDS_API_KEY)));
  if(d.__error) return {source:"Odds", ok:false, note:d.__error};
  const h=clean(home), a=clean(away);
  const found=(d||[]).filter(o=>{
    const teams=(o.home_team+" "+o.away_team).toLowerCase();
    const c=clean(teams);
    return c.includes(h) || c.includes(a);
  });
  return {source:"Odds", ok:found.length>0, count:found.length, note:`${found.length} odds relacionadas encontradas`};
}

app.get("/api/debug-match", async (req,res)=>{
  try{
    const home = req.query.home || "";
    const away = req.query.away || "";
    const date = req.query.date || today();
    if(!home || !away) return res.status(400).json({ok:false,error:"Informe home, away e date. Ex: /api/debug-match?home=Corinthians&away=Atletico-MG&date=2026-05-24"});

    const [apiFootball, sportmonks, espnDiag, news, odds] = await Promise.all([
      diagnosticApiFootball(home, away, date),
      diagnosticSportMonks(home, away, date),
      diagnosticESPN(home, away, date),
      diagnosticNews(home, away),
      diagnosticOdds(home, away)
    ]);

    const summary = {
      fixture: apiFootball.fixtureFound || sportmonks.fixtureFound || espnDiag.fixtureFound,
      stats: apiFootball.stats?.ok || sportmonks.stats?.ok,
      events: apiFootball.events?.ok || sportmonks.events?.ok,
      lineups: apiFootball.lineups?.ok || sportmonks.lineups?.ok,
      players: apiFootball.players?.ok || false,
      recentMatches: apiFootball.teams?.ok || false,
      news: news.ok,
      odds: odds.ok
    };

    const recommendation = [];
    if(!summary.fixture) recommendation.push("Nenhuma fonte encontrou a partida por nome/data. Verifique data, nomes e liga.");
    if(summary.fixture && !summary.stats) recommendation.push("Partida encontrada, mas nenhuma API retornou estatísticas detalhadas para esse jogo.");
    if(summary.fixture && !summary.lineups) recommendation.push("Partida encontrada, mas lineups oficiais ainda não retornaram ou não estão liberados no plano/API.");
    if(summary.fixture && !summary.players) recommendation.push("Jogadores/estatísticas individuais não retornaram; pode ser ID de time/liga divergente ou limitação do plano.");
    if(summary.fixture && summary.news) recommendation.push("NewsAPI encontrou notícias: usar apenas como provável/contexto, nunca como oficial.");
    if(!recommendation.length) recommendation.push("Fontes retornaram dados suficientes para alimentar a tela.");

    res.json({
      ok:true,
      query:{home,away,date},
      summary,
      recommendation,
      sources:{apiFootball, sportmonks, espn:espnDiag, news, odds}
    });
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message||e)});
  }
});


const SM_AUDIT_INCLUDES = [
  "participants","scores","state","league","season","venue","periods",
  "events.type","events.participant","statistics.type",
  "lineups.player","lineups.position","lineups.type",
  "formations","coaches","sidelined","metadata"
];

function auditCount(value){
  if(Array.isArray(value)) return value.length;
  if(value && typeof value === "object") return Object.keys(value).length;
  return value ? 1 : 0;
}
function auditFlag(obj,key){
  const v=obj?.[key], c=auditCount(v);
  return {ok:c>0,count:c};
}
function sportmonksAuditSummary(fx){
  return {
    fixtureId:fx.id||"",
    name:fx.name||"",
    starting_at:fx.starting_at||"",
    participants:auditFlag(fx,"participants"),
    scores:auditFlag(fx,"scores"),
    state:fx.state?{ok:true,count:1,value:fx.state.name||fx.state.state||""}:{ok:false,count:0},
    league:fx.league?{ok:true,count:1,value:fx.league.name||fx.league_id||""}:{ok:false,count:0},
    season:fx.season?{ok:true,count:1,value:fx.season.name||fx.season_id||""}:{ok:!!fx.season_id,count:fx.season_id?1:0,value:fx.season_id||""},
    venue:fx.venue?{ok:true,count:1,value:fx.venue.name||""}:{ok:false,count:0},
    periods:auditFlag(fx,"periods"),
    events:auditFlag(fx,"events"),
    statistics:auditFlag(fx,"statistics"),
    lineups:auditFlag(fx,"lineups"),
    formations:auditFlag(fx,"formations"),
    coaches:auditFlag(fx,"coaches"),
    sidelined:auditFlag(fx,"sidelined"),
    odds:auditFlag(fx,"odds"),
    metadata:auditFlag(fx,"metadata")
  };
}

app.get("/api/sportmonks-fixture-full", async (req,res)=>{
  try{
    const fixtureId=req.query.fixtureId||req.query.id;
    if(!fixtureId) return res.status(400).json({ok:false,error:"Informe fixtureId"});
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const include=req.query.include||SM_AUDIT_INCLUDES.join(";");
    const data=await sm(`/fixtures/${fixtureId}?include=${include}`);
    const fx=data.data||{};
    res.json({ok:true,fixtureId,include,summary:sportmonksAuditSummary(fx),raw:fx});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}
});

app.get("/api/sportmonks-audit", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const date=req.query.date||today();
    const fixtureId=req.query.fixtureId||"";
    const include=req.query.include||SM_AUDIT_INCLUDES.join(";");

    if(fixtureId){
      const full=await sm(`/fixtures/${fixtureId}?include=${include}`);
      const fx=full.data||{};
      return res.json({ok:true,mode:"fixture",date,fixtureId,includes:include.split(";"),fixtures:[sportmonksAuditSummary(fx)],rawFixture:fx});
    }

    const fixtures=await getAllSportMonksByDate(date);
    const basic=fixtures.map(f=>normalizeSportMonks(f));
    const sample=fixtures.slice(0,8);
    const detailed=[];

    for(const f of sample){
      try{
        const full=await sm(`/fixtures/${f.id}?include=${include}`);
        detailed.push(sportmonksAuditSummary(full.data||{}));
      }catch(e){
        detailed.push({fixtureId:f.id,name:f.name||"",error:String(e.message||e)});
      }
    }

    const coverage={
      totalFixtures:fixtures.length,
      sampledFixtures:detailed.length,
      participants:detailed.filter(x=>x.participants?.ok).length,
      scores:detailed.filter(x=>x.scores?.ok).length,
      events:detailed.filter(x=>x.events?.ok).length,
      statistics:detailed.filter(x=>x.statistics?.ok).length,
      lineups:detailed.filter(x=>x.lineups?.ok).length,
      formations:detailed.filter(x=>x.formations?.ok).length,
      odds:detailed.filter(x=>x.odds?.ok).length,
      venue:detailed.filter(x=>x.venue?.ok).length
    };

    res.json({ok:true,mode:"date",date,includes:include.split(";"),coverage,games:basic,fixtures:detailed});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}
});


app.get("/api/sportmonks-raw", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const fixtureId=req.query.fixtureId||req.query.id;
    if(!fixtureId) return res.status(400).json({ok:false,error:"Informe fixtureId"});

    const includeSets = {
      basic:"",
      common:"participants;scores;state;league;season;venue;periods",
      events:"events;events.type;events.participant",
      stats:"statistics;statistics.type",
      lineups:"lineups;lineups.player;lineups.position;lineups.type",
      extra:"formations;coaches;sidelined;metadata",
      all:"participants;scores;state;league;season;venue;periods;events;events.type;events.participant;statistics;statistics.type;lineups;lineups.player;lineups.position;lineups.type;formations;coaches;sidelined;metadata"
    };

    const results={};
    for(const [name,include] of Object.entries(includeSets)){
      try{
        const path = include ? `/fixtures/${fixtureId}?include=${include}` : `/fixtures/${fixtureId}`;
        const data = await sm(path);
        const fx=data.data||{};
        results[name]={
          ok:true,
          include,
          keys:Object.keys(fx),
          counts:{
            participants:Array.isArray(fx.participants)?fx.participants.length:null,
            scores:Array.isArray(fx.scores)?fx.scores.length:null,
            events:Array.isArray(fx.events)?fx.events.length:null,
            statistics:Array.isArray(fx.statistics)?fx.statistics.length:null,
            lineups:Array.isArray(fx.lineups)?fx.lineups.length:null,
            formations:Array.isArray(fx.formations)?fx.formations.length:null,
            odds:Array.isArray(fx.odds)?fx.odds.length:null
          },
          raw:data
        };
      }catch(e){
        results[name]={ok:false,include,error:String(e.message||e)};
      }
    }

    res.json({ok:true,fixtureId,results});
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message||e)});
  }
});

app.get("/api/sportmonks-includes-test", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const fixtureId=req.query.fixtureId||req.query.id;
    if(!fixtureId) return res.status(400).json({ok:false,error:"Informe fixtureId"});

    const candidates=[
      "participants","scores","state","league","season","venue","periods",
      "events","events.type","events.participant","events.player",
      "statistics","statistics.type",
      "lineups","lineups.player","lineups.position","lineups.type","lineups.details",
      "formations","coaches","sidelined","metadata",
      "referees","round","stage","group"
    ];

    const out=[];
    for(const inc of candidates){
      try{
        const data=await sm(`/fixtures/${fixtureId}?include=${inc}`);
        const fx=data.data||{};
        out.push({include:inc,ok:true,keys:Object.keys(fx),count:Array.isArray(fx[inc.split(".")[0]])?fx[inc.split(".")[0]].length:null});
      }catch(e){
        out.push({include:inc,ok:false,error:String(e.message||e)});
      }
    }
    res.json({ok:true,fixtureId,tests:out});
  }catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}
});


async function resolveApiFootballFixtureIdByNames(game){
  if(game.apiFootballId) return game.apiFootballId;
  if(!API_FOOTBALL_KEY) return "";
  const date=(game.date||today()).slice(0,10);
  const data=await safe(api(`/fixtures?date=${date}`));
  if(data.__error) return "";
  const h=engineClean(game.home?.name||""), a=engineClean(game.away?.name||"");
  const found=(data.response||[]).find(m=>{
    const mh=engineClean(m.teams?.home?.name||""), ma=engineClean(m.teams?.away?.name||"");
    return ((mh.includes(h)||h.includes(mh)) && (ma.includes(a)||a.includes(ma))) ||
           ((mh.includes(a)||a.includes(mh)) && (ma.includes(h)||h.includes(ma)));
  });
  return found?.fixture?.id || "";
}

async function resolveApiFootballTeamIdByName(name){
  if(!API_FOOTBALL_KEY || !name) return "";
  const data=await safe(api(`/teams?search=${encodeURIComponent(name)}`));
  if(data.__error) return "";
  const q=engineClean(name);
  const found=(data.response||[]).find(x=>engineClean(x.team?.name||"")===q) ||
              (data.response||[]).find(x=>{
                const n=engineClean(x.team?.name||"");
                return n.includes(q)||q.includes(n);
              });
  return found?.team?.id || "";
}

async function buildCoverageForGame(game){
  const state=matchState(game);
  const cov={fixture:true};
  const notes=[];
  let sportmonksRaw=null, apiFixtureId=game.apiFootballId||"";

  if(SPORTMONKS_KEY && game.sportmonksId){
    const include="participants;scores;state;league;season;venue;periods;events;events.type;events.participant;statistics;statistics.type;lineups;lineups.player;lineups.position;lineups.type;formations;coaches;sidelined;metadata";
    const smFull=await safe(sm(`/fixtures/${game.sportmonksId}?include=${include}`));
    if(!smFull.__error && smFull.data){
      sportmonksRaw=smFull.data;
      cov.participants=(sportmonksRaw.participants||[]).length>0;
      cov.scores=(sportmonksRaw.scores||[]).length>0;
      cov.events=(sportmonksRaw.events||[]).length>0;
      cov.statistics=(sportmonksRaw.statistics||[]).length>0;
      cov.lineups=(sportmonksRaw.lineups||[]).length>0;
      cov.formations=(sportmonksRaw.formations||[]).length>0;
      cov.coaches=(sportmonksRaw.coaches||[]).length>0;
      cov.sidelined=(sportmonksRaw.sidelined||[]).length>0;
    } else {
      notes.push("SportMonks fixture full falhou ou não liberou dados detalhados.");
    }
  }

  apiFixtureId = apiFixtureId || await resolveApiFootballFixtureIdByNames(game);

  let apiStats=null, apiEvents=[], apiLineups=[];
  if(API_FOOTBALL_KEY && apiFixtureId){
    const [st,ev,lu]=await Promise.all([
      safe(api(`/fixtures/statistics?fixture=${apiFixtureId}`)),
      safe(api(`/fixtures/events?fixture=${apiFixtureId}`)),
      safe(api(`/fixtures/lineups?fixture=${apiFixtureId}`))
    ]);
    if(!st.__error) apiStats=st.response||[];
    if(!ev.__error) apiEvents=ev.response||[];
    if(!lu.__error) apiLineups=lu.response||[];
    cov.events = cov.events || apiEvents.length>0;
    cov.statistics = cov.statistics || apiStats.length>0;
    cov.lineups = cov.lineups || apiLineups.length>0;
  }

  let lineups=[];
  if(sportmonksRaw) lineups=lineups.concat(lineupEngine.fromSportMonks(sportmonksRaw));
  lineups=lineups.concat(lineupEngine.fromApiFootball(apiLineups));
  const lineup= lineupEngine.classifyLineup(lineups);

  let smStats=sportmonksRaw ? statsEngine.fromSportMonks(sportmonksRaw,game) : null;
  let afStats=apiStats ? statsEngine.fromApiFootball(apiStats,game) : null;
  const stats=statsEngine.mergeStats(smStats,afStats);

  const homeId=game.home?.id || await resolveApiFootballTeamIdByName(game.home?.name);
  const awayId=game.away?.id || await resolveApiFootballTeamIdByName(game.away?.name);
  let form={home:null,away:null};
  if(API_FOOTBALL_KEY){
    const [hl,al]=await Promise.all([
      homeId ? safe(api(`/fixtures?team=${homeId}&last=10`)) : Promise.resolve({response:[]}),
      awayId ? safe(api(`/fixtures?team=${awayId}&last=10`)) : Promise.resolve({response:[]})
    ]);
    const hm=(hl.response||[]).map(f=>formEngine.apiFixtureToMini(f,game.home?.name));
    const am=(al.response||[]).map(f=>formEngine.apiFixtureToMini(f,game.away?.name));
    form={home:{matches:hm,summary:formEngine.summarize(hm)},away:{matches:am,summary:formEngine.summarize(am)}};
    cov.recentMatches=hm.length>0 || am.length>0;
  }

  cov.players=false;
  cov.odds=!!game.has_odds || !!game.has_premium_odds;
  cov.news=false;

  const coverage=normalizeCoverage(cov);
  if(!coverage.statistics) notes.push("Sem estatísticas detalhadas retornadas por SportMonks/API-Football.");
  if(!coverage.lineups) notes.push("Sem escalação oficial retornada pelas APIs.");
  if(!coverage.events) notes.push("Sem eventos/timeline retornados pelas APIs.");

  return {
    state,
    coverage,
    ids:{sportmonksId:game.sportmonksId||"",apiFootballId:apiFixtureId||"",homeId,awayId},
    stats,
    lineup,
    events:{
      sportmonks:(sportmonksRaw?.events||[]).length,
      apiFootball:apiEvents.length,
      total:(sportmonksRaw?.events||[]).length+apiEvents.length
    },
    form,
    notes
  };
}

app.get("/api/coverage-match", async (req,res)=>{
  try{
    const game=JSON.parse(req.query.game||"{}");
    if(!game.home || !game.away) return res.status(400).json({ok:false,error:"Envie game serializado"});
    const data=await buildCoverageForGame(game);
    res.json({ok:true,game,data});
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message||e)});
  }
});


function smHA(fx){const ps=fx?.participants||[];return{home:ps.find(p=>p?.meta?.location==='home')||ps[0]||null,away:ps.find(p=>p?.meta?.location==='away')||ps[1]||null,participants:ps}}
function smScore(fx){const sc=fx?.scores||[];const cur=sc.filter(s=>s.description==='CURRENT');const h=(cur.find(s=>s.score?.participant==='home')||sc.find(s=>s.score?.participant==='home'));const a=(cur.find(s=>s.score?.participant==='away')||sc.find(s=>s.score?.participant==='away'));return{home:h?.score?.goals??0,away:a?.score?.goals??0}}
function smVal(s){const v=s?.data?.value??s?.value?.total??s?.value?.count??s?.value;const n=Number(v);return Number.isFinite(n)?n:v}
function smType(s){return String(s?.type?.name||s?.type?.developer_name||s?.type?.code||s?.name||'').trim()}
function smFixture(fx){const {home,away}=smHA(fx);return{id:fx.id,name:fx.name,league:fx.league?.name||'',season_id:fx.season_id||fx.season?.id||'',league_id:fx.league_id||fx.league?.id||'',state:fx.state?.name||fx.state?.state||fx.state?.short_name||'',state_short:fx.state?.short_name||fx.state?.state||'',starting_at:fx.starting_at,venue:fx.venue?.name||'',home:home?{id:home.id,name:home.name,logo:home.image_path,meta:home.meta}:null,away:away?{id:away.id,name:away.name,logo:away.image_path,meta:away.meta}:null,score:smScore(fx)}}
function smEvents(fx){const {home,away}=smHA(fx);return(fx.events||[]).map(e=>({id:e.id,minute:e.minute,extra_minute:e.extra_minute,sort_order:e.sort_order,side:e.participant_id===home?.id?'home':e.participant_id===away?.id?'away':'unknown',participant_id:e.participant_id,type:e.type?.name||e.type?.developer_name||'',code:e.type?.code||'',player:e.player?.display_name||e.player_name||'',related_player:e.related_player?.display_name||e.related_player_name||'',result:e.result||'',info:e.info||'',addition:e.addition||'',injured:!!e.injured})).sort((a,b)=>(a.minute||0)-(b.minute||0)||(a.sort_order||0)-(b.sort_order||0))}
function smStats(fx){const {home,away}=smHA(fx);const out={home:{},away:{},raw:fx.statistics||[]};const map=n=>{n=String(n||'').toLowerCase();if(n.includes('possession'))return'possession';if(n.includes('corner'))return'corners';if(n.includes('target')||n.includes('goal'))return'shotsOnGoal';if(n.includes('shot'))return'shots';if(n.includes('yellow'))return'yellowCards';if(n.includes('red'))return'redCards';if(n.includes('foul'))return'fouls';if(n.includes('successful')&&n.includes('pass'))return'successfulPasses';if(n.includes('pass'))return'passes';if(n.includes('danger')&&n.includes('attack'))return'dangerousAttacks';if(n.includes('attack'))return'attacks';if(n.includes('expected goals')||n==='xg')return'xg';return n||'unknown'};for(const s of fx.statistics||[]){const side=s.location||(s.participant_id===home?.id?'home':s.participant_id===away?.id?'away':'');if(side!=='home'&&side!=='away')continue;out[side][map(smType(s))]=smVal(s)}return out}
function smLineups(fx){const {home,away}=smHA(fx);return(fx.lineups||[]).map(l=>({id:l.id,side:(l.participant_id===home?.id||l.team_id===home?.id)?'home':(l.participant_id===away?.id||l.team_id===away?.id)?'away':'unknown',participant_id:l.participant_id||l.team_id,player_id:l.player_id,name:l.player?.display_name||l.player?.name||l.player_name||'',number:l.jersey_number||l.number||'',position:l.position?.name||l.position?.developer_name||l.position_name||'',type:l.type?.name||l.type?.developer_name||l.type_name||'',formation_position:l.formation_position||null,formation_field:l.formation_field||null,details:l.details||[]})).filter(x=>x.name)}
function smSidelined(fx){const {home,away}=smHA(fx);return(fx.sidelined||[]).map(s=>({id:s.id,side:s.participant_id===home?.id?'home':s.participant_id===away?.id?'away':'unknown',participant_id:s.participant_id,player_id:s.player_id,player:s.sideline?.player?.display_name||s.sideline?.player?.name||'',category:s.sideline?.category||'',type:s.sideline?.type?.name||'',start_date:s.sideline?.start_date||'',end_date:s.sideline?.end_date||'',games_missed:s.sideline?.games_missed??null,completed:!!s.sideline?.completed}))}
function smPredictions(fx){return(fx.predictions||[]).map(p=>({id:p.id,type:p.type?.name||p.type?.developer_name||p.type?.code||'',value:p.predictions||p.value||p.data||p}))}
function smTrends(fx){return(fx.trends||[]).map(t=>({id:t.id,participant_id:t.participant_id,type:t.type?.name||t.type?.developer_name||'',minute:t.minute??t.period_minute??null,value:smVal(t),data:t.data||t.value||{}}))}
function smNews(fx){const pre=fx.prematchNews||fx.prematchnews||[],post=fx.postmatchNews||fx.postmatchnews||[];const p=(x,phase)=>({id:x.id,phase,title:x.title||'',type:x.type||'',lines:x.lines||[],text:(x.lines||[]).map(l=>l.text).filter(Boolean).join(' ')});return[...pre.map(x=>p(x,'prematch')),...post.map(x=>p(x,'postmatch'))]}
async function smFixtureComponentCore(id){const include=['participants','league','venue','state','scores','periods','events.type','events.period','events.player','events.participant','statistics.type','lineups.player','lineups.type','lineups.details.type','metadata.type','coaches','sidelined.sideline.player','sidelined.sideline.type','predictions.type','trends.type','trends.participant','prematchNews.lines','postmatchNews.lines','referees'].join(';');const raw=await sm(`/fixtures/${id}?include=${include}`);const fx=raw.data||{};return{ok:true,fixture:smFixture(fx),events:smEvents(fx),statistics:smStats(fx),lineups:smLineups(fx),sidelined:smSidelined(fx),predictions:smPredictions(fx),trends:smTrends(fx),news:smNews(fx),referees:fx.referees||[],raw:fx}}
app.get('/api/sm/components/fixture/:id',async(req,res)=>{try{if(!SPORTMONKS_KEY)return res.status(400).json({ok:false,error:'SPORTMONKS_KEY ausente'});res.json(await smFixtureComponentCore(req.params.id))}catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}});
app.get('/api/sm/components/calendar',async(req,res)=>{try{if(!SPORTMONKS_KEY)return res.status(400).json({ok:false,error:'SPORTMONKS_KEY ausente'});const date=req.query.date||today();const raw=await sm(`/leagues/date/${date}?include=today.scores;today.participants;today.stage;today.group;today.round`);res.json({ok:true,date,leagues:raw.data||[]})}catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}});
app.get('/api/sm/components/team/:id',async(req,res)=>{try{if(!SPORTMONKS_KEY)return res.status(400).json({ok:false,error:'SPORTMONKS_KEY ausente'});const id=req.params.id;const team=await sm(`/teams/${id}?include=latest.statistics.type;latest.xgfixture.type;latest.participants;latest.scores.type`);let schedule=null,squad=null;try{schedule=await sm(`/schedules/teams/${id}`)}catch(_){}try{squad=await sm(`/squads/teams/${id}?include=team;player.nationality;player.statistics.details.type;player.position`)}catch(_){}res.json({ok:true,team:team.data||{},schedule:schedule?.data||[],squad:squad?.data||[]})}catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}});
app.get('/api/sm/components/standings/:seasonId',async(req,res)=>{try{if(!SPORTMONKS_KEY)return res.status(400).json({ok:false,error:'SPORTMONKS_KEY ausente'});const raw=await sm(`/standings/seasons/${req.params.seasonId}?include=participant;rule.type;details.type;form;stage;league;group`);res.json({ok:true,standings:raw.data||[]})}catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}});
app.get('/api/sm/components/player/:id',async(req,res)=>{try{if(!SPORTMONKS_KEY)return res.status(400).json({ok:false,error:'SPORTMONKS_KEY ausente'});const inc='trophies.league;trophies.season;trophies.trophy;trophies.team;teams.team;statistics.details.type;statistics.team;statistics.season.league;latest.fixture.participants;latest.fixture.league;latest.fixture.scores;latest.details.type;nationality;detailedPosition;metadata.type';const raw=await sm(`/players/${req.params.id}?include=${inc}`);res.json({ok:true,player:raw.data||{}})}catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}});
app.get('/api/sm/components/head-to-head',async(req,res)=>{try{if(!SPORTMONKS_KEY)return res.status(400).json({ok:false,error:'SPORTMONKS_KEY ausente'});const t1=req.query.team1||req.query.home,t2=req.query.team2||req.query.away;if(!t1||!t2)return res.status(400).json({ok:false,error:'Informe team1 e team2'});const raw=await sm(`/fixtures/head-to-head/${t1}/${t2}?include=participants;league;scores;state;venue;events`);res.json({ok:true,fixtures:raw.data||[]})}catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}});
app.get('/api/sm/components/topscorers/:seasonId',async(req,res)=>{try{if(!SPORTMONKS_KEY)return res.status(400).json({ok:false,error:'SPORTMONKS_KEY ausente'});const raw=await sm(`/topscorers/seasons/${req.params.seasonId}?include=player.nationality;player.position;participant;type;season.league`);res.json({ok:true,topscorers:raw.data||[]})}catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}});


function smNameClean(s){
  return String(s||"")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9 ]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function smNameMatch(a,b){
  const x=smNameClean(a), y=smNameClean(b);
  if(!x || !y) return false;
  return x===y || x.includes(y) || y.includes(x);
}

function addDaysISO(dateStr, days){
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate()+days);
  return d.toISOString().slice(0,10);
}

function fixtureParticipantsByLocation(fx){
  const ps = fx?.participants || [];
  const home = ps.find(p => p?.meta?.location === "home") || ps[0] || null;
  const away = ps.find(p => p?.meta?.location === "away") || ps[1] || null;
  return {home,away};
}

async function resolveSportMonksFixtureByNames(homeName, awayName, date){
  if(!SPORTMONKS_KEY) return null;
  const dates = [date, addDaysISO(date,-1), addDaysISO(date,1)];
  const include = "participants;scores;state;league;season;venue;round";
  const tried = [];

  for(const dt of dates){
    let fixtures = [];
    try{
      const raw = await sm(`/fixtures/date/${dt}?include=${include}`);
      fixtures = raw.data || [];
    }catch(e){
      try{
        fixtures = await getAllSportMonksByDate(dt);
      }catch(_){
        fixtures = [];
      }
    }

    for(const fx of fixtures){
      const {home,away} = fixtureParticipantsByLocation(fx);
      const okDirect = smNameMatch(home?.name, homeName) && smNameMatch(away?.name, awayName);
      const okReverse = smNameMatch(home?.name, awayName) && smNameMatch(away?.name, homeName);
      tried.push({date:dt,id:fx.id,name:fx.name,home:home?.name,away:away?.name,okDirect,okReverse});
      if(okDirect || okReverse){
        return {
          id: fx.id,
          date: dt,
          reverse: okReverse,
          fixture: fx,
          home: home?.name || "",
          away: away?.name || "",
          state: fx.state?.name || fx.state?.state || "",
          starting_at: fx.starting_at || ""
        };
      }
    }
  }

  return {id:null,tried};
}

app.get("/api/sm/resolve-fixture", async (req,res)=>{
  try{
    const home = req.query.home || "";
    const away = req.query.away || "";
    const date = (req.query.date || today()).slice(0,10);
    if(!home || !away) return res.status(400).json({ok:false,error:"Informe home e away"});
    const found = await resolveSportMonksFixtureByNames(home, away, date);
    res.json({ok:!!found?.id, result:found});
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message||e)});
  }
});


const SM_MATCH_CACHE = new Map();
const SM_MATCH_TTL = 45 * 1000;
function smCacheGet(key){ const v=SM_MATCH_CACHE.get(key); if(!v) return null; if(Date.now()-v.t>SM_MATCH_TTL){SM_MATCH_CACHE.delete(key);return null;} return v.data; }
function smCacheSet(key,data){ SM_MATCH_CACHE.set(key,{t:Date.now(),data}); return data; }
function smArr(x){ if(Array.isArray(x)) return x; if(Array.isArray(x?.data)) return x.data; return []; }
function smTxt(x){ return String(x ?? "").trim(); }
function smSides(fx){
  const participants = smArr(fx.participants);
  const home = participants.find(p=>p?.meta?.location==="home") || participants[0] || null;
  const away = participants.find(p=>p?.meta?.location==="away") || participants[1] || null;
  return {participants,home,away,homeId:Number(home?.id),awayId:Number(away?.id)};
}
function smScoreNow(fx){
  const scores = smArr(fx.scores);
  const h = scores.find(s=>s?.description==="CURRENT"&&s?.score?.participant==="home") || scores.find(s=>s?.score?.participant==="home");
  const a = scores.find(s=>s?.description==="CURRENT"&&s?.score?.participant==="away") || scores.find(s=>s?.score?.participant==="away");
  return {home:Number.isFinite(Number(h?.score?.goals))?Number(h.score.goals):0, away:Number.isFinite(Number(a?.score?.goals))?Number(a.score.goals):0};
}
function smKey(name){
  const n=String(name||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
  if(n.includes("possession")) return "possession";
  if(n.includes("corner")) return "corners";
  if(n.includes("shots_on_target")||n.includes("shots_on_goal")||n.includes("on_target")) return "shotsOnGoal";
  if(n.includes("shots_off_target")||n.includes("off_target")) return "shotsOffGoal";
  if(n.includes("blocked_shots")||n.includes("shots_blocked")) return "blockedShots";
  if(n.includes("shots_total")||n.includes("total_shots")||n==="shots"||n.includes("shot_total")) return "shots";
  if(n.includes("yellow")) return "yellowCards";
  if(n.includes("red")) return "redCards";
  if(n.includes("foul")) return "fouls";
  if(n==="passes"||n.includes("total_passes")) return "passes";
  if(n.includes("accurate_passes")||n.includes("successful_passes")) return "successfulPasses";
  if(n.includes("dangerous_attacks")) return "dangerousAttacks";
  if(n==="attacks"||n.endsWith("_attacks")) return "attacks";
  if(n.includes("expected_goals")||n==="xg") return "xg";
  if(n.includes("big_chances")) return "bigChances";
  if(n.includes("saves")) return "saves";
  if(n.includes("offsides")) return "offsides";
  if(n.includes("tackles")) return "tackles";
  if(n.includes("interceptions")) return "interceptions";
  if(n.includes("duels_won")) return "duelsWon";
  if(n.includes("crosses")) return "crosses";
  if(n.includes("key_passes")) return "keyPasses";
  return n||"unknown";
}
function smVal(s){
  const cs=[s?.data?.value,s?.data?.total,s?.data?.count,s?.value?.total,s?.value?.count,s?.value?.value,s?.value,s?.total,s?.count];
  for(const c of cs){ if(c===undefined||c===null||c==="") continue; const n=Number(c); return Number.isFinite(n)?n:c; }
  return null;
}
function normalizeSportMonksFull(raw){
  const fx=raw?.data || raw || {};
  const {home,away,homeId,awayId}=smSides(fx);
  const score=smScoreNow(fx);
  const statistics={home:{},away:{},labels:{},raw:smArr(fx.statistics)};
  for(const st of statistics.raw){
    const label=smTxt(st?.type?.developer_name||st?.type?.name||st?.type?.code||st?.name||st?.type_name);
    const key=smKey(label);
    const side=st?.location||st?.data?.location||(Number(st?.participant_id)===homeId?"home":Number(st?.participant_id)===awayId?"away":"");
    const value=smVal(st);
    if((side==="home"||side==="away")&&value!==null){ statistics[side][key]=value; statistics.labels[key]=label||key; }
  }
  const events=smArr(fx.events).map(e=>{
    const side=Number(e?.participant_id)===homeId?"home":Number(e?.participant_id)===awayId?"away":"unknown";
    return {id:e.id,minute:e.minute,extra_minute:e.extra_minute,sort_order:e.sort_order,side,team_id:e.participant_id,type:e?.type?.name||e?.type?.developer_name||e?.type?.code||e?.addition||"Evento",type_id:e.type_id,player:e?.player?.display_name||e?.player?.name||e.player_name||"",player_id:e.player_id,related_player:e?.related_player?.display_name||e.related_player_name||"",result:e.result||"",info:e.info||"",addition:e.addition||""};
  }).sort((a,b)=>(a.minute||0)-(b.minute||0)||(a.sort_order||0)-(b.sort_order||0));
  const lineups=smArr(fx.lineups).map(l=>{
    const player=l.player||{}, pos=l.position||l.detailed_position||{}, type=l.type||{};
    const tid=Number(l.team_id??l.participant_id??l.team?.id??l.participant?.id);
    const side=tid===homeId?"home":tid===awayId?"away":"unknown";
    return {id:l.id,side,team_id:tid||l.team_id||l.participant_id,player_id:l.player_id||player.id,name:player.display_name||player.name||l.player_name||l.name||"",number:l.jersey_number||l.number||"",position:pos.name||pos.developer_name||l.position_name||"",type:type.name||type.developer_name||l.type_name||"",formation_position:l.formation_position||l.formationPosition||null,formation_field:l.formation_field||l.formationField||null,details:smArr(l.details)};
  }).filter(x=>x.name);
  const formations=smArr(fx.formations).map(f=>({id:f.id,team_id:f.participant_id||f.team_id,formation:f.formation||f.name||f.value||"",raw:f}));
  const trends=smArr(fx.trends).map(t=>({id:t.id,team_id:t.participant_id,side:Number(t.participant_id)===homeId?"home":Number(t.participant_id)===awayId?"away":"unknown",type:t?.type?.name||t?.type?.developer_name||"",minute:t.minute??t.period_minute??null,value:smVal(t),data:t.data||t.value||{}}));
  const comments=smArr(fx.comments).map(c=>({id:c.id,minute:c.minute,text:c.comment||c.text||c.message||"",type:c.type||""}));
  const news=[...smArr(fx.prematchNews||fx.prematchnews).map(n=>({phase:"prematch",title:n.title||"",text:smArr(n.lines).map(l=>l.text).filter(Boolean).join(" ")})),...smArr(fx.postmatchNews||fx.postmatchnews).map(n=>({phase:"postmatch",title:n.title||"",text:smArr(n.lines).map(l=>l.text).filter(Boolean).join(" ")}))];
  const sidelined=smArr(fx.sidelined).map(s=>({id:s.id,side:Number(s.participant_id)===homeId?"home":Number(s.participant_id)===awayId?"away":"unknown",player:s?.sideline?.player?.display_name||s?.sideline?.player?.name||"",type:s?.sideline?.type?.name||s?.sideline?.category||"",start_date:s?.sideline?.start_date||"",games_missed:s?.sideline?.games_missed??null}));
  const predictions=smArr(fx.predictions).map(p=>({id:p.id,type:p?.type?.name||p?.type?.developer_name||"",value:p.predictions||p.value||p.data||p}));
  const coverage={participants:!!(home&&away),statistics:Object.keys(statistics.home).length+Object.keys(statistics.away).length,events:events.length,lineups:lineups.length,formations:formations.length,trends:trends.length,comments:comments.length,news:news.length,sidelined:sidelined.length,predictions:predictions.length};
  const pts=[];
  if(coverage.statistics){
    const hs=statistics.home, as=statistics.away;
    if(hs.shots!==undefined||as.shots!==undefined) pts.push(`Finalizações: ${home?.name||"Casa"} ${hs.shots??"-"} x ${as.shots??"-"} ${away?.name||"Fora"}.`);
    if(hs.shotsOnGoal!==undefined||as.shotsOnGoal!==undefined) pts.push(`Chutes no gol: ${hs.shotsOnGoal??"-"} x ${as.shotsOnGoal??"-"}.`);
    if(hs.corners!==undefined||as.corners!==undefined) pts.push(`Escanteios: ${hs.corners??"-"} x ${as.corners??"-"}.`);
    if(hs.possession!==undefined||as.possession!==undefined) pts.push(`Posse: ${hs.possession??"-"}% x ${as.possession??"-"}%.`);
    if(hs.dangerousAttacks!==undefined||as.dangerousAttacks!==undefined) pts.push(`Ataques perigosos: ${hs.dangerousAttacks??"-"} x ${as.dangerousAttacks??"-"}.`);
  }
  if(coverage.events) pts.push(`${coverage.events} eventos oficiais carregados.`);
  if(coverage.lineups) pts.push(`${coverage.lineups} jogadores de escalação/banco carregados.`);
  return {ok:true,fixture:{id:fx.id,name:fx.name,date:fx.starting_at,league:fx.league?.name||"",league_id:fx.league_id||fx.league?.id||"",season_id:fx.season_id||fx.season?.id||"",state:fx.state?.name||fx.state?.state||fx.state?.short_name||"",venue:fx.venue?.name||"",home:home?{id:home.id,name:home.name,logo:home.image_path,meta:home.meta}:null,away:away?{id:away.id,name:away.name,logo:away.image_path,meta:away.meta}:null,score},coverage,statistics,events,lineups,formations,trends,comments,news,sidelined,predictions,ai:{text:pts[0]||"Sem dados detalhados oficiais para leitura.",points:pts},raw:fx};
}
const SM_FULL_INCLUDE = ["participants","scores","state","league","venue","season","periods","events.type","events.participant","events.player","statistics.type","lineups.player","lineups.position","lineups.type","lineups.details.type","formations","metadata.type","coaches","sidelined.sideline.player","sidelined.sideline.type","predictions.type","trends.type","trends.participant","comments","prematchNews.lines","postmatchNews.lines","referees"].join(";");
async function smFullFixture(fixtureId){ const raw=await sm(`/fixtures/${fixtureId}?include=${SM_FULL_INCLUDE}`); return normalizeSportMonksFull(raw.data||raw); }
app.get("/api/match-full", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    let fixtureId=req.query.fixtureId||req.query.id||"";
    const home=req.query.home||"", away=req.query.away||"", date=(req.query.date||today()).slice(0,10);
    if(!fixtureId && home && away){ const r=await resolveSportMonksFixtureByNames(home,away,date); if(r?.id) fixtureId=r.id; }
    if(!fixtureId) return res.status(400).json({ok:false,error:"fixtureId não encontrado",home,away,date});
    const ck=`match-full:${fixtureId}`; const cached=smCacheGet(ck); if(cached) return res.json({...cached,cached:true});
    const data=await smFullFixture(fixtureId); smCacheSet(ck,data); res.json(data);
  }catch(e){ res.status(500).json({ok:false,error:String(e.message||e)}); }
});


/* V46 MATCH CENTER */
const MC_CACHE = new Map();
const MC_TTL = 35 * 1000;
function mcCacheGet(k){const v=MC_CACHE.get(k);if(!v)return null;if(Date.now()-v.t>MC_TTL){MC_CACHE.delete(k);return null}return v.d}
function mcCacheSet(k,d){MC_CACHE.set(k,{t:Date.now(),d});return d}
function mcArr(x){if(Array.isArray(x))return x;if(Array.isArray(x?.data))return x.data;return []}
function mcObj(x){return x?.data||x||{}}
function mcTxt(x){return String(x??"").trim()}
function mcN(x){const n=Number(x);return Number.isFinite(n)?n:null}
function mcSlug(x){return String(x||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"")}
function mcSim(a,b){const A=mcSlug(a),B=mcSlug(b);return !!A&&!!B&&(A===B||A.includes(B)||B.includes(A))}
function mcParts(fx){
 const ps=mcArr(fx.participants);
 const home=ps.find(p=>p?.meta?.location==="home")||ps.find(p=>p?.location==="home")||ps[0]||null;
 const away=ps.find(p=>p?.meta?.location==="away")||ps.find(p=>p?.location==="away")||ps[1]||null;
 return {list:ps,home,away,homeId:mcN(home?.id),awayId:mcN(away?.id)};
}
function mcSide(tid,homeId,awayId){const n=mcN(tid);if(n!==null&&n===homeId)return"home";if(n!==null&&n===awayId)return"away";return"unknown"}
function mcScore(fx){
 const ss=mcArr(fx.scores);
 const pick=s=>ss.find(x=>String(x?.description).toUpperCase()==="CURRENT"&&x?.score?.participant===s)||ss.find(x=>x?.score?.participant===s);
 const h=pick("home"),a=pick("away");
 return {home:mcN(h?.score?.goals)??0,away:mcN(a?.score?.goals)??0,raw:ss};
}
function mcStatKey(label,id){
 const n=mcSlug(label);
 if(n.includes("possession"))return"possession";
 if(n.includes("corner"))return"corners";
 if(n.includes("shots_on_target")||n.includes("shots_on_goal")||n.includes("on_target"))return"shotsOnGoal";
 if(n.includes("shots_off_target")||n.includes("off_target"))return"shotsOffGoal";
 if(n.includes("blocked_shots")||n.includes("shots_blocked"))return"blockedShots";
 if(n.includes("shots_total")||n.includes("total_shots")||n==="shots"||n.includes("shot_total"))return"shots";
 if(n.includes("yellow"))return"yellowCards";
 if(n.includes("red"))return"redCards";
 if(n.includes("foul"))return"fouls";
 if(n==="passes"||n.includes("total_passes"))return"passes";
 if(n.includes("accurate_passes")||n.includes("successful_passes"))return"successfulPasses";
 if(n.includes("dangerous_attacks"))return"dangerousAttacks";
 if(n==="attacks"||n.endsWith("_attacks"))return"attacks";
 if(n.includes("expected_goals")||n==="xg")return"xg";
 if(n.includes("big_chances"))return"bigChances";
 if(n.includes("saves"))return"saves";
 if(n.includes("offsides"))return"offsides";
 if(n.includes("tackles"))return"tackles";
 if(n.includes("interceptions"))return"interceptions";
 if(n.includes("duels_won"))return"duelsWon";
 if(n.includes("crosses"))return"crosses";
 if(n.includes("key_passes"))return"keyPasses";
 if(n.includes("dribble"))return"dribbles";
 return n||`type_${id||"unknown"}`;
}
function mcVal(s){
 const cs=[s?.data?.value,s?.data?.total,s?.data?.count,s?.value?.total,s?.value?.count,s?.value?.value,s?.value,s?.total,s?.count];
 for(const c of cs){if(c===undefined||c===null||c==="")continue;const n=Number(c);return Number.isFinite(n)?n:c}
 return null;
}
function mcStats(fx,homeId,awayId){
 const raw=mcArr(fx.statistics), out={home:{},away:{},labels:{},raw};
 for(const s of raw){
  const label=mcTxt(s?.type?.developer_name||s?.type?.name||s?.type?.code||s?.name||s?.type_name||s?.type);
  const key=mcStatKey(label,s?.type_id);
  const pid=mcN(s?.participant_id??s?.team_id);
  const side=s?.location||s?.data?.location||(pid===homeId?"home":pid===awayId?"away":"");
  const value=mcVal(s);
  if((side==="home"||side==="away")&&value!==null){out[side][key]=value;out.labels[key]=label||key}
 }
 return out;
}
function mcLineups(fx,home,away,homeId,awayId){
 const raw=mcArr(fx.lineups);
 const all=raw.map(l=>{
  const player=l.player||{},pos=l.position||l.detailed_position||{},type=l.type||{};
  const teamId=l.team_id??l.participant_id??l.team?.id??l.participant?.id??l.player?.team_id;
  let side=mcSide(teamId,homeId,awayId);
  if(side==="unknown"){
    const tn=l.team?.name||l.participant?.name||l.team_name||"";
    if(mcSim(tn,home?.name))side="home";else if(mcSim(tn,away?.name))side="away";
  }
  const typeLabel=type.name||type.developer_name||l.type_name||"";
  const isBench=/bench|substitute/i.test(typeLabel)||l.type_id===12||l.type_id===2;
  const isStarter=!isBench&&(/lineup|starter|starting/i.test(typeLabel)||l.type_id===11||l.type_id===1||l.formation_position||l.formation_field||!typeLabel);
  return {id:l.id,side,team_id:teamId,participant_id:teamId,player_id:l.player_id||player.id,name:player.display_name||player.common_name||player.name||l.player_name||l.name||"",number:l.jersey_number||l.number||player.jersey_number||"",position:pos.name||pos.developer_name||l.position_name||"",type:typeLabel||"Lineup",starter:!!isStarter,bench:!!isBench,formation_position:l.formation_position||l.formationPosition||null,formation_field:l.formation_field||l.formationField||null,details:mcArr(l.details)};
 }).filter(x=>x.name);
 const homeAll=all.filter(p=>p.side==="home"),awayAll=all.filter(p=>p.side==="away"),unknown=all.filter(p=>p.side==="unknown");
 const split=a=>({starters:a.filter(p=>p.starter),bench:a.filter(p=>p.bench||!p.starter),all:a});
 return {mode:(homeAll.length||awayAll.length)?"team-columns":unknown.length?"unknown-safe-list":"empty",home:split(homeAll),away:split(awayAll),unknown,all,raw};
}
function mcEvents(fx,homeId,awayId){
 return mcArr(fx.events).map(e=>{const pid=mcN(e?.participant_id??e?.team_id);return {id:e.id,minute:e.minute,extra_minute:e.extra_minute,sort_order:e.sort_order,side:mcSide(pid,homeId,awayId),team_id:pid,type:e?.type?.name||e?.type?.developer_name||e?.type?.code||e?.addition||"Evento",type_id:e.type_id,player:e?.player?.display_name||e?.player?.common_name||e?.player?.name||e.player_name||"",player_id:e.player_id,related_player:e?.related_player?.display_name||e?.related_player?.name||e.related_player_name||"",result:e.result||"",info:e.info||"",addition:e.addition||""}}).sort((a,b)=>(a.minute||0)-(b.minute||0)||(a.sort_order||0)-(b.sort_order||0));
}
function mcContext(fx,homeId,awayId){
 const news=[...mcArr(fx.prematchNews||fx.prematchnews).map(n=>({phase:"prematch",title:n.title||"",text:mcArr(n.lines).map(l=>l.text).filter(Boolean).join(" ")})),...mcArr(fx.postmatchNews||fx.postmatchnews).map(n=>({phase:"postmatch",title:n.title||"",text:mcArr(n.lines).map(l=>l.text).filter(Boolean).join(" ")}))].filter(n=>n.title||n.text);
 const sidelined=mcArr(fx.sidelined).map(s=>({id:s.id,side:mcSide(s.participant_id,homeId,awayId),player:s?.sideline?.player?.display_name||s?.sideline?.player?.name||"",type:s?.sideline?.type?.name||s?.sideline?.category||"",start_date:s?.sideline?.start_date||"",games_missed:s?.sideline?.games_missed??null})).filter(s=>s.player||s.type);
 const predictions=mcArr(fx.predictions).map(p=>({id:p.id,type:p?.type?.name||p?.type?.developer_name||"",value:p.predictions||p.value||p.data||p}));
 return {news,sidelined,predictions};
}
function mcAI(home,away,stats,events,lineups,trends,ctx){
 const pts=[],hs=stats.home||{},as=stats.away||{};
 if(hs.shots!==undefined||as.shots!==undefined)pts.push(`Finalizações: ${home?.name||"Mandante"} ${hs.shots??"-"} x ${as.shots??"-"} ${away?.name||"Visitante"}.`);
 if(hs.shotsOnGoal!==undefined||as.shotsOnGoal!==undefined)pts.push(`Chutes no gol: ${hs.shotsOnGoal??"-"} x ${as.shotsOnGoal??"-"}.`);
 if(hs.corners!==undefined||as.corners!==undefined)pts.push(`Escanteios: ${hs.corners??"-"} x ${as.corners??"-"}.`);
 if(hs.possession!==undefined||as.possession!==undefined)pts.push(`Posse: ${hs.possession??"-"}% x ${as.possession??"-"}%.`);
 if(hs.dangerousAttacks!==undefined||as.dangerousAttacks!==undefined)pts.push(`Ataques perigosos: ${hs.dangerousAttacks??"-"} x ${as.dangerousAttacks??"-"}.`);
 if(events.length)pts.push(`${events.length} eventos oficiais carregados na timeline.`);
 if(lineups.all.length)pts.push(`${lineups.all.length} jogadores retornados; ${lineups.home.all.length} mandante e ${lineups.away.all.length} visitante.`);
 if(ctx.sidelined.length)pts.push(`${ctx.sidelined.length} desfalques/suspensões carregados.`);
 const hp=Number(hs.dangerousAttacks??hs.attacks??hs.shots??0),ap=Number(as.dangerousAttacks??as.attacks??as.shots??0);
 const leader=(hp||ap)?(hp>=ap?home?.name:away?.name):null;
 return {available:pts.length>0,text:pts.length?`${leader||"A partida"} aparece com maior volume nos dados oficiais disponíveis.`:"Sem dados oficiais suficientes para leitura contextual.",points:pts};
}
function mcNormalize(raw){
 const fx=mcObj(raw), {home,away,homeId,awayId}=mcParts(fx), score=mcScore(fx);
 const statistics=mcStats(fx,homeId,awayId),events=mcEvents(fx,homeId,awayId),lineups=mcLineups(fx,home,away,homeId,awayId);
 const formations=mcArr(fx.formations).map(f=>({id:f.id,team_id:f.participant_id||f.team_id,formation:f.formation||f.name||f.value||"",raw:f}));
 const trends=mcArr(fx.trends).map(t=>({id:t.id,team_id:t.participant_id,side:mcSide(t.participant_id,homeId,awayId),type:t?.type?.name||t?.type?.developer_name||"",minute:t.minute??t.period_minute??null,value:mcVal(t),data:t.data||t.value||{}}));
 const comments=mcArr(fx.comments).map(c=>({id:c.id,minute:c.minute,text:c.comment||c.text||c.message||"",type:c.type||""})).filter(c=>c.text||c.type);
 const context=mcContext(fx,homeId,awayId);
 const coverage={participants:!!(home&&away),score:true,statistics:Object.keys(statistics.home).length+Object.keys(statistics.away).length,events:events.length,lineups:lineups.all.length,homeLineup:lineups.home.all.length,awayLineup:lineups.away.all.length,unknownLineup:lineups.unknown.length,formations:formations.length,trends:trends.length,comments:comments.length,news:context.news.length,sidelined:context.sidelined.length,predictions:context.predictions.length};
 return {ok:true,source:"SportMonks",version:"v46-match-center",fixture:{id:fx.id,name:fx.name,date:fx.starting_at,league:fx.league?.name||"",league_id:fx.league_id||fx.league?.id||"",season_id:fx.season_id||fx.season?.id||"",state:fx.state?.name||fx.state?.state||fx.state?.short_name||"",state_id:fx.state_id,venue:fx.venue?.name||"",home:home?{id:home.id,name:home.name,logo:home.image_path,meta:home.meta}:null,away:away?{id:away.id,name:away.name,logo:away.image_path,meta:away.meta}:null,score},coverage,statistics,events,lineups,formations,trends,comments,context,ai:mcAI(home,away,statistics,events,lineups,trends,context),raw:fx};
}
const MC_INCLUDE=["participants","scores","state","league","venue","season","periods","events.type","events.participant","events.player","events.relatedPlayer","statistics.type","lineups.player","lineups.position","lineups.type","lineups.details.type","formations","metadata.type","coaches","sidelined.sideline.player","sidelined.sideline.type","predictions.type","trends.type","trends.participant","comments","prematchNews.lines","postmatchNews.lines","referees"].join(";");
async function mcFetch(id){const raw=await sm(`/fixtures/${id}?include=${MC_INCLUDE}`);return mcNormalize(raw.data||raw)}
app.get("/api/match-center",async(req,res)=>{
 try{
  if(!SPORTMONKS_KEY)return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
  let id=req.query.fixtureId||req.query.id||"";const home=req.query.home||"",away=req.query.away||"",date=(req.query.date||today()).slice(0,10);
  if(!id&&home&&away){const r=await resolveSportMonksFixtureByNames(home,away,date);if(r?.id)id=r.id}
  if(!id)return res.status(400).json({ok:false,error:"fixtureId não encontrado",home,away,date});
  const ck=`mc:${id}`,c=mcCacheGet(ck);if(c)return res.json({...c,cached:true});
  const d=await mcFetch(id);mcCacheSet(ck,d);res.json(d);
 }catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}
});
app.get("/api/match-center/audit-day",async(req,res)=>{
 try{
  if(!SPORTMONKS_KEY)return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
  const date=(req.query.date||today()).slice(0,10), limit=Number(req.query.limit||20);
  const raw=await sm(`/fixtures/date/${date}?include=participants;scores;state;league`);
  const fixtures=mcArr(raw.data||raw), sample=[];
  for(const fx of fixtures.slice(0,limit)){
   try{const d=await mcFetch(fx.id);sample.push({fixtureId:d.fixture.id,name:d.fixture.name,league:d.fixture.league,state:d.fixture.state,statistics:d.coverage.statistics,events:d.coverage.events,lineups:d.coverage.lineups,homeLineup:d.coverage.homeLineup,awayLineup:d.coverage.awayLineup,unknownLineup:d.coverage.unknownLineup})}
   catch(err){sample.push({fixtureId:fx.id,name:fx.name,error:String(err.message||err)})}
  }
  res.json({ok:true,date,total:fixtures.length,sample});
 }catch(e){res.status(500).json({ok:false,error:String(e.message||e)})}
});


/* V48 - MY LEAGUES FIX
   Ligas contratadas confirmadas no MySportMonks:
   Premier League 8, Série A Brasil 648, Copa do Brasil 654,
   Copa Sudamericana 1116, Copa Libertadores 1122.
*/
const DHUNIOR_MY_LEAGUES = [
  { id: 648, name: "Serie A", country: "Brazil", aliases: ["Brasileirão", "Brasileirao", "BR Série A", "BR Serie A", "Série A"] },
  { id: 654, name: "Copa do Brasil", country: "Brazil", aliases: ["Copa do Brasil"] },
  { id: 8, name: "Premier League", country: "England", aliases: ["Premier League", "Inglaterra"] },
  { id: 1116, name: "Copa Sudamericana", country: "South America", aliases: ["Sul-Americana", "Sulamericana", "Copa Sul-Americana", "Sudamericana"] },
  { id: 1122, name: "Copa Libertadores", country: "South America", aliases: ["Libertadores", "Copa Libertadores"] }
];
const DHUNIOR_MY_LEAGUE_IDS = DHUNIOR_MY_LEAGUES.map(l => Number(l.id));

function isDhuniorLeagueId(id){
  return DHUNIOR_MY_LEAGUE_IDS.includes(Number(id));
}
function leagueLabelFromId(id){
  const l = DHUNIOR_MY_LEAGUES.find(x => Number(x.id) === Number(id));
  return l ? l.name : String(id || "");
}
function leagueGroupFromId(id){
  const n = Number(id);
  if(n === 1116) return "sudamericana";
  if(n === 1122) return "libertadores";
  if(n === 648) return "brasileirao";
  if(n === 654) return "copa_do_brasil";
  if(n === 8) return "premier";
  return "outros";
}
function normalizeMyLeagueFixture(fx){
  const p = Array.isArray(fx.participants) ? fx.participants : Array.isArray(fx.participants?.data) ? fx.participants.data : [];
  const home = p.find(x=>x?.meta?.location==="home") || p[0] || {};
  const away = p.find(x=>x?.meta?.location==="away") || p[1] || {};
  const scores = Array.isArray(fx.scores) ? fx.scores : Array.isArray(fx.scores?.data) ? fx.scores.data : [];
  const scoreSide = side => {
    const s = scores.find(x=>String(x?.description).toUpperCase()==="CURRENT" && x?.score?.participant===side) || scores.find(x=>x?.score?.participant===side);
    return Number(s?.score?.goals ?? 0);
  };
  return {
    id: fx.id,
    sportmonksId: fx.id,
    source: "SportMonks",
    league_id: fx.league_id || fx.league?.id,
    league: fx.league?.name || leagueLabelFromId(fx.league_id || fx.league?.id),
    leagueGroup: leagueGroupFromId(fx.league_id || fx.league?.id),
    date: fx.starting_at,
    status: fx.state?.name || fx.state?.state || fx.state?.short_name || "",
    state_id: fx.state_id,
    home: { id: home.id, name: home.name || "Mandante", logo: home.image_path || "", score: scoreSide("home") },
    away: { id: away.id, name: away.name || "Visitante", logo: away.image_path || "", score: scoreSide("away") },
    raw: fx
  };
}

app.get("/api/my-leagues", (req,res)=>{
  res.json({ ok:true, leagues: DHUNIOR_MY_LEAGUES, ids: DHUNIOR_MY_LEAGUE_IDS });
});

app.get("/api/my-leagues/fixtures", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const date = (req.query.date || today()).slice(0,10);
    const include = "participants;scores;state;league;venue";
    const raw = await sm(`/fixtures/date/${date}?include=${include}`);
    const arr = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
    const fixtures = arr
      .filter(fx => isDhuniorLeagueId(fx.league_id || fx.league?.id))
      .map(normalizeMyLeagueFixture);
    const counts = {};
    for(const g of fixtures){
      const k = g.leagueGroup;
      counts[k] = (counts[k] || 0) + 1;
    }
    res.json({ ok:true, date, subscribedLeagueIds: DHUNIOR_MY_LEAGUE_IDS, total: fixtures.length, counts, fixtures });
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message || e)});
  }
});

app.get("/api/my-leagues/audit", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const date = (req.query.date || today()).slice(0,10);
    const include = "participants;scores;state;league";
    const raw = await sm(`/fixtures/date/${date}?include=${include}`);
    const arr = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
    const found = {};
    for(const l of DHUNIOR_MY_LEAGUES){
      found[l.id] = { ...l, count: 0, fixtures: [] };
    }
    for(const fx of arr){
      const lid = Number(fx.league_id || fx.league?.id);
      if(found[lid]){
        found[lid].count++;
        found[lid].fixtures.push({ id: fx.id, name: fx.name, date: fx.starting_at, state: fx.state?.name || fx.state?.state || "" });
      }
    }
    res.json({ ok:true, date, found: Object.values(found), totalFromSubscribed: Object.values(found).reduce((s,x)=>s+x.count,0) });
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message || e)});
  }
});


/* =========================
   V49 - SPORTMONKS STATISTICS CORE
   Usa a camada avançada da SportMonks:
   - /statistics/seasons/{participant}/{id}
   - /statistics/stages/{stageId}
   - /statistics/rounds/{roundId}
   - /topscorers/seasons/{seasonId}
   - /my/filters/entity
   ========================= */

const DHUNIOR_STAT_TYPE_HINTS = {
  52: "Gols",
  88: "Finalizações",
  86: "Chutes no gol",
  34: "Assistências",
  118: "Nota média",
  119: "Minutos",
  80: "Passes",
  116: "Passes certos",
  117: "Passes errados",
  1584: "Precisão de passe",
  84: "Cartões amarelos",
  83: "Cartões vermelhos",
  575: "Participante destaque",
  574: "Total"
};

function statValueToNumberV49(value){
  if(value == null) return null;
  if(typeof value === "number") return value;
  if(typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  if(typeof value === "object"){
    if(value.total != null) return Number(value.total);
    if(value.count != null) return Number(value.count);
    if(value.average != null) return Number(value.average);
    if(value.all != null) return Number(value.all);
    if(value.goals != null) return Number(value.goals);
  }
  return null;
}

function normalizeStatisticDetailsV49(details){
  const arr = Array.isArray(details) ? details : Array.isArray(details?.data) ? details.data : [];
  return arr.map(d => ({
    id: d.id,
    type_id: d.type_id,
    name: d.type?.name || d.type?.developer_name || DHUNIOR_STAT_TYPE_HINTS[d.type_id] || `Tipo ${d.type_id}`,
    raw_value: d.value,
    value: statValueToNumberV49(d.value),
    participant_id: d.value?.participant_id || d.relation_id || null,
    participant_name: d.value?.participant_name || null
  }));
}

async function smPagedV49(path, maxPages=3){
  let page = 1;
  let all = [];
  let last = null;
  while(page <= maxPages){
    const sep = path.includes("?") ? "&" : "?";
    const res = await sm(`${path}${sep}page=${page}`);
    last = res;
    const data = Array.isArray(res?.data) ? res.data : Array.isArray(res) ? res : [];
    all.push(...data);
    const hasMore = !!(res?.pagination?.has_more || res?.meta?.pagination?.has_more);
    if(!hasMore) break;
    page++;
  }
  return { data: all, raw: last };
}

app.get("/api/sportmonks/filters", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const raw = await sm(`/my/filters/entity`);
    res.json({ok:true, data: raw?.data || raw});
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message || e)});
  }
});

app.get("/api/statistics/stage/:stageId", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const stageId = req.params.stageId;
    const include = req.query.include || "type";
    const raw = await smPagedV49(`/statistics/stages/${stageId}?include=${include}&per_page=50`, 5);
    const stats = raw.data.map(s => ({
      id: s.id,
      model_id: s.model_id,
      type_id: s.type_id,
      name: s.type?.name || s.type?.developer_name || DHUNIOR_STAT_TYPE_HINTS[s.type_id] || `Tipo ${s.type_id}`,
      relation_id: s.relation_id,
      value: s.value,
      numeric: statValueToNumberV49(s.value),
      participant_id: s.value?.participant_id || s.relation_id || null,
      participant_name: s.value?.participant_name || null
    }));
    res.json({ok:true, stageId, total:stats.length, stats, raw:raw.data});
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message || e)});
  }
});

app.get("/api/statistics/round/:roundId", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const roundId = req.params.roundId;
    const include = req.query.include || "type";
    const raw = await smPagedV49(`/statistics/rounds/${roundId}?include=${include}&per_page=50`, 5);
    const stats = raw.data.map(s => ({
      id: s.id,
      model_id: s.model_id,
      type_id: s.type_id,
      name: s.type?.name || s.type?.developer_name || DHUNIOR_STAT_TYPE_HINTS[s.type_id] || `Tipo ${s.type_id}`,
      relation_id: s.relation_id,
      value: s.value,
      numeric: statValueToNumberV49(s.value),
      participant_id: s.value?.participant_id || s.relation_id || null,
      participant_name: s.value?.participant_name || null
    }));
    res.json({ok:true, roundId, total:stats.length, stats, raw:raw.data});
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message || e)});
  }
});

app.get("/api/statistics/season/:participant/:seasonId", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const {participant, seasonId} = req.params;
    const include = req.query.include || "player;team;position";
    const raw = await smPagedV49(`/statistics/seasons/${participant}/${seasonId}?include=${include}&per_page=50`, 6);
    const rows = raw.data.map(s => ({
      id: s.id,
      player_id: s.player_id,
      team_id: s.team_id,
      season_id: s.season_id,
      position_id: s.position_id,
      jersey_number: s.jersey_number,
      player: s.player?.display_name || s.player?.name || s.player?.common_name || "",
      team: s.team?.name || "",
      position: s.position?.name || "",
      details: normalizeStatisticDetailsV49(s.details)
    }));
    res.json({ok:true, participant, seasonId, total:rows.length, rows, raw:raw.data});
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message || e)});
  }
});

app.get("/api/topscorers/season/:seasonId", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const seasonId = req.params.seasonId;
    const include = req.query.include || "player.nationality;player.position;participant;type;season.league";
    const filters = req.query.filters ? `&filters=${encodeURIComponent(req.query.filters)}` : "";
    const raw = await smPagedV49(`/topscorers/seasons/${seasonId}?include=${include}${filters}&per_page=50`, 5);
    const rows = raw.data.map(x => ({
      id: x.id,
      season_id: x.season_id,
      player_id: x.player_id,
      team_id: x.participant_id || x.team_id,
      position: x.position,
      total: x.total,
      type: x.type?.name || x.type?.developer_name || "",
      player: x.player?.display_name || x.player?.name || x.player?.common_name || "",
      team: x.participant?.name || "",
      nationality: x.player?.nationality?.name || ""
    }));
    res.json({ok:true, seasonId, total:rows.length, rows, raw:raw.data});
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message || e)});
  }
});


/* =========================
   V50 - FIXTURE PERFECT INCLUDES
   Aplicação direta do que o usuário trouxe da documentação SportMonks:
   - nested includes com ponto: events.player, lineups.player.country, statistics.type
   - filtros dinâmicos corretos: eventTypes / fixtureStatisticTypes
   - escalação separada por participants.meta.location e lineups.team_id
   - estatísticas reais da fixture por participant_id/location
   ========================= */

const DHUNIOR_CORE_STAT_TYPES_V50 = {
  42: "Finalizações",
  86: "Chutes no gol",
  34: "Escanteios",
  45: "Posse de bola",
  52: "Gols",
  41: "Chutes fora",
  58: "Chutes bloqueados",
  43: "Ataques",
  44: "Ataques perigosos",
  56: "Faltas",
  78: "Desarmes",
  80: "Passes",
  81: "Passes certos",
  82: "Precisão de passe",
  84: "Cartões amarelos",
  83: "Cartões vermelhos",
  51: "Impedimentos",
  57: "Defesas",
  59: "Substituições"
};

function arrV50(x){
  if(Array.isArray(x)) return x;
  if(Array.isArray(x?.data)) return x.data;
  return [];
}

function valV50(st){
  const d = st?.data || st?.value || {};
  if(typeof d === "number") return d;
  if(d.value !== undefined) return d.value;
  if(d.total !== undefined) return d.total;
  if(d.count !== undefined) return d.count;
  return null;
}

function participantSidesV50(fixture){
  const participants = arrV50(fixture.participants);
  const home = participants.find(p => p?.meta?.location === "home") || participants.find(p => p?.meta?.position === 1) || participants[0] || null;
  const away = participants.find(p => p?.meta?.location === "away") || participants.find(p => p?.meta?.position === 2) || participants[1] || null;
  return {home, away, participants};
}

function normalizeStatsV50(fixture){
  const {home, away} = participantSidesV50(fixture);
  const stats = arrV50(fixture.statistics);
  const byType = {};
  for(const st of stats){
    const id = st.type_id;
    const name = st.type?.name || st.type?.developer_name || DHUNIOR_CORE_STAT_TYPES_V50[id] || `Tipo ${id}`;
    if(!byType[id]) byType[id] = {type_id:id, name, home:null, away:null, raw:[]};
    const v = valV50(st);
    if(st.participant_id && home?.id && Number(st.participant_id) === Number(home.id)) byType[id].home = v;
    else if(st.participant_id && away?.id && Number(st.participant_id) === Number(away.id)) byType[id].away = v;
    else if(st.location === "home") byType[id].home = v;
    else if(st.location === "away") byType[id].away = v;
    byType[id].raw.push(st);
  }
  const preferred = [42,86,34,45,52,41,58,43,44,56,78,80,81,82,84,83,51,57,59];
  return Object.values(byType).sort((a,b)=>{
    const ia = preferred.indexOf(Number(a.type_id)); const ib = preferred.indexOf(Number(b.type_id));
    return (ia<0?999:ia) - (ib<0?999:ib);
  });
}

function normalizeEventsV50(fixture){
  const {home, away} = participantSidesV50(fixture);
  return arrV50(fixture.events).map(e => ({
    id:e.id,
    minute:e.minute,
    extra_minute:e.extra_minute,
    type_id:e.type_id,
    type:e.type?.name || e.type?.developer_name || (e.type_id===14?"Gol":e.type_id===18?"Substituição":`Tipo ${e.type_id}`),
    team_id:e.participant_id,
    side: Number(e.participant_id)===Number(home?.id) ? "home" : Number(e.participant_id)===Number(away?.id) ? "away" : null,
    player:e.player?.display_name || e.player?.name || e.player_name || "",
    related_player:e.related_player?.display_name || e.related_player?.name || e.related_player_name || "",
    result:e.result,
    info:e.info,
    addition:e.addition
  })).sort((a,b)=>(a.minute||0)-(b.minute||0));
}

function normalizeLineupsV50(fixture){
  const {home, away} = participantSidesV50(fixture);
  const rows = arrV50(fixture.lineups).map(l => ({
    id:l.id,
    player_id:l.player_id,
    team_id:l.team_id,
    side: Number(l.team_id)===Number(home?.id) ? "home" : Number(l.team_id)===Number(away?.id) ? "away" : null,
    player_name:l.player?.display_name || l.player?.name || l.player_name || "",
    image_path:l.player?.image_path || "",
    country:l.player?.country?.name || "",
    country_image:l.player?.country?.image_path || "",
    jersey_number:l.jersey_number,
    position_id:l.position_id,
    type_id:l.type_id,
    formation_field:l.formation_field,
    formation_position:l.formation_position,
    is_starting: Number(l.type_id) === 11 || String(l.type?.name||"").toLowerCase().includes("lineup"),
    is_bench: Number(l.type_id) === 12 || String(l.type?.name||"").toLowerCase().includes("bench")
  }));
  return {
    home: rows.filter(x => x.side==="home"),
    away: rows.filter(x => x.side==="away"),
    unknown: rows.filter(x => !x.side),
    all: rows
  };
}

app.get("/api/fixture/full/:fixtureId", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const fixtureId = req.params.fixtureId;
    const include = req.query.include || [
      "participants",
      "league",
      "venue",
      "state",
      "scores",
      "periods",
      "events.type",
      "events.player",
      "lineups.type",
      "lineups.player",
      "lineups.player.country",
      "statistics.type",
      "formations"
    ].join(";");
    const filters = req.query.filters ? `&filters=${encodeURIComponent(req.query.filters)}` : "";
    const raw = await sm(`/fixtures/${fixtureId}?include=${include}${filters}`);
    const fixture = raw?.data || raw;
    const sides = participantSidesV50(fixture);
    const normalized = {
      fixture: {
        id: fixture.id,
        league_id: fixture.league_id,
        season_id: fixture.season_id,
        stage_id: fixture.stage_id,
        round_id: fixture.round_id,
        state_id: fixture.state_id,
        name: fixture.name,
        starting_at: fixture.starting_at,
        result_info: fixture.result_info,
        length: fixture.length
      },
      home: sides.home,
      away: sides.away,
      stats: normalizeStatsV50(fixture),
      events: normalizeEventsV50(fixture),
      lineups: normalizeLineupsV50(fixture),
      formations: arrV50(fixture.formations)
    };
    res.json({ok:true, fixtureId, normalized, raw:fixture});
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message || e)});
  }
});

app.get("/api/fixtures/date/:date/full", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const date = req.params.date;
    const include = req.query.include || "participants;league;state;scores;events.type;events.player;statistics.type;lineups.type;lineups.player;lineups.player.country";
    const filters = req.query.filters ? `&filters=${encodeURIComponent(req.query.filters)}` : "";
    const raw = await smPagedV49(`/fixtures/date/${date}?include=${include}${filters}&per_page=50`, 6);
    const data = raw.data.map(f => {
      const sides = participantSidesV50(f);
      return {
        id:f.id,
        name:f.name,
        league_id:f.league_id,
        season_id:f.season_id,
        stage_id:f.stage_id,
        round_id:f.round_id,
        state_id:f.state_id,
        starting_at:f.starting_at,
        home:sides.home,
        away:sides.away,
        stats: normalizeStatsV50(f),
        events: normalizeEventsV50(f),
        lineups: normalizeLineupsV50(f)
      };
    });
    res.json({ok:true,date,total:data.length,data,raw:raw.data});
  }catch(e){
    res.status(500).json({ok:false,error:String(e.message || e)});
  }
});


/* =========================================================
   V53 - DHUNIORSTATS MATCH CENTRE PRO
   Arquitetura consolidada com base nos estudos SportMonks:
   - cache de /core/types sem usar statistics.type em produção
   - state map oficial
   - event map oficial
   - lineup/position map
   - participants.meta.location como fonte da verdade
   - lineups.team_id, events.participant_id e statistics.participant_id
   - endpoint central /api/match-centre-pro/:fixtureId
   ========================================================= */

const MC_PRO_CACHE = new Map();
const MC_PRO_TTL_MS = 30 * 1000;
const TYPE_MAP_CACHE = { loadedAt: 0, map: null, raw: [] };
const TYPE_MAP_TTL_MS = 12 * 60 * 60 * 1000;

const STATE_MAP_PRO = {
  1:{code:"NS",name:"Não começou",phase:"pre"},
  2:{code:"INPLAY_1ST_HALF",name:"1º tempo",phase:"live"},
  3:{code:"HT",name:"Intervalo",phase:"live"},
  4:{code:"BREAK",name:"Fim tempo normal / aguardando extra",phase:"live"},
  5:{code:"FT",name:"Encerrado",phase:"post"},
  6:{code:"INPLAY_ET",name:"Prorrogação",phase:"live"},
  7:{code:"AET",name:"Fim da prorrogação",phase:"post"},
  8:{code:"FT_PEN",name:"Fim nos pênaltis",phase:"post"},
  9:{code:"INPLAY_PENALTIES",name:"Pênaltis",phase:"live"},
  10:{code:"POSTPONED",name:"Adiado",phase:"special"},
  11:{code:"SUSPENDED",name:"Suspenso",phase:"special"},
  12:{code:"CANCELLED",name:"Cancelado",phase:"special"},
  13:{code:"TBA",name:"A definir",phase:"pre"},
  14:{code:"WO",name:"W.O.",phase:"post"},
  15:{code:"ABANDONED",name:"Abandonado",phase:"special"},
  16:{code:"DELAYED",name:"Atrasado",phase:"special"},
  17:{code:"AWARDED",name:"Decisão administrativa",phase:"post"},
  18:{code:"INTERRUPTED",name:"Interrompido",phase:"special"},
  19:{code:"AWAITING_UPDATES",name:"Aguardando atualização",phase:"special"},
  20:{code:"DELETED",name:"Deletado",phase:"special"},
  21:{code:"EXTRA_TIME_BREAK",name:"Intervalo da prorrogação",phase:"live"},
  22:{code:"INPLAY_2ND_HALF",name:"2º tempo",phase:"live"},
  25:{code:"PEN_BREAK",name:"Aguardando pênaltis",phase:"live"},
  26:{code:"PENDING",name:"Pendente",phase:"special"}
};

const EVENT_MAP_PRO = {
  10:{icon:"🔍",name:"VAR",group:"var"},
  14:{icon:"⚽",name:"Gol",group:"goal"},
  15:{icon:"🥅",name:"Gol contra",group:"goal"},
  16:{icon:"⚽",name:"Pênalti convertido",group:"goal"},
  17:{icon:"❌",name:"Pênalti perdido",group:"penalty"},
  18:{icon:"🔁",name:"Substituição",group:"sub"},
  19:{icon:"🟨",name:"Cartão amarelo",group:"card"},
  20:{icon:"🟥",name:"Cartão vermelho",group:"card"},
  21:{icon:"🟨🟥",name:"Segundo amarelo",group:"card"},
  22:{icon:"❌",name:"Pênalti perdido",group:"penalty"},
  23:{icon:"⚽",name:"Pênalti convertido",group:"penalty"}
};

const LINEUP_TYPE_MAP_PRO = {
  11:{code:"lineup",name:"Titular"},
  12:{code:"bench",name:"Banco"},
  13:{code:"sidelined",name:"Fora da partida"}
};

const POSITION_MAP_PRO = {
  24:{name:"Goleiro",short:"GOL",line:1},
  25:{name:"Defensor",short:"DEF",line:2},
  26:{name:"Meio-campista",short:"MEI",line:3},
  27:{name:"Atacante",short:"ATA",line:4},
  28:{name:"Desconhecido",short:"?",line:9},
  148:{name:"Zagueiro",short:"ZAG",line:2},
  149:{name:"Volante",short:"VOL",line:3},
  150:{name:"Meia ofensivo",short:"MO",line:3},
  151:{name:"Centroavante",short:"CA",line:4},
  152:{name:"Ponta esquerda",short:"PE",line:4},
  153:{name:"Meia central",short:"MC",line:3},
  154:{name:"Lateral direito",short:"LD",line:2},
  155:{name:"Lateral esquerdo",short:"LE",line:2},
  156:{name:"Ponta direita",short:"PD",line:4},
  157:{name:"Meia esquerdo",short:"ME",line:3},
  158:{name:"Meia direito",short:"MD",line:3},
  163:{name:"Segundo atacante",short:"SA",line:4}
};

const CORE_STAT_IDS_PRO = {
  42:"shotsTotal",
  86:"shotsOnTarget",
  41:"shotsOffTarget",
  58:"shotsBlocked",
  34:"corners",
  45:"possession",
  52:"goals",
  43:"attacks",
  44:"dangerousAttacks",
  56:"fouls",
  78:"tackles",
  80:"passes",
  81:"successfulPasses",
  82:"successfulPassesPercentage",
  84:"yellowCards",
  83:"redCards",
  85:"yellowRedCards",
  51:"offsides",
  57:"saves",
  59:"substitutions",
  49:"shotsInsideBox",
  50:"shotsOutsideBox",
  55:"freeKicks",
  53:"goalKicks",
  47:"penalties",
  64:"woodwork",
  66:"interceptions",
  70:"headers",
  65:"successfulHeaders",
  77:"challenges",
  1527:"counterAttacks",
  5304:"xG",
  5305:"xGoT",
  7939:"xPTS",
  9687:"xGA"
};

const CORE_STAT_LABELS_PRO = {
  shotsTotal:"Finalizações",
  shotsOnTarget:"Chutes no gol",
  shotsOffTarget:"Chutes fora",
  shotsBlocked:"Chutes bloqueados",
  corners:"Escanteios",
  possession:"Posse de bola",
  goals:"Gols",
  attacks:"Ataques",
  dangerousAttacks:"Ataques perigosos",
  fouls:"Faltas",
  tackles:"Desarmes",
  passes:"Passes",
  successfulPasses:"Passes certos",
  successfulPassesPercentage:"Precisão de passe",
  yellowCards:"Cartões amarelos",
  redCards:"Cartões vermelhos",
  yellowRedCards:"Segundo amarelo",
  offsides:"Impedimentos",
  saves:"Defesas",
  substitutions:"Substituições",
  shotsInsideBox:"Chutes dentro da área",
  shotsOutsideBox:"Chutes fora da área",
  freeKicks:"Faltas cobradas",
  goalKicks:"Tiros de meta",
  penalties:"Pênaltis",
  woodwork:"Bola na trave",
  interceptions:"Interceptações",
  headers:"Cabeceios",
  successfulHeaders:"Cabeceios certos",
  challenges:"Disputas",
  counterAttacks:"Contra-ataques",
  xG:"xG",
  xGoT:"xGoT",
  xPTS:"xPTS",
  xGA:"xGA"
};

function proArr(x){ return Array.isArray(x) ? x : Array.isArray(x?.data) ? x.data : []; }
function proObj(x){ return x?.data || x || {}; }
function proNum(x){ const n = Number(x); return Number.isFinite(n) ? n : null; }
function proVal(stat){
  const d = stat?.data ?? stat?.value ?? {};
  if(typeof d === "number") return d;
  if(typeof d === "string" && d.trim() !== "" && !Number.isNaN(Number(d))) return Number(d);
  if(d.value !== undefined) return d.value;
  if(d.total !== undefined) return d.total;
  if(d.count !== undefined) return d.count;
  if(d.average !== undefined) return d.average;
  if(d.all !== undefined) return d.all;
  return null;
}
function proCacheGet(key){
  const v = MC_PRO_CACHE.get(key);
  if(!v) return null;
  if(Date.now() - v.t > MC_PRO_TTL_MS){ MC_PRO_CACHE.delete(key); return null; }
  return v.d;
}
function proCacheSet(key,d){ MC_PRO_CACHE.set(key,{t:Date.now(),d}); return d; }

async function smCore(path){
  if(!SPORTMONKS_KEY) throw new Error("SPORTMONKS_KEY ausente");
  const sep = path.includes("?") ? "&" : "?";
  return fetchJson("https://api.sportmonks.com/v3" + path + sep + "api_token=" + encodeURIComponent(SPORTMONKS_KEY), {
    headers:{Accept:"application/json"}
  });
}

async function getTypeMapPro(){
  if(TYPE_MAP_CACHE.map && Date.now() - TYPE_MAP_CACHE.loadedAt < TYPE_MAP_TTL_MS) return TYPE_MAP_CACHE.map;
  const raw = await smCore("/core/types");
  const rows = proArr(raw.data || raw);
  const map = {};
  for(const t of rows){
    map[Number(t.id)] = {
      id:t.id,
      name:t.name || t.developer_name || t.code || `Tipo ${t.id}`,
      code:t.code || "",
      developer_name:t.developer_name || "",
      model_type:t.model_type || "",
      stat_group:t.stat_group || ""
    };
  }
  // fallback com os tipos que o usuário levantou
  for(const [id,key] of Object.entries(CORE_STAT_IDS_PRO)){
    if(!map[id]) map[id] = {id:Number(id), name:CORE_STAT_LABELS_PRO[key] || key, code:key, developer_name:key.toUpperCase(), model_type:"statistic"};
  }
  TYPE_MAP_CACHE.loadedAt = Date.now();
  TYPE_MAP_CACHE.map = map;
  TYPE_MAP_CACHE.raw = rows;
  return map;
}

function proParticipants(fx){
  const ps = proArr(fx.participants);
  const home = ps.find(p => p?.meta?.location === "home") || ps.find(p => p?.meta?.position === 1) || ps[0] || null;
  const away = ps.find(p => p?.meta?.location === "away") || ps.find(p => p?.meta?.position === 2) || ps[1] || null;
  return {participants:ps, home, away, homeId:proNum(home?.id), awayId:proNum(away?.id)};
}

function proScores(fx){
  const scores = proArr(fx.scores);
  const pick = side =>
    scores.find(s => String(s.description).toUpperCase() === "CURRENT" && s?.score?.participant === side) ||
    scores.find(s => s?.score?.participant === side);
  const h = pick("home"), a = pick("away");
  return {
    home: proNum(h?.score?.goals) ?? 0,
    away: proNum(a?.score?.goals) ?? 0,
    raw:scores
  };
}

function proSideById(id, homeId, awayId){
  const n = proNum(id);
  if(n !== null && n === homeId) return "home";
  if(n !== null && n === awayId) return "away";
  return "unknown";
}

function proNormalizeStats(fx, typeMap, homeId, awayId){
  const raw = proArr(fx.statistics);
  const home = {};
  const away = {};
  const rows = [];
  for(const st of raw){
    const typeId = Number(st.type_id);
    const key = CORE_STAT_IDS_PRO[typeId] || (typeMap[typeId]?.developer_name || typeMap[typeId]?.code || `type_${typeId}`).toString().toLowerCase().replace(/[^a-z0-9]+/g,"_");
    const label = CORE_STAT_LABELS_PRO[key] || typeMap[typeId]?.name || `Tipo ${typeId}`;
    const side = st.location || proSideById(st.participant_id, homeId, awayId);
    const value = proVal(st);
    if(side === "home") home[key] = value;
    if(side === "away") away[key] = value;
    rows.push({type_id:typeId,key,label,side,value,participant_id:st.participant_id,raw:st});
  }
  const preferred = Object.values(CORE_STAT_IDS_PRO);
  const comparison = [...new Set(rows.map(r=>r.key))].map(key => {
    const sample = rows.find(r=>r.key===key);
    return {
      key,
      type_id:sample?.type_id,
      label:CORE_STAT_LABELS_PRO[key] || sample?.label || key,
      home:home[key] ?? null,
      away:away[key] ?? null
    };
  }).sort((a,b)=>{
    const ia = preferred.indexOf(a.key), ib = preferred.indexOf(b.key);
    return (ia<0?999:ia) - (ib<0?999:ib);
  });
  return {home,away,rows,comparison,raw};
}

function proNormalizeEvents(fx, homeId, awayId){
  return proArr(fx.events).map(e=>{
    const map = EVENT_MAP_PRO[Number(e.type_id)] || {};
    return {
      id:e.id,
      minute:e.minute,
      extra_minute:e.extra_minute,
      display_minute: e.extra_minute ? `${e.minute}+${e.extra_minute}` : `${e.minute ?? ""}`,
      type_id:e.type_id,
      type: e.type?.name || e.type?.developer_name || map.name || `Evento ${e.type_id}`,
      icon: map.icon || "•",
      group: map.group || "other",
      side: proSideById(e.participant_id, homeId, awayId),
      team_id:e.participant_id,
      player_id:e.player_id,
      player:e.player?.display_name || e.player?.common_name || e.player?.name || e.player_name || "",
      related_player_id:e.related_player_id,
      related_player:e.related_player?.display_name || e.related_player?.name || e.related_player_name || "",
      result:e.result || "",
      info:e.info || "",
      addition:e.addition || "",
      period_id:e.period_id,
      injured:!!e.injured,
      on_bench:!!e.on_bench
    };
  }).sort((a,b)=>(Number(a.minute)||0)-(Number(b.minute)||0));
}

function proNormalizeLineups(fx, homeId, awayId){
  const all = proArr(fx.lineups).map(l=>{
    const p = l.player || {};
    const typeId = Number(l.type_id);
    const posId = Number(l.position_id || p.position_id || p.detailed_position_id);
    const pos = POSITION_MAP_PRO[posId] || {};
    return {
      id:l.id,
      fixture_id:l.fixture_id,
      player_id:l.player_id || p.id,
      team_id:l.team_id,
      side:proSideById(l.team_id, homeId, awayId),
      player_name:p.display_name || p.common_name || p.name || l.player_name || "",
      image_path:p.image_path || "",
      country:p.country?.name || "",
      country_image:p.country?.image_path || "",
      jersey_number:l.jersey_number,
      type_id:typeId,
      lineup_type:LINEUP_TYPE_MAP_PRO[typeId]?.name || (typeId===11?"Titular":typeId===12?"Banco":"Lineup"),
      is_starting:typeId===11 || !!l.formation_field || !!l.formation_position,
      is_bench:typeId===12,
      position_id:posId || l.position_id,
      position:pos.name || l.position?.name || "",
      position_short:pos.short || "",
      position_line:pos.line || 9,
      formation_field:l.formation_field || "",
      formation_position:l.formation_position || null,
      details:proArr(l.details)
    };
  }).filter(p=>p.player_name);
  const split = side => {
    const list = all.filter(p=>p.side===side);
    return {
      starters:list.filter(p=>p.is_starting && !p.is_bench).sort((a,b)=>(a.formation_position||99)-(b.formation_position||99)),
      bench:list.filter(p=>p.is_bench),
      all:list
    };
  };
  return {home:split("home"),away:split("away"),unknown:all.filter(p=>p.side==="unknown"),all};
}

function proNormalizeFormations(fx, homeId, awayId){
  return proArr(fx.formations).map(f=>({
    id:f.id,
    team_id:f.participant_id || f.team_id,
    side:proSideById(f.participant_id || f.team_id, homeId, awayId),
    formation:f.formation || f.name || f.value || "",
    raw:f
  }));
}

function proNormalizeContext(fx, homeId, awayId){
  const sidelined = proArr(fx.sidelined).map(s=>({
    id:s.id,
    team_id:s.participant_id,
    side:proSideById(s.participant_id, homeId, awayId),
    player:s.sideline?.player?.display_name || s.sideline?.player?.name || s.player?.display_name || "",
    type:s.sideline?.type?.name || s.type?.name || s.category || "",
    start_date:s.sideline?.start_date || s.start_date || "",
    games_missed:s.sideline?.games_missed ?? s.games_missed ?? null
  })).filter(s=>s.player || s.type);
  const coaches = proArr(fx.coaches).map(c=>({
    id:c.id,
    team_id:c.participant_id || c.team_id,
    side:proSideById(c.participant_id || c.team_id, homeId, awayId),
    name:c.coach?.display_name || c.coach?.name || c.name || "",
    type:c.type?.name || ""
  })).filter(c=>c.name);
  const metadata = proArr(fx.metadata).map(m=>({type_id:m.type_id,type:m.type?.name || m.type?.developer_name || "", value:m.value || m.data || m}));
  const weather = fx.weatherReport || fx.weatherreport || fx.weather_report || null;
  return {sidelined,coaches,metadata,weather};
}

function proBuildAI(fixture, stats, events, lineups, context){
  const pts = [];
  const hs = stats.home || {}, as = stats.away || {};
  if(hs.shotsTotal !== undefined || as.shotsTotal !== undefined) pts.push(`Finalizações: ${hs.shotsTotal ?? "-"} x ${as.shotsTotal ?? "-"}.`);
  if(hs.shotsOnTarget !== undefined || as.shotsOnTarget !== undefined) pts.push(`Chutes no gol: ${hs.shotsOnTarget ?? "-"} x ${as.shotsOnTarget ?? "-"}.`);
  if(hs.corners !== undefined || as.corners !== undefined) pts.push(`Escanteios: ${hs.corners ?? "-"} x ${as.corners ?? "-"}.`);
  if(hs.possession !== undefined || as.possession !== undefined) pts.push(`Posse: ${hs.possession ?? "-"}% x ${as.possession ?? "-"}%.`);
  if(hs.dangerousAttacks !== undefined || as.dangerousAttacks !== undefined) pts.push(`Ataques perigosos: ${hs.dangerousAttacks ?? "-"} x ${as.dangerousAttacks ?? "-"}.`);
  if(hs.xG !== undefined || as.xG !== undefined) pts.push(`xG: ${hs.xG ?? "-"} x ${as.xG ?? "-"}.`);
  const goals = events.filter(e=>["goal","penalty"].includes(e.group));
  const cards = events.filter(e=>e.group==="card");
  const subs = events.filter(e=>e.group==="sub");
  if(goals.length) pts.push(`${goals.length} gol(s) registrado(s) na timeline.`);
  if(cards.length) pts.push(`${cards.length} cartão(ões) impactando o contexto disciplinar.`);
  if(subs.length) pts.push(`${subs.length} substituição(ões) registradas.`);
  if(lineups.all.length) pts.push(`${lineups.all.length} jogadores de escalação carregados; ${lineups.home.starters.length} titulares mandante e ${lineups.away.starters.length} titulares visitante.`);
  if(context.sidelined.length) pts.push(`${context.sidelined.length} desfalque(s)/suspensão(ões) retornados.`);
  const state = STATE_MAP_PRO[fixture.state_id] || {};
  if(state.phase === "live") pts.push(`Jogo em andamento: ${state.name}.`);
  if(state.phase === "pre") pts.push("Pré-jogo: análise deve priorizar escalação provável/oficial, forma recente e contexto.");
  if(state.phase === "post") pts.push("Pós-jogo: análise deve comparar placar, eventos e volume estatístico.");
  const pressureHome = Number(hs.dangerousAttacks ?? hs.attacks ?? hs.shotsTotal ?? 0);
  const pressureAway = Number(as.dangerousAttacks ?? as.attacks ?? as.shotsTotal ?? 0);
  let headline = "Dados oficiais carregados para leitura contextual.";
  if(pressureHome || pressureAway){
    headline = pressureHome >= pressureAway ? "Mandante aparece com maior volume nos indicadores disponíveis." : "Visitante aparece com maior volume nos indicadores disponíveis.";
  }
  return {headline,points:pts,qualityScore:pts.length};
}

function proCoverage(fx, stats, events, lineups, context){
  return {
    participants:proArr(fx.participants).length,
    statistics:stats.rows.length,
    events:events.length,
    lineups:lineups.all.length,
    homeStarters:lineups.home.starters.length,
    awayStarters:lineups.away.starters.length,
    sidelined:context.sidelined.length,
    coaches:context.coaches.length,
    metadata:context.metadata.length,
    hasWeather:!!context.weather
  };
}

async function buildMatchCentrePro(fixtureId, opts={}){
  const typeMap = await getTypeMapPro();
  const include = opts.include || [
    "participants",
    "league",
    "venue",
    "state",
    "scores",
    "periods",
    "events",
    "events.player",
    "events.relatedPlayer",
    "lineups",
    "lineups.player",
    "lineups.player.country",
    "formations",
    "coaches",
    "sidelined",
    "metadata",
    "statistics"
  ].join(";");
  const filters = opts.filters ? `&filters=${encodeURIComponent(opts.filters)}` : "";
  const raw = await sm(`/fixtures/${fixtureId}?include=${include}${filters}`);
  const fx = proObj(raw);
  const {home,away,homeId,awayId,participants} = proParticipants(fx);
  const score = proScores(fx);
  const state = STATE_MAP_PRO[fx.state_id] || {code:fx.state?.state || "",name:fx.state?.name || "",phase:"unknown"};
  const stats = proNormalizeStats(fx,typeMap,homeId,awayId);
  const events = proNormalizeEvents(fx,homeId,awayId);
  const lineups = proNormalizeLineups(fx,homeId,awayId);
  const formations = proNormalizeFormations(fx,homeId,awayId);
  const context = proNormalizeContext(fx,homeId,awayId);
  const fixture = {
    id:fx.id,
    name:fx.name,
    league_id:fx.league_id,
    league:fx.league?.name || "",
    season_id:fx.season_id,
    stage_id:fx.stage_id,
    round_id:fx.round_id,
    venue:fx.venue?.name || "",
    state_id:fx.state_id,
    state,
    starting_at:fx.starting_at,
    result_info:fx.result_info || "",
    length:fx.length,
    has_odds:!!fx.has_odds,
    home:home ? {id:home.id,name:home.name,logo:home.image_path,meta:home.meta} : null,
    away:away ? {id:away.id,name:away.name,logo:away.image_path,meta:away.meta} : null,
    score
  };
  const ai = proBuildAI(fixture,stats,events,lineups,context);
  return {
    ok:true,
    source:"SportMonks",
    version:"v53-match-centre-pro",
    fixture,
    participants,
    stats,
    events,
    lineups,
    formations,
    context,
    coverage:proCoverage(fx,stats,events,lineups,context),
    ai,
    maps:{
      states:STATE_MAP_PRO,
      events:EVENT_MAP_PRO,
      lineupTypes:LINEUP_TYPE_MAP_PRO,
      positions:POSITION_MAP_PRO
    },
    raw: opts.raw ? fx : undefined
  };
}

app.get("/api/types-map", async (req,res)=>{
  try{
    const map = await getTypeMapPro();
    res.json({ok:true,total:Object.keys(map).length,map,loadedAt:TYPE_MAP_CACHE.loadedAt});
  }catch(e){ res.status(500).json({ok:false,error:String(e.message||e)}); }
});

app.get("/api/match-centre-pro/:fixtureId", async (req,res)=>{
  try{
    if(!SPORTMONKS_KEY) return res.status(400).json({ok:false,error:"SPORTMONKS_KEY ausente"});
    const fixtureId = req.params.fixtureId;
    const key = `mcpro:${fixtureId}:${req.query.filters||""}:${req.query.raw?"raw":""}`;
    const cached = proCacheGet(key);
    if(cached) return res.json({...cached,cached:true});
    const data = await buildMatchCentrePro(fixtureId,{filters:req.query.filters,raw:req.query.raw==="1"});
    proCacheSet(key,data);
    res.json(data);
  }catch(e){ res.status(500).json({ok:false,error:String(e.message||e)}); }
});

app.get("/api/match-centre-pro/resolve/by-game", async (req,res)=>{
  try{
    const home = req.query.home || "";
    const away = req.query.away || "";
    const date = (req.query.date || today()).slice(0,10);
    if(!home || !away) return res.status(400).json({ok:false,error:"Informe home e away"});
    const resolved = await resolveSportMonksFixtureByNames(home,away,date);
    if(!resolved?.id) return res.status(404).json({ok:false,error:"fixture não encontrado",resolved});
    const data = await buildMatchCentrePro(resolved.id,{raw:false});
    res.json({...data,resolved});
  }catch(e){ res.status(500).json({ok:false,error:String(e.message||e)}); }
});

app.listen(PORT, () => console.log("DhuniorStats V36 Diagnóstico rodando na porta " + PORT));
