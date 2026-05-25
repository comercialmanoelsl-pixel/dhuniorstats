
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

  const map=new Map();
  for(const g of normalized){
    if(!g.home.name || !g.away.name) continue;
    const k=gameKey(g.home.name,g.away.name,g.date||date);
    map.set(k, mergeGame(map.get(k), g));
  }

  const games=[...map.values()].sort((a,b)=>{
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

  const out=new Map();
  for(const g of normalized){
    if(!g.home.name || !g.away.name) continue;
    const k=gameKey(g.home.name,g.away.name,g.date||date);
    out.set(k, mergeGame(out.get(k), g));
  }
  const games=[...out.values()].sort((a,b)=>new Date(a.date||date)-new Date(b.date||date));
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

  const map=new Map();
  for(const g of normalized){
    if(!g.home?.name || !g.away?.name) continue;
    const k=gameKey(g.home.name,g.away.name,g.date||date);
    map.set(k, mergeGame(map.get(k), g));
  }

  const games=[...map.values()].filter(g=>g.live || g.state==="in").sort((a,b)=>{
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

app.listen(PORT, () => console.log("DhuniorStats V36 Diagnóstico rodando na porta " + PORT));
