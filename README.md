# DhuniorStats V32 Core Real

Esta versão não limita times e não limita jogos.

Principais correções:
- /api/games busca todos os jogos do dia.
- SportMonks com paginação.
- API-Football como fonte adicional.
- ESPN como fallback público.
- Merge por mandante/visitante/data.
- Lineups para todos os jogos quando a API entregar.
- Fallback de lineups SportMonks -> API-Football.
- Estatísticas não aparecem antes do jogo se a API não enviar.
- Sem heatmap fake.
- Sem odds fake.
- Sem escalação fake.
- Home e match page com dados reais/avisos honestos.
- Arquivos separados em CSS/JS para manutenção real.

Variáveis no Render:
SPORTMONKS_KEY
API_FOOTBALL_KEY
NEWS_API_KEY
GEMINI_API_KEY

Build:
npm install

Start:
npm start


## V32.1
Correção:
- Adicionado app.listen no final do server.js.
- Render agora consegue manter o servidor online.
