# DhuniorStats V41 SportMonks Components Core

Nova tela: /components.html

Novos endpoints:
- /api/sm/components/fixture/:id
- /api/sm/components/calendar?date=YYYY-MM-DD
- /api/sm/components/team/:id
- /api/sm/components/standings/:seasonId
- /api/sm/components/player/:id
- /api/sm/components/head-to-head?team1=ID&team2=ID
- /api/sm/components/topscorers/:seasonId

Aplicado:
- casa/fora por participants.meta.location
- eventos por participant_id
- estatísticas por location/participant_id
- lineups por participant_id
- desfalques/suspensos
- predictions/trends/news quando disponíveis
- sem inventar dados
