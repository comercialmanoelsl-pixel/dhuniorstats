
const $=id=>document.getElementById(id);
let allGames=[], selected=null, details=null, tab="overview", sideTab="ia", quick="", homeMode=true, detailTimer=null;

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
function setLive(){$("filterInput").value="live";renderMatches();showHome()}
function setFav(){$("filterInput").value="fav";renderMatches();showHome()}

function filteredGames(){
  const q=$("searchInput").value.toLowerCase(), f=$("filterInput").value;
  let games=[...allGames];
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
  const hot=live[0]||games.find(g=>g.state==="post")||games[0];
  $("homeView").innerHTML=`<div class="card homeHero">
    <h1 class="homeTitle">Jogos de hoje</h1>
    <div class="homeSub">Placar, estatísticas reais, favoritos e leitura IA sem dados inventados.</div>
    <div class="homeTabs">
      <button onclick="setLive()">Ao vivo</button>
      <button onclick="setFav()">Favoritos</button>
      <button onclick="document.getElementById('filterInput').value='post';renderMatches();renderHome()">Finalizados</button>
    </div>
    <div class="homeGrid">
      <div class="feature">${hot?`<div class="featureTitle">Jogo em destaque</div><div class="hotGame"><span>${miniLogo(hot.home)} ${esc(hot.home.name)}</span><span class="hotScore">${esc(hot.home.score)} x ${esc(hot.away.score)}</span><span>${miniLogo(hot.away)} ${esc(hot.away.name)}</span></div><br><button class="btn" onclick="openMatch(allGames[${allGames.indexOf(hot)}])">Abrir partida</button>`:`<div class="empty">Nenhum jogo encontrado.</div>`}</div>
      <div class="feature"><div class="featureTitle">Resumo</div><div class="trendItem"><b>${live.length}</b> jogos ao vivo</div><div class="trendItem"><b>${games.filter(g=>g.state==="post").length}</b> finalizados</div><div class="trendItem"><b>${games.filter(g=>g.state==="pre").length}</b> próximos</div></div>
    </div>
  </div>
  <div class="card section"><div class="sectionTitle">🔥 Partidas</div><div class="compactGrid">${games.slice(0,18).map(g=>`<div class="compactCard" onclick="openMatch(allGames[${allGames.indexOf(g)}])"><small>${esc(g.league)}</small><div class="teamLine"><span class="teamName">${miniLogo(g.home)}${esc(g.home.name)}</span><span class="score">${esc(g.home.score)}</span></div><div class="teamLine"><span class="teamName">${miniLogo(g.away)}${esc(g.away.name)}</span><span class="score">${esc(g.away.score)}</span></div></div>`).join("")||"<div class='empty'>Sem jogos.</div>"}</div></div>`;
}

function renderMatches(){
  const games=filteredGames();
  $("matchList").innerHTML=`<div class="dayTitle">Partidas (${games.length})</div>`+games.map(g=>`<div class="match ${selected&&selected.id===g.id&&!homeMode?"active":""}" data-idx="${allGames.indexOf(g)}"><small>${esc(g.league)} ${g.live?'<b style="color:var(--brand)">● AO VIVO</b>':''}</small><div class="teamLine"><span class="teamName">${miniLogo(g.home)}${esc(g.home.name)}</span><span class="score">${esc(g.home.score)}</span></div><div class="teamLine"><span class="teamName">${miniLogo(g.away)}${esc(g.away.name)}</span><span class="score">${esc(g.away.score)}</span></div><small>${esc(g.status||"")} · ${esc(g.time||"")}</small></div>`).join("")||"<div class='empty'>Nenhum jogo.</div>";
  document.querySelectorAll(".match").forEach(el=>el.onclick=()=>openMatch(allGames[Number(el.dataset.idx)]));
  if(homeMode)renderHome();
}

