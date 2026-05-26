# DhuniorStats V46 Match Center 99.9

Novo endpoint central:
- /api/match-center?fixtureId=ID
- /api/match-center?home=Lanús&away=Mirassol&date=2026-05-26
- /api/match-center/audit-day?date=2026-05-26&limit=20

Tela debug:
- /match-center.html?fixtureId=ID

Correções:
- SportMonks como fonte principal.
- Endpoint central normaliza tudo antes do frontend.
- Escalações separadas por team_id.
- Se não houver campo/posição confiável, mostra duas colunas bonitas: mandante e visitante, titulares e banco.
- Estatísticas, eventos, contexto, trends, comments e IA vêm do endpoint central.
