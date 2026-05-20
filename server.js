
const express = require("express");
const fetch = require("node-fetch");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static("."));

async function sofa(path) {
  const url = "https://www.sofascore.com/api/v1" + path;
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      "Accept": "application/json,text/plain,*/*",
      "Referer": "https://www.sofascore.com/"
    }
  });
  if (!res.ok) throw new Error(`SofaScore HTTP ${res.status}`);
  return res.json();
}

function placar(ev) {
  const h = ev.homeScore && ev.homeScore.current;
  const a = ev.awayScore && ev.awayScore.current;
  if (h === undefined || a === undefined) return "";
  return `${h} x ${a}`;
}

function minuto(ev) {
  if (!ev.status) return "";
  if (ev.status.type !== "inprogress") return ev.status.description || ev.status.type || "";
  const inicio = ev.time && ev.time.currentPeriodStartTimestamp;
  if (!inicio) return "AO VIVO";
  let seg = Math.max(0, Math.floor(Date.now() / 1000) - inicio);
  if ((ev.status.description || "").toLowerCase().includes("2nd")) seg += 45 * 60;
  const m = Math.floor(seg / 60);
  const s = seg % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

app.get("/api/jogos", async (req, res) => {
  try {
    const date = req.query.date || new Date().toISOString().slice(0, 10);
    const json = await sofa(`/sport/football/scheduled-events/${date}`);
    const jogos = (json.events || []).map(ev => ({
      id: ev.id,
      campeonato: (ev.tournament && ((ev.tournament.uniqueTournament && ev.tournament.uniqueTournament.name) || ev.tournament.name)) || "",
      casa: (ev.homeTeam && ev.homeTeam.name) || "",
      fora: (ev.awayTeam && ev.awayTeam.name) || "",
      status: (ev.status && (ev.status.description || ev.status.type)) || "",
      tipoStatus: (ev.status && ev.status.type) || "",
      minuto: minuto(ev),
      placar: placar(ev),
      inicio: ev.startTimestamp ? new Date(ev.startTimestamp * 1000).toLocaleString("pt-BR") : "",
      url: `https://www.sofascore.com/pt/football/match/${ev.slug || ""}#id:${ev.id}`
    }));
    res.json({ ok: true, date, total: jogos.length, jogos });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.get("/api/jogo/:id", async (req, res) => {
  const id = req.params.id;
  try {
    const evJson = await sofa(`/event/${id}`);
    const ev = evJson.event;
    let statsTime = [], eventos = [], jogadores = [];

    try {
      const st = await sofa(`/event/${id}/statistics`);
      (st.statistics || []).forEach(bloco => {
        (bloco.groups || []).forEach(grupo => {
          (grupo.statisticsItems || []).forEach(item => {
            statsTime.push({ time: (ev.homeTeam && ev.homeTeam.name) || "Casa", estatistica: item.name, valor: item.home });
            statsTime.push({ time: (ev.awayTeam && ev.awayTeam.name) || "Fora", estatistica: item.name, valor: item.away });
          });
        });
      });
    } catch (e) {}

    try {
      const inc = await sofa(`/event/${id}/incidents`);
      eventos = (inc.incidents || []).map(i => ({
        minuto: i.time || "",
        time: i.isHome ? ((ev.homeTeam && ev.homeTeam.name) || "") : ((ev.awayTeam && ev.awayTeam.name) || ""),
        jogador: (i.player && i.player.name) || "",
        tipo: i.incidentType || "",
        detalhe: i.incidentClass || ""
      }));
    } catch (e) {}

    try {
      const lu = await sofa(`/event/${id}/lineups`);
      function addPlayer(p, time) {
        const player = p.player || {};
        const s = p.statistics || {};
        jogadores.push({
          time,
          jogador: player.name || "",
          posicao: p.position || player.position || "",
          nota: p.rating || s.rating || "",
          minutos: s.minutesPlayed || p.minutesPlayed || "",
          gols: s.goals || "",
          assistencias: s.goalAssist || s.assists || "",
          chutesTotal: s.totalShots || "",
          chutesGol: s.shotsOnGoal || s.shotsOnTarget || "",
          passes: s.accuratePass || "",
          passesChave: s.keyPass || "",
          desarmes: s.totalTackle || s.tackles || "",
          interceptacoes: s.interceptionWon || "",
          duelos: s.totalDuels || "",
          duelosGanhos: s.duelWon || "",
          faltasSofridas: s.wasFouled || "",
          faltasCometidas: s.fouls || "",
          amarelo: s.yellowCard || "",
          vermelho: s.redCard || ""
        });
      }
      (lu.home && lu.home.players || []).forEach(p => addPlayer(p, (ev.homeTeam && ev.homeTeam.name) || "Casa"));
      (lu.away && lu.away.players || []).forEach(p => addPlayer(p, (ev.awayTeam && ev.awayTeam.name) || "Fora"));
    } catch (e) {}

    res.json({
      ok: true,
      jogo: {
        id: ev.id,
        campeonato: (ev.tournament && ((ev.tournament.uniqueTournament && ev.tournament.uniqueTournament.name) || ev.tournament.name)) || "",
        casa: (ev.homeTeam && ev.homeTeam.name) || "",
        fora: (ev.awayTeam && ev.awayTeam.name) || "",
        status: (ev.status && (ev.status.description || ev.status.type)) || "",
        minuto: minuto(ev),
        placar: placar(ev)
      },
      statsTime, eventos, jogadores
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: String(err.message || err) });
  }
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
