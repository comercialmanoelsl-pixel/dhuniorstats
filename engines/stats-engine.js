
function num(v){
  const n = Number(String(v ?? "").replace("%","").replace(",",".").trim());
  return Number.isFinite(n) ? n : null;
}

function empty(source){ return {source, available:false, home:{}, away:{}}; }

function fromApiFootball(rows, game){
  const out = empty("API-Football");
  const clean = s => String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
  for(const tb of rows || []){
    const side = clean(tb.team?.name).includes(clean(game.home?.name)) || clean(game.home?.name).includes(clean(tb.team?.name)) ? "home"
      : clean(tb.team?.name).includes(clean(game.away?.name)) || clean(game.away?.name).includes(clean(tb.team?.name)) ? "away" : "";
    if(!side) continue;
    for(const st of tb.statistics || []){
      const name = clean(st.type);
      const value = num(st.value);
      if(value === null) continue;
      if(name.includes("total shots")) out[side].finalizations = value;
      if(name.includes("shots on goal") || name.includes("shots on target")) out[side].shotsOnGoal = value;
      if(name.includes("corner")) out[side].corners = value;
      if(name.includes("possession")) out[side].possession = value;
      if(name.includes("yellow")) out[side].yellowCards = value;
      if(name.includes("red")) out[side].redCards = value;
    }
  }
  out.available = Object.keys(out.home).length>0 || Object.keys(out.away).length>0;
  return out;
}

function fromSportMonks(fx, game){
  const out = empty("SportMonks");
  const parts = fx?.participants || [];
  const home = parts.find(p=>p.meta?.location==="home" || p.pivot?.location==="home") || parts[0] || {};
  const away = parts.find(p=>p.meta?.location==="away" || p.pivot?.location==="away") || parts[1] || {};
  const clean = s => String(s||"").toLowerCase();
  for(const s of fx?.statistics || []){
    const side = s.participant_id===home.id ? "home" : s.participant_id===away.id ? "away" : "";
    if(!side) continue;
    const name = clean(s.type?.name || s.type?.developer_name || s.name || "");
    const value = num(s.data?.value ?? s.data?.count ?? s.value);
    if(value === null) continue;
    if(name.includes("shot")) out[side].finalizations = (out[side].finalizations||0) + value;
    if(name.includes("target")) out[side].shotsOnGoal = value;
    if(name.includes("corner")) out[side].corners = value;
    if(name.includes("possession")) out[side].possession = value;
    if(name.includes("yellow")) out[side].yellowCards = value;
    if(name.includes("red")) out[side].redCards = value;
  }
  out.available = Object.keys(out.home).length>0 || Object.keys(out.away).length>0;
  return out;
}

function mergeStats(primary, fallback){
  if(primary?.available) return primary;
  if(fallback?.available) return fallback;
  return primary || fallback || empty("none");
}

module.exports = { fromApiFootball, fromSportMonks, mergeStats };