function renderScoreboard(g){
  const status=g.live?"AO VIVO":g.state==="pre"?"PRÉ-JOGO":"FINALIZADO";
  $("scoreboard").innerHTML=`<div class="scoreTop"><div class="comp">${esc(g.league)} · ${esc(g.status||"")}</div><div><button class="btn" onclick="toggleFav('${esc(g.home.name)}')">${isFav(g.home.name)?"★":"☆"} ${esc(g.home.name)}</button> <span class="status">${status}</span></div></div><div class="scoreBody"><div class="mainTeam">${logo(g.home,"mainLogo")}<div class="mainName">${esc(g.home.name)}</div></div><div class="centerScore"><div class="bigScore">${esc(g.home.score)} x ${esc(g.away.score)}</div><div class="minute">${esc(g.minute||"")}</div><div class="comp">${esc(g.time||"")}</div></div><div class="mainTeam">${logo(g.away,"mainLogo")}<div class="mainName">${esc(g.away.name)}</div></div></div><div class="matchTabs">${["overview:Resumo","stats:Estatísticas","momentum:Momentum","timeline:Timeline","lineups:Escalações","teams:Times","players:Jogadores","ai:Leitura IA","post:Pós-jogo"].map(x=>{let [k,v]=x.split(":");return `<button class="${tab===k?"active":""}" data-tab="${k}">${v}</button>`}).join("")}</div>`;
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

function renderLineups(){
  const l=details?.lineups||[];
  if(!l.length){
    $("mainPanel").innerHTML=`<div class="title">Escalações</div><div class="dataNotice">${esc(details?.lineupNote||"Escalação oficial ainda não disponível. O site atualizará automaticamente quando a API liberar.")}</div><br><div class="base">${(details?.news||[]).slice(0,5).map(n=>`<div>📰 ${esc(n.title)} <small>${esc(n.source||"")}</small></div>`).join("")||"<div>Sem notícia de provável escalação encontrada.</div>"}</div>`;
    return;
  }
  const starters=l.filter(x=>String(x.type||"").toLowerCase().includes("titular")||String(x.type||"").toLowerCase().includes("starting"));
  const bench=l.filter(x=>!starters.includes(x));
  const row=x=>`<div class="event"><b>${esc(x.pos||"-")}</b><div><b>${esc(x.name)}</b><br><small>${esc(x.team)} · ${esc(x.type)} ${x.number?("#"+x.number):""} · ${esc(x.source||"API")}</small></div></div>`;
  $("mainPanel").innerHTML=`<div class="title">Escalações oficiais</div><div class="realBadge">Atualização automática</div><br><br><div class="grid2"><div><b>Titulares</b>${(starters.length?starters:l.slice(0,22)).map(row).join("")}</div><div><b>Banco</b>${bench.slice(0,18).map(row).join("")||"<div class='dataNotice'>Banco indisponível.</div>"}</div></div>`;
}
function renderMainPanel(){
  if(!selected){$("mainPanel").innerHTML=`<div class="empty">Selecione uma partida</div>`;return}
  if(!details){$("mainPanel").innerHTML=`<div class="skeleton"></div><br><div class="skeleton"></div>`;return}
  if(tab==="stats")$("mainPanel").innerHTML=`<div class="title">Estatísticas</div>${statRows(details.stats)}`;
  else if(tab==="momentum")$("mainPanel").innerHTML=momentum();
  else if(tab==="timeline")$("mainPanel").innerHTML=timeline();
  else if(tab==="lineups")renderLineups();
  else if(tab==="ai")$("mainPanel").innerHTML=`<div class="title">Leitura IA</div><div class="aiBox"><div class="aiText">${esc(details.ai?.text||"Sem leitura disponível.")}</div></div><br><div class="base">${(details.ai?.points||[]).map(p=>`<div>${esc(p)}</div>`).join("")}</div>`;
  else if(tab==="teams")renderTeamProfile();
  else if(tab==="players")renderPlayersReal();
  else if(tab==="post")$("mainPanel").innerHTML=`<div class="title">Pós-jogo</div><div class="dataNotice">${selected.state==="post"?"Partida finalizada. A análise pós-jogo usa eventos e estatísticas oficiais disponíveis.":"Disponível após a partida."}</div>`;
  else $("mainPanel").innerHTML=`<div class="title">Resumo da partida</div><div class="realBadge">Sem dados inventados</div><br><br><div class="aiBox"><div class="aiText">${esc(details.ai?.text||"Aguardando dados oficiais.")}</div></div><br>${statRows(details.stats)}`;
}

function formatApiFixture(f){const h=f.teams?.home?.name||"",a=f.teams?.away?.name||"";const gh=f.goals?.home??"",ga=f.goals?.away??"";const st=f.fixture?.status?.short||f.fixture?.status?.long||"";return `${h} ${gh} x ${ga} ${a} · ${st}`}
async function renderTeamProfile(){
  $("mainPanel").innerHTML=`<div class="title">Times</div><div class="skeleton"></div>`;
  try{
    const [h,a]=await Promise.all([
      fetch(`/api/team-profile?teamId=${selected.home.id||""}&leagueId=${selected.leagueId||""}&season=${selected.season||""}`).then(r=>r.json()),
      fetch(`/api/team-profile?teamId=${selected.away.id||""}&leagueId=${selected.leagueId||""}&season=${selected.season||""}`).then(r=>r.json())
    ]);
    const block=(name,d)=>`<div class="infoCard"><b>${esc(name)}</b><div class="featureTitle">Últimos jogos</div><div class="base">${(d.recent||[]).slice(0,5).map(f=>`<div class="fixtureMini">${esc(formatApiFixture(f))}</div>`).join("")||"<div>Sem dados disponíveis.</div>"}</div></div>`;
    $("mainPanel").innerHTML=`<div class="title">Times</div><div class="grid2">${block(selected.home.name,h)}${block(selected.away.name,a)}</div>`;
  }catch(e){$("mainPanel").innerHTML=`<div class="dataNotice">Perfil dos times indisponível.</div>`}
}
async function renderPlayersReal(){
  $("mainPanel").innerHTML=`<div class="title">Jogadores</div><div class="skeleton"></div>`;
  try{
    const r=await fetch(`/api/team-profile?teamId=${selected.home.id||""}&leagueId=${selected.leagueId||""}&season=${selected.season||""}`).then(r=>r.json());
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
  const l=details?.lineups||[];
  if(!l.length){
    $("sideContent").innerHTML=`<div class="title">Escalações</div><div class="dataNotice">${esc(details?.lineupNote||"Escalações oficiais ainda indisponíveis.")}</div>`;
    return;
  }
  $("sideContent").innerHTML=`<div class="title">Escalações</div>`+l.slice(0,22).map(x=>`<div class="event"><b>${esc(x.pos||"-")}</b><div><b>${esc(x.name)}</b><br><small>${esc(x.team)} · ${esc(x.type)} · ${esc(x.source||"API")}</small></div></div>`).join("");
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

async function loadDetails(g){
  selected=g;details=null;localStorage.setItem("selectedGameKey",`${g.home.name}_${g.away.name}`);
  renderScoreboard(g);renderMainPanel();renderSide();renderMatches();
  const gp=encodeURIComponent(JSON.stringify(g));
  try{
    const d=await fetch(`/api/game-details?apiFootballId=${encodeURIComponent(g.apiFootballId||"")}&sportmonksId=${encodeURIComponent(g.sportmonksId||"")}&game=${gp}&_=${Date.now()}`).then(r=>r.json());
    if(!d.ok)throw new Error(d.error);
    details=d;renderMainPanel();renderSide();
  }catch(e){$("mainPanel").innerHTML=`<div class="empty">Erro: ${esc(e.message||e)}</div>`}
}
function openMatch(g){
  homeMode=false;$("homeView").style.display="none";$("matchView").style.display="block";
  if(detailTimer)clearInterval(detailTimer);
  loadDetails(g);
  detailTimer=setInterval(()=>{ if(selected && !homeMode) loadDetails(selected); },30000);
}

async function loadGames(){
  const date=$("dateInput").value||new Date().toISOString().slice(0,10);
  $("matchList").innerHTML=`<div class="empty">Buscando jogos...</div>`;
  try{
    const d=await fetch(`/api/games?date=${date}&_=${Date.now()}`).then(r=>r.json());
    allGames=d.games||[];
    renderMatches();showHome();
  }catch(e){$("matchList").innerHTML=`<div class="empty">Erro ao carregar jogos.</div>`}
}

document.querySelectorAll(".quick button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".quick button").forEach(x=>x.classList.remove("active"));b.classList.add("active");quick=b.dataset.q;renderMatches()});
$("dateInput").value=new Date().toISOString().slice(0,10);
$("refreshBtn").onclick=loadGames;$("searchInput").oninput=renderMatches;$("filterInput").onchange=renderMatches;
loadGames();setInterval(loadGames,45000);
