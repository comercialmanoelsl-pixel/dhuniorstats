
/* =========================
   V55 HOTFIX
   ========================= */

function normalizeFixtureStateV55(f){
  const id = Number(f?.state_id || f?.raw?.state_id || 0);
  const map = {
    1:"PRÉ-JOGO",
    2:"AO VIVO",
    3:"INTERVALO",
    5:"FINALIZADO",
    7:"FINALIZADO",
    8:"PÊNALTIS",
    10:"ADIADO",
    12:"CANCELADO",
    16:"ATRASADO",
    22:"AO VIVO"
  };
  return map[id] || "AGENDADO";
}

function dedupeFixturesV55(list=[]){
  const unique = new Map();

  function score(g){
    const id = Number(g?.state_id || 0);
    if([2,3,22].includes(id)) return 100;
    if([5,7,8].includes(id)) return 50;
    return 10;
  }

  for(const g of list){
    const key = String(g?.id || g?.fixture_id || Math.random());
    const old = unique.get(key);

    if(!old || score(g) > score(old)){
      unique.set(key,g);
    }
  }

  return [...unique.values()];
}


/* =========================
   V54 - Production UX Guard
   ========================= */
let DHUNIOR_APP_CONFIG = {prod:true,debug:false,poll:{liveMs:30000,preMs:90000,postMs:0}};
let DHUNIOR_REFRESH_LOCK = false;
let DHUNIOR_AUTO_TIMER = null;

async function loadAppConfigV54(){
  try{
    const cfg = await fetch(`/api/app-config?_=${Date.now()}`).then(r=>r.json());
    if(cfg?.ok) DHUNIOR_APP_CONFIG = cfg;
  }catch(e){}
  document.documentElement.classList.toggle("prodMode", !!DHUNIOR_APP_CONFIG.prod && !DHUNIOR_APP_CONFIG.debug);
}

function emptyStateV54(title, text, icon="⚽"){
  return `<div class="emptyStateV54">
    <div class="emptyIconV54">${icon}</div>
    <h3>${esc(title)}</h3>
    <p>${esc(text)}</p>
  </div>`;
}

function isLiveStateV54(g){
  const s = String(g?.status || g?.state || g?.fixture?.status?.short || "").toUpperCase();
  const id = Number(g?.state_id || g?.raw?.state_id || 0);
  return [2,3,4,6,9,18,19,21,22,25].includes(id) || /LIVE|1H|2H|HT|ET|PEN|INPLAY|INTERRUPTED|AWAITING/.test(s);
}

function isPreStateV54(g){
  const s = String(g?.status || g?.state || "").toUpperCase();
  const id = Number(g?.state_id || g?.raw?.state_id || 0);
  return [1,13,16,26].includes(id) || /NS|TBA|DELAYED|PENDING|NOT/.test(s);
}

function scheduleAutoRefreshV54(){
  if(DHUNIOR_AUTO_TIMER) clearTimeout(DHUNIOR_AUTO_TIMER);
  if(document.hidden || !selected) return;
  const ms = isLiveStateV54(selected) ? DHUNIOR_APP_CONFIG.poll.liveMs : isPreStateV54(selected) ? DHUNIOR_APP_CONFIG.poll.preMs : 0;
  if(!ms) return;
  DHUNIOR_AUTO_TIMER = setTimeout(async ()=>{
    if(!document.hidden && selected){
      await safeRefreshSelectedV54(false);
      scheduleAutoRefreshV54();
    }
  }, ms);
}

async function safeRefreshSelectedV54(manual=true){
  if(DHUNIOR_REFRESH_LOCK) return;
  DHUNIOR_REFRESH_LOCK = true;
  try{
    if(manual && $("refreshBtnV54")) $("refreshBtnV54").disabled = true;
    if(selected) await loadDetails(selected);
  }finally{
    setTimeout(()=>{
      DHUNIOR_REFRESH_LOCK = false;
      if($("refreshBtnV54")) $("refreshBtnV54").disabled = false;
    }, 2500);
  }
}

document.addEventListener("visibilitychange", scheduleAutoRefreshV54);
loadAppConfigV54();


/* V48 - Ligas contratadas fixas */
const DHUNIOR_MY_LEAGUES_FRONT = [
  { id:648, label:"BR Série A", group:"brasileirao", aliases:["Brasileirão","Brasileirao","Serie A","Série A"] },
  { id:654, label:"Copa do Brasil", group:"copa_do_brasil", aliases:["Copa do Brasil"] },
  { id:8, label:"Premier League", group:"premier", aliases:["Premier League"] },
  { id:1116, label:"Sul-Americana", group:"sudamericana", aliases:["Sul-Americana","Sulamericana","Sudamericana","Copa Sudamericana","Copa Sul-Americana"] },
  { id:1122, label:"Libertadores", group:"libertadores", aliases:["Libertadores","Copa Libertadores"] }
];
function isMyLeagueV48(g){
  const lid = Number(g.league_id || g.leagueId || g.raw?.league_id || g.raw?.league?.id);
  if(DHUNIOR_MY_LEAGUES_FRONT.some(l=>l.id===lid)) return true;
  const league = String(g.league || g.competition || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  return DHUNIOR_MY_LEAGUES_FRONT.some(l => l.aliases.some(a => league.includes(String(a).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""))));
}
function leagueGroupV48(g){
  const lid = Number(g.league_id || g.leagueId || g.raw?.league_id || g.raw?.league?.id);
  const byId = DHUNIOR_MY_LEAGUES_FRONT.find(l=>l.id===lid);
  if(byId) return byId.group;
  const league = String(g.league || g.competition || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const byName = DHUNIOR_MY_LEAGUES_FRONT.find(l => l.aliases.some(a => league.includes(String(a).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,""))));
  return byName?.group || "outros";
}
async function loadMyLeagueFixturesV48(date){
  try{
    const r = await fetch(`/api/my-leagues/fixtures?date=${encodeURIComponent(date)}&_=${Date.now()}`).then(x=>x.json());
    if(r?.ok && Array.isArray(r.fixtures)) return r.fixtures;
  }catch(e){}
  return null;
}


/* =========================
   V47 HARD FIX - LINEUP + NEWS
   - Nunca mais mostra "Time não identificado" bagunçado
   - Se a API não separar time, divide visualmente em 2 colunas seguras
   - Notícias só aparecem quando vierem da SportMonks/endpoint confiável
   ========================= */

function normalizeLineupPlayerV47(p){
  return {
    name: p.name || p.player_name || p.playerName || p.display_name || "",
    number: p.number || p.jersey_number || p.jerseyNumber || "",
    position: p.position || p.pos || p.position_name || "Jogador",
    type: p.type || p.status || "",
    starter: !!(p.starter || /lineup|titular|starter|starting/i.test(String(p.type||p.status||""))),
    bench: !!(p.bench || /bench|banco|substitute/i.test(String(p.type||p.status||""))),
    side: p.side || "",
    team: p.team || p.team_name || "",
    team_id: p.team_id || p.participantId || p.participant_id || ""
  };
}

function splitUnknownLineupV47(players){
  const list = (players || []).map(normalizeLineupPlayerV47).filter(p=>p.name);
  if(!list.length) return {home:[],away:[]};

  // Primeiro tenta separar por texto de time se existir
  const homeName = selected?.home?.name || "";
  const awayName = selected?.away?.name || "";
  let home = list.filter(p => p.side==="home" || sameTeamNameV47(p.team, homeName));
  let away = list.filter(p => p.side==="away" || sameTeamNameV47(p.team, awayName));

  // Se não tiver nenhuma referência confiável, divide por ordem mantendo visual seguro.
  // Isso NÃO afirma que é oficial por time; é apenas fallback visual para não virar bagunça.
  if(!home.length && !away.length){
    const mid = Math.ceil(list.length / 2);
    home = list.slice(0, mid);
    away = list.slice(mid);
  }

  return {home,away};
}

function sameTeamNameV47(a,b){
  const clean = s => String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"");
  const A=clean(a), B=clean(b);
  return !!A && !!B && (A===B || A.includes(B) || B.includes(A));
}

function renderPlayerCardV47(p){
  p = normalizeLineupPlayerV47(p);
  return `<div class="linePlayerCard v47">
    <b>${p.number ? "#"+esc(p.number)+" " : ""}${esc(p.name)}</b>
    <span>${esc(p.position || "Jogador")} · ${esc(p.bench ? "Banco" : "Titular/Lineup")}</span>
  </div>`;
}

function renderLineSectionV47(title, arr){
  const list = arr || [];
  return `<div class="lineSection">
    <h4>${esc(title)} <small>${list.length}</small></h4>
    <div class="lineGrid">${list.map(renderPlayerCardV47).join("") || `<div class="muted">Sem dados.</div>`}</div>
  </div>`;
}

function renderTeamLineupV47(title, subtitle, players){
  players = (players || []).map(normalizeLineupPlayerV47).filter(p=>p.name);
  let starters = players.filter(p=>p.starter && !p.bench);
  let bench = players.filter(p=>p.bench);

  // Se a API não marcou banco/titular, não chuta tática: mostra lista limpa.
  if(!starters.length && !bench.length){
    starters = players.slice(0, 11);
    bench = players.slice(11);
  }

  return `<div class="lineTeam v47">
    <div class="lineTeamHead">${esc(title)} <span>${esc(subtitle)}</span></div>
    ${renderLineSectionV47("Titulares / Lineup", starters)}
    ${renderLineSectionV47("Banco", bench)}
  </div>`;
}

function renderLineupsV47Hard(){
  const groups = details?.lineupGroups;
  const raw = (groups?.all || details?.lineups || []).filter(Boolean);

  function norm(p){
    return {
      name:p.name || p.player_name || p.playerName || "Jogador",
      number:p.number || p.jersey_number || "",
      pos:p.pos || p.position || p.position_short || p.position_name || "",
      type:p.type || p.lineup_type || "",
      side:p.side || "",
      team:p.team || "",
      starter:!!(p.starter || p.is_starting || /lineup|titular|starting|starter/i.test(String(p.type||p.lineup_type||""))),
      bench:!!(p.bench || p.is_bench || /bench|banco|substitute/i.test(String(p.type||p.lineup_type||""))),
      formation_field:p.formation_field || "",
      formation_position:p.formation_position || null,
      image:p.image_path || p.player_image || ""
    };
  }

  let homePlayers = groups?.home?.all || raw.filter(p=>p.side==="home");
  let awayPlayers = groups?.away?.all || raw.filter(p=>p.side==="away");
  const unknown = groups?.unknown || raw.filter(p=>!p.side || p.side==="unknown");

  homePlayers = homePlayers.map(norm).filter(p=>p.name);
  awayPlayers = awayPlayers.map(norm).filter(p=>p.name);

  let warn = "";
  if(!homePlayers.length && !awayPlayers.length && unknown.length){
    const list = unknown.map(norm).filter(p=>p.name);
    const mid = Math.ceil(list.length/2);
    homePlayers = list.slice(0,mid);
    awayPlayers = list.slice(mid);
    warn = `<div class="dataNotice warnV47">A API retornou jogadores sem vínculo 100% seguro com mandante/visitante. Para não embolar, o DhuniorStats separou visualmente em duas colunas.</div>`;
  }

  if(!homePlayers.length && !awayPlayers.length){
    return `<div class="lineupSofaShell">
      <div class="lineupSofaHeader"><b>Escalações</b><span>Carregamento progressivo</span></div>
      <div class="emptyStateV59"><b>Escalação ainda não disponível</b><span>A SportMonks ainda não retornou lineup oficial/provável para esta partida.</span></div>
    </div>`;
  }

  const homeName = selected?.home?.name || "Mandante";
  const awayName = selected?.away?.name || "Visitante";

  function isStarter(p){ return p.starter && !p.bench; }
  function starters(list){
    let s = list.filter(isStarter);
    if(!s.length) s = list.filter(p=>!p.bench).slice(0,11);
    if(!s.length) s = list.slice(0,11);
    return s.slice(0,11);
  }
  const hStart = starters(homePlayers);
  const aStart = starters(awayPlayers);
  const hBench = homePlayers.filter(p=>!hStart.includes(p)).slice(0,16);
  const aBench = awayPlayers.filter(p=>!aStart.includes(p)).slice(0,16);

  function role(p){
    const s=String(p.pos||"").toLowerCase();
    if(s.includes("goal")||s.includes("goleiro")||s==="gk"||s==="gol") return "gk";
    if(s.includes("back")||s.includes("def")||s.includes("zague")||s.includes("lateral")||s==="def") return "def";
    if(s.includes("mid")||s.includes("meio")||s.includes("vol")||s.includes("meia")||s==="mei") return "mid";
    if(s.includes("att")||s.includes("forward")||s.includes("wing")||s.includes("atac")||s.includes("ponta")||s==="ata") return "att";
    return "mid";
  }

  function short(n){
    const parts=String(n||"Jogador").trim().split(/\s+/);
    return (parts.length>1 ? parts[parts.length-1] : parts[0]).slice(0,13);
  }

  function lineNodes(players, side){
    const grouped={gk:[],def:[],mid:[],att:[]};
    players.forEach(p=>grouped[role(p)].push(p));
    const lines=[
      {k:"gk",hx:8,ax:92},
      {k:"def",hx:22,ax:78},
      {k:"mid",hx:38,ax:62},
      {k:"att",hx:48,ax:52}
    ];
    return lines.map(line=>{
      const arr=grouped[line.k];
      if(!arr.length) return "";
      const x=side==="home" ? line.hx : line.ax;
      const step=78/(arr.length+1);
      return arr.map((p,i)=>{
        const y=10+step*(i+1);
        return `<div class="sofaPlayer ${side}" style="left:${x}%;top:${y}%">
          <div class="sofaShirt">${esc(p.number||"")}</div>
          <div class="sofaName">${esc(short(p.name))}</div>
        </div>`;
      }).join("");
    }).join("");
  }

  function bench(title,list){
    return `<div class="sofaBenchCard">
      <div class="sofaBenchTitle">${esc(title)} <small>${list.length}</small></div>
      <div class="sofaBenchList">${list.map(p=>`<div class="sofaBenchItem"><b>${p.number ? "#"+esc(p.number)+" " : ""}${esc(short(p.name))}</b><span>${esc(p.pos||"Banco")}</span></div>`).join("") || `<div class="muted">Banco não retornado.</div>`}</div>
    </div>`;
  }

  return `<div class="lineupSofaShell">
    <div class="lineupSofaHeader">
      <b>Escalações</b>
      <span>${esc(homeName)} à esquerda · ${esc(awayName)} à direita</span>
    </div>
    ${warn}
    <div class="sofaPitch">
      <div class="sofaMid"></div>
      <div class="sofaBox home"></div>
      <div class="sofaBox away"></div>
      <div class="sofaTeamName home">${esc(homeName)}</div>
      <div class="sofaTeamName away">${esc(awayName)}</div>
      ${lineNodes(hStart,"home")}
      ${lineNodes(aStart,"away")}
    </div>
    <div class="sofaBenchWrap">
      ${bench("Banco · "+homeName,hBench)}
      ${bench("Banco · "+awayName,aBench)}
    </div>
  </div>`;
}


