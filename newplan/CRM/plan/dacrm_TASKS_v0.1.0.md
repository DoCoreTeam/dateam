# dacrm TASKS v0.1.0

에이전트는 위에서 아래로 진행한다. 완료 기준 명령이 전부 통과해야 DONE. HUMAN GATE 는 사람 작업 후 재개.
버전은 커밋 메시지에 동일 기록. 기준 문서: 구현명세서 v0.1.0(절 번호 참조)

## Phase 0 기반 (목표 v0.5.0)

| ID | 버전 | 태스크 | 산출물 | 완료 기준 | 상태 |
|---|---|---|---|---|---|
| T0-01 | v0.5.0 | 호스트 정합 확인 | docs/host-check.md: 호스트의 Next, Prisma, Supabase 버전과 인증 세션 구조, 사이드바 메뉴 정의 파일 위치, 모델명 충돌 목록 | 문서에 5개 항목 전부 기재, 충돌 모델 0건 확인 | DONE (docs/crm/host-check.md, 충돌 0건. ⚠️ 호스트에 Prisma 부재 — T0-02~05 방침 결정 필요, 문서 5절) |
| T0-02 | v0.5.1 | 스키마 병합 | crm_schema_v0.1.0.prisma 를 schema.prisma 에 병합, 마이그레이션 생성 | `pnpm prisma validate` 통과 + 마이그레이션 적용 (※ `migrate dev`는 운영 DB 205테이블을 드리프트로 보고 리셋을 제안하므로 **금지** → `migrate diff --from-empty` + `scripts/migrate.sh` 로 치환) | DONE (apps/web/prisma/schema.prisma, supabase/migrations/198_crm_core.sql 적용완료: 205→229테이블, enum 16, RLS 24/24 선잠금, 기존 데이터 무손상) |
| T0-03 | v0.5.2 | raw SQL 마이그레이션 | RLS 전 테이블, CHECK 4종(명세 2.3) | 마이그레이션 적용 후 psql 로 제약 존재 확인 스크립트 통과 | DONE (199_crm_rls_check.sql 적용. `scripts/crm-check-db.sh` 9/9 통과, 음성테스트 `supabase/tests/crm_constraints_negative.sql` 6/6. ⚠️ 발견: postgres 롤이 rolbypassrls=true → RLS 는 PostgREST 경로만 보호, Prisma 경로는 앱 가드(T0-04)가 책임. T0-10 은 전용 롤 필요) |
| T0-04 | v0.5.3 | workspace guard | modules/crm/db/{client,workspace-guard}.ts | 단위 테스트: 필터 자동 주입, 불일치 workspaceId 예외, TENANT_FREE 통과 | DONE (apps/web/lib/crm/db/{client,workspace-guard}.ts + domain/errors.ts. 단위 25/25, 전체 1868/1868, tsc·lint·design:check 통과. 명세 2.2의 "전 테이블 workspaceId" 전제가 틀려(24중 17개) 5분류로 구현 — 분류 누락 시 실패하는 스키마 대조 가드 포함, 일부러 깨서 확인) |
| T0-05 | v0.5.4 | withCrmTx 와 감사 | 트랜잭션 래퍼(SET LOCAL), audit 헬퍼 | 테스트: 트랜잭션 내 set_config 확인, 실패 시 audit 도 롤백 | DONE (lib/crm/db/{tx,audit}.ts. 단위 12/12 + 실DB 5/5(supabase/tests/crm_tx_setconfig.sql). set_config 3번째 인자 true 검증 포함 — false면 세션에 남아 풀 재사용 시 교차 오염됨을 실DB로 확인) |
| T0-06 | v0.5.5 | 상태 머신 | domain/state-machines.ts, errors.ts | 단위 테스트: 3.4 전이표 전 케이스(허용, 금지) 통과 | DONE (lib/crm/domain/state-machines.ts. 28/28 — 딜 9조합·녹음 25조합·제안 25조합 전수 대조 + 예산 판정 7건. errors.ts 는 T0-04 에서 선행 생성. WON→LOST 를 허용시켜 실제로 실패시킨 뒤 원복) |
| T0-07 | v0.5.6 | 시드 | 워크스페이스 1, 멤버(본인), 파이프라인 4종(GPU 인프라, 파트너십, 공공, KDC 제품)과 스테이지 | `pnpm prisma db seed` 후 조회 스크립트로 검증 | TODO |
| T0-08 | v0.5.7 | 정합성 테스트 1차 | tests/crm/integrity/ DI-01~09 (격리, 중복, 전이) | `pnpm test integrity` 통과 | TODO |
| T0-09 | v0.5.8 | 정합성 테스트 2차 | DI-13~18, DI-23 (관문, 예산, 잠금, 세그먼트) | `pnpm test integrity` 통과 | TODO |
| T0-10 | v0.5.9 | RLS 격리 테스트 | 2개 워크스페이스 시드, service role 에서 set_config 만으로 격리되는지 | `pnpm test rls` 통과 | TODO |
| T0-11 | v0.5.10 | 기존 데이터 이관 스크립트 | scripts/migrate-v04.ts: 기존 dacrm 데이터와 호스트 프로젝트관리의 영업 항목을 딜로 이관, 드라이런 모드 | 드라이런 리포트 생성, 왕복 검증(건수, 금액 합) 통과 | TODO |
| T0-12 | v0.5.11 | Phase 0 게이트 | 전체 검증 | `pnpm typecheck && pnpm lint && pnpm test && pnpm build` 전부 통과, v0.5.0 태그 | TODO |

