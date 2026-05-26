# DhuniorStats V45 SportMonks Core Clean

Novo endpoint principal:
- /api/match-full?fixtureId=ID
- /api/match-full?home=Corinthians&away=Atletico-MG&date=2026-05-24

O que muda:
- Resolve fixture correto quando não tem ID.
- Busca fixture detalhada com includes completos.
- Normaliza participants, score, statistics, events, lineups, formations, trends, comments, news, sidelined e predictions.
- Usa team_id da lineup para separar mandante/visitante.
- Usa cache curto por fixture para evitar loop/render infinito.
- Frontend busca match-full uma vez ao abrir a partida e só depois renderiza.

Tela debug:
- /match-full.html?fixtureId=19621919
