
const express = require("express");
const fetch = require("node-fetch");
const app = express();
const PORT = process.env.PORT || 3000;

const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";
const SPORTMONKS_KEY = process.env.SPORTMONKS_KEY || "";
const NEWS_API_KEY = process.env.NEWS_API_KEY || "";

app.use(express.static("public"));

const ESPN_LEAGUES = [
  ["bra.1","Brasileirão Série A"],["bra.2","Brasileirão Série B"],
  ["conmebol.libertadores","Libertadores"],["conmebol.sudamericana","Sul-Americana"],
  ["eng.1","Premier League"],["esp.1","La Liga"],["ita.1","Serie A Itália"],
  ["ger.1","Bundesliga"],["fra.1","Ligue 1"],["ned.1","Eredivisie"],
  ["nor.1","Noruega"],["por.1","Portugal"],["ksa.1","Saudita"]
].map(([key,name])=>({key,name}));

const INTERNAL_CONTEXT = {
  rivalries: [
    ["Palmeiras","Corinthians"],["Palmeiras","Santos"],["São Paulo","Santos"],["São Paulo","Corinthians"],
    ["Athletico-PR","Coritiba"],["Athletico Paranaense","Coritiba"],["Flamengo","Fluminense"],
    ["Flamengo","Vasco"],["Grêmio","Internacional"],["Atlético-MG","Cruzeiro"],
    ["Barcelona","Real Madrid"],["Manchester United","Manchester City"],["Liverpool","Everton"]
  ],
  notes: [
    ["Always Ready","em casa costuma ter vantagem física pela altitude de El Alto"],
    ["Bolívar","em casa costuma ter vantagem física pela altitude de La Paz"],
    ["The Strongest","em casa costuma ter vantagem física pela altitude de La Paz"],
    ["LDU Quito","joga em altitude relevante em Quito"],
    ["Bodo/Glimt","costuma ser equipe forte/ofensiva no contexto da Noruega"]
  ]
};

const isoDate = d => String(d || new Date().toISOString().slice(0,10));
const yyyymmdd = d => isoDate(d).replaceAll("-","");
const norm = s => String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]/g,"");
const gameKey = (h,a) => norm(h)+"_"+norm(a);
const num = v => { const n = Number(String(v ?? "").replace("%","").trim()); return isNaN(n) ? 0 : n; };
const avg = arr => arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0;

async function espn(path){
  const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/soccer/" + path, {
    headers: {"User-Agent":"Mozilla/5.0","Accept":"application/json,text/plain,*/*"}
  });
  if(!res.ok) throw new Error("ESPN HTTP " + res.status);
  return res.json();
}

async function apiFootball(path){
  if(!API_FOOTBALL_KEY) throw new Error("API_FOOTBALL_KEY não configurada");
  const res = await fetch("https://v3.football.api-sports.io" + path, {
    headers: {"x-apisports-key": API_FOOTBALL_KEY, "Accept":"application/json"}
  });
  if(!res.ok) throw new Error("API-Football HTTP " + res.status);
  const json = await res.json();
  if(json.errors && Object.keys(json.errors).length) throw new Error(JSON.stringify(json.errors));
  return json;
}

async function safeApi(path){
  try { return await apiFootball(path); }
  catch(e){ return {response:[], error:String(e.message||e)}; }
}

function normalizeEspnGame(event, league){
  const comp = event.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find(c=>c.homeAway==="home") || competitors[0] || {};
  const away = competitors.find(c=>c.homeAway==="away") || competitors[1] || {};
  const type = event.status?.type || {};
  return {
    source:"ESPN", id:event.id, fixtureId:"", leagueId:"", season:"",
    leagueKey:league.key, league:league.name, date:event.date || "",
    time:event.date ? new Date(event.date).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}) : "",
    status:type.description || type.detail || type.name || "", state:type.state || "", live:type.state==="in",
    minute:event.status?.displayClock || "",
    home:{id:"", name:home.team?.displayName || home.team?.name || "", logo:home.team?.logo || "", score:home.score ?? ""},
    away:{id:"", name:away.team?.displayName || away.team?.name || "", logo:away.team?.logo || "", score:away.score ?? ""}
  };
}

