# DhuniorStats V10 — Contexto Real

- Remove “chutômetro” inventado.
- Separa estatísticas reais: finalizações, chutes no gol, posse e escanteios.
- Pré-jogo usa base real da API-Football quando disponível:
  - últimos jogos;
  - casa/fora;
  - H2H;
  - tabela;
  - estatísticas de temporada.
- Se não houver dados suficientes, mostra “dados insuficientes”.

Render:
Build Command: npm install
Start Command: npm start

Environment:
API_FOOTBALL_KEY = sua chave da API-Football