## Phase 1 코어 CRM (목표 v0.6.0 ~ v0.7.0)

| ID | 버전 | 태스크 | 산출물 | 완료 기준 | 상태 |
|---|---|---|---|---|---|
| T1-01 | v0.6.0 | CRM 레이아웃과 메뉴 | app/crm/layout.tsx, 호스트 사이드바에 CRM 섹션 8개(명세 1.2 허용 수정) | Playwright: 메뉴 진입, 권한 없는 사용자 차단 | TODO |
| T1-02 | v0.6.1 | 회사, 인물 CRUD | 목록(커서), 레코드 3열, PATCH 낙관적 잠금 | API 테스트 + DI-02, 03, 18 재실행 통과 | TODO |
| T1-03 | v0.6.2 | 딜 CRUD 와 보드 | 테이블과 보드 뷰, 드래그 이동, won/lost 모달 | Playwright: 드래그 이동, won 금액 강제, DI-05~08 통과 | TODO |
| T1-04 | v0.6.3 | 태스크와 타임라인 | CrmTask CRUD, 레코드 타임라인 | API 테스트, 완료 처리 시 activity 기록 확인 | TODO |
| T1-05 | v0.6.4 | 원터치 생성(mock AI) | quick-create 서비스 + 갭필 모달, mock 러너 픽스처 | Playwright: 텍스트 등록 → 회사, 인물, 딜 생성 → 갭필 표시 | TODO |
| T1-06 | v0.6.5 | 제안 관문과 인박스 | suggestion.service, apply.ts, 인박스 카드(수락, 수정, 거절) | DI-12, 13 통과, Playwright 수락 플로우 | TODO |
| T1-07 | v0.6.6 | 예산 서비스 | budget.service, 설정 UI(상한), 차단 배너 | DI-14, 15 통과, E2E 9번 시나리오 통과 | TODO |
| T1-08 | v0.6.7 | 설정 체계 | CrmAppSetting CRUD UI, 시크릿 암호화, 감사 기록 | 테스트: 오버라이드 우선순위, 시크릿 마스킹 | TODO |
| T1-09 | v0.6.8 | HUMAN GATE: Google OAuth | 사람: GCP 프로젝트, 내부(Internal) 동의 화면, 클라이언트 ID 발급, Workspace 조직 일치 확인(C-02) | 시크릿이 설정에 등록되면 재개 | TODO |
| T1-10 | v0.6.9 | Gmail, Calendar 캡처 | IntegrationConnection 연결 플로우, gmail-sync 잡(3.5) | mock 픽스처로 DI-21 통과, 실계정 스모크 1회 | TODO |
| T1-11 | v0.6.10 | 병합 | duplicate 스캔 잡, 병합 서비스, 검토 UI | DI-10, 11 통과 | TODO |
| T1-12 | v0.7.0 | Phase 1 게이트 | 리포트 v1(파이프라인 합계), 전체 검증, 실사용 시작 | 전체 명령 통과, 본인 실데이터 1주 사용 회고 문서 | TODO |

## Phase 2 이후

Meeting Mode(STT 어댑터, HUMAN GATE: Clova 와 Deepgram 키), 5축 실모델 연결과 골든셋, 자동화 엔진, 리포트 확장은 Phase 1 게이트 통과 후 본 파일 v0.2.0 으로 상세화한다

문서 끝
