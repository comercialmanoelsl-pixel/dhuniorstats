# DhuniorStats V42 Components Integrated

Correção principal:
A V41 criou /components.html como teste. A V42 integra os dados da SportMonks Components dentro da tela principal do jogo.

Agora, ao abrir uma partida SportMonks:
- busca /api/sm/components/fixture/:id automaticamente
- corrige placar/casa/fora usando participants.meta.location
- usa statistics normalizadas nas estatísticas
- usa events reais na timeline
- usa lineups por participant_id na aba Escalações
- usa sidelined/predictions/news na aba Contexto
- mostra cobertura com status dos Components
- não inventa dados se a API não retornar

Abas melhoradas:
- Estatísticas
- Timeline
- Escalações
- Leitura IA
- Contexto
- Cobertura

Se uma partida não tiver lineups/statistics/events na SportMonks, o site mostra indisponível, não inventa.
