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


## V18.1
- Corrigido mapeamento de estatísticas da SportMonks.
- Finalizações totais não confundem mais com chutes no gol.
- Se não vier total shots, soma on target + off target + blocked.
