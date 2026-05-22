
const express = require("express");
const fetch = require("node-fetch");
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
    const apiFootballId=req.query.apiFootballId || game.apiFootballId || "";
    let stats=null, events=[], lineups=[];

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
    const teamId=req.query.teamId, leagueId=req.query.leagueId, season=req.query.season;
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

app.listen(PORT, () => console.log("DhuniorStats V32.1 rodando na porta " + PORT));