function normalizeApiGame(m){
  const f=m.fixture||{}, l=m.league||{}, t=m.teams||{}, g=m.goals||{}, s=f.status||{};
  const short=s.short||"";
  const live=["1H","2H","HT","ET","BT","P","SUSP","INT","LIVE"].includes(short);
  const finished=["FT","AET","PEN"].includes(short);
  return {
    source:"API-Football", id:String(f.id||""), fixtureId:f.id || "",
    leagueId:l.id || "", season:l.season || "", league:l.name || "", date:f.date || "",
    time:f.date ? new Date(f.date).toLocaleString("pt-BR",{timeZone:"America/Sao_Paulo"}) : "",
    status:s.long || short || "", state:live ? "in" : finished ? "post" : "pre", live,
    minute:s.elapsed ? String(s.elapsed)+"'" : "",
    home:{id:t.home?.id || "", name:t.home?.name || "", logo:t.home?.logo || "", score:g.home ?? ""},
    away:{id:t.away?.id || "", name:t.away?.name || "", logo:t.away?.logo || "", score:g.away ?? ""}
  };
}

app.get("/api/health", (req,res)=>res.json({
  ok:true,
  providers:{apiFootball:!!API_FOOTBALL_KEY, espn:true, sportMonks:!!SPORTMONKS_KEY, news:!!NEWS_API_KEY}
}));

app.get("/api/games", async (req,res)=>{
  const date = isoDate(req.query.date);
  const out=[], errors=[];
  try{
    const apiData = await apiFootball(`/fixtures?date=${date}`);
    (apiData.response||[]).forEach(m=>out.push(normalizeApiGame(m)));
  }catch(e){ errors.push({source:"API-Football", error:String(e.message||e)}); }

  await Promise.all(ESPN_LEAGUES.map(async league=>{
    try{
      const data = await espn(`${league.key}/scoreboard?dates=${yyyymmdd(date)}&limit=200`);
      (data.events||[]).forEach(ev=>out.push(normalizeEspnGame(ev, league)));
    }catch(e){ errors.push({source:"ESPN", league:league.name, error:String(e.message||e)}); }
  }));

  const map = new Map();
  for(const g of out){
    const key = gameKey(g.home.name, g.away.name);
    if(!key || key==="_") continue;
    const old = map.get(key);
    if(!old) map.set(key,g);
    else if(g.source==="API-Football") map.set(key,{...old,...g});
  }
  res.json({ok:true,date,total:map.size,games:[...map.values()].sort((a,b)=>new Date(a.date)-new Date(b.date)),errors});
});

function normalizeStats(resp){
  const rows=[];
  (resp||[]).forEach(tb=>{
    const team=tb.team?.name||"";
    (tb.statistics||[]).forEach(s=>rows.push({team,label:s.type||"",value:s.value ?? ""}));
  });
  return rows;
}

function normalizeEvents(events){
  return (events||[]).map(e=>({minute:e.time?.elapsed?String(e.time.elapsed)+"'":"",team:e.team?.name||"",player:e.player?.name||"",type:e.type||"",detail:e.detail||""}));
}

function splitByTeam(stats){
  const teams=[...new Set(stats.map(s=>s.team).filter(Boolean))];
  const home=teams[0]||"Casa", away=teams[1]||"Fora";
  const homeStats={}, awayStats={};
  stats.forEach(s=>{(s.team===home?homeStats:awayStats)[String(s.label).toLowerCase()]=s.value});
  return {home,away,homeStats,awayStats};
}

function find(obj, labels){
  const k=Object.keys(obj).find(k=>labels.some(l=>k.includes(l)));
  return k?obj[k]:"";
}

async function getTeamRecent(teamId, venue, last=10){
  if(!teamId) return [];
  const data = await safeApi(`/fixtures?team=${teamId}&last=${last}`);
  return (data.response||[]).filter(f=>{
    if(!venue) return true;
    const isHome = f.teams?.home?.id == teamId;
    return venue === "home" ? isHome : !isHome;
  }).slice(0,last);
}

function teamRecentSummary(fixtures, teamId){
  const games = fixtures.map(f=>{
    const isHome = f.teams?.home?.id == teamId;
    const gf = isHome ? f.goals?.home : f.goals?.away;
    const ga = isHome ? f.goals?.away : f.goals?.home;
    return {gf:num(gf), ga:num(ga), win:num(gf)>num(ga), draw:num(gf)===num(ga), loss:num(gf)<num(ga)};
  });
  return {
    played:games.length,
    wins:games.filter(g=>g.win).length,
    draws:games.filter(g=>g.draw).length,
    losses:games.filter(g=>g.loss).length,
    goalsForAvg:Number(avg(games.map(g=>g.gf)).toFixed(2)),
    goalsAgainstAvg:Number(avg(games.map(g=>g.ga)).toFixed(2))
  };
}

