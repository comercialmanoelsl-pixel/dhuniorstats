# DhuniorStats V18 — SportMonks principal

Novidades:
- SportMonks como fonte principal.
- API-Football como fallback.
- Fallback histórico/contextual para não deixar tela vazia.
- Correção para manter o jogo selecionado e não resetar para o primeiro.
- Aba Pós-jogo.
- Notícias filtradas.

Variáveis no Render:
SPORTMONKS_KEY
API_FOOTBALL_KEY
NEWS_API_KEY
OPENWEATHER_KEY
THESPORTSDB_KEY

Build: npm install
Start: npm start


## V18.2 — Correção de precisão das estatísticas
- Corrigido mapeamento de time: estatísticas agora são atribuídas pelo nome/participant_id do mandante e visitante, não pela ordem em que a API retorna.
- Corrigido mapeamento de finalizações: usa goal-attempts/shots-total e não confunde com shots-on-target.
- Posse, escanteios e chutes no gol usam type_id/código oficial quando disponível.
