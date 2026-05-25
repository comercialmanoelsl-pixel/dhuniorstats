
const $=id=>document.getElementById(id);
let smComponentData=null; let coverageData=null; let allGames=[], selected=null, details=null, tab="overview", sideTab="ia", quick="", homeMode=true, detailTimer=null, activeLeagueSlug="";

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
  $("filterInput").value="live";
  loadLiveGames();
}
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
  <div class="card section"><div class="sectionTitle">🔥 Jogos em destaque</div><div class="compactGrid">${games.slice(0,18).map(g=>`<div class="compactCard" onclick="openMatch(allGames[${allGames.indexOf(g)}])"><small>${esc(g.league)}</small><div class="teamLine"><span class="teamName">${miniLogo(g.home)}${esc(g.home.name)}</span><span class="score">${esc(g.home.score)}</span></div><div class="teamLine"><span class="teamName">${miniLogo(g.away)}${esc(g.away.name)}</span><span class="score">${esc(g.away.score)}</span></div></div>`).join("")||"<div class='empty'>Sem jogos.</div>"}</div></div>`;
}

function renderMatches(){
  const games=filteredGames();
  $("matchList").innerHTML=`<div class="dayTitle">Partidas (${games.length})</div>`+games.map(g=>`<div class="match ${selected&&selected.id===g.id&&!homeMode?"active":""}" data-idx="${allGames.indexOf(g)}"><small>${esc(g.league)} ${g.live?'<b style="color:var(--brand)">● AO VIVO</b>':''}</small><div class="teamLine"><span class="teamName">${miniLogo(g.home)}${esc(g.home.name)}</span><span class="score">${esc(g.home.score)}</span></div><div class="teamLine"><span class="teamName">${miniLogo(g.away)}${esc(g.away.name)}</span><span class="score">${esc(g.away.score)}</span></div><small>${esc(g.status||"")} · ${esc(g.time||"")}</small></div>`).join("")||"<div class='empty'>Nenhum jogo.</div>";
  document.querySelectorAll(".match").forEach(el=>el.onclick=()=>openMatch(allGames[Number(el.dataset.idx)]));
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





function renderLineups(){
  const raw=details?.lineups||[];
  const homeName=selected.home?.name||"Mandante";
  const awayName=selected.away?.name||"Visitante";

  if(!raw.length){
    const d=`/diagnostico.html?home=${encodeURIComponent(homeName)}&away=${encodeURIComponent(awayName)}&date=${encodeURIComponent((selected.date||"").slice(0,10))}`;
    $("mainPanel").innerHTML=`<div class="title">Escalações</div>
      <div class="dataNotice">Escalação oficial ainda não disponível ou não retornada pelas APIs conectadas.</div>
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
  const unsafeTeamMapping = (!homeAll.length || !awayAll.length);

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
      participantId:p.participant_id,
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
    ["Finalizações",s.home.finalizations,s.away.finalizations],
    ["Chutes no gol",s.home.shotsOnGoal,s.away.shotsOnGoal],
    ["Escanteios",s.home.corners,s.away.corners],
    ["Posse",s.home.possession!==undefined?s.home.possession+"%":"",s.away.possession!==undefined?s.away.possession+"%":""],
    ["Faltas",s.home.fouls,s.away.fouls],
    ["Cartões amarelos",s.home.yellowCards,s.away.yellowCards],
    ["Cartões vermelhos",s.home.redCards,s.away.redCards],
    ["xG",s.home.xg,s.away.xg],
    ["Ataques",s.home.attacks,s.away.attacks],
    ["Ataques perigosos",s.home.dangerousAttacks,s.away.dangerousAttacks],
    ["Passes",s.home.passes,s.away.passes]
  ].filter(r=>r[1]!==undefined || r[2]!==undefined);
  return `<div class="title">Estatísticas</div><div class="statsGrid">${rows.map(r=>{
    const pc=pct(parseFloat(r[1]),parseFloat(r[2]));
    return `<div class="statRow"><div class="statTop"><span>${esc(r[1]??"-")}</span><span>${esc(r[2]??"-")}</span></div><div class="statLabel">${esc(r[0])}</div><div class="bar"><div class="homeBar" style="width:${pc}%"></div><div class="awayBar" style="width:${100-pc}%"></div></div></div>`;
  }).join("")}</div>`;
}

