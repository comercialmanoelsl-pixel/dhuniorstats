
function norm(s){
  return String(s||"").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"");
}

function uniquePlayers(list){
  const seen = new Set();
  return (list||[]).filter(p=>{
    const k = `${p.team||""}-${p.number||""}-${norm(p.name||p.player_name)}`;
    if(seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function isStarter(p){
  const t = norm(p.type || p.type_name || p.lineup_type || "");
  return t.includes("titular") || t.includes("starting") || t.includes("lineup") || t.includes("start");
}

function fromSportMonks(fx){
  const raw = fx?.lineups || [];
  const participants = fx?.participants || [];

  function participantName(id){
    const p = participants.find(x => String(x.id) === String(id) || String(x.participant_id) === String(id));
    return p?.name || p?.participant?.name || "";
  }

  return uniquePlayers(raw.map(x=>{
    const participantId = x.participant_id || x.team_id || x.participant?.id || x.team?.id || "";
    return {
      source:"SportMonks",
      status:"official",
      team: participantName(participantId) || x.participant?.name || x.team?.name || x.team_name || "",
      participantId,
      name:x.player?.display_name || x.player?.name || x.player_name || "",
      number:x.jersey_number || x.number || "",
      pos:x.position?.name || x.position_name || x.position?.developer_name || "",
      type:x.type?.name || x.type_name || ""
    };
  }).filter(x=>x.name));
}

function fromApiFootball(resp){
  const out = [];
  for(const team of resp || []){
    const teamName = team.team?.name || "";
    for(const p of team.startXI || []){
      out.push({source:"API-Football",status:"official",team:teamName,type:"Titular",name:p.player?.name||"",number:p.player?.number||"",pos:p.player?.pos||""});
    }
    for(const p of team.substitutes || []){
      out.push({source:"API-Football",status:"official",team:teamName,type:"Banco",name:p.player?.name||"",number:p.player?.number||"",pos:p.player?.pos||""});
    }
  }
  return uniquePlayers(out.filter(x=>x.name));
}

function classifyLineup(lineups){
  const starters = uniquePlayers((lineups||[]).filter(isStarter));
  const bench = uniquePlayers((lineups||[]).filter(p=>!starters.includes(p)));
  return { available:(lineups||[]).length>0, official:(lineups||[]).some(x=>x.status==="official"), starters, bench, all:uniquePlayers(lineups||[]) };
}

module.exports = { fromSportMonks, fromApiFootball, classifyLineup, uniquePlayers };