function renderNewsV47Hard(){
  const news = details?.news || details?.context?.news || matchCenterData?.context?.news || [];
  const clean = (news || []).filter(n => (n.title || n.text) && !/maior volume|dados oficiais disponíveis|não começou/i.test(String(n.title||n.text||"")));
  if(!clean.length){
    return `<div class="title">Notícias</div>
      <div class="dataNotice">Nenhuma notícia confiável retornada pela SportMonks para esta partida. O DhuniorStats não vai inventar notícia nem usar texto genérico.</div>`;
  }
  return `<div class="title">Notícias</div>
    <div class="newsList">${clean.slice(0,6).map(n=>`<div class="newsCard">
      <b>${esc(n.title || "Notícia")}</b>
      <p>${esc(n.text || "")}</p>
      <small>${esc(n.phase || "SportMonks")}</small>
    </div>`).join("")}</div>`;
}




// V51: integra o endpoint novo /api/fixture/full na tela principal, não só na tela de teste
async function fetchFixtureFullV51(g){
  const id = g?.sportmonksId || selected?.sportmonksId || g?.id;
  if(!id) return null;
  if(fixtureFullCacheV59[id]) return fixtureFullCacheV59[id];
  try{
    const r = await fetch(`/api/fixture/full/${encodeURIComponent(id)}?_=${Date.now()}`).then(x=>x.json());
    if(r?.ok) fixtureFullCacheV59[id] = r;
    return r?.ok ? r : null;
  }catch(e){ return null; }
}
function statKeyV51(name, id){
  const n=String(name||'').toLowerCase();
  if(id==42||n.includes('shots total'))return 'finalizations';
  if(id==86||n.includes('shots on target'))return 'shotsOnGoal';
  if(id==34||n.includes('corner'))return 'corners';
  if(id==45||n.includes('possession'))return 'possession';
  if(id==41||n.includes('off target'))return 'shotsOffGoal';
  if(id==58||n.includes('blocked'))return 'blockedShots';
  if(id==43&&n.includes('attack'))return 'attacks';
  if(id==44||n.includes('dangerous'))return 'dangerousAttacks';
  if(id==56||n.includes('foul'))return 'fouls';
  if(id==78||n.includes('tackle'))return 'tackles';
  if(id==80||n==='passes')return 'passes';
  if(id==81||n.includes('successful passes'))return 'successfulPasses';
  if(id==82||n.includes('percentage'))return 'successfulPassesPercentage';
  if(id==84||n.includes('yellow'))return 'yellowCards';
  if(id==83||n.includes('red'))return 'redCards';
  if(id==51||n.includes('offside'))return 'offsides';
  if(id==57||n.includes('save'))return 'saves';
  return String(name||`type_${id}`).replace(/[^a-zA-Z0-9]+/g,'_');
}
function applyFixtureFullV51(pack){
  if(!pack?.ok || !pack.normalized) return;
  const n=pack.normalized;
  details = details || {};
  if(n.fixture?.id) selected.sportmonksId=n.fixture.id;
  if(n.home){ selected.home.id=n.home.id||selected.home.id; selected.home.name=n.home.name||selected.home.name; selected.home.logo=n.home.image_path||selected.home.logo; }
  if(n.away){ selected.away.id=n.away.id||selected.away.id; selected.away.name=n.away.name||selected.away.name; selected.away.logo=n.away.image_path||selected.away.logo; }

  const homeStats={}, awayStats={}, labels={};
  (n.stats||[]).forEach(st=>{ const k=statKeyV51(st.name, Number(st.type_id)); homeStats[k]=st.home; awayStats[k]=st.away; labels[k]=st.name; });
  if(Object.keys(labels).length) details.stats={available:true,source:'SportMonks fixture/full V51',home:homeStats,away:awayStats,labels};

  details.events=(n.events||[]).map(e=>({id:e.id, minute:e.extra_minute?`${e.minute}+${e.extra_minute}`:e.minute, type:e.type, detail:[e.result,e.info,e.addition].filter(Boolean).join(' · '), team:e.side==='home'?selected.home.name:e.side==='away'?selected.away.name:'', player:e.player||'', related_player:e.related_player||'', side:e.side}));

  const conv=p=>({source:'SportMonks fixture/full V51',status:'official',team:p.side==='home'?selected.home.name:p.side==='away'?selected.away.name:'',side:p.side,participantId:p.team_id,team_id:p.team_id,name:p.player_name,number:p.jersey_number,pos:p.country||'Jogador',type:p.is_bench?'Bench':'Lineup',starter:p.is_starting,bench:p.is_bench,formation_position:p.formation_position,formation_field:p.formation_field});
  const home=(n.lineups?.home||[]).map(conv), away=(n.lineups?.away||[]).map(conv), unknown=(n.lineups?.unknown||[]).map(conv);
  if(home.length || away.length || unknown.length){
    details.lineupGroups={
      mode:(home.length||away.length)?'team-columns':'unknown-safe-list',
      home:{all:home,starters:home.filter(p=>p.starter&&!p.bench),bench:home.filter(p=>p.bench)},
      away:{all:away,starters:away.filter(p=>p.starter&&!p.bench),bench:away.filter(p=>p.bench)},
      unknown:unknown,
      all:[...home,...away,...unknown]
    };
    details.lineups=[...home,...away,...unknown].filter(p=>p.name);
  }
  details.ai=details.ai||{};
  const pts=[];
  if(Object.keys(labels).length) pts.push('Estatísticas reais carregadas pelo endpoint fixture/full.');
  if(details.events?.length) pts.push(`${details.events.length} eventos reais carregados.`);
  if(details.lineups?.length) pts.push(`${details.lineups.length} jogadores de escalação carregados e separados por team_id.`);
  if(pts.length){ details.ai.text='Dados oficiais da SportMonks aplicados nesta partida quando disponíveis.'; details.ai.points=pts; }
}

const $=id=>document.getElementById(id);
const matchFullCache={}; const matchCenterCache={}; let matchCenterData=null; let matchFullData=null; let smComponentData=null; let coverageData=null; let allGames=[], selected=null, details=null, tab="overview", sideTab="ia", quick="", homeMode=true, detailTimer=null, activeLeagueSlug="", listMode="today";
const fixtureFullCacheV59 = {};
let DHUNIOR_AUTO_REFRESH_TIMER_V63 = null;
let DHUNIOR_DETAIL_REFRESH_LOCK_V63 = false;

function gameStableKeyV63(g){
  if(!g) return "";
  return String(g.sportmonksId || g.apiFootballId || g.id || `${g.home?.name||""}_${g.away?.name||""}_${g.date||""}`);
}
function preserveSelectedFromListV63(){
  if(!selected) return;
  const key = gameStableKeyV63(selected);
  const updated = allGames.find(g=>gameStableKeyV63(g)===key);
  if(updated){
    selected = {...selected, ...updated};
  }
}

const favs=()=>JSON.parse(localStorage.getItem("favs")||"[]");
function saveFavs(a){localStorage.setItem("favs",JSON.stringify(a))}
function isFav(name){return favs().includes(name)}
function toggleFav(name){let f=favs();f=f.includes(name)?f.filter(x=>x!==name):[...f,name];saveFavs(f);renderMatches();if(selected)renderScoreboard(selected);if(homeMode)renderHome()}
function esc(s){return String(s??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"}[m]))}
function pct(a,b){a=Number(a)||0;b=Number(b)||0;const t=a+b;return t?Math.round(a/t*100):50}
function logo(t,cls){return t.logo?`<img class="${cls}" src="${esc(t.logo)}">`:`<span class="fallbackLogo">${esc((t.name||"?")[0])}</span>`}
function miniLogo(t){return t.logo?`<img class="miniLogo" src="${esc(t.logo)}">`:`<span class="miniLogo" style="display:inline-grid;place-items:center;font-size:10px;font-weight:900">${esc((t.name||"?")[0])}</span>`}

function setTheme(t){document.body.dataset.theme=t;localStorage.setItem("theme",t);$("lightBtn").classList.toggle("active",t==="light");$("darkBtn").classList.toggle("active",t==="dark")}
$("lightBtn").onclick=()=>setTheme("light");
$("darkBtn").onclick=()=>setTheme("dark");
setTheme(localStorage.getItem("theme")||"light");

function showHome(){homeMode=true;if(detailTimer)clearInterval(detailTimer);$("homeView").style.display="block";$("matchView").style.display="none";renderHome();renderSide()}
function setLive(){
  listMode="live";
  $("filterInput").value="live";
  loadLiveGames();
}
function setFav(){$("filterInput").value="fav";renderMatches();showHome()}

function filteredGames(){
  const q=$("searchInput").value.toLowerCase(), f=$("filterInput").value;
  let games=dedupeFixturesV56(allGames);
  if(quick)games=games.filter(g=>String(g.league||"").toLowerCase().includes(quick.toLowerCase()));
  if(q)games=games.filter(g=>(g.home.name+" "+g.away.name+" "+g.league).toLowerCase().includes(q));
  if(f==="live")games=games.filter(g=>g.live);
  if(f==="pre")games=games.filter(g=>g.state==="pre");
  if(f==="post")games=games.filter(g=>g.state==="post");
  if(f==="fav")games=games.filter(g=>isFav(g.home.name)||isFav(g.away.name));
  return games;
}

function renderHome(){
  const games=filteredGames();
  const live=games.filter(g=>g.live);
  const finished=games.filter(g=>g.state==="post");
  const upcoming=games.filter(g=>g.state==="pre");
  const hot=live[0]||finished[0]||games[0];
  const title = listMode==="finished" ? "Finalizados recentes" : listMode==="live" ? "Jogos ao vivo" : listMode==="search" ? "Resultado da busca" : "Jogos de hoje";
  const sub = listMode==="finished" ? "Últimos jogos encerrados, sem precisar escolher data." : "Placar, estatísticas reais, favoritos e leitura IA sem dados inventados.";
  $("homeView").innerHTML=`<div class="card homeHero">
    <h1 class="homeTitle">${esc(title)}</h1>
    <div class="homeSub">${esc(sub)}</div>
    <div class="homeTabs sofaScroll">
      <button onclick="setLive()">Ao vivo</button>
      <button onclick="setFav()">Favoritos</button>
      <button onclick="loadFinishedGamesV59()">Finalizados</button>
      <button onclick="listMode='today';document.getElementById('filterInput').value='';loadGames()">Hoje</button>
    </div>
    <div class="homeGrid">
      <div class="feature">${hot?`<div class="featureTitle">Jogo em destaque</div><div class="hotGame"><span>${miniLogo(hot.home)} ${esc(hot.home.name)}</span><span class="hotScore">${esc(hot.home.score)} x ${esc(hot.away.score)}</span><span>${miniLogo(hot.away)} ${esc(hot.away.name)}</span></div><br><button class="btn" onclick="openMatchByIdV59('${esc(hot.id)}')">Abrir partida</button>`:`<div class="emptyStateV59"><b>Nenhum jogo encontrado.</b><span>Tente outra busca ou outro filtro.</span></div>`}</div>
      <div class="feature"><div class="featureTitle">Resumo</div><div class="trendItem"><b>${live.length}</b> jogos ao vivo</div><div class="trendItem"><b>${finished.length}</b> finalizados</div><div class="trendItem"><b>${upcoming.length}</b> próximos</div></div>
    </div>
  </div>
  <div class="card section"><div class="sectionTitle">${listMode==="finished"?"✅ Finalizados":"🔥 Jogos em destaque"}</div><div class="compactGrid">${games.slice(0,24).map(g=>`<div class="compactCard" onclick="openMatchByIdV59('${esc(g.id)}')"><small>${esc(g.league)}</small><div class="teamLine"><span class="teamName">${miniLogo(g.home)}${esc(g.home.name)}</span><span class="score">${esc(g.home.score)}</span></div><div class="teamLine"><span class="teamName">${miniLogo(g.away)}${esc(g.away.name)}</span><span class="score">${esc(g.away.score)}</span></div></div>`).join("")||"<div class='emptyStateV59'><b>Sem jogos.</b><span>Nada retornado pelas APIs para este filtro.</span></div>"}</div></div>`;
}

function openMatchByIdV59(id){
  const g = allGames.find(x=>String(x.id)===String(id));
  if(g) openMatch(g);
}

function renderMatches(){
  const games=filteredGames();
  if(!games.length){
    const msg = listMode==="finished" ? "Nenhum jogo finalizado encontrado nos últimos dias." : listMode==="live" ? "Nenhum jogo ao vivo agora." : "Nenhum jogo encontrado.";
    $("matchList").innerHTML=`<div class="dayTitle">Partidas (0)</div><div class="emptyStateV59"><b>${esc(msg)}</b><span>O DhuniorStats não vai deixar a tela branca.</span></div>`;
    if(homeMode)renderHome();
    return;
  }

  const groups = {};
  games.forEach(g=>{
    const k = g.league || "Outras competições";
    if(!groups[k]) groups[k]=[];
    groups[k].push(g);
  });

  $("matchList").innerHTML=`<div class="dayTitle">${listMode==="finished"?"Finalizados recentes":"Partidas"} (${games.length})</div>`+
    Object.entries(groups).map(([league,list])=>`
      <div class="leagueGroupV59">
        <div class="leagueHeaderV59">${esc(league)}</div>
        ${list.map(g=>`<div class="match ${selected&&selected.id===g.id&&!homeMode?"active":""}" data-id="${esc(g.id)}"><small>${esc(g.statusLabel||g.status||"")} ${g.live?'<b style="color:var(--brand)">● AO VIVO</b>':''}</small><div class="teamLine"><span class="teamName">${miniLogo(g.home)}${esc(g.home.name)}</span><span class="score">${esc(g.home.score)}</span></div><div class="teamLine"><span class="teamName">${miniLogo(g.away)}${esc(g.away.name)}</span><span class="score">${esc(g.away.score)}</span></div><small>${esc(g.time||"")}</small></div>`).join("")}
      </div>`).join("");
  document.querySelectorAll(".match").forEach(el=>el.onclick=()=>openMatchByIdV59(el.dataset.id));
  if(homeMode)renderHome();
}
function renderScoreboard(g){
  const status=g.live?"AO VIVO":g.state==="pre"?"PRÉ-JOGO":"FINALIZADO";
  $("scoreboard").innerHTML=`<div class="scoreTop"><div class="comp">${esc(g.league)} · ${esc(g.status||"")}</div><div><button class="btn" onclick="toggleFav('${esc(g.home.name)}')">${isFav(g.home.name)?"★":"☆"} ${esc(g.home.name)}</button> <span class="status">${status}</span></div></div><div class="scoreBody"><div class="mainTeam">${logo(g.home,"mainLogo")}<div class="mainName">${esc(g.home.name)}</div></div><div class="centerScore"><div class="bigScore">${esc(g.home.score)} x ${esc(g.away.score)}</div><div class="minute">${esc(g.minute||"")}</div><div class="comp">${esc(g.time||"")}</div></div><div class="mainTeam">${logo(g.away,"mainLogo")}<div class="mainName">${esc(g.away.name)}</div></div></div><div class="matchTabs">${["overview:Resumo","coverage:Cobertura","stats:Estatísticas","momentum:Momentum","timeline:Timeline","lineups:Escalações","teams:Times","players:Jogadores","ai:Leitura IA","post:Contexto"].map(x=>{let [k,v]=x.split(":");return `<button class="${tab===k?"active":""}" data-tab="${k}">${v}</button>`}).join("")}</div>`;
  document.querySelectorAll(".matchTabs button").forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderScoreboard(selected);renderMainPanel()});
}