async function getH2H(homeId, awayId){
  if(!homeId || !awayId) return [];
  const data = await safeApi(`/fixtures/headtohead?h2h=${homeId}-${awayId}&last=10`);
  return data.response || [];
}

async function getStandings(leagueId, season){
  if(!leagueId || !season) return [];
  const data = await safeApi(`/standings?league=${leagueId}&season=${season}`);
  return data.response?.[0]?.league?.standings?.[0] || [];
}

async function getTeamSeasonStats(teamId, leagueId, season){
  if(!teamId || !leagueId || !season) return null;
  const data = await safeApi(`/teams/statistics?team=${teamId}&league=${leagueId}&season=${season}`);
  return data.response || null;
}

async function getPlayerSeasonStats(teamId, leagueId, season){
  if(!teamId || !leagueId || !season) return [];
  const data = await safeApi(`/players?team=${teamId}&league=${leagueId}&season=${season}`);
  return data.response || [];
}

function standingOf(standings, teamId){ return standings.find(s=>s.team?.id == teamId) || null; }

function getInternalNotes(game){
  const home = game?.home?.name || "", away = game?.away?.name || "";
  const notes = [];
  const rivalry = INTERNAL_CONTEXT.rivalries.some(([a,b]) => (norm(a)===norm(home)&&norm(b)===norm(away)) || (norm(a)===norm(away)&&norm(b)===norm(home)));
  if(rivalry) notes.push("Clássico/rivalidade detectado: confiança da análise reduzida.");
  for(const [team,note] of INTERNAL_CONTEXT.notes){
    if(norm(team)===norm(home) || norm(team)===norm(away)) notes.push(`${team}: ${note}.`);
  }
  return {rivalry, notes};
}

function makePregame(game, ctx){
  const home = game.home?.name || "Mandante";
  const away = game.away?.name || "Visitante";
  const base = [];
  let homeScore = 0, awayScore = 0, evidence = 0;

  if(ctx.homeRecent.played >= 3 && ctx.awayRecent.played >= 3){
    evidence++;
    const hPts = ctx.homeRecent.wins*3 + ctx.homeRecent.draws;
    const aPts = ctx.awayRecent.wins*3 + ctx.awayRecent.draws;
    homeScore += hPts; awayScore += aPts;
    base.push(`Forma recente: ${home} ${ctx.homeRecent.wins}V/${ctx.homeRecent.draws}E/${ctx.homeRecent.losses}D; ${away} ${ctx.awayRecent.wins}V/${ctx.awayRecent.draws}E/${ctx.awayRecent.losses}D.`);
  }

  if(ctx.homeHomeRecent.played >= 2 && ctx.awayAwayRecent.played >= 2){
    evidence++;
    const hPts = ctx.homeHomeRecent.wins*3 + ctx.homeHomeRecent.draws;
    const aPts = ctx.awayAwayRecent.wins*3 + ctx.awayAwayRecent.draws;
    homeScore += hPts*1.2; awayScore += aPts*1.2;
    base.push(`Casa/fora: ${home} em casa ${ctx.homeHomeRecent.wins}V/${ctx.homeHomeRecent.draws}E/${ctx.homeHomeRecent.losses}D; ${away} fora ${ctx.awayAwayRecent.wins}V/${ctx.awayAwayRecent.draws}E/${ctx.awayAwayRecent.losses}D.`);
  }

  if(ctx.homeStanding && ctx.awayStanding){
    evidence++;
    const hRank=num(ctx.homeStanding.rank), aRank=num(ctx.awayStanding.rank);
    homeScore += Math.max(0,25-hRank); awayScore += Math.max(0,25-aRank);
    base.push(`Tabela: ${home} está em ${hRank}º; ${away} está em ${aRank}º.`);
  }

  if(ctx.h2h.length >= 3){
    evidence++;
    let hw=0,aw=0,d=0;
    ctx.h2h.forEach(f=>{
      const hId=f.teams?.home?.id, wh=f.teams?.home?.winner, wa=f.teams?.away?.winner;
      if(wh===true){ if(hId==game.home.id) hw++; else aw++; }
      else if(wa===true){ if(hId==game.home.id) aw++; else hw++; }
      else d++;
    });
    homeScore += hw*2+d; awayScore += aw*2+d;
    base.push(`H2H recente: ${home} ${hw} vitória(s), ${away} ${aw} vitória(s), ${d} empate(s).`);
  }

  if(ctx.homeSeasonStats && ctx.awaySeasonStats){
    evidence++;
    const hg=num(ctx.homeSeasonStats.goals?.for?.total?.total), ag=num(ctx.awaySeasonStats.goals?.for?.total?.total);
    const hga=num(ctx.homeSeasonStats.goals?.against?.total?.total), aga=num(ctx.awaySeasonStats.goals?.against?.total?.total);
    homeScore += hg*.25 - hga*.12; awayScore += ag*.25 - aga*.12;
    base.push(`Temporada: ${home} marcou ${hg||"-"} e sofreu ${hga||"-"}; ${away} marcou ${ag||"-"} e sofreu ${aga||"-"}.`);
  }

  const internal = getInternalNotes(game);
  if(internal.notes.length){ evidence++; base.push(...internal.notes); }

  const canAssert = evidence >= 2;
  const leader = homeScore >= awayScore ? home : away;
  let confidence = evidence >= 5 ? "Alta" : evidence >= 3 ? "Moderada" : evidence >= 2 ? "Baixa+" : "Baixa";
  if(internal.rivalry && confidence === "Alta") confidence = "Moderada";

  return {
    hasEnoughData: canAssert,
    confidence,
    evidenceCount:evidence,
    pressureTeam: canAssert ? leader : "",
    reading: canAssert ? `${leader} aparece melhor no contexto pré-jogo com base nos dados disponíveis.` : "Dados reais insuficientes para afirmar tendência pré-jogo.",
    base: base.length ? base : ["Sem base real suficiente para tendência pré-jogo."]
  };
}