function renderSidelinedPanel(){
  const list = details?.sidelined || [];
  const pred = details?.predictions || [];
  const news = details?.news || [];
  return `<div class="title">Base pré-jogo / contexto</div>
    <div class="grid2">
      <div class="infoCard"><b>Desfalques e suspensos</b><div class="base">
        ${list.length?list.map(x=>`<div><b>${esc(x.side==="home"?selected.home.name:selected.away.name)}</b> · ${esc(x.player||x.player_id)} · ${esc(x.type||x.category||"")}</div>`).join(""):"<div>Sem desfalques retornados.</div>"}
      </div></div>
      <div class="infoCard"><b>Predictions SportMonks</b><div class="base">
        ${pred.length?pred.slice(0,8).map(x=>`<div>${esc(x.type)} · ${esc(JSON.stringify(x.value).slice(0,90))}</div>`).join(""):"<div>Sem predictions retornadas.</div>"}
      </div></div>
    </div>
    <br>
    <div class="infoCard"><b>Notícias SportMonks</b><div class="base">
      ${news.length?news.slice(0,4).map(n=>`<div><b>${esc(n.title||n.phase)}</b><br>${esc(n.text||"").slice(0,350)}</div>`).join("<hr>"):"<div>Sem notícias retornadas.</div>"}
    </div></div>`;
}