function statRows(s){
  if(!s?.available)return `<div class="dataNotice">Estatísticas reais indisponíveis. O DhuniorStats não mostra chute, posse ou escanteio antes da API enviar dados oficiais.</div>`;
  const f=s.home?.finalizations, fa=s.away?.finalizations, t=s.home?.shotsOnGoal, ta=s.away?.shotsOnGoal, c=s.home?.corners, ca=s.away?.corners, p=s.home?.possession, pa=s.away?.possession;
  const rows=[["Finalizações",f,fa],["Chutes no gol",t,ta],["Posse de bola",p!==undefined?p+"%":"",pa!==undefined?pa+"%":""],["Escanteios",c,ca]];
  return `<div class="statsGrid">${rows.map(r=>{const pc=pct(parseFloat(r[1]),parseFloat(r[2]));return `<div class="statRow"><div class="statTop"><span>${esc(r[1]??"-")}</span><span>${esc(r[2]??"-")}</span></div><div class="statLabel">${esc(r[0])}</div><div class="bar"><div class="homeBar" style="width:${pc}%"></div><div class="awayBar" style="width:${100-pc}%"></div></div></div>`}).join("")}</div>`;
}

function momentum(){
  const s=details?.stats;
  if(!s?.available)return `<div class="title">Momentum</div><div class="dataNotice">Momentum real indisponível. Ele só aparece quando houver estatísticas oficiais em tempo real.</div>`;
  const hs=Number(s.home.finalizations||0)*2+Number(s.home.corners||0)*1.5+Number(s.home.possession||0)*.12;
  const as=Number(s.away.finalizations||0)*2+Number(s.away.corners||0)*1.5+Number(s.away.possession||0)*.12;
  let bars=[];for(let i=0;i<12;i++){const cls=hs>=as?(i%4===0?"a":"h"):(i%4===0?"h":"a");bars.push(`<div class="mom ${cls}" style="height:${18+((i%5)+1)*7}px"></div>`)}
  const leader=hs>=as?selected.home.name:selected.away.name;
  return `<div class="title">Momentum</div><div class="momentum">${bars.join("")}</div><div class="base"><div><b>${esc(leader)}</b> tem maior pressão pelos dados disponíveis.</div><div>Verde: mandante. Vermelho: visitante.</div></div>`;
}

function timeline(){
  const ev=details?.events||[];
  if(!ev.length)return `<div class="title">Timeline</div><div class="dataNotice">Eventos reais indisponíveis para esta partida.</div>`;
  return `<div class="title">Timeline</div><div class="timeline">${ev.slice(-16).reverse().map(e=>`<div class="timelineEvent"><div class="ball">${esc(e.minute||"")}</div><div class="eventBody"><b>${esc(e.type||"Evento")}</b><br>${esc(e.detail||"")}<br><small>${esc(e.team||"")} ${e.player?"· "+esc(e.player):""}</small></div></div>`).join("")}</div>`;
}






function renderLineupColumnsV46(){
  const groups = details?.lineupGroups;
  if(!groups || !(groups.home?.all?.length || groups.away?.all?.length || groups.unknown?.length)){
    return `<div class="dataNotice">Escalação oficial ainda não disponível ou não retornada pelas APIs conectadas.</div>
      <button class="smallBtn" onclick="openDiagnosticForSelected()">Diagnosticar esta partida</button>`;
  }
  const playerCard = (p) => `<div class="linePlayerCard">
    <b>${p.number ? "#"+esc(p.number)+" " : ""}${esc(p.name)}</b>
    <span>${esc(p.position || "Jogador")} · ${esc(p.starter ? "Titular" : p.bench ? "Banco" : p.type || "Lineup")}</span>
  </div>`;
  const section = (title, arr) => `<div class="lineSection">
    <h4>${esc(title)} <small>${arr.length}</small></h4>
    <div class="lineGrid">${arr.map(playerCard).join("") || `<div class="muted">Sem dados.</div>`}</div>
  </div>`;
  const homeStarters = groups.home.starters?.length ? groups.home.starters : groups.home.all.filter(p=>!p.bench).slice(0,11);
  const awayStarters = groups.away.starters?.length ? groups.away.starters : groups.away.all.filter(p=>!p.bench).slice(0,11);
  const homeBench = groups.home.bench?.length ? groups.home.bench : groups.home.all.filter(p=>!homeStarters.includes(p));
  const awayBench = groups.away.bench?.length ? groups.away.bench : groups.away.all.filter(p=>!awayStarters.includes(p));
  if(groups.home.all.length || groups.away.all.length){
    return `<div class="lineupV46">
      <div class="lineTeam">
        <div class="lineTeamHead">${esc(selected.home.name)} <span>mandante</span></div>
        ${section("Titulares", homeStarters)}
        ${section("Banco", homeBench)}
      </div>
      <div class="lineTeam">
        <div class="lineTeamHead">${esc(selected.away.name)} <span>visitante</span></div>
        ${section("Titulares", awayStarters)}
        ${section("Banco", awayBench)}
      </div>
    </div>
    <div class="dataNotice">Escalação organizada por time usando team_id/participants da SportMonks. Campo visual só aparece quando a API retorna posição/formação confiável.</div>`;
  }
  return `<div class="dataNotice">A API retornou jogadores, mas sem team_id confiável para separar mandante/visitante.</div>
    <div class="lineupV46"><div class="lineTeam"><div class="lineTeamHead">Jogadores retornados <span>sem time identificado</span></div>${section("Lista segura", groups.unknown || [])}</div></div>`;
}