function makeLive(stats){
  const t=splitByTeam(stats), hs=t.homeStats, as=t.awayStats;
  const finalHome=num(find(hs,["total shots","shots total"]));
  const finalAway=num(find(as,["total shots","shots total"]));
  const targetHome=num(find(hs,["shots on goal","shots on target"]));
  const targetAway=num(find(as,["shots on goal","shots on target"]));
  const cornerHome=num(find(hs,["corner"]));
  const cornerAway=num(find(as,["corner"]));
  const possHome=num(find(hs,["ball possession","possession"]));
  const possAway=num(find(as,["ball possession","possession"]));
  const has = !!(finalHome||finalAway||targetHome||targetAway||cornerHome||cornerAway||possHome||possAway);
  if(!has) return {
    hasEnoughData:false,confidence:"Baixa",
    reading:"Sem estatísticas ao vivo suficientes para leitura forte.",
    pressureTeam:"",
    finalizations:{home:0,away:0},shotsOnGoal:{home:0,away:0},corners:{home:0,away:0},possession:{home:0,away:0},
    base:["A API não entregou estatísticas ao vivo completas para essa partida."]
  };
  const hp=finalHome*2+targetHome*4+cornerHome*2+possHome*.25;
  const ap=finalAway*2+targetAway*4+cornerAway*2+possAway*.25;
  const leader = hp>=ap ? t.home : t.away;
  return {
    hasEnoughData:true,
    confidence:(finalHome+finalAway+cornerHome+cornerAway)>=10 ? "Alta" : "Moderada",
    reading:`${leader} pressiona mais neste momento com base nas estatísticas ao vivo.`,
    pressureTeam:leader,
    finalizations:{home:finalHome,away:finalAway},
    shotsOnGoal:{home:targetHome,away:targetAway},
    corners:{home:cornerHome,away:cornerAway},
    possession:{home:possHome,away:possAway},
    base:[`Finalizações: ${finalHome} x ${finalAway}.`,`Chutes no gol: ${targetHome} x ${targetAway}.`,`Escanteios: ${cornerHome} x ${cornerAway}.`,`Posse: ${possHome || "-"}% x ${possAway || "-"}%.`]
  };
}

function topShooters(players){
  const rows = [];
  for(const p of players || []){
    const player = p.player?.name || "";
    const stats = p.statistics?.[0] || {};
    const shots = num(stats.shots?.total);
    const on = num(stats.shots?.on);
    const goals = num(stats.goals?.total);
    if(player && (shots || on || goals)) rows.push({player, shots, on, goals});
  }
  return rows.sort((a,b)=>b.shots-a.shots).slice(0,8);
}

