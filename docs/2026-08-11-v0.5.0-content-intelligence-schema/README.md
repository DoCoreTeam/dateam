# 콘텐츠 인텔리전스 — 구현 문서 색인

원본 설계: `newplan/content_intelligence_design_v0.4.0_2026-08-11.html`

설계서 §12가 정한 착수 순서: **v0.5.0 스키마 → v0.6.0 API 계약 → Slice 1**. 건너뛰기 금지.

## v0.5.0 — DB 스키마 (이 폴더)

| 문서 | 내용 |
|---|---|
| `00-integration-decisions.md` | 재사용 vs 신규 경계, 표면 설계, 디자인 시스템 판정(shadcn 기각 근거) |
| `01-db-schema.md` | 전 테이블·필드·타입·관계·인덱스·ENUM 17종·RLS·마이그레이션 분할 |
| `02-ucm-and-connectors.md` | UCM 모델, 분석 방법론(배수·백분위·신뢰도), 커넥터 계약, 게시 어댑터 — **부재한 v0.2.0 흡수분** |
| `03-screen-a01-performance.md` | A01 성과 화면 스펙 — 설계서가 미작성으로 남긴 부분 |

## v0.6.0 — API 계약

`docs/2026-08-11-v0.6.0-content-intelligence-api/`

| 문서 | 내용 |
|---|---|
| `01-api-contract.md` | 엔드포인트 전수, 요청/응답 스키마, 에러 코드 12종, 잡 워커 계약 |
| `02-command-catalog.md` | Command 전체 목록과 위험도 3등급, AI 어시스턴트 도구 정의 |
| `03-slice1-execution-plan.md` | GRAPH 승격 판정, 노드 정의, HUMAN_GATE 위치 |

## 마이그레이션 (작성 완료, **미적용**)

`supabase/migrations/184~190_ci_*.sql` — 35개 테이블, ENUM 17종, RLS 정책 48개, 인덱스 86개.

로컬 일회용 Postgres 16에서 전량 실행 검증 완료(재실행 멱등성 포함). 운영 적용은 승인 후:

```bash
PGPASSWORD='...' ./scripts/migrate.sh 184_ci_enums_and_workspace.sql
# 185 → 186 → 187 → 188 → 189 → 190 순차
```

기존 테이블은 한 줄도 수정하지 않는다. CI는 순수 추가분이며, 사내 업무 스키마와 FK가 없다.