function renderLineups(){
  return renderLineupsV47Hard();

  const raw=details?.lineups||[];
  const homeName=selected.home?.name||"Mandante";
  const awayName=selected.away?.name||"Visitante";

  if(!raw.length){
    const d=`/diagnostico.html?home=${encodeURIComponent(homeName)}&away=${encodeURIComponent(awayName)}&date=${encodeURIComponent((selected.date||"").slice(0,10))}`;
    $("mainPanel").innerHTML=`<div class="title">Escalações</div>
      <div class="dataNotice">Escalação oficial ainda não disponível ou não retornada para este fixture. Fixture SportMonks: ${esc(selected?.sportmonksId||"-")}.</div>
      <br><button class="btn" onclick="location.href='${d}'">Diagnosticar esta partida</button>`;
    return;
  }

  const normName=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();

  function belongs(p,name){
    const t=normName(p.team);
    const n=normName(name);
    return t && n && (t.includes(n) || n.includes(t));
  }

  function unique(list){
    const seen=new Set();
    return list.filter(p=>{
      const k=`${p.team||""}-${p.number||""}-${normName(p.name)}`;
      if(seen.has(k))return false;
      seen.add(k);
      return true;
    });
  }

  const teamNames=[...new Set(raw.map(p=>String(p.team||"").trim()).filter(Boolean))];

  let homeAll=unique(raw.filter(p=>p.side==="home" || belongs(p,homeName)));
  let awayAll=unique(raw.filter(p=>p.side==="away" || belongs(p,awayName)));

  // Safety: if both sides cannot be matched by explicit team name, DO NOT split blindly.
  const hasTrustedSide = raw.some(p=>p.side==="home") && raw.some(p=>p.side==="away");
  const unsafeTeamMapping = (!hasTrustedSide && (!homeAll.length || !awayAll.length));

  if(unsafeTeamMapping){
    const grouped = {};
    raw.forEach(p=>{
      const k=String(p.team||"Time não identificado").trim() || "Time não identificado";
      if(!grouped[k]) grouped[k]=[];
      grouped[k].push(p);
    });

    const diag=`/diagnostico.html?home=${encodeURIComponent(homeName)}&away=${encodeURIComponent(awayName)}&date=${encodeURIComponent((selected.date||"").slice(0,10))}`;

    $("mainPanel").innerHTML=`
      <div class="title">Escalações</div>
      <div class="dataNotice">
        A API retornou jogadores, mas o DhuniorStats não conseguiu associar com segurança cada jogador ao mandante/visitante.
        Para evitar escalação invertida, o campo visual foi bloqueado nesta partida.
      </div>
      <br>
      <button class="btn" onclick="location.href='${diag}'">Diagnosticar esta partida</button>
      <br><br>
      <div class="grid2">
        ${Object.entries(grouped).map(([team,list])=>`
          <div class="benchCard">
            <div class="sectionTitle">${esc(team)}</div>
            <div class="benchGrid">
              ${unique(list).slice(0,24).map(p=>`<div class="benchItem"><b>#${esc(p.number||"-")} ${esc(p.name||"Jogador")}</b><small>${esc(p.pos||"")} · ${esc(p.type||"")} · ${esc(p.source||"API")}</small></div>`).join("")}
            </div>
          </div>`).join("")}
      </div>`;
    return;
  }

  const starter=x=>{
    const t=normName(x.type);
    return t.includes("titular") || t.includes("starting") || t.includes("lineup") || t.includes("start");
  };

  let homeStarters=unique(homeAll.filter(starter));
  let awayStarters=unique(awayAll.filter(starter));

  if(!homeStarters.length) homeStarters=unique(homeAll).slice(0,11);
  if(!awayStarters.length) awayStarters=unique(awayAll).slice(0,11);

  homeStarters=homeStarters.slice(0,11);
  awayStarters=awayStarters.slice(0,11);

  const homeBench=unique(homeAll.filter(p=>!homeStarters.includes(p))).slice(0,14);
  const awayBench=unique(awayAll.filter(p=>!awayStarters.includes(p))).slice(0,14);

  const officialFormation = details?.formation || details?.homeFormation || details?.awayFormation || "";
  const formationText = officialFormation ? esc(officialFormation) : "formação não informada pela API";

  function shortName(n){
    const parts=String(n||"Jogador").trim().split(/\s+/);
    return (parts.length>1?parts[parts.length-1]:parts[0]).slice(0,12);
  }

  function role(p){
    const pos=normName(p.pos||p.position||"");
    if(pos.includes("goal")||pos.includes("goleiro")||pos==="gk")return "gk";
    if(pos.includes("def")||pos.includes("zague")||pos.includes("back")||pos==="d")return "def";
    if(pos.includes("mid")||pos.includes("meio")||pos==="m")return "mid";
    if(pos.includes("att")||pos.includes("forward")||pos.includes("ata")||pos==="f")return "att";
    return "mid";
  }

  function sortByRole(list){
    const order={gk:0,def:1,mid:2,att:3};
    return [...list].sort((a,b)=>order[role(a)]-order[role(b)]);
  }

  function nodes(players,side){
    const grouped={gk:[],def:[],mid:[],att:[]};
    sortByRole(players).forEach(p=>grouped[role(p)].push(p));

    const lines=[
      {key:"gk",homeX:7,awayX:93},
      {key:"def",homeX:18,awayX:82},
      {key:"mid",homeX:32,awayX:68},
      {key:"att",homeX:43,awayX:57}
    ];

    const out=[];
    lines.forEach(line=>{
      const arr=grouped[line.key];
      if(!arr.length)return;
      const x=side==="home"?line.homeX:line.awayX;
      const spacing=76/(arr.length+1);
      arr.forEach((p,i)=>{
        const y=12+spacing*(i+1);
        out.push(`
          <div class="playerNode" style="left:${x}%;top:${y}%">
            <div class="playerCircle">${esc(p.number||"-")}</div>
            <div class="playerName">${esc(shortName(p.name))}</div>
          </div>
        `);
      });
    });
    return out.join("");
  }

  function benchCard(title,list){
    return `<div class="benchCard">
      <div class="sectionTitle">${esc(title)}</div>
      <div class="benchGrid">
        ${list.length?list.map(p=>`<div class="benchItem"><b>#${esc(p.number||"-")} ${esc(shortName(p.name))}</b><small>${esc(p.pos||"Banco")} · ${esc(p.source||"API")}</small></div>`).join(""):"<div class='dataNotice'>Banco indisponível.</div>"}
      </div>
    </div>`;
  }

  const diag=`/diagnostico.html?home=${encodeURIComponent(homeName)}&away=${encodeURIComponent(awayName)}&date=${encodeURIComponent((selected.date||"").slice(0,10))}`;

  $("mainPanel").innerHTML=`
    <div class="title">Escalações</div>
    <div class="lineupMeta">
      <span class="realBadge">Lineup via API</span>
      <span class="formationPill">${formationText}</span>
      <span class="formationPill">${esc(homeName)} à esquerda · ${esc(awayName)} à direita</span>
      <button class="btn" onclick="location.href='${diag}'">Diagnóstico</button>
    </div>

    <div class="visualPitch">
      <div class="pitchBoxL"></div>
      <div class="pitchBoxR"></div>
      <div class="teamLabel home">${esc(homeName)}</div>
      <div class="teamLabel away">${esc(awayName)}</div>
      ${nodes(homeStarters,"home")}
      ${nodes(awayStarters,"away")}
    </div>

    <div class="dataNotice" style="margin-top:10px">
      Campo visual exibido somente quando o time de cada jogador foi identificado com segurança.
    </div>

    <div class="benchWrap">
      ${benchCard("Banco · "+homeName,homeBench)}
      ${benchCard("Banco · "+awayName,awayBench)}
    </div>
  `;
}



async function resolveSportMonksIdForSelectedGame(g){
  if(g?.sportmonksId) return g.sportmonksId;
  try{
    const date = (g.date || selected?.date || today()).slice(0,10);
    const home = encodeURIComponent(g.home?.name || "");
    const away = encodeURIComponent(g.away?.name || "");
    const r = await fetch(`/api/sm/resolve-fixture?home=${home}&away=${away}&date=${date}&_=${Date.now()}`).then(x=>x.json());
    if(r.ok && r.result?.id){
      g.sportmonksId = r.result.id;
      g.resolvedSportMonksDate = r.result.date;
      g.resolvedSportMonksReverse = r.result.reverse;
      if(selected){
        selected.sportmonksId = r.result.id;
        selected.resolvedSportMonksDate = r.result.date;
        selected.resolvedSportMonksReverse = r.result.reverse;
      }
      return r.result.id;
    }
  }catch(e){}
  return "";
}



async function fetchMatchCenterForGame(g){
  const key = g.sportmonksId || `${g.home?.name}|${g.away?.name}|${g.date}`;
  if(matchCenterCache[key]) return matchCenterCache[key];
  const params = new URLSearchParams();
  if(g.sportmonksId) params.set("fixtureId", g.sportmonksId);
  params.set("home", g.home?.name || "");
  params.set("away", g.away?.name || "");
  params.set("date", (g.date || selected?.date || today()).slice(0,10));
  const data = await fetch(`/api/match-center?${params.toString()}&_=${Date.now()}`).then(r=>r.json());
  if(data.ok){
    matchCenterCache[key]=data;
    if(data.fixture?.id){
      g.sportmonksId = data.fixture.id;
      if(selected) selected.sportmonksId = data.fixture.id;
    }
  }
  return data;
}
function applyMatchCenterToDetails(center){
  if(!center || !center.ok) return;
  matchCenterData = center;
  matchFullData = center;
  if(center.fixture){
    selected.sportmonksId = center.fixture.id || selected.sportmonksId;
    selected.league = center.fixture.league || selected.league;
    selected.status = center.fixture.state || selected.status;
    selected.venue = center.fixture.venue || selected.venue;
    if(center.fixture.home){
      selected.home.id = center.fixture.home.id || selected.home.id;
      selected.home.name = center.fixture.home.name || selected.home.name;
      selected.home.logo = center.fixture.home.logo || selected.home.logo;
      selected.home.score = center.fixture.score?.home ?? selected.home.score;
    }
    if(center.fixture.away){
      selected.away.id = center.fixture.away.id || selected.away.id;
      selected.away.name = center.fixture.away.name || selected.away.name;
      selected.away.logo = center.fixture.away.logo || selected.away.logo;
      selected.away.score = center.fixture.score?.away ?? selected.away.score;
    }
  }
  details = details || {};
  details.stats = {available: !!center.coverage?.statistics, source:"SportMonks match-center", home:center.statistics?.home||{}, away:center.statistics?.away||{}, labels:center.statistics?.labels||{}};
  details.events = (center.events || []).map(e=>({id:e.id, minute:e.extra_minute ? `${e.minute}+${e.extra_minute}` : e.minute, type:e.type, detail:[e.result,e.info,e.addition].filter(Boolean).join(" · "), team:e.side==="home"?selected.home.name:e.side==="away"?selected.away.name:"", player:e.player||"", related_player:e.related_player||"", side:e.side}));
  details.lineupGroups = center.lineups || null;
  details.lineups = (center.lineups?.all || []).map(p=>({source:"SportMonks match-center", status:"official", team:p.side==="home"?selected.home.name:p.side==="away"?selected.away.name:"", side:p.side, participantId:p.team_id, team_id:p.team_id, name:p.name, number:p.number, pos:p.position, type:p.type, starter:p.starter, bench:p.bench, formation_position:p.formation_position, formation_field:p.formation_field, details:p.details||[]})).filter(p=>p.name);
  details.sidelined = center.context?.sidelined || [];
  details.predictions = center.context?.predictions || [];
  details.news = center.context?.news || [];
  details.trends = center.trends || [];
  details.comments = center.comments || [];
  details.formations = center.formations || [];
  details.ai = center.ai || details.ai || {};
}

async function fetchMatchFullForGame(g){
  const key = g.sportmonksId || `${g.home?.name}|${g.away?.name}|${g.date}`;
  if(matchFullCache[key]) return matchFullCache[key];
  const params = new URLSearchParams();
  if(g.sportmonksId) params.set("fixtureId", g.sportmonksId);
  params.set("home", g.home?.name || "");
  params.set("away", g.away?.name || "");
  params.set("date", (g.date || selected?.date || today()).slice(0,10));
  const data = await fetch(`/api/match-full?${params.toString()}&_=${Date.now()}`).then(r=>r.json());
  if(data.ok){
    matchFullCache[key]=data;
    if(data.fixture?.id){
      g.sportmonksId = data.fixture.id;
      if(selected) selected.sportmonksId = data.fixture.id;
    }
  }
  return data;
}
function applyMatchFullToDetails(full){
  if(!full || !full.ok) return;
  matchFullData = full;
  if(full.fixture){
    selected.sportmonksId = full.fixture.id || selected.sportmonksId;
    selected.league = full.fixture.league || selected.league;
    selected.status = full.fixture.state || selected.status;
    selected.venue = full.fixture.venue || selected.venue;
    if(full.fixture.home){
      selected.home.id = full.fixture.home.id || selected.home.id;
      selected.home.name = full.fixture.home.name || selected.home.name;
      selected.home.logo = full.fixture.home.logo || selected.home.logo;
      selected.home.score = full.fixture.score?.home ?? selected.home.score;
    }
    if(full.fixture.away){
      selected.away.id = full.fixture.away.id || selected.away.id;
      selected.away.name = full.fixture.away.name || selected.away.name;
      selected.away.logo = full.fixture.away.logo || selected.away.logo;
      selected.away.score = full.fixture.score?.away ?? selected.away.score;
    }
  }
  details = details || {};
  details.stats = {available: !!full.coverage?.statistics, source:"SportMonks match-full", home: full.statistics?.home || {}, away: full.statistics?.away || {}, labels: full.statistics?.labels || {}};
  details.events = (full.events || []).map(e=>({id:e.id, minute:e.extra_minute ? `${e.minute}+${e.extra_minute}` : e.minute, type:e.type, detail:[e.result,e.info,e.addition].filter(Boolean).join(" · "), team:e.side==="home"?selected.home.name:e.side==="away"?selected.away.name:"", player:e.player || "", related_player:e.related_player || "", side:e.side}));
  details.lineups = (full.lineups || []).map(p=>({source:"SportMonks match-full", status:"official", team:p.side==="home"?selected.home.name:p.side==="away"?selected.away.name:"", side:p.side, participantId:p.team_id, team_id:p.team_id, name:p.name, number:p.number, pos:p.position, type:p.type, formation_position:p.formation_position, formation_field:p.formation_field, details:p.details || []})).filter(p=>p.name);
  details.sidelined = full.sidelined || [];
  details.predictions = full.predictions || [];
  details.trends = full.trends || [];
  details.news = full.news || [];
  details.comments = full.comments || [];
  details.formations = full.formations || [];
  details.ai = full.ai || details.ai || {};
}

function mergeSportMonksComponentsIntoDetails(baseDetails, smd){
  if(!smd || !smd.ok) return baseDetails;
  const out = {...(baseDetails||{})};

  // Score/header correction
  if(smd.fixture){
    if(selected?.home && smd.fixture.home){
      selected.home.id = smd.fixture.home.id || selected.home.id;
      selected.home.name = smd.fixture.home.name || selected.home.name;
      selected.home.logo = smd.fixture.home.logo || selected.home.logo;
      selected.home.score = smd.fixture.score?.home ?? selected.home.score;
    }
    if(selected?.away && smd.fixture.away){
      selected.away.id = smd.fixture.away.id || selected.away.id;
      selected.away.name = smd.fixture.away.name || selected.away.name;
      selected.away.logo = smd.fixture.away.logo || selected.away.logo;
      selected.away.score = smd.fixture.score?.away ?? selected.away.score;
    }
    selected.league = smd.fixture.league || selected.league;
    selected.status = smd.fixture.state || selected.status;
    selected.venue = smd.fixture.venue || selected.venue;
    selected.season = smd.fixture.season_id || selected.season;
    selected.leagueId = smd.fixture.league_id || selected.leagueId;
  }

  // Stats normalized for existing statRows
  const st = smd.statistics || {};
  const hasStats = Object.keys(st.home||{}).length || Object.keys(st.away||{}).length;
  if(hasStats){
    out.stats = {
      available:true,
      source:"SportMonks Components",
      home:{
        finalizations: st.home.shots ?? st.home["Shots Total"] ?? st.home.shotsTotal,
        shotsOffGoal: st.home.shotsOffGoal,
        blockedShots: st.home.blockedShots,
        bigChances: st.home.bigChances,
        tackles: st.home.tackles,
        interceptions: st.home.interceptions,
        duelsWon: st.home.duelsWon,
        crosses: st.home.crosses,
        keyPasses: st.home.keyPasses,
        saves: st.home.saves,
        offsides: st.home.offsides,
        shotsOnGoal: st.home.shotsOnGoal,
        corners: st.home.corners,
        possession: st.home.possession,
        fouls: st.home.fouls,
        yellowCards: st.home.yellowCards,
        redCards: st.home.redCards,
        xg: st.home.xg,
        attacks: st.home.attacks,
        dangerousAttacks: st.home.dangerousAttacks,
        passes: st.home.passes
      },
      away:{
        finalizations: st.away.shots ?? st.away["Shots Total"] ?? st.away.shotsTotal,
        shotsOffGoal: st.away.shotsOffGoal,
        blockedShots: st.away.blockedShots,
        bigChances: st.away.bigChances,
        tackles: st.away.tackles,
        interceptions: st.away.interceptions,
        duelsWon: st.away.duelsWon,
        crosses: st.away.crosses,
        keyPasses: st.away.keyPasses,
        saves: st.away.saves,
        offsides: st.away.offsides,
        shotsOnGoal: st.away.shotsOnGoal,
        corners: st.away.corners,
        possession: st.away.possession,
        fouls: st.away.fouls,
        yellowCards: st.away.yellowCards,
        redCards: st.away.redCards,
        xg: st.away.xg,
        attacks: st.away.attacks,
        dangerousAttacks: st.away.dangerousAttacks,
        passes: st.away.passes
      }
    };
  }

  // Timeline normalized for existing timeline()
  if(Array.isArray(smd.events) && smd.events.length){
    out.events = smd.events.map(e=>({
      id:e.id,
      minute:e.extra_minute ? `${e.minute}+${e.extra_minute}` : e.minute,
      type:e.type || e.code || "Evento",
      detail:[e.result, e.info, e.addition].filter(Boolean).join(" · "),
      team:e.teamSide==="home" ? selected.home.name : e.teamSide==="away" ? selected.away.name : "",
      player:e.player || "",
      related_player:e.related_player || "",
      side:e.teamSide
    }));
  }

  // Lineups normalized for renderLineups
  if(Array.isArray(smd.lineups) && smd.lineups.length){
    out.lineups = smd.lineups.map(p=>({
      source:"SportMonks Components",
      status:"official",
      team: p.side==="home" ? selected.home.name : p.side==="away" ? selected.away.name : "",
      side:p.side,
      participantId:p.participant_id || p.team_id,
      team_id:p.team_id || p.participant_id,
      name:p.name,
      number:p.number,
      pos:p.position,
      type:p.type,
      formation_position:p.formation_position,
      formation_field:p.formation_field,
      details:p.details || []
    })).filter(p=>p.team && p.name);
  }

  out.sidelined = Array.isArray(smd.sidelined) ? smd.sidelined : [];
  out.predictions = Array.isArray(smd.predictions) ? smd.predictions : [];
  out.trends = Array.isArray(smd.trends) ? smd.trends : [];
  out.news = Array.isArray(smd.news) ? smd.news : [];
  out.referees = Array.isArray(smd.referees) ? smd.referees : [];
  out.smFixture = smd.fixture || null;

  // Stronger AI context
  const points = [];
  if(out.stats?.available) points.push("Estatísticas oficiais carregadas via SportMonks Components.");
  if(out.events?.length) points.push(`${out.events.length} eventos reais carregados na timeline.`);
  if(out.lineups?.length) points.push(`${out.lineups.length} jogadores carregados em escalações oficiais/prováveis.`);
  if(out.sidelined?.length) points.push(`${out.sidelined.length} desfalques/suspensões encontrados.`);
  if(out.predictions?.length) points.push(`${out.predictions.length} blocos de prediction disponíveis.`);
  if(out.trends?.length) points.push(`${out.trends.length} tendências/momentum disponíveis.`);
  if(out.news?.length) points.push(`${out.news.length} notícias SportMonks disponíveis.`);
  out.ai = out.ai || {};
  if(points.length){
    out.ai.text = `${selected.away?.name || "Visitante"} e ${selected.home?.name || "Mandante"} agora usam dados reais da SportMonks quando disponíveis.`;
    out.ai.points = points;
  }

  return out;
}

function renderAdvancedStats(){
  const s = details?.stats;
  if(!s?.available) return `<div class="title">Estatísticas</div><div class="dataNotice">Estatísticas reais indisponíveis para esta partida.</div>`;
  const rows = [
    ["Finalizações",s.home.finalizations ?? s.home.shots,s.away.finalizations ?? s.away.shots],
    ["Chutes no gol",s.home.shotsOnGoal,s.away.shotsOnGoal],
    ["Chutes fora",s.home.shotsOffGoal,s.away.shotsOffGoal],
    ["Chutes bloqueados",s.home.blockedShots,s.away.blockedShots],
    ["Escanteios",s.home.corners,s.away.corners],
    ["Posse",s.home.possession!==undefined?s.home.possession+"%":"",s.away.possession!==undefined?s.away.possession+"%":""],
    ["Faltas",s.home.fouls,s.away.fouls],
    ["Cartões amarelos",s.home.yellowCards,s.away.yellowCards],
    ["Cartões vermelhos",s.home.redCards,s.away.redCards],
    ["xG",s.home.xg,s.away.xg],
    ["Big chances",s.home.bigChances,s.away.bigChances],
    ["Ataques",s.home.attacks,s.away.attacks],
    ["Ataques perigosos",s.home.dangerousAttacks,s.away.dangerousAttacks],
    ["Passes",s.home.passes,s.away.passes],
    ["Passes certos",s.home.successfulPasses,s.away.successfulPasses],
    ["Tackles",s.home.tackles,s.away.tackles],
    ["Interceptações",s.home.interceptions,s.away.interceptions],
    ["Duelos vencidos",s.home.duelsWon,s.away.duelsWon],
    ["Cruzamentos",s.home.crosses,s.away.crosses],
    ["Key passes",s.home.keyPasses,s.away.keyPasses],
    ["Impedimentos",s.home.offsides,s.away.offsides],
    ["Defesas",s.home.saves,s.away.saves]
  ].filter(r=>r[1]!==undefined || r[2]!==undefined);
  return `<div class="title">Estatísticas</div><div class="statsGrid">${rows.map(r=>{
    const pc=pct(parseFloat(r[1]),parseFloat(r[2]));
    return `<div class="statRow"><div class="statTop"><span>${esc(r[1]??"-")}</span><span>${esc(r[2]??"-")}</span></div><div class="statLabel">${esc(r[0])}</div><div class="bar"><div class="homeBar" style="width:${pc}%"></div><div class="awayBar" style="width:${100-pc}%"></div></div></div>`;
  }).join("")}</div>`;
}


function renderLiveMomentumV45(){
  const trends = details?.trends || [];
  const comments = details?.comments || [];
  if(!trends.length && !comments.length){
    return `<div class="title">Momentum</div><div class="dataNotice">Momentum/trends oficiais não retornados para esta partida.</div>`;
  }
  const bars = trends.slice(-60).map(t=>{
    const side = t.side==="home" ? "home" : "away";
    const h = Math.max(6, Math.min(80, Number(t.value)||18));
    return `<div class="momBar ${side}" title="${esc(t.type)} ${esc(t.minute||"")} min" style="height:${h}px"></div>`;
  }).join("");
  return `<div class="title">Momentum</div>
    <div class="momentumBars">${bars || "<span class='muted'>Sem trends numéricos.</span>"}</div>
    <div class="title smallTitle">Comentários</div>
    <div class="timelineList">${comments.slice(-20).map(c=>`<div class="eventItem"><b>${esc(c.minute||"")}’</b> ${esc(c.text||c.type||"")}</div>`).join("") || "<div class='dataNotice'>Sem comentários.</div>"}</div>`;
}

function renderSidelinedPanel(){
  const list = details?.sidelined || [];
  const pred = details?.predictions || [];
  const news = details?.news || [];
  return `<div class="title">Base pré-jogo / contexto</div>
    <div class="grid2">
      <div class="infoCard"><b>Desfalques e suspensos</b><div class="base">
        ${list.length?list.map(x=>`<div><b>${esc(x.side==="home"?selected.home.name:selected.away.name)}</b> · ${esc(x.player||x.player_id)} · ${esc(x.type||x.category||"")}</div>`).join(""):"<div>Dados de desfalques ainda não liberados.</div>"}
      </div></div>
      <div class="infoCard"><b>Predictions SportMonks</b><div class="base">
        ${pred.length?pred.slice(0,8).map(x=>`<div>${esc(x.type)} · ${esc(JSON.stringify(x.value).slice(0,90))}</div>`).join(""):"<div>Predictions ainda não liberadas.</div>"}
      </div></div>
    </div>
    <br>
    <div class="infoCard"><b>Notícias SportMonks</b><div class="base">
      ${news.length?news.slice(0,4).map(n=>`<div><b>${esc(n.title||n.phase)}</b><br>${esc(n.text||"").slice(0,350)}</div>`).join("<hr>"):"<div>Notícias ainda não disponíveis.</div>"}
    </div></div>`;
}

function renderMainPanel(){
  if(!selected){$("mainPanel").innerHTML=emptyStateV54("Selecione uma partida","Escolha um jogo na lista para abrir estatísticas, escalações e leitura IA.","📊");return}
  if(!details){$("mainPanel").innerHTML=`<div class="skeleton"></div><br><div class="skeleton"></div><br>${emptyStateV54("Carregando dados da partida","Buscando informações oficiais com segurança, sem repetir chamadas desnecessárias.","⏳")}`;return}
  if(tab==="coverage")renderCoverage();
  else if(tab==="stats")$("mainPanel").innerHTML=renderAdvancedStats();
  else if(tab==="momentum")$("mainPanel").innerHTML=momentum();
  else if(tab==="timeline")$("mainPanel").innerHTML=timeline();
  else if(tab==="livefield")renderLiveField();
  else if(tab==="lineups")$("mainPanel").innerHTML=renderLineups();
  else if(tab==="ai")$("mainPanel").innerHTML=`<div class="title">Leitura IA</div><div class="aiBox"><div class="aiText">${esc(details.ai?.text||"Sem leitura disponível.")}</div></div><br><div class="base">${(details.ai?.points||[]).map(p=>`<div>${esc(p)}</div>`).join("")}</div>`;
  else if(tab==="teams")renderTeamProfile();
  else if(tab==="players")renderPlayersReal();
  else if(tab==="post")$("mainPanel").innerHTML=renderSidelinedPanel();
  else $("mainPanel").innerHTML=`<div class="title">Resumo da partida</div><div class="realBadge">Sem dados inventados</div><br><br><div class="aiBox"><div class="aiText">${esc(details.ai?.text||"Aguardando dados oficiais.")}</div></div><br>${statRows(details.stats)}`;
}

function formatApiFixture(f){const h=f.teams?.home?.name||"",a=f.teams?.away?.name||"";const gh=f.goals?.home??"",ga=f.goals?.away??"";const st=f.fixture?.status?.short||f.fixture?.status?.long||"";return `${h} ${gh} x ${ga} ${a} · ${st}`}
async function renderTeamProfile(){
  $("mainPanel").innerHTML=`<div class="title">Times</div><div class="skeleton"></div>`;
  try{
    const [h,a]=await Promise.all([
      fetch(`/api/team-profile?teamId=${selected.home.id||""}&teamName=${encodeURIComponent(selected.home.name||"")}&leagueId=${selected.leagueId||""}&season=${selected.season||""}`).then(r=>r.json()),
      fetch(`/api/team-profile?teamId=${selected.away.id||""}&teamName=${encodeURIComponent(selected.away.name||"")}&leagueId=${selected.leagueId||""}&season=${selected.season||""}`).then(r=>r.json())
    ]);
    const block=(name,d)=>`<div class="infoCard"><b>${esc(name)}</b><div class="featureTitle">Últimos jogos</div><div class="base">${(d.recent||[]).slice(0,5).map(f=>`<div class="fixtureMini">${esc(formatApiFixture(f))}</div>`).join("")||"<div>Sem dados disponíveis.</div>"}</div></div>`;
    $("mainPanel").innerHTML=`<div class="title">Times</div><div class="grid2">${block(selected.home.name,h)}${block(selected.away.name,a)}</div>`;
  }catch(e){$("mainPanel").innerHTML=`<div class="dataNotice">Perfil dos times indisponível.</div>`}
}
async function renderPlayersReal(){
  $("mainPanel").innerHTML=`<div class="title">Jogadores</div><div class="skeleton"></div>`;
  try{
    const r=await fetch(`/api/team-profile?teamId=${selected.home.id||""}&teamName=${encodeURIComponent(selected.home.name||"")}&leagueId=${selected.leagueId||""}&season=${selected.season||""}`).then(r=>r.json());
    const players=(r.players||[]).slice(0,15);
    if(!players.length){$("mainPanel").innerHTML=`<div class="title">Jogadores</div><div class="dataNotice">Estatísticas reais de jogadores indisponíveis para este time/liga.</div>`;return}
    $("mainPanel").innerHTML=`<div class="title">Jogadores - ${esc(selected.home.name)}</div><div class="playerRow"><b>Jogador</b><b>Gols</b><b>Assists</b></div>${players.map(p=>`<div class="playerRow"><span>${esc(p.player?.name||"-")}</span><span>${esc(p.statistics?.[0]?.goals?.total??"-")}</span><span>${esc(p.statistics?.[0]?.goals?.assists??"-")}</span></div>`).join("")}`;
  }catch(e){$("mainPanel").innerHTML=`<div class="dataNotice">Jogadores indisponíveis.</div>`}
}

function renderSide(){
  if(homeMode){$("sideContent").innerHTML=`<div class="title">DhuniorStats</div><div class="base"><div>Selecione uma partida para ver dados reais.</div></div>`;return}
  if(!details){$("sideContent").innerHTML=`<div class="skeleton"></div>`;return}
  if(sideTab==="ia")$("sideContent").innerHTML=`<div class="title">Leitura IA</div><div class="aiText">${esc(details.ai?.text||"Sem leitura disponível.")}</div>`;
  else if(sideTab==="base")$("sideContent").innerHTML=`<div class="title">Base</div><div class="base">${(details.ai?.points||[]).map(p=>`<div>${esc(p)}</div>`).join("")||"<div>Sem base disponível.</div>"}</div>`;
  else if(sideTab==="events")$("sideContent").innerHTML=`<div class="title">Eventos</div>${(details.events||[]).slice(-14).reverse().map(e=>`<div class="event"><b>${esc(e.minute)}</b><div>${esc(e.type)} · ${esc(e.detail)}<br><small>${esc(e.team)} ${e.player?"· "+esc(e.player):""}</small></div></div>`).join("")||"<div class='dataNotice'>Eventos reais indisponíveis.</div>"}`;
  else if(sideTab==="lineups")renderSideLineups();
  else if(sideTab==="table")loadStandings();
  else if(sideTab==="news")$("sideContent").innerHTML=`<div class="title">Notícias</div><div class="base">${(details.news||[]).slice(0,8).map(n=>`<div>📰 ${esc(n.title)}<br><small>${esc(n.source||"")}</small></div>`).join("")||"<div>Sem notícias encontradas.</div>"}</div>`;
  else $("sideContent").innerHTML=`<div class="dataNotice">Área exibida somente quando houver dados reais.</div>`;
}


function renderSideLineups(){
  const raw=details?.lineups||[];
  if(!raw.length){
    $("sideContent").innerHTML=`<div class="title">Escalações</div><div class="dataNotice">Escalações oficiais ainda indisponíveis.</div>`;
    return;
  }

  const homeName=selected.home?.name||"Mandante";
  const awayName=selected.away?.name||"Visitante";
  const norm=s=>String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  const belongs=(p,name)=>norm(p.team)&&(norm(p.team).includes(norm(name))||norm(name).includes(norm(p.team)));

  let home=raw.filter(p=>belongs(p,homeName));
  let away=raw.filter(p=>belongs(p,awayName));

  if(!home.length && !away.length){
    const half=Math.ceil(raw.length/2);
    home=raw.slice(0,half);
    away=raw.slice(half);
  }

  const short=n=>{
    const parts=String(n||"Jogador").split(/\s+/);
    return (parts.length>1?parts[parts.length-1]:parts[0]).slice(0,14);
  };

  const uniq=list=>{
    const seen=new Set();
    return list.filter(p=>{
      const k=(p.number||"")+"-"+norm(p.name);
      if(seen.has(k))return false;
      seen.add(k);
      return true;
    });
  };

  const group=(title,list)=>`<div class="sideLineupGroup">
    <div class="sideLineupTitle">${esc(title)}</div>
    ${uniq(list).slice(0,14).map(p=>`<div class="sidePlayer"><div class="sideNum">${esc(p.number||"-")}</div><div><div class="sideName">${esc(short(p.name))}</div><div class="sideSub">${esc(p.pos||"")} · ${esc(p.type||"")}</div></div></div>`).join("")}
  </div>`;

  $("sideContent").innerHTML=`<div class="title">Escalações</div>${group(homeName,home)}${group(awayName,away)}`;
}

async function loadStandings(){
  $("sideContent").innerHTML=`<div class="title">Tabela</div><div class="skeleton"></div>`;
  try{
    const d=await fetch(`/api/standings?leagueId=${selected.leagueId||""}&season=${selected.season||""}`).then(r=>r.json());
    const rows=(d.standings||[]).slice(0,12);
    $("sideContent").innerHTML=`<div class="title">Tabela</div>`+(rows.length?`<div class="standRow"><b>#</b><b>Time</b><b>J</b><b>Pts</b><b>SG</b></div>`+rows.map(x=>`<div class="standRow"><span>${x.rank||"-"}</span><span>${esc(x.team?.name||"-")}</span><span>${x.all?.played||"-"}</span><span>${x.points||"-"}</span><span>${x.goalsDiff||"-"}</span></div>`).join(""):"<div class='dataNotice'>Tabela real indisponível para esta competição/temporada.</div>");
  }catch(e){$("sideContent").innerHTML=`<div class="dataNotice">Tabela real indisponível.</div>`}
}
document.querySelectorAll(".sideNav button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".sideNav button").forEach(x=>x.classList.remove("active"));b.classList.add("active");sideTab=b.dataset.side;renderSide()});

async function loadDetails(g, opts={}){
  const silent = !!opts.silent;
  const currentTabBefore = tab;
  selected=g;
  localStorage.setItem("selectedGameKey",`${g.home.name}_${g.away.name}`);

  if(!silent){
    details=null;
    renderScoreboard(g);
    renderMainPanel();
    renderSide();
    renderMatches();
  }else{
    renderScoreboard(g);
    renderMatches();
  }

  if(DHUNIOR_DETAIL_REFRESH_LOCK_V63 && silent) return;
  DHUNIOR_DETAIL_REFRESH_LOCK_V63 = true;

  const gp=encodeURIComponent(JSON.stringify(g));
  try{
    const d=await fetch(`/api/game-details?apiFootballId=${encodeURIComponent(g.apiFootballId||"")}&sportmonksId=${encodeURIComponent(g.sportmonksId||"")}&game=${gp}&_=${Date.now()}`).then(r=>r.json());
    if(!d.ok)throw new Error(d.error);
    details=d;
    matchFullData=null;
    smComponentData=null;
    try{
      const fullV51 = await fetchFixtureFullV51(g);
      if(fullV51?.ok){
        applyFixtureFullV51(fullV51);
        smComponentData = fullV51;
      } else {
        const center = await fetchMatchCenterForGame(g);
        if(center?.ok){
          applyMatchCenterToDetails(center);
          smComponentData = center;
        }
      }
    }catch(_){
      try{
        const center = await fetchMatchCenterForGame(g);
        if(center?.ok){ applyMatchCenterToDetails(center); smComponentData=center; }
      }catch(__){ matchCenterData=null; matchFullData=null; smComponentData=null; }
    }
    try{
      const cd=await fetch(`/api/coverage-match?game=${gp}&_=${Date.now()}`).then(r=>r.json());
      coverageData=cd.ok?cd.data:null;
    }catch(_){coverageData=null}

    tab = currentTabBefore || tab;
    renderScoreboard(selected);
    renderMainPanel();
    renderSide();
    scheduleAutoRefreshV54();
  }catch(e){
    if(!silent) $("mainPanel").innerHTML=emptyStateV54("Não foi possível carregar",""+(e.message||e),"⚠️");
  }finally{
    setTimeout(()=>{ DHUNIOR_DETAIL_REFRESH_LOCK_V63=false; }, 1200);
  }
}
function openMatch(g){
  homeMode=false;$("homeView").style.display="none";$("matchView").style.display="block";
  if(detailTimer)clearInterval(detailTimer);
  loadDetails(g);
  detailTimer=setInterval(()=>{ if(selected && !homeMode) loadDetails(selected,{silent:true}); },30000);
}


async function loadLeagueGames(slug, opts={}){
  activeLeagueSlug=slug||"";
  if(!activeLeagueSlug){ return loadGames(); }
  const date=$("dateInput").value||new Date().toISOString().slice(0,10);
  if(!opts.background) $("matchList").innerHTML=`<div class="empty">Buscando jogos da liga...</div>`;
  try{
    const d=await fetch(`/api/league-games?slug=${encodeURIComponent(activeLeagueSlug)}&date=${date}&_=${Date.now()}`).then(r=>r.json());
    setAllGamesV56(d.games||[]);
    preserveSelectedFromListV63();
    renderMatches();
    if(homeMode) showHome(); else if(selected){ renderScoreboard(selected); renderSide(); }
    if(!allGames.length){
      $("homeView").innerHTML=`<div class="card section"><div class="sectionTitle">${esc(d.label||"Liga")}</div><div class="dataNotice">Nenhum jogo encontrado nesta liga para ${esc(date)} pelas APIs conectadas.</div></div>`;
    }
  }catch(e){
    if(!opts.background) $("matchList").innerHTML=`<div class="empty">Erro ao carregar jogos da liga.</div>`;
  }
}


async function loadLiveGames(opts={}){
  activeLeagueSlug="";
  document.querySelectorAll(".quick button").forEach(x=>x.classList.remove("active"));
  const first=document.querySelector('.quick button[data-slug=""]');
  if(first)first.classList.add("active");
  const date=$("dateInput").value||new Date().toISOString().slice(0,10);
  if(!opts.background) $("matchList").innerHTML=`<div class="empty">Buscando jogos ao vivo...</div>`;
  try{
    const d=await fetch(`/api/live-games?date=${date}&_=${Date.now()}`).then(r=>r.json());
    setAllGamesV56(d.games||[]);
    preserveSelectedFromListV63();
    renderMatches();
    if(homeMode) showHome(); else if(selected){ renderScoreboard(selected); renderSide(); }
    if(!allGames.length){
      $("homeView").innerHTML=`<div class="card section"><div class="sectionTitle">Ao vivo</div><div class="dataNotice">Nenhum jogo ao vivo foi retornado pelas APIs conectadas neste momento.<br><br>Isso pode acontecer quando a liga ao vivo não está coberta no seu plano ou quando o provedor não marca o status como live. Use /api/debug-live para verificar as fontes.</div></div>`;
    }
  }catch(e){
    if(!opts.background) $("matchList").innerHTML=`<div class="empty">Erro ao buscar jogos ao vivo.</div>`;
  }
}

async function searchGames(){
  const q=$("searchInput").value.trim();
  if(!q){ renderMatches(); return; }
  activeLeagueSlug="";
  listMode="search";
  const date=$("dateInput").value||new Date().toISOString().slice(0,10);
  $("matchList").innerHTML=`<div class="empty">Buscando...</div>`;
  try{
    const d=await fetch(`/api/search-games?q=${encodeURIComponent(q)}&date=${date}&_=${Date.now()}`).then(r=>r.json());
    setAllGamesV56(d.games||[]);
    preserveSelectedFromListV63();
    renderMatches();
    if(homeMode) showHome(); else if(selected){ renderScoreboard(selected); renderSide(); }
    if(allGames.length===1) openMatch(allGames[0]);
    if(!allGames.length){
      $("homeView").innerHTML=`<div class="card section"><div class="sectionTitle">Busca</div><div class="dataNotice">Nenhum jogo encontrado para “${esc(q)}”.</div></div>`;
    }
  }catch(e){
    $("matchList").innerHTML=`<div class="empty">Erro na busca.</div>`;
  }
}

async function loadGames(opts={}){
  listMode="today";
  const background = !!opts.background;
  const date=$("dateInput").value||new Date().toISOString().slice(0,10);
  if(!background) $("matchList").innerHTML=`<div class="empty">Buscando jogos...</div>`;
  try{
    const d=await fetch(`/api/games?date=${date}&_=${Date.now()}`).then(r=>r.json());
    setAllGamesV56(d.games||[]);
    preserveSelectedFromListV63();
    renderMatches();
    if(homeMode) showHome();
    else if(selected){
      renderScoreboard(selected);
      renderSide();
    }
  }catch(e){
    if(!background) $("matchList").innerHTML=`<div class="empty">Erro ao carregar jogos.</div>`;
  }
}

async function smartRefreshV63(){
  if(document.hidden) return;
  if(activeLeagueSlug){
    return loadLeagueGames(activeLeagueSlug,{background:true});
  }
  if(listMode==="live"){
    return loadLiveGames({background:true});
  }
  if(listMode==="finished"){
    return loadFinishedGamesV59({background:true});
  }
  return loadGames({background:true});
}


document.querySelectorAll(".quick button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".quick button").forEach(x=>x.classList.remove("active"));b.classList.add("active");quick=b.dataset.q||"";activeLeagueSlug=b.dataset.slug||""; if(activeLeagueSlug) loadLeagueGames(activeLeagueSlug); else loadGames();});
$("dateInput").value=new Date().toISOString().slice(0,10);
$("refreshBtn").onclick=()=>activeLeagueSlug?loadLeagueGames(activeLeagueSlug):loadGames();
$("searchInput").oninput=renderMatches;
$("searchInput").onkeydown=e=>{if(e.key==="Enter")searchGames()};
$("searchBtn").onclick=searchGames;
$("filterInput").onchange=()=>{$("filterInput").value==="post"?loadFinishedGamesV59():renderMatches()};
$("dateInput").onchange=()=>activeLeagueSlug?loadLeagueGames(activeLeagueSlug):loadGames();

loadGames();
if(DHUNIOR_AUTO_REFRESH_TIMER_V63) clearInterval(DHUNIOR_AUTO_REFRESH_TIMER_V63);
DHUNIOR_AUTO_REFRESH_TIMER_V63 = setInterval(smartRefreshV63,45000);


function renderLiveField(){
  if(!details || !selected){
    $("mainPanel").innerHTML = `<div class="card"><div class="dataNotice">Sem partida carregada.</div></div>`;
    return;
  }

  const home = selected.home?.name || "Mandante";
  const away = selected.away?.name || "Visitante";

  const hs = Number(details.stats?.shotsHome || 0);
  const as = Number(details.stats?.shotsAway || 0);
  const psH = Number(details.stats?.possessionHome || 50);

  let ballX = 50;
  if(psH > 60) ballX = 72;
  else if(psH > 52) ballX = 60;
  else if(psH < 40) ballX = 25;
  else if(psH < 48) ballX = 40;

  let label = "Bola no meio";
  if(ballX >= 65) label = `${home} pressionando`;
  if(ballX <= 35) label = `${away} pressionando`;

  if(hs > as + 4){
    ballX = 82;
    label = `${home} em ataque perigoso`;
  }

  if(as > hs + 4){
    ballX = 18;
    label = `${away} em ataque perigoso`;
  }

  $("mainPanel").innerHTML = `
    <div class="title">Campo ao vivo</div>
    <div class="liveField">
      <div class="pitch">
        <div class="goalAreaL"></div>
        <div class="goalAreaR"></div>
        <div class="liveBall" style="left:calc(${ballX}% - 9px);top:calc(50% - 9px)"></div>
      </div>
    </div>

    <div class="possessionBar">
      <div class="attackBadge">${home}</div>
      <div class="attackBadge">${label}</div>
      <div class="attackBadge">${away}</div>
    </div>

    <br>

    <div class="grid2">
      <div class="card">
        <b>Finalizações</b>
        <div>${hs} x ${as}</div>
      </div>

      <div class="card">
        <b>Posse</b>
        <div>${psH}% x ${100-psH}%</div>
      </div>
    </div>
  `;
}


function applyProdChromeV54(){
  const hideWords = ["diagnostico.html","components.html","sportmonks.html","match-full.html","match-center.html","stats-core.html","fixture-full.html"];
  if(!(DHUNIOR_APP_CONFIG.prod && !DHUNIOR_APP_CONFIG.debug)) return;
  document.querySelectorAll("a,button").forEach(el=>{
    const txt = (el.textContent||"").toLowerCase();
    const href = (el.getAttribute("href")||"").toLowerCase();
    const onclick = (el.getAttribute("onclick")||"").toLowerCase();
    if(hideWords.some(w=>href.includes(w)||onclick.includes(w)) || /diagn[oó]stico|debug|raw|components|sportmonks/i.test(txt)){
      el.classList.add("devOnlyV54");
    }
  });
}
setInterval(applyProdChromeV54, 1500);


/* =========================
   V56 FRONT DEDUPE REAL
   ========================= */
function canonicalTeamV56Front(name){
  let n = String(name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const aliases = [
    [/^(ldu quito|liga de quito|ldu de quito|ldu)$/,'ldu quito'],
    [/^(ca lanus|lanus|club atletico lanus)$/,'lanus'],
    [/^(mirassol fc|mirassol)$/,'mirassol'],
    [/^(o higgins|ohiggins)$/,'ohiggins'],
    [/^(sao paulo|sao paulo fc)$/,'sao paulo'],
    [/^(atletico mg|atletico mineiro|atl mineiro)$/,'atletico mineiro'],
    [/^(athletico pr|athletico paranaense|atletico pr)$/,'athletico paranaense']
  ];
  for(const [rx,val] of aliases){ if(rx.test(n)) return val; }
  return n;
}
function canonicalLeagueV56Front(name){
  const n = String(name||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(n.includes('libertadores')) return 'libertadores';
  if(n.includes('sudamericana') || n.includes('sul americana') || n.includes('sulamericana')) return 'sudamericana';
  if(n.includes('brasileir') || n.includes('serie a')) return 'brasileirao';
  if(n.includes('copa do brasil')) return 'copa do brasil';
  return n.replace(/[^a-z0-9]+/g,' ').trim();
}
function fixtureKeyV56Front(g){
  const smid = g?.sportmonksId || (String(g?.id||'').startsWith('sm_') ? String(g.id).slice(3) : '');
  if(smid) return 'sm:' + smid;
  const d = String(g?.date || g?.time || '').slice(0,10);
  const l = canonicalLeagueV56Front(g?.league||'');
  const h = canonicalTeamV56Front(g?.home?.name||'');
  const a = canonicalTeamV56Front(g?.away?.name||'');
  return `sig:${d}:${l}:${h}:${a}`;
}
function dedupeFixturesV56(list=[]){
  const map = new Map();
  const sigToKey = new Map();
  const rank = g => String(g?.source||'').toLowerCase().includes('sportmonks') ? 100 : String(g?.source||'').toLowerCase().includes('api-football') ? 70 : 10;
  const merge = (old,g)=>{
    if(!old) return g;
    const preferred = rank(g) > rank(old) ? g : old;
    return {...old, ...g, home:{...old.home,...g.home,name:preferred.home?.name||g.home?.name||old.home?.name}, away:{...old.away,...g.away,name:preferred.away?.name||g.away?.name||old.away?.name}, league:preferred.league||g.league||old.league};
  };
  for(const g of list){
    if(!g?.home?.name || !g?.away?.name) continue;
    const d = String(g?.date || g?.time || '').slice(0,10);
    const l = canonicalLeagueV56Front(g?.league||'');
    const h = canonicalTeamV56Front(g?.home?.name||'');
    const a = canonicalTeamV56Front(g?.away?.name||'');
    const candidates = [fixtureKeyV56Front(g), `sig:${d}:${l}:${h}:${a}`, `sig:${d}:${l}:${a}:${h}`];
    let key = candidates.map(k=>sigToKey.get(k) || (map.has(k)?k:null)).find(Boolean) || candidates[0];
    map.set(key, merge(map.get(key), g));
    for(const c of candidates) sigToKey.set(c,key);
  }
  return [...map.values()];
}
function setAllGamesV56(list){ allGames = dedupeFixturesV56(Array.isArray(list)?list:[]); return allGames; }


/* =========================
   V57 PRO FIX
   - status único por state_id
   - escalação visual bonita e segura
   - contexto sem cards vazios
   - notícias filtradas
   - refresh com trava
   ========================= */
function v57StateId(g){ return Number(g?.state_id || g?.raw?.state_id || g?.fixture?.state_id || selected?.state_id || selected?.raw?.state_id || 0); }
function v57Status(g){
  const id=v57StateId(g);
  const map={1:'PRÉ-JOGO',2:'AO VIVO',3:'INTERVALO',4:'INTERVALO',5:'FINALIZADO',6:'PRORROGAÇÃO',7:'FINALIZADO',8:'PÊNALTIS',9:'PÊNALTIS',10:'ADIADO',11:'SUSPENSO',12:'CANCELADO',13:'A DEFINIR',16:'ATRASADO',18:'INTERROMPIDO',19:'AGUARDANDO',21:'INTERVALO ET',22:'AO VIVO',25:'PÊNALTIS',26:'PENDENTE'};
  if(map[id]) return map[id];
  if(g?.live) return 'AO VIVO';
  if(g?.state==='post') return 'FINALIZADO';
  if(g?.state==='pre') return 'PRÉ-JOGO';
  return 'AGENDADO';
}
function v57StatusClass(g){ const s=v57Status(g); return s.includes('AO VIVO')?'live':s.includes('FINAL')?'done':'pre'; }
function v57CleanNews(items=[]){
  return (items||[]).filter(n=>{
    const text=String((n.title||'')+' '+(n.text||'')).trim();
    if(!text) return false;
    if(/maior volume|dados oficiais|não começou|nao comecou|sem notícia|sem noticia|generic|fallback/i.test(text)) return false;
    return true;
  });
}
function v57PlayerName(p){ return p?.name || p?.player_name || p?.display_name || p?.player?.display_name || p?.player?.name || 'Jogador'; }
function v57ShortName(n){ const parts=String(n||'Jogador').trim().split(/\s+/); return (parts.length>1?parts[parts.length-1]:parts[0]).slice(0,13); }
function v57PlayerNum(p){ return p?.number || p?.jersey_number || p?.jerseyNumber || ''; }
function v57Pos(p){ return p?.pos || p?.position || p?.position_name || p?.position?.name || 'Jogador'; }
function v57IsBench(p){ return !!(p?.bench || p?.is_bench || /bench|banco|substitute/i.test(String(p?.type||p?.status||''))); }
function v57IsStarter(p){ return !v57IsBench(p) && !!(p?.starter || p?.is_starting || /lineup|titular|starter|starting/i.test(String(p?.type||p?.status||'')) || p?.formation_field || p?.formation_position); }
function v57Role(p){
  const pos=String(v57Pos(p)).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(/goal|goleiro|keeper|gk/.test(pos)) return 'gk';
  if(/def|zague|back|lateral|centre back|center back/.test(pos)) return 'def';
  if(/att|ata|forward|wing|striker|ponta/.test(pos)) return 'att';
  return 'mid';
}
function v57UniquePlayers(list=[]){
  const seen=new Set();
  return (list||[]).filter(p=>{
    const k=[p?.team_id||p?.participantId||p?.side||'',v57PlayerNum(p),v57PlayerName(p).toLowerCase()].join('|');
    if(seen.has(k)) return false; seen.add(k); return !!v57PlayerName(p);
  });
}
function v57GetLineGroups(){
  const groups=details?.lineupGroups;
  let home=[],away=[],unknown=[];
  if(groups){ home=groups.home?.all||[]; away=groups.away?.all||[]; unknown=groups.unknown||[]; }
  else{
    const raw=details?.lineups||[];
    const hid=selected?.home?.id, aid=selected?.away?.id;
    home=raw.filter(p=>p.side==='home'||String(p.team_id||p.participantId||p.participant_id||'')===String(hid));
    away=raw.filter(p=>p.side==='away'||String(p.team_id||p.participantId||p.participant_id||'')===String(aid));
    unknown=raw.filter(p=>!home.includes(p)&&!away.includes(p));
  }
  return {home:v57UniquePlayers(home),away:v57UniquePlayers(away),unknown:v57UniquePlayers(unknown)};
}
function v57SplitStartersBench(list=[]){
  let starters=v57UniquePlayers(list.filter(v57IsStarter));
  let bench=v57UniquePlayers(list.filter(v57IsBench));
  if(!starters.length){ starters=v57UniquePlayers(list).slice(0,11); bench=v57UniquePlayers(list).slice(11); }
  return {starters:starters.slice(0,11), bench:bench.length?bench:v57UniquePlayers(list.filter(p=>!starters.includes(p))).slice(0,14)};
}
function v57PitchNodes(players=[], side='home'){
  const withField=players.filter(p=>p.formation_field);
  const nodes=[];
  if(withField.length>=6){
    const byLine={};
    players.forEach(p=>{ const line=String(p.formation_field||'3:1').split(':')[0]||'3'; (byLine[line]=byLine[line]||[]).push(p); });
    Object.keys(byLine).sort((a,b)=>Number(a)-Number(b)).forEach(line=>{
      const arr=byLine[line];
      const row=Number(line)||3;
      const xHome={1:8,2:20,3:32,4:43,5:48}[row] || Math.min(48, 8+(row-1)*10);
      const x=side==='home'?xHome:100-xHome;
      const gap=76/(arr.length+1);
      arr.forEach((p,i)=>nodes.push({p,x,y:12+gap*(i+1)}));
    });
  }else{
    const by={gk:[],def:[],mid:[],att:[]}; players.forEach(p=>by[v57Role(p)].push(p));
    const rows=[['gk',8],['def',20],['mid',34],['att',45]];
    rows.forEach(([k,xh])=>{ const arr=by[k]; const x=side==='home'?xh:100-xh; const gap=76/(arr.length+1); arr.forEach((p,i)=>nodes.push({p,x,y:12+gap*(i+1)})); });
  }
  return nodes.map(({p,x,y})=>`<div class="v57Node ${side}" style="left:${x}%;top:${y}%"><div class="v57Circle">${esc(v57PlayerNum(p)||'-')}</div><div class="v57PName">${esc(v57ShortName(v57PlayerName(p)))}</div></div>`).join('');
}
function v57List(title, list=[]){
  return `<div class="v57List"><h4>${esc(title)} <small>${list.length}</small></h4>${list.length?list.map(p=>`<div class="v57ListRow"><b>${v57PlayerNum(p)?'#'+esc(v57PlayerNum(p))+' ':''}${esc(v57PlayerName(p))}</b><span>${esc(v57Pos(p))}</span></div>`).join(''):`<div class="dataNotice">Indisponível.</div>`}</div>`;
}
function renderLineups(){
  const {home,away,unknown}=v57GetLineGroups();
  const homeName=selected?.home?.name||'Mandante';
  const awayName=selected?.away?.name||'Visitante';
  if(!home.length && !away.length){
    return `<div class="title">Escalações</div><div class="v57Empty"><b>Escalação ainda não liberada com segurança.</b><p>A SportMonks pode liberar próximo do jogo. O DhuniorStats não vai inventar formação nem inverter times.</p></div>`;
  }
  if(!home.length || !away.length){
    return `<div class="title">Escalações</div><div class="v57Empty warn"><b>Jogadores retornados, mas sem separação segura dos dois times.</b><p>Para evitar erro igual ao que aconteceu antes, o campo tático fica bloqueado até a API separar mandante e visitante por team_id.</p></div>${unknown.length?v57List('Jogadores retornados pela API',unknown):''}`;
  }
  const h=v57SplitStartersBench(home), a=v57SplitStartersBench(away);
  const hForm=details?.formations?.find?.(f=>f.side==='home')?.formation || details?.homeFormation || '';
  const aForm=details?.formations?.find?.(f=>f.side==='away')?.formation || details?.awayFormation || '';
  return `<div class="title">Escalações</div>
    <div class="v57LineupHeader"><div><b>${esc(homeName)}</b><span>${esc(hForm||'formação pela posição')}</span></div><strong>LINEUP</strong><div><b>${esc(awayName)}</b><span>${esc(aForm||'formação pela posição')}</span></div></div>
    <div class="v57LineupLayout">
      <aside>${v57List('Titulares · '+homeName,h.starters)}${v57List('Banco · '+homeName,h.bench)}</aside>
      <div class="v57Pitch"><div class="v57Mid"></div><div class="v57Box left"></div><div class="v57Box right"></div>${v57PitchNodes(h.starters,'home')}${v57PitchNodes(a.starters,'away')}</div>
      <aside>${v57List('Titulares · '+awayName,a.starters)}${v57List('Banco · '+awayName,a.bench)}</aside>
    </div>
    <div class="dataNotice">Escalação separada por team_id/participants. Quando não houver vínculo seguro, o campo não é renderizado para evitar inversão.</div>`;
}
function renderSidelinedPanel(){
  const sidelined=details?.sidelined||[];
  const predictions=details?.predictions||[];
  const news=v57CleanNews(details?.news||[]);
  const cards=[];
  if(sidelined.length) cards.push(`<div class="infoCard"><b>Desfalques e suspensos</b><div class="base">${sidelined.map(x=>`<div>${esc(x.side==='home'?selected.home.name:selected.away.name)} · ${esc(x.player||x.player_id||'Jogador')} · ${esc(x.type||x.category||'')}</div>`).join('')}</div></div>`);
  if(predictions.length) cards.push(`<div class="infoCard"><b>Predictions SportMonks</b><div class="base">${predictions.slice(0,8).map(x=>`<div>${esc(x.type||'Prediction')} · ${esc(JSON.stringify(x.value||{}).slice(0,100))}</div>`).join('')}</div></div>`);
  if(news.length) cards.push(`<div class="infoCard"><b>Notícias SportMonks</b><div class="base">${news.slice(0,4).map(n=>`<div><b>${esc(n.title||n.phase||'Notícia')}</b><br>${esc((n.text||'').slice(0,350))}</div>`).join('<hr>')}</div></div>`);
  if(!cards.length) return `<div class="title">Base pré-jogo / contexto</div><div class="v57Empty"><b>Contexto ainda não liberado pela SportMonks.</b><p>Não há notícia, prediction ou desfalque confiável para esta partida neste momento.</p></div>`;
  return `<div class="title">Base pré-jogo / contexto</div><div class="v57ContextGrid">${cards.join('')}</div>`;
}
function renderMatches(){
  const games=filteredGames();
  $('matchList').innerHTML=`<div class="dayTitle">Partidas (${games.length})</div>`+games.map(g=>{
    const st=v57Status(g), cls=v57StatusClass(g);
    return `<div class="match ${selected&&selected.id===g.id&&!homeMode?'active':''}" data-idx="${allGames.indexOf(g)}"><small>${esc(g.league)} ${cls==='live'?'<b style="color:var(--brand)">● AO VIVO</b>':''}</small><div class="teamLine"><span class="teamName">${miniLogo(g.home)}${esc(g.home.name)}</span><span class="score">${esc(g.home.score)}</span></div><div class="teamLine"><span class="teamName">${miniLogo(g.away)}${esc(g.away.name)}</span><span class="score">${esc(g.away.score)}</span></div><small>${esc(st)} · ${esc(g.time||'')}</small></div>`;
  }).join('')||"<div class='empty'>Nenhum jogo.</div>";
  document.querySelectorAll('.match').forEach(el=>el.onclick=()=>openMatch(allGames[Number(el.dataset.idx)]));
  if(homeMode)renderHome();
}
function renderScoreboard(g){
  const status=v57Status(g), cls=v57StatusClass(g);
  $('scoreboard').innerHTML=`<div class="scoreTop"><div class="comp">${esc(g.league)} · ${esc(status)}</div><div><button class="btn" onclick="toggleFav('${esc(g.home.name)}')">${isFav(g.home.name)?'★':'☆'} ${esc(g.home.name)}</button> <span class="status ${cls}">${status}</span></div></div><div class="scoreBody"><div class="mainTeam">${logo(g.home,'mainLogo')}<div class="mainName">${esc(g.home.name)}</div></div><div class="centerScore"><div class="bigScore">${esc(g.home.score)} x ${esc(g.away.score)}</div><div class="minute">${esc(g.minute||'')}</div><div class="comp">${esc(g.time||'')}</div></div><div class="mainTeam">${logo(g.away,'mainLogo')}<div class="mainName">${esc(g.away.name)}</div></div></div><div class="matchTabs">${['overview:Resumo','coverage:Cobertura','stats:Estatísticas','momentum:Momentum','timeline:Timeline','lineups:Escalações','teams:Times','players:Jogadores','ai:Leitura IA','post:Contexto'].map(x=>{let [k,v]=x.split(':');return `<button class="${tab===k?'active':''}" data-tab="${k}">${v}</button>`}).join('')}</div>`;
  document.querySelectorAll('.matchTabs button').forEach(b=>b.onclick=()=>{tab=b.dataset.tab;renderScoreboard(selected);renderMainPanel();});
}
function v57SafeManualRefresh(){
  if(DHUNIOR_REFRESH_LOCK) return;
  DHUNIOR_REFRESH_LOCK=true;
  const btn=$('refreshBtn'); if(btn) btn.disabled=true;
  Promise.resolve(activeLeagueSlug?loadLeagueGames(activeLeagueSlug):loadGames()).finally(()=>setTimeout(()=>{DHUNIOR_REFRESH_LOCK=false;if(btn)btn.disabled=false;},3000));
}
setTimeout(()=>{ const b=$('refreshBtn'); if(b) b.onclick=v57SafeManualRefresh; },0);

/* =========================
   V60 SOFASCORE REAL FIX
   - lista agrupada como SofaScore
   - abas Ao Vivo / Finalizados / Próximos
   - escalação sem jogadores embolados: um campo por time
   - modo escuro minimalista
   ========================= */
let dh60ListMode = window.dh60ListMode || "all";
window.dh60ListMode = dh60ListMode;

function dh60NormText(s){return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");}
function dh60GameStatus(g){
  const id=Number(g?.state_id||g?.raw?.state_id||0);
  const raw=String(g?.status||g?.statusLabel||g?.state||"").toUpperCase();
  if(g?.live || [2,3,4,6,9,18,19,21,22,25].includes(id) || /LIVE|INPLAY|1ST|2ND|HALF|HT|INTERVALO|AO VIVO/.test(raw)) return {kind:"live",label:g?.minute?String(g.minute): raw.includes("HT")||id===3?"HT":"AO VIVO"};
  if([5,7,8].includes(id) || /FT|AET|PEN|FINAL|ENCERR|FULL/.test(raw) || g?.state==="post") return {kind:"post",label:"FT"};
  return {kind:"pre",label:g?.timeShort||g?.kickoff||""};
}
function dh60FilteredGames(){
  let games=dedupeFixturesV56 ? dedupeFixturesV56(allGames||[]) : (allGames||[]);
  const q=dh60NormText($("searchInput")?.value||"");
  const quickQ=dh60NormText(quick||"");
  if(quickQ) games=games.filter(g=>dh60NormText(g.league).includes(quickQ));
  if(q) games=games.filter(g=>dh60NormText(`${g.home?.name||""} ${g.away?.name||""} ${g.league||""}`).includes(q));
  const f=$("filterInput")?.value||"";
  const mode=dh60ListMode || (f==="live"?"live":f==="post"?"post":f==="pre"?"pre":"all");
  if(mode==="live") games=games.filter(g=>dh60GameStatus(g).kind==="live");
  if(mode==="post") games=games.filter(g=>dh60GameStatus(g).kind==="post");
  if(mode==="pre") games=games.filter(g=>dh60GameStatus(g).kind==="pre");
  if(f==="fav") games=games.filter(g=>isFav(g.home?.name)||isFav(g.away?.name));
  return games;
}
function dh60SetMode(mode){
  dh60ListMode=mode; window.dh60ListMode=mode;
  if($("filterInput")) $("filterInput").value = mode==="live"?"live":mode==="post"?"post":mode==="pre"?"pre":"";
  if(mode==="post" && typeof loadFinishedGamesV59==="function") return loadFinishedGamesV59();
  renderMatches();
}
function dh60StatusCell(g){
  const st=dh60GameStatus(g);
  if(st.kind==="live") return `<div class="dh60Time live">${esc(st.label||"LIVE")}</div>`;
  if(st.kind==="post") return `<div class="dh60Time ft">FT</div>`;
  return `<div class="dh60Time pre">${esc((g.time||"").split(" ").pop()||"NS")}</div>`;
}
function dh60FavoriteBtn(name){return `<button class="dh60Star" onclick="event.stopPropagation();toggleFav('${esc(name||"")}')">${isFav(name)?"★":"☆"}</button>`}

function renderMatches(){
  const games=dh60FilteredGames();
  const tabs=`<div class="dh60Tabs"><button class="${dh60ListMode==='live'?'active':''}" onclick="dh60SetMode('live')">Ao Vivo</button><button class="${dh60ListMode==='post'?'active':''}" onclick="dh60SetMode('post')">Finalizados</button><button class="${dh60ListMode==='pre'?'active':''}" onclick="dh60SetMode('pre')">Próximos</button><button class="${dh60ListMode==='all'?'active':''}" onclick="dh60SetMode('all')">Todos</button></div>`;
  if(!games.length){
    const msg=dh60ListMode==='post'?"Nenhum jogo finalizado encontrado.":dh60ListMode==='live'?"Nenhum jogo ao vivo agora.":dh60ListMode==='pre'?"Nenhum próximo jogo encontrado.":"Nenhum jogo encontrado.";
    $("matchList").innerHTML=tabs+`<div class="dayTitle">Partidas (0)</div><div class="dh60Empty"><b>${esc(msg)}</b><span>Tente limpar filtros ou pesquisar outro time.</span></div>`;
    if(homeMode) renderHome();
    return;
  }
  const groups={};
  games.forEach(g=>{const k=g.league||"Outras competições";(groups[k]=groups[k]||[]).push(g)});
  $("matchList").innerHTML=tabs+`<div class="dayTitle">Partidas (${games.length})</div>`+Object.entries(groups).map(([league,list])=>`
    <section class="dh60League">
      <header>${esc(league)}</header>
      ${list.map(g=>{const st=dh60GameStatus(g);return `<div class="dh60Match ${selected&&selected.id===g.id&&!homeMode?'active':''}" data-id="${esc(g.id)}">
        ${dh60StatusCell(g)}
        <div class="dh60Teams">
          <div><span>${miniLogo(g.home)}</span><b>${esc(g.home?.name||'')}</b></div>
          <div><span>${miniLogo(g.away)}</span><b>${esc(g.away?.name||'')}</b></div>
        </div>
        <div class="dh60Scores"><b>${esc(g.home?.score??'')}</b><b>${esc(g.away?.score??'')}</b></div>
        ${dh60FavoriteBtn(g.home?.name)}
      </div>`}).join("")}
    </section>`).join("");
  document.querySelectorAll(".dh60Match").forEach(el=>el.onclick=()=>{const g=(allGames||[]).find(x=>String(x.id)===String(el.dataset.id)); if(g) openMatch(g);});
  if(homeMode) renderHome();
}

function renderHome(){
  const games=dh60FilteredGames();
  const live=(allGames||[]).filter(g=>dh60GameStatus(g).kind==="live").length;
  const post=(allGames||[]).filter(g=>dh60GameStatus(g).kind==="post").length;
  const pre=(allGames||[]).filter(g=>dh60GameStatus(g).kind==="pre").length;
  const title=dh60ListMode==="post"?"Finalizados":dh60ListMode==="live"?"Ao vivo":dh60ListMode==="pre"?"Próximos jogos":"Jogos de hoje";
  $("homeView").innerHTML=`<div class="card dh60Home"><h1>${esc(title)}</h1><p>Placar, escalações e estatísticas oficiais, sem dados inventados.</p><div class="dh60Tabs big"><button class="${dh60ListMode==='live'?'active':''}" onclick="dh60SetMode('live')">Ao Vivo</button><button class="${dh60ListMode==='post'?'active':''}" onclick="dh60SetMode('post')">Finalizados</button><button class="${dh60ListMode==='pre'?'active':''}" onclick="dh60SetMode('pre')">Próximos</button></div><div class="dh60Summary"><div><b>${live}</b><span>ao vivo</span></div><div><b>${post}</b><span>finalizados</span></div><div><b>${pre}</b><span>próximos</span></div></div></div><div class="card dh60HomeList"><h2>${dh60ListMode==='post'?'Finalizados recentes':'Jogos em destaque'}</h2><div class="dh60MiniGrid">${games.slice(0,18).map(g=>`<button onclick="openMatchByIdV59&&openMatchByIdV59('${esc(g.id)}')"><small>${esc(g.league||'')}</small><span>${miniLogo(g.home)}${esc(g.home?.name||'')} <b>${esc(g.home?.score??'')}</b></span><span>${miniLogo(g.away)}${esc(g.away?.name||'')} <b>${esc(g.away?.score??'')}</b></span></button>`).join('')||`<div class="dh60Empty"><b>Sem jogos.</b></div>`}</div></div>`;
}

function dh60LP(p){
  return {
    name:p?.name||p?.player_name||p?.display_name||p?.player?.display_name||p?.player?.name||"Jogador",
    num:p?.number||p?.jersey_number||p?.jerseyNumber||"",
    pos:p?.pos||p?.position||p?.position_name||p?.position?.name||"",
    side:p?.side||"",
    bench:!!(p?.bench || p?.is_bench || /bench|banco|substitute/i.test(String(p?.type||p?.status||""))),
    starter:!!(p?.starter || p?.is_starting || /lineup|titular|starter|starting/i.test(String(p?.type||p?.status||"")) || p?.formation_field || p?.formation_position),
    ff:p?.formation_field||"",
    fp:p?.formation_position||p?.formationPosition||null,
    rating:p?.rating||p?.statistics?.rating||p?.stats?.rating||"",
    img:p?.image_path||p?.player?.image_path||""
  };
}
function dh60LineGroups(){
  const old = typeof v57GetLineGroups==="function" ? v57GetLineGroups() : {home:[],away:[],unknown:details?.lineups||[]};
  let home=(old.home||[]).map(dh60LP), away=(old.away||[]).map(dh60LP), unknown=(old.unknown||[]).map(dh60LP);
  if((!home.length || !away.length) && unknown.length>=18){
    const mid=Math.ceil(unknown.length/2); if(!home.length) home=unknown.slice(0,mid); if(!away.length) away=unknown.slice(mid);
  }
  function split(list){let starters=list.filter(p=>p.starter&&!p.bench).slice(0,11); if(starters.length<8) starters=list.filter(p=>!p.bench).slice(0,11); if(starters.length<8) starters=list.slice(0,11); const ids=new Set(starters.map(p=>p.name+"|"+p.num)); let bench=list.filter(p=>!ids.has(p.name+"|"+p.num)).slice(0,18); return {starters,bench};}
  return {home:split(home), away:split(away)};
}
function dh60Short(n){const a=String(n||"").trim().split(/\s+/);return (a.length>1?a[a.length-1]:a[0]).slice(0,12)}
function dh60Role(p){const s=dh60NormText(p.pos); if(/goal|goleiro|keeper|gk/.test(s))return"gk"; if(/def|back|zague|lateral/.test(s))return"def"; if(/att|forward|striker|wing|ata|ponta/.test(s))return"att"; return"mid";}
function dh60Nodes(players){
  const by={gk:[],def:[],mid:[],att:[]}; players.forEach(p=>by[dh60Role(p)].push(p));
  const rows=[['gk',88],['def',68],['mid',46],['att',24]];
  return rows.map(([k,y])=>{const arr=by[k]; const gap=100/(arr.length+1); return arr.map((p,i)=>`<div class="dh60Player" style="left:${gap*(i+1)}%;top:${y}%"><div class="dh60Avatar">${p.img?`<img src="${esc(p.img)}">`:esc(p.num||'')}</div>${p.rating?`<em>${esc(p.rating)}</em>`:''}<strong>${esc(dh60Short(p.name))}</strong></div>`).join('')}).join('');
}
function dh60Bench(title, list){return `<div class="dh60Bench"><h4>${esc(title)}</h4>${list.map(p=>`<div><span>${p.num?`#${esc(p.num)}`:''}</span><b>${esc(p.name)}</b><small>${esc(p.pos||'Banco')}</small></div>`).join('')||`<p>Banco não retornado.</p>`}</div>`}
function dh61RowsByFormation(players, side){
  const withFF = players.filter(p=>String(p.ff||"").includes(":"));
  if(withFF.length >= 7){
    return withFF.map(p=>{
      const [a,b]=String(p.ff).split(":").map(x=>Number(x));
      // SportMonks usually gives rows from own goal. Home plays top -> bottom, away bottom -> top.
      const row = Number.isFinite(a) ? a : 1;
      const col = Number.isFinite(b) ? b : 1;
      const rowMax = Math.max(...withFF.map(x=>Number(String(x.ff).split(":")[0])||1),4);
      const inRow = withFF.filter(x=>Number(String(x.ff).split(":")[0])===row);
      const maxCol = Math.max(...inRow.map(x=>Number(String(x.ff).split(":")[1])||1),1);
      const x = 12 + ((col)/(maxCol+1))*76;
      const ownToAttack = 8 + ((row-1)/(Math.max(rowMax-1,1)))*36;
      const y = side==="home" ? ownToAttack : 100-ownToAttack;
      return {...p, x, y};
    });
  }

  // fallback quando a API não manda formation_field: monta linhas reais e nunca deixa tudo em fila
  const list = players.slice(0,11);
  const roles = {gk:[],def:[],mid:[],att:[]};
  list.forEach((p,i)=>{
    let r = dh60Role(p);
    // se não vier posição, usa ordem comum: 1 GK, 4 DEF, 4 MID, 2 ATT
    if(!p.pos){
      if(i===0) r="gk";
      else if(i<=4) r="def";
      else if(i<=8) r="mid";
      else r="att";
    }
    roles[r].push(p);
  });
  const order = side==="home"
    ? [{k:"gk",y:8},{k:"def",y:23},{k:"mid",y:39},{k:"att",y:55}]
    : [{k:"gk",y:92},{k:"def",y:77},{k:"mid",y:61},{k:"att",y:45}];

  const out=[];
  order.forEach(row=>{
    const arr=roles[row.k];
    const gap=100/(arr.length+1);
    arr.forEach((p,i)=>out.push({...p,x:gap*(i+1),y:row.y}));
  });
  return out;
}

function dh61PitchNodes(players, side){
  return dh61RowsByFormation(players, side).map(p=>`
    <div class="dh61Player ${side}" style="left:${p.x}%;top:${p.y}%">
      <div class="dh61Avatar">${p.img?`<img src="${esc(p.img)}">`:esc(p.num||"")}</div>
      ${p.rating?`<em>${esc(String(p.rating).slice(0,4))}</em>`:""}
      <strong>${esc(dh60Short(p.name))}</strong>
    </div>`).join("");
}

function dh61Bench(title, list){
  return `<div class="dh61Bench"><h4>${esc(title)}</h4>
    <div class="dh61BenchGrid">${list.map(p=>`<div><span>${p.num?`#${esc(p.num)}`:""}</span><b>${esc(p.name)}</b><small>${esc(p.pos||"Reserva")}</small></div>`).join("") || `<p>Banco não retornado.</p>`}</div>
  </div>`;
}

function renderLineups(){
  const st=dh60GameStatus(selected||{});
  const modeLabel=st.kind==="pre"?"Escalação provável":"Escalação oficial";
  const {home,away}=dh60LineGroups();
  const homeName=selected?.home?.name||"Mandante", awayName=selected?.away?.name||"Visitante";
  if(!home.starters.length && !away.starters.length){
    return `<div class="title">Escalações</div><div class="dh60Empty"><b>Escalação ainda não liberada.</b><span>Quando a SportMonks/API retornar lineup, ela aparece aqui sem inventar dados.</span></div>`;
  }
  return `<div class="title">Escalações</div>
    <div class="dh61Lineup">
      <div class="dh61Top">
        <div><b>${esc(homeName)}</b><span>${esc(modeLabel)}</span></div>
        <strong>FORMAÇÕES</strong>
        <div><b>${esc(awayName)}</b><span>${esc(modeLabel)}</span></div>
      </div>
      <div class="dh61Pitch">
        <div class="dh61Half"></div><div class="dh61Circle"></div>
        <div class="dh61Goal top"></div><div class="dh61Goal bottom"></div>
        <div class="dh61Team top">${esc(homeName)}</div>
        <div class="dh61Team bottom">${esc(awayName)}</div>
        ${dh61PitchNodes(home.starters, "home")}
        ${dh61PitchNodes(away.starters, "away")}
      </div>
      <div class="dh61Benches">
        ${dh61Bench("Reservas · "+homeName, home.bench)}
        ${dh61Bench("Reservas · "+awayName, away.bench)}
      </div>
    </div>`;
}

// Search no Enter, sem precisar lupa
setTimeout(()=>{
  const inp=$("searchInput"); if(inp){inp.onkeydown=(e)=>{if(e.key==="Enter") searchGames();};}
  const liveBtn=[...document.querySelectorAll('.topBtn')].find(b=>/Ao vivo/i.test(b.textContent||'')); if(liveBtn) liveBtn.onclick=()=>dh60SetMode('live');
},0);