async function fetchNewsContext(game){
  if(!NEWS_API_KEY) return {enabled:false, items:[], base:["NEWS_API_KEY não configurada."]};
  try{
    const q = encodeURIComponent(`"${game.home.name}" "${game.away.name}" futebol`);
    const url = `https://newsapi.org/v2/everything?q=${q}&language=pt&sortBy=publishedAt&pageSize=5&apiKey=${NEWS_API_KEY}`;
    const res = await fetch(url);
    const data = await res.json();
    const items = (data.articles||[]).slice(0,5).map(a=>({title:a.title,source:a.source?.name,url:a.url}));
    return {enabled:true, items, base:items.map(a=>`Notícia: ${a.title} (${a.source||"fonte"})`)};
  }catch(e){ return {enabled:true, items:[], base:["Erro ao buscar notícias."]}; }
}

app.get("/api/game-details", async (req,res)=>{
  try{
    const fixtureId=req.query.fixtureId;
    const game=req.query.game?JSON.parse(req.query.game):null;
    let teamStats=[], events=[];

    if(fixtureId){
      const [statsJson, eventsJson] = await Promise.all([
        safeApi(`/fixtures/statistics?fixture=${fixtureId}`),
        safeApi(`/fixtures/events?fixture=${fixtureId}`)
      ]);
      teamStats=normalizeStats(statsJson.response);
      events=normalizeEvents(eventsJson.response);
    }

    let pregame, playersHome=[], playersAway=[], newsContext={items:[],base:["Notícias opcionais."]};

    if(game?.home?.id && game?.away?.id){
      const homeId=game.home.id, awayId=game.away.id, leagueId=game.leagueId, season=game.season;
      const [hr, ar, hhr, aar, h2h, standings, hs, ass, ph, pa, news] = await Promise.all([
        getTeamRecent(homeId,null,10), getTeamRecent(awayId,null,10),
        getTeamRecent(homeId,"home",10), getTeamRecent(awayId,"away",10),
        getH2H(homeId,awayId), getStandings(leagueId,season),
        getTeamSeasonStats(homeId,leagueId,season), getTeamSeasonStats(awayId,leagueId,season),
        getPlayerSeasonStats(homeId,leagueId,season), getPlayerSeasonStats(awayId,leagueId,season),
        fetchNewsContext(game)
      ]);
      playersHome = topShooters(ph);
      playersAway = topShooters(pa);
      newsContext = news;
      pregame = makePregame(game, {
        homeRecent:teamRecentSummary(hr,homeId), awayRecent:teamRecentSummary(ar,awayId),
        homeHomeRecent:teamRecentSummary(hhr,homeId), awayAwayRecent:teamRecentSummary(aar,awayId),
        h2h, homeStanding:standingOf(standings,homeId), awayStanding:standingOf(standings,awayId),
        homeSeasonStats:hs, awaySeasonStats:ass
      });
      if(playersHome.length || playersAway.length) pregame.base.push("Jogadores: principais finalizadores carregados pela API-Football.");
      if(newsContext.enabled && newsContext.base.length) pregame.base.push(...newsContext.base.slice(0,3));
    } else {
      pregame = {hasEnoughData:false,confidence:"Baixa",reading:"Esse jogo não possui IDs suficientes da API-Football para montar contexto real.",base:["Sem IDs de time/competição vindos da API-Football."]};
    }

    const live = makeLive(teamStats);
    const analysis = {
      live, pregame,
      contextSource:"API-Football + ESPN + base interna; SportMonks e Notícias preparados por variável.",
      providers:{apiFootball:!!API_FOOTBALL_KEY,espn:true,sportMonks:!!SPORTMONKS_KEY,news:!!NEWS_API_KEY},
      providerNotes:[SPORTMONKS_KEY ? "SPORTMONKS_KEY configurada, pronto para ativar endpoints do plano." : "SPORTMONKS_KEY não configurada."],
      main: live.hasEnoughData ? live : pregame
    };

    res.json({ok:true,fixtureId:fixtureId||"",teamStats,events,players:{home:playersHome,away:playersAway},news:newsContext.items||[],analysis});
  }catch(e){ res.status(500).json({ok:false,error:String(e.message||e)}); }
});

app.listen(PORT, () => console.log("DhuniorStats V11 Multi-Fontes rodando na porta " + PORT));
