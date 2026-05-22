# DhuniorStats V33.2 Search Live Home

Correções:
- Logo DhuniorStats clicável volta para início.
- Busca por Enter.
- Botão de lupa.
- Busca real em `/api/search-games`, procurando em janela de datas.
- Botão Ao Vivo busca `/api/live-games`, não apenas filtro local.
- Home com Jogos em Destaque.
- Mantém League Fetch da V33.1.

Observação:
Se um jogo ao vivo como Sudtirol não aparecer, a API conectada pode não estar retornando essa liga no endpoint live/global.


V34:
- Campo ao vivo estilo Bet365/SofaScore simplificado.
- Bola se move conforme posse/finalizações.
- Estrutura estabilizada para Render.
- Sem alteração arriscada no backend.


## V34.1 Live Fix
- Corrigido botão Ao Vivo.
- `/api/live-games` agora tenta:
  1. API-Football live=all
  2. API-Football por data
  3. SportMonks por data
  4. ESPN fallback por ligas mapeadas
- Adicionado `/api/debug-live` para verificar quais fontes retornam live.


## V34.2 Lineups + Team Fix
- Escalação redesenhada em cards por time.
- Remove letras sobrepostas.
- Se fixture vier sem apiFootballId, backend resolve por nome dos times + data.
- Perfil dos times resolve teamId por nome quando IDs entre APIs não batem.
- Últimos jogos e jogadores ficam mais prováveis de aparecer.
- Escalação continua automática: oficial quando API liberar, provável apenas como notícia/contexto.