function renderMainPanel(){
  if(!selected){$("mainPanel").innerHTML=`<div class="empty">Selecione uma partida</div>`;return}
  if(!details){$("mainPanel").innerHTML=`<div class="skeleton"></div><br><div class="skeleton"></div>`;return}
  if(tab==="coverage")renderCoverage();
  else if(tab==="stats")$("mainPanel").innerHTML=renderAdvancedStats();
  else if(tab==="momentum")$("mainPanel").innerHTML=momentum();
  else if(tab==="timeline")$("mainPanel").innerHTML=timeline();
  else if(tab==="livefield")renderLiveField();
  else if(tab==="lineups")renderLineups();
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

async function loadDetails(g){
  selected=g;details=null;localStorage.setItem("selectedGameKey",`${g.home.name}_${g.away.name}`);
  renderScoreboard(g);renderMainPanel();renderSide();renderMatches();
  const gp=encodeURIComponent(JSON.stringify(g));
  try{
    const d=await fetch(`/api/game-details?apiFootballId=${encodeURIComponent(g.apiFootballId||"")}&sportmonksId=${encodeURIComponent(g.sportmonksId||"")}&game=${gp}&_=${Date.now()}`).then(r=>r.json());
    if(!d.ok)throw new Error(d.error);
    details=d;
    smComponentData=null;
    if(g.sportmonksId){
      try{
        const smd=await fetch(`/api/sm/components/fixture/${encodeURIComponent(g.sportmonksId)}?_=${Date.now()}`).then(r=>r.json());
        smComponentData=smd.ok?smd:null;
        details=mergeSportMonksComponentsIntoDetails(details, smComponentData);
      }catch(_){smComponentData=null}
    }
    try{
      const cd=await fetch(`/api/coverage-match?game=${gp}&_=${Date.now()}`).then(r=>r.json());
      coverageData=cd.ok?cd.data:null;
    }catch(_){coverageData=null}
    renderScoreboard(selected);renderMainPanel();renderSide();
  }catch(e){$("mainPanel").innerHTML=`<div class="empty">Erro: ${esc(e.message||e)}</div>`}
}
function openMatch(g){
  homeMode=false;$("homeView").style.display="none";$("matchView").style.display="block";
  if(detailTimer)clearInterval(detailTimer);
  loadDetails(g);
  detailTimer=setInterval(()=>{ if(selected && !homeMode) loadDetails(selected); },30000);
}


async function loadLeagueGames(slug){
  activeLeagueSlug=slug||"";
  if(!activeLeagueSlug){ return loadGames(); }
  const date=$("dateInput").value||new Date().toISOString().slice(0,10);
  $("matchList").innerHTML=`<div class="empty">Buscando jogos da liga...</div>`;
  try{
    const d=await fetch(`/api/league-games?slug=${encodeURIComponent(activeLeagueSlug)}&date=${date}&_=${Date.now()}`).then(r=>r.json());
    allGames=d.games||[];
    selected=null;
    renderMatches();
    showHome();
    if(!allGames.length){
      $("homeView").innerHTML=`<div class="card section"><div class="sectionTitle">${esc(d.label||"Liga")}</div><div class="dataNotice">Nenhum jogo encontrado nesta liga para ${esc(date)} pelas APIs conectadas.</div></div>`;
    }
  }catch(e){
    $("matchList").innerHTML=`<div class="empty">Erro ao carregar jogos da liga.</div>`;
  }
}


async function loadLiveGames(){
  activeLeagueSlug="";
  document.querySelectorAll(".quick button").forEach(x=>x.classList.remove("active"));
  const first=document.querySelector('.quick button[data-slug=""]');
  if(first)first.classList.add("active");
  const date=$("dateInput").value||new Date().toISOString().slice(0,10);
  $("matchList").innerHTML=`<div class="empty">Buscando jogos ao vivo...</div>`;
  try{
    const d=await fetch(`/api/live-games?date=${date}&_=${Date.now()}`).then(r=>r.json());
    allGames=d.games||[];
    renderMatches();
    showHome();
    if(!allGames.length){
      $("homeView").innerHTML=`<div class="card section"><div class="sectionTitle">Ao vivo</div><div class="dataNotice">Nenhum jogo ao vivo foi retornado pelas APIs conectadas neste momento.<br><br>Isso pode acontecer quando a liga ao vivo não está coberta no seu plano ou quando o provedor não marca o status como live. Use /api/debug-live para verificar as fontes.</div></div>`;
    }
  }catch(e){
    $("matchList").innerHTML=`<div class="empty">Erro ao buscar jogos ao vivo.</div>`;
  }
}

async function searchGames(){
  const q=$("searchInput").value.trim();
  if(!q){ renderMatches(); return; }
  activeLeagueSlug="";
  const date=$("dateInput").value||new Date().toISOString().slice(0,10);
  $("matchList").innerHTML=`<div class="empty">Buscando...</div>`;
  try{
    const d=await fetch(`/api/search-games?q=${encodeURIComponent(q)}&date=${date}&_=${Date.now()}`).then(r=>r.json());
    allGames=d.games||[];
    renderMatches();
    showHome();
    if(allGames.length===1) openMatch(allGames[0]);
    if(!allGames.length){
      $("homeView").innerHTML=`<div class="card section"><div class="sectionTitle">Busca</div><div class="dataNotice">Nenhum jogo encontrado para “${esc(q)}”.</div></div>`;
    }
  }catch(e){
    $("matchList").innerHTML=`<div class="empty">Erro na busca.</div>`;
  }
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

document.querySelectorAll(".quick button").forEach(b=>b.onclick=()=>{document.querySelectorAll(".quick button").forEach(x=>x.classList.remove("active"));b.classList.add("active");quick=b.dataset.q||"";activeLeagueSlug=b.dataset.slug||""; if(activeLeagueSlug) loadLeagueGames(activeLeagueSlug); else loadGames();});
$("dateInput").value=new Date().toISOString().slice(0,10);
$("refreshBtn").onclick=()=>activeLeagueSlug?loadLeagueGames(activeLeagueSlug):loadGames();$("searchInput").oninput=renderMatches;$("searchInput").onkeydown=e=>{if(e.key==="Enter")searchGames()};$("searchBtn").onclick=searchGames;$("filterInput").onchange=renderMatches;$("dateInput").onchange=()=>activeLeagueSlug?loadLeagueGames(activeLeagueSlug):loadGames();
loadGames();setInterval(loadGames,45000);


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
