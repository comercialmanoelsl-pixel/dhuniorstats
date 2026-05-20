
const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";

app.use(express.static("public"));

const LEAGUES = [
  { key: "bra.1", name: "Brasileirão Série A" },
  { key: "bra.2", name: "Brasileirão Série B" },
  { key: "conmebol.libertadores", name: "Libertadores" },
  { key: "conmebol.sudamericana", name: "Sul-Americana" },
  { key: "eng.1", name: "Premier League" },
  { key: "esp.1", name: "La Liga" },
  { key: "ita.1", name: "Serie A Itália" },
  { key: "ger.1", name: "Bundesliga" },
  { key: "fra.1", name: "Ligue 1" },
  { key: "ned.1", name: "Eredivisie" },
  { key: "por.1", name: "Portugal" },
  { key: "ksa.1", name: "Saudita" }
];

function yyyymmdd(dateStr) {
  return String(dateStr || new Date().toISOString().slice(0, 10)).replaceAll("-", "");
}

function isoDate(dateStr) {
  return String(dateStr || new Date().toISOString().slice(0, 10));
}

async function espn(path) {
  const url = "https://site.api.espn.com/apis/site/v2/sports/soccer/" + path;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json,text/plain,*/*" } });
  if (!res.ok) throw new Error(`ESPN HTTP ${res.status}`);
  return res.json();
}

async function apiFootball(path) {
  if (!API_FOOTBALL_KEY) throw new Error("API_FOOTBALL_KEY não configurada no Render");
  const url = "https://v3.football.api-sports.io" + path;
  const res = await fetch(url, { headers: { "x-apisports-key": API_FOOTBALL_KEY, "Accept": "application/json" } });
  if (!res.ok) throw new Error(`API-Football HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors && Object.keys(json.errors).length) throw new Error("API-Football: " + JSON.stringify(json.errors));
  return json;
}

function normalizeGame(event, league) {
  const comp = event.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === "home") || competitors[0] || {};
  const away = competitors.find(c => c.homeAway === "away") || competitors[1] || {};
  const status = event.status || {};
  const type = status.type || {};
  return {
    id: event.id,
    leagueKey: league.key,
    league: league.name,
    date: event.date || "",
    time: event.date ? new Date(event.date).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
    status: type.description || type.detail || type.name || "",
    state: type.state || "",
    live: type.state === "in",
    minute: status.displayClock || "",
    home: { name: home.team?.displayName || home.team?.name || "", score: home.score ?? "" },
    away: { name: away.team?.displayName || away.team?.name || "", score: away.score ?? "" }
  };
}

app.get("/api/games", async (req, res) => {
  const date = isoDate(req.query.date);
  const dates = yyyymmdd(date);
  const out = [];
  const errors = [];
  await Promise.all(LEAGUES.map(async league => {
    try {
      const data = await espn(`${league.key}/scoreboard?dates=${dates}&limit=200`);
      (data.events || []).forEach(ev => out.push(normalizeGame(ev, league)));
    } catch (e) { errors.push({ league: league.name, error: String(e.message || e) }); }
  }));
  out.sort((a,b) => new Date(a.date) - new Date(b.date));
  res.json({ ok: true, date, total: out.length, games: out, errors });
});

function similar(a, b) {
  a = String(a || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  b = String(b || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (!a || !b) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const aw = a.split(/\s+/).filter(x => x.length > 2);
  const bw = b.split(/\s+/).filter(x => x.length > 2);
  return aw.some(x => bw.includes(x));
}

async function findApiFootballFixture({ date, home, away }) {
  const json = await apiFootball(`/fixtures?date=${date}`);
  const matches = json.response || [];
  return matches.find(m => {
    const h = m.teams?.home?.name || "";
    const a = m.teams?.away?.name || "";
    return (similar(h, home) && similar(a, away)) || (similar(h, away) && similar(a, home));
  }) || null;
}

function normalizeStats(statResponse) {
  const rows = [];
  (statResponse || []).forEach(teamBlock => {
    const team = teamBlock.team?.name || "";
    (teamBlock.statistics || []).forEach(s => rows.push({ team, name: s.type || "", label: s.type || "", value: s.value ?? "" }));
  });
  return rows;
}

function normalizeEvents(events) {
  return (events || []).map(e => ({
    minute: e.time?.elapsed ? String(e.time.elapsed) + "'" : "",
    team: e.team?.name || "",
    player: e.player?.name || "",
    assist: e.assist?.name || "",
    type: e.type || "",
    detail: e.detail || "",
    comments: e.comments || ""
  }));
}

function normalizeLineups(lineups) {
  const rows = [];
  (lineups || []).forEach(teamBlock => {
    const team = teamBlock.team?.name || "";
    (teamBlock.startXI || []).forEach(x => rows.push({ team, player: x.player?.name || "", number: x.player?.number || "", pos: x.player?.pos || "", type: "Titular" }));
    (teamBlock.substitutes || []).forEach(x => rows.push({ team, player: x.player?.name || "", number: x.player?.number || "", pos: x.player?.pos || "", type: "Reserva" }));
  });
  return rows;
}

async function espnSummaryFallback(league, id) {
  const summary = await espn(`${league}/summary?event=${id}`);
  const comp = summary.header?.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const teamStats = [];
  competitors.forEach(c => {
    const team = c.team?.displayName || "";
    (c.statistics || []).forEach(s => teamStats.push({ team, name: s.name || "", label: s.displayName || s.label || s.name || "", value: s.displayValue ?? s.value ?? "" }));
  });
  const events = (summary.plays || []).map(p => ({ minute: p.clock?.displayValue || "", team: p.team?.displayName || "", player: "", type: p.type?.text || "", detail: p.text || "", comments: "" }));
  return { teamStats, events, lineups: [] };
}

app.get("/api/game-details", async (req, res) => {
  const { date, home, away, league, espnId } = req.query;
  try {
    let source = "API-Football";
    let fixtureId = null;
    let teamStats = [], events = [], lineups = [];
    try {
      const fixture = await findApiFootballFixture({ date: isoDate(date), home, away });
      if (fixture) {
        fixtureId = fixture.fixture?.id;
        const [statsJson, eventsJson, lineupsJson] = await Promise.all([
          apiFootball(`/fixtures/statistics?fixture=${fixtureId}`).catch(() => ({ response: [] })),
          apiFootball(`/fixtures/events?fixture=${fixtureId}`).catch(() => ({ response: [] })),
          apiFootball(`/fixtures/lineups?fixture=${fixtureId}`).catch(() => ({ response: [] }))
        ]);
        teamStats = normalizeStats(statsJson.response);
        events = normalizeEvents(eventsJson.response);
        lineups = normalizeLineups(lineupsJson.response);
      } else {
        source = "ESPN fallback";
        const fb = await espnSummaryFallback(league, espnId);
        teamStats = fb.teamStats; events = fb.events; lineups = fb.lineups;
      }
    } catch (e) {
      source = "ESPN fallback";
      const fb = await espnSummaryFallback(league, espnId);
      teamStats = fb.teamStats; events = fb.events; lineups = fb.lineups;
    }
    res.json({ ok: true, source, fixtureId, teamStats, events, lineups, note: "API-Football só é usada ao clicar em estatísticas para economizar requests." });
  } catch (e) { res.status(500).json({ ok: false, error: String(e.message || e) }); }
});

app.listen(PORT, () => console.log(`Meu Futebol Live V3 rodando na porta ${PORT}`));
