# DhuniorStats V23 — Layout + Dados Corretos

Objetivo:
- Layout estilo SofaScore/Flashscore com lista fixa de partidas à esquerda.
- Ao clicar no jogo, abre página da partida no centro com subabas.
- Correção de placar:
  - jogo finalizado usa score final;
  - jogo ao vivo usa score atual;
  - API-Football pode corrigir placar final quando SportMonks vier parcial;
  - cache desativado no backend.

Endpoints úteis:
- /api/health
- /api/debug-game?sportmonksId=ID_DO_JOGO

Variáveis:
SPORTMONKS_KEY
API_FOOTBALL_KEY
NEWS_API_KEY
OPENWEATHER_KEY
GEMINI_API_KEY

Build:
npm install

Start:
npm start
