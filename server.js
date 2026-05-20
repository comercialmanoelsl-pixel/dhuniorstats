const express = require("express");
const fetch = require("node-fetch");

const app = express();
const PORT = process.env.PORT || 3000;
const API_FOOTBALL_KEY = process.env.API_FOOTBALL_KEY || "";

app.use(express.static("public"));

const ESPN_LEAGUES = [
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
  { key: "nor.1", name: "Noruega" },
  { key: "por.1", name: "Portugal" },
  { key: "ksa.1", name: "Saudita" }
];

function isoDate(dateStr) {
  return String(dateStr || new Date().toISOString().slice(0, 10));
}
function yyyymmdd(dateStr) {
  return isoDate(dateStr).replaceAll("-", "");
}
function norm(s) {
  return String(s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
}
function gameKey(home, away) {
  return norm(home) + "_" + norm(away);
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

function normalizeEspnGame(event, league) {
  const comp = event.competitions?.[0] || {};
  const competitors = comp.competitors || [];
  const home = competitors.find(c => c.homeAway === "home") || competitors[0] || {};
  const away = competitors.find(c => c.homeAway === "away") || competitors[1] || {};
  const status = event.status || {};
  const type = status.type || {};
  return {
    source: "ESPN",
    id: event.id,
    espnId: event.id,
    fixtureId: "",
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

function normalizeApiGame(m) {
  const fixture = m.fixture || {};
  const league = m.league || {};
  const teams = m.teams || {};
  const goals = m.goals || {};
  const status = fixture.status || {};
  const short = status.short || "";
  const live = ["1H","2H","HT","ET","BT","P","SUSP","INT","LIVE"].includes(short);
  const finished = ["FT","AET","PEN"].includes(short);
  return {
    source: "API-Football",
    id: String(fixture.id || ""),
    espnId: "",
    fixtureId: fixture.id || "",
    leagueKey: "",
    league: league.name || "",
    date: fixture.date || "",
    time: fixture.date ? new Date(fixture.date).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "",
    status: status.long || short || "",
    state: live ? "in" : finished ? "post" : "pre",
    live,
    minute: status.elapsed ? String(status.elapsed) + "'" : "",
    home: { name: teams.home?.name || "", score: goals.home ?? "" },
    away: { name: teams.away?.name || "", score: goals.away ?? "" }
  };
}

app.get("/api/games", async (req, res) => {
  const date = isoDate(req.query.date);
  const out = [];
  const errors = [];

  await Promise.all(ESPN_LEAGUES.map(async league => {
    try {
      const data = await espn(`${league.key}/scoreboard?dates=${yyyymmdd(date)}&limit=200`);
      (data.events || []).forEach(ev => out.push(normalizeEspnGame(ev, league)));
    } catch (e) {
      errors.push({ source: "ESPN", league: league.name, error: String(e.message || e) });
    }
  }));

  try {
    const apiData = await apiFootball(`/fixtures?date=${date}`);
    (apiData.response || []).forEach(m => out.push(normalizeApiGame(m)));
  } catch (e) {
    errors.push({ source: "API-Football", error: String(e.message || e) });
  }

  const map = new Map();
  for (const g of out) {
    const key = gameKey(g.home.name, g.away.name);
    if (!key || key === "_") continue;
    const old = map.get(key);
    if (!old) {
      map.set(key, g);
    } else {
      // Prefer API-Football when available because it has fixtureId for stats.
      if (g.source === "API-Football") map.set(key, { ...old, ...g, espnId: old.espnId || g.espnId, leagueKey: old.leagueKey || g.leagueKey });
    }
  }

  const games = Array.from(map.values()).sort((a,b) => new Date(a.date) - new Date(b.date));
  res.json({ ok: true, date, total: games.length, games, errors });
});

function normalizeStats(statResponse) {
  const rows = [];
  (statResponse || []).forEach(teamBlock => {
    const team = teamBlock.team?.name || "";
    (teamBlock.statistics || []).forEach(s => rows.push({ team, label: s.type || "", value: s.value ?? "" }));
  });
  return rows;
}
function normalizeEvents(events) {
  return (events || []).map(e => ({
    minute: e.time?.elapsed ? String(e.time.elapsed) + "'" : "",
    team: e.team?.name || "",
    player: e.player?.name || "",
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

async function apiDetails(fixtureId) {
  const [statsJson, eventsJson, lineupsJson] = await Promise.all([
    apiFootball(`/fixtures/statistics?fixture=${fixtureId}`).catch(() => ({ response: [] })),
    apiFootball(`/fixtures/events?fixture=${fixtureId}`).catch(() => ({ response: [] })),
    apiFootball(`/fixtures/lineups?fixture=${fixtureId}`).catch(() => ({ response: [] }))
  ]);
  return {
    teamStats: normalizeStats(statsJson.response),
    events: normalizeEvents(eventsJson.response),
    lineups: normalizeLineups(lineupsJson.response)
  };
}

app.get("/api/game-details", async (req, res) => {
  const fixtureId = req.query.fixtureId;
  try {
    if (!fixtureId) throw new Error("Esse jogo não veio com fixtureId da API-Football. Atualize ou tente outro jogo.");
    const details = await apiDetails(fixtureId);
    res.json({ ok: true, source: "API-Football", fixtureId, ...details });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e.message || e) });
  }
});

app.listen(PORT, () => console.log(`Meu Futebol Live V4 rodando na porta ${PORT}`));
