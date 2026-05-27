
function apiFixtureToMini(f, teamName){
  const home=f.teams?.home?.name||"", away=f.teams?.away?.name||"";
  const hg=f.goals?.home, ag=f.goals?.away;
  const isHome = String(home).toLowerCase().includes(String(teamName||"").toLowerCase());
  let result = "";
  if(hg !== null && ag !== null && hg !== undefined && ag !== undefined){
    const gf = isHome ? hg : ag;
    const ga = isHome ? ag : hg;
    result = gf>ga ? "V" : gf<ga ? "D" : "E";
  }
  return {home,away,score:`${hg ?? ""} x ${ag ?? ""}`,date:f.fixture?.date||"",status:f.fixture?.status?.short||"",result};
}

function summarize(matches){
  const list = matches || [];
  const v=list.filter(x=>x.result==="V").length, e=list.filter(x=>x.result==="E").length, d=list.filter(x=>x.result==="D").length;
  return {played:list.length,wins:v,draws:e,losses:d,form:list.map(x=>x.result).filter(Boolean).join("")};
}

module.exports = { apiFixtureToMini, summarize };
