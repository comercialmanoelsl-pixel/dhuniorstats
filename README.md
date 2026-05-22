# DhuniorStats V33 API Aggregator

Objetivo:
Usar todas as APIs configuradas no Render para enriquecer os dados sem inventar informação.

APIs consideradas:
- SPORTMONKS_KEY
- API_FOOTBALL_KEY
- FOOTBALL_DATA_KEY
- THESPORTSDB_KEY
- ODDS_API_KEY
- NEWS_API_KEY
- GEMINI_API_KEY

Principais mudanças:
- Lineups oficiais com prioridade SportMonks + API-Football.
- Escalação não é inventada.
- Se ainda não há escalação oficial, mostra aviso e notícias relacionadas.
- Atualização automática da partida a cada 30 segundos.
- NewsAPI usada para notícias da partida/escalação provável.
- Odds endpoint preparado com ODDS_API_KEY.
- Health mostra quais APIs estão conectadas.
- Frontend mostra fonte da escalação.
- Quando a API liberar escalação minutos antes do jogo, o site atualiza sozinho.

Importante:
Provável escalação só aparece como notícia/contexto, nunca como oficial.
Escalação oficial só aparece quando vem de API confiável.

Build:
npm install

Start:
npm start
