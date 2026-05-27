# DhuniorStats V53 Match Centre Pro

Esta versão consolida os estudos da SportMonks em um núcleo profissional.

## Novo endpoint principal

`GET /api/match-centre-pro/:fixtureId`

Ele aplica:

- `/core/types` com cache local para resolver `type_id`
- `participants.meta.location` como fonte de mandante/visitante
- `lineups.team_id` para separar escalação
- `events.participant_id` para timeline
- `statistics.participant_id` para estatísticas
- mapa oficial de estados da partida
- mapa de eventos: gol, VAR, cartões, substituições, pênaltis
- mapa de posições e lineup types
- IA contextual baseada nos dados retornados

## Nova tela

`/match-centre-pro.html?fixtureId=ID`

## O que foi aplicado

1. Estatísticas
- Busca `statistics` sem `statistics.type` pesado em produção.
- Resolve nomes via `/core/types` cacheado.
- Mapeia finalizações, chutes no gol, posse, escanteios, ataques perigosos, cartões, passes, xG etc.

2. Timeline
- Usa eventos oficiais.
- Identifica gol, cartão, substituição, pênalti e VAR.

3. Escalações
- Separação correta por `team_id`.
- Titulares, banco, posição, país, imagem do jogador.

4. Estados ao vivo
- NS, 1H, HT, 2H, FT, ET, penalties, delayed, suspended etc.

5. Contexto IA
- Usa estatísticas + eventos + escalações + estado do jogo + desfalques.

## Endpoints adicionados

- `/api/types-map`
- `/api/match-centre-pro/:fixtureId`
- `/api/match-centre-pro/resolve/by-game?home=...&away=...&date=...`

## Revisão

Este pacote não remove as telas anteriores. Ele cria um núcleo novo e uma tela nova para testar com segurança antes de substituir 100% da tela principal.


# V54 - Production UX + Performance

Aplicado com base nas críticas de UX/performance:

## 1. Debug escondido em produção
- `DHUNIOR_PROD=true` por padrão.
- Links/telas técnicas são ocultadas no front.
- `/api/app-config` informa se está em modo produção/debug.

## 2. Proteção contra spam de API
- Middleware simples de proteção contra muitas chamadas por segundo no mesmo endpoint/IP.
- Botões de carregamento ficam temporariamente desabilitados.
- O botão manual de refresh é escondido visualmente.

## 3. Auto refresh controlado
- Ao vivo: 30s
- Pré-jogo: 90s
- Finalizado: sem polling
- Pausa quando a aba do navegador está oculta.

## 4. Mobile UX
- Tabs e menus com scroll horizontal.
- Melhor comportamento no celular.
- Cards e grid adaptáveis.

## 5. Empty states
- Mensagens amigáveis para carregando, sem dados, sem partida selecionada e erro.

## 6. Warmup
- `/api/warmup` para ping externo e reduzir cold start no Render.

## Nova tela:
- `/producao.html`
