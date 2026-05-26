
function clean(s){
  return String(s||"")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"")
    .replace(/[^a-z0-9 ]/g," ")
    .replace(/\s+/g," ")
    .trim();
}

function matchState(game){
  const raw = String(game?.status || game?.state || "").toUpperCase();
  const live = ["LIVE","1H","2H","HT","ET","BT","P","SUSP","INT","IN_PLAY","BREAK","PAUSED","FIRST HALF","SECOND HALF"].some(x=>raw.includes(x));
  const finished = ["FT","FULL TIME","FULLTIME","FINISHED","ENDED","AET","PEN"].some(x=>raw.includes(x));
  if(live) return "LIVE";
  if(finished) return "FINISHED";
  return "PREMATCH";
}

function coverageScore(cov){
  const keys = ["fixture","participants","scores","events","statistics","lineups","formations","coaches","sidelined","players","recentMatches","odds","news"];
  const total = keys.length;
  const got = keys.filter(k=>!!cov[k]).length;
  return Math.round((got/total)*100);
}

function normalizeCoverage(cov){
  const out = {
    fixture: !!cov.fixture,
    participants: !!cov.participants,
    scores: !!cov.scores,
    events: !!cov.events,
    statistics: !!cov.statistics,
    lineups: !!cov.lineups,
    formations: !!cov.formations,
    coaches: !!cov.coaches,
    sidelined: !!cov.sidelined,
    players: !!cov.players,
    recentMatches: !!cov.recentMatches,
    odds: !!cov.odds,
    news: !!cov.news
  };
  out.score = coverageScore(out);
  return out;
}

module.exports = { clean, matchState, normalizeCoverage, coverageScore };
