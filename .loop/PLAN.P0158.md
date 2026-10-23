# PLAN newAX: teamda 의 모든 기능을 CLI 로
플랜 ID: P0158
플랜 버전: v0.1.4
상태: 진행중
지시: ins_0318
목표 버전: v0.11.61
푸시: 모음
작성: 2026-10-23
시작 커밋: ff2160d2

## 목표
- 웹에서 사람이 하는 동작 전부(라우트 메서드와 서버 액션, 추출기 실측 859개)를 `teamda` CLI 로 똑같이 할 수 있다
- 기능 정의 표에 한 줄을 더하면 공개 API 경로, openapi.json, 개발자센터 문서, CLI 명령이 같이 생긴다, 정의가 없으면 cli-parity 가 실패한다
- 키에 범위(read write approve send delete admin)와 만료일이 있고, 범위 밖 위험 동작은 승인 요청(202)이 된다

## 범위 밖
- git push, 운영 배포, 운영 DB 마이그레이션 적용, npm 게시, 저장소 브랜치 보호 설정 (사용자 몫, 보고에 방법만)
- 구 CRM accounts contacts deals 공개 API 를 CLI 명령으로 만들기 (대응표에 「이관 중, 새 CRM 명령으로 대체」)
- 화면 버그 수정 (docs/cli/발견.md 에 적기만), 예외는 서버 견적서 내보내기의 REQ-047
- 작업 브랜치 feat/teamda-cli: 같은 작업 트리를 다른 세션(P0157)이 쓰고 있어 브랜치를 바꾸면 그 세션이 깨짐, 프로젝트 규정대로 main 에 커밋하고 모음으로 안 밂

## 완료 정의
- pnpm typecheck, pnpm test, pnpm build 통과
- node scripts/cli-parity-check.mjs 가 「대응 안 된 줄 0, 시험 안 된 줄 0」 으로 종료 코드 0
- teamda help --json 이 모든 명령과 범위를 냄, teamda.exe 빌드 산출
- 지침 파일 다섯 맨 위에 필수 문단이 그대로 있음, PR 템플릿과 CI cli-parity 작업 있음
- 사용자 노출 문자열은 전부 lib/terms 키 사용
- 설정값은 env 추가 없이 DB 저장 + UI 관리 (해당 시)

## 참조
- 지시 원문 ins_0318 (총괄 작업: teamda 의 모든 기능을 CLI 로)
- docs/cli/00-현황.md, docs/cli/01-계획.md, docs/cli/02-기능대응표.md
- LOOP.md 7절 보안 기준

## 항목

### I01 현황 계획 문서와 기능 추출기
상태: 통과
모드: 경량
범위: docs/cli/00-현황.md (신규), docs/cli/01-계획.md (신규), docs/cli/발견.md (신규), scripts/cli/extract-operations.mjs (신규)
감사 기준:
- node scripts/cli/extract-operations.mjs 가 라우트 메서드와 서버 액션을 JSON 으로 내고 개수가 00-현황.md 에 적힌 수와 같음
- 00-현황.md 에 지시 0장 항목 일곱 자리가 파일 경로와 함께 있음 (못 찾은 것은 못 찾음)
- 보안: 해당 없음, 문서와 읽기 전용 스크립트, 키 쿠키 값 없음 (grep ax_live_ 0건)
의존: 없음

### I02 기능 정의 표와 대응표 생성, cli-parity-check 첫 판
상태: 통과
모드: 경량
범위: apps/web/lib/actions/defs/ (신규), apps/web/lib/actions/types.ts (신규), apps/web/lib/actions/openapi.ts (신규), apps/web/lib/actions/generated/ (신규 생성물), scripts/cli/naming.mjs (신규), scripts/cli/extract-operations.mjs, scripts/cli/gen.mjs (신규), scripts/cli-parity-check.mjs (신규), docs/cli/02-기능대응표.md (신규 생성물)
감사 기준:
- 추출된 동작마다 정의 한 줄(이름 범위 CLI 명령)이 있고 없으면 cli-parity-check 가 종료 코드 1
- 대응표에 8개 영역 동작이 다 있음, 검사 출력이 「전체 n / CLI 0」 꼴로 나옴
- 범위 없는 정의를 일부러 넣으면 검사가 실패함 (깨 봄)
- 보안: 범위 판정 표 자체가 보안 경계, approve send delete admin 분류를 이름 규칙과 손 검토로 확인
의존: I01

### I03 키 범위 만료일 승인요청 멱등 감사 표 마이그레이션
상태: 통과
모드: 중량
범위: supabase/migrations/318_api_key_scopes.sql (신규)
감사 기준:
- api_keys 에 scopes text[] 기본 {read}, expires_at, purpose, 기존 행은 read 로
- api_approval_requests, api_idempotency, api_write_audit 표, 같은 마이그레이션에서 RLS 켬, TO public 없음
- 쓰기 분당 한도 함수 record_api_key_write_hit, search_path 고정, anon authenticated 실행 회수
- 보안: rls-baseline.test.ts 통과, 정책 대상 authenticated 또는 서비스롤 전용
의존: 없음

### I03a I02 생성물이 가드 셋을 깨는 것 고침
상태: 통과
모드: 경량
범위: scripts/cli/gen.mjs, apps/web/lib/actions/generated/, apps/web/scripts/route-census.mjs
감사 기준:
- route-census.test.ts 통과, 창구 인구조사가 생성된 관문 표를 「화면에 적힘」으로 세지 않음 (사유 주석)
- glossary.test.ts 통과, 관문 표 table.ts 에 소스 주석에서 온 요약 글이 안 실림 (금지어 0, 「—」 기준선 그대로)
- node scripts/cli-parity-check.mjs 종료 코드 0
- 보안: 해당 없음, 생성기와 읽기 전용 조사 스크립트
의존: I02

### I04 키 인증에 범위와 만료, 기존 공개 쓰기의 범위
상태: 통과
모드: 중량
범위: apps/web/lib/publicApiAuth.ts, apps/web/lib/public-api/scopes.ts (신규), apps/web/lib/public-api/scopes.test.ts (신규), apps/web/app/api/public/v1/settings/route.ts, apps/web/app/api/public/v1/suppliers/route.ts, apps/web/app/api/public/v1/quote/route.ts, apps/web/package.json
감사 기준:
- 만료된 키 403, read 키로 PATCH settings 403 + requiredScope admin, POST suppliers pool-stock 은 write (시험)
- 실제 권한 = 계정 권한 ∩ 키 범위 (시험)
- 보안: key-gate.test.ts api-auth-surface.test.ts 통과, 범위 검사를 빼면 시험이 실패함 (깨 봄)
의존: I03

### I05 키 만들기 화면에 범위 만료일 쓰는 곳
상태: 통과
모드: 중량
범위: apps/web/app/api/user/api-keys/route.ts, apps/web/app/(member)/api-keys/page.tsx, apps/web/app/admin/api/ApiKeysPanel.tsx (관리자 키 목록 실제 자리, admin/api-keys/page.tsx 는 그리로 넘기기만 함), apps/web/lib/terms/api-key.ts (신규), apps/web/lib/terms/index.ts, apps/web/lib/public-api/key-create.ts (신규), apps/web/lib/public-api/key-create.test.ts (신규), apps/web/package.json
감사 기준:
- 만들기에 범위 체크(기본 read), 만료일(기본 90일), 쓰는 곳 이름, 목록에 범위와 만료일 (실브라우저 또는 확인 못 함 기록)
- zod 로 범위 값 검증, 모르는 범위 400
- 보안: 키 값은 만든 직후 한 번만, 목록에는 앞자리만
의존: I04

### I06 키 소유자로 내부 처리 함수 부르기
상태: 통과
모드: 중량
범위: apps/web/lib/actions/acting-as.ts (신규), apps/web/lib/actions/acting-session.ts (신규), apps/web/lib/supabase/server.ts, apps/web/lib/actions/acting-as.test.ts (신규)
감사 기준:
- 관문 안에서 createClient 가 쿠키 대신 키 소유자 세션을 씀, 관문 밖에서는 지금과 똑같음 (시험)
- 세션은 서비스롤 generateLink 와 verifyOtp 로 만들고 사용자별 메모리 캐시, 토큰 값은 로그에 안 찍힘
- 보안: 관문 밖 요청이 acting 문맥을 만들 길이 없음 (AsyncLocalStorage 를 관문만 엶, 시험)
의존: I04

### I07 공개 API 관문, 정의에서 자동 등록
상태: 대기
모드: 중량
범위: apps/web/app/api/public/v1/[...path]/route.ts (신규), apps/web/lib/actions/dispatch.ts (신규), apps/web/lib/actions/generated/ (신규 생성물), apps/web/lib/actions/dispatch.test.ts (신규), 겹치는 공개 라우트의 빠진 메서드 재수출
감사 기준:
- 정의 하나가 /api/public/v1/<내부 경로> 와 서버 액션 /api/public/v1/actions/<이름> 으로 불림 (시험)
- 범위 없는 키로 approve send delete admin 동작 → 202 승인 요청, 범위 밖 read write → 403 requiredScope (시험)
- Idempotency-Key 재요청은 처음 결과, dryRun 은 처리 함수를 안 부름, 쓰기 분당 20회 (시험)
- 보안: 모든 쓰기가 api_write_audit 에 키 에이전트 요청id ip 와 함께 남음, api-auth-surface 에 관문 표식 등재
의존: I02, I06

### I08 openapi.json 과 개발자센터가 정의를 읽음, GET me, 승인 요청 화면
상태: 대기
모드: 중량
범위: apps/web/app/api/public/v1/openapi.json/route.ts, apps/web/app/api/public/v1/me/route.ts (신규), apps/web/app/api/public/v1/approvals/[id]/route.ts (신규), apps/web/app/approvals/[id]/ (신규), apps/web/app/develop/page.tsx
감사 기준:
- openapi.json 에 정의 전부가 x-cli 와 x-scope 와 함께 실림, 기존 경로 응답 모양 그대로 (시험)
- /approvals/{id} 에서 키 소유자가 승인하면 같은 처리 함수가 실행되고 상태가 APPROVED 로 (시험 또는 확인 못 함)
- 보안: 승인은 키 소유자 본인 또는 관리자만, 만료된 요청은 실행 안 됨
의존: I07

### I09 teamda CLI 본체
상태: 대기
모드: 경량
범위: packages/teamda-cli/ (신규)
감사 기준:
- openapi 에서 명령 트리를 만듦, teamda sync 가 서버 openapi 를 받아 해시로 캐시 갱신, help --json, api 비상 명령 (시험)
- 종료 코드 0 2 3 4 5 6 7 8 9 와 표준출력 JSON 하나, 표준오류 오류 봉투 (가짜 서버 시험)
- auth login 은 키 파일로만, OS 자격 증명 저장소, 키 값은 앞 12자만 찍힘
- 보안: 키를 명령줄 인자로 안 받음, 평문 파일 저장 안 함 (시험)
의존: I08

### I10 견적서 서버 내보내기
상태: 대기
모드: 경량
범위: apps/web/app/api/crm/quotes/[id]/export/route.ts (신규), apps/web/lib/crm/export/quote-export.ts (신규)
감사 기준:
- format pdf png page n, 화면 미리보기와 같은 그리기 데이터, 원가 마진 딜 노트 없음 (시험)
- REQ-047 라벨 겹침과 합계 줄 잘림 없음 (쪽 이미지로 확인 또는 확인 못 함)
- 보안: 해당 견적을 읽을 권한 검사는 withCrmApi READONLY
의존: I07

### I11 변경 이력 API 탭과 키별 최근 요청
상태: 대기
모드: 경량
범위: apps/web/app/api/crm/audit/route.ts, 변경 이력 화면 탭, apps/web/app/api/user/api-keys/[id]/requests/route.ts (신규), apps/web/lib/terms/
감사 기준:
- 변경 이력에 사람 AI API(에이전트) 탭, API 행은 api_write_audit 에서 (시험)
- 키 관리 화면에 키별 최근 요청 100건
- 보안: 본인 키 기록만, 관리자는 전부
의존: I07

### I12 기본 지침 PR 템플릿 CI cli-parity
상태: 대기
모드: 경량
범위: CLAUDE.md, AGENTS.md, GEMINI.md, CONTRIBUTING.md (신규), .github/copilot-instructions.md (신규), .cursorrules (신규), .github/pull_request_template.md (신규), .github/workflows/cli-parity.yml (신규)
감사 기준:
- 지침 파일 맨 위에 필수 문단이 글자 그대로 (grep)
- cli-parity 작업이 parity check, 생성물 최신, 웹=CLI 시험, 하위 호환을 돌림
- 정의 없이 라우트만 더하면 parity check 실패, 정의 한 줄 더하면 sync 뒤 CLI 명령이 생김 (시험 기능으로 확인 뒤 되돌림)
- 보안: 해당 없음, 문서와 CI, 비밀 없음
의존: I09

### I13 웹=CLI 시험과 teamda.exe
상태: 대기
모드: 경량
범위: apps/web/lib/actions/parity.test.ts (신규), packages/teamda-cli/test/ (신규), apps/web/package.json
감사 기준:
- 대응표 모든 줄에서 CLI 명령이 웹과 같은 처리 함수를 가리킴 (시험), CRM 흐름 8명령 실DB 시험은 시험 DB 가 있을 때만, 없으면 확인 못 함
- bun build --compile --target=bun-windows-x64 로 teamda.exe 산출, help --json 한글 정상
- 보안: 해당 없음, 시험과 빌드
의존: I12

### I14 버전과 업데이트 내역
상태: 대기
모드: 경량
범위: apps/web/lib/changelog/entries.ts
감사 기준:
- v0.11.55 블록에 CLI 와 키 범위 설명
- 보안: 해당 없음, 문구
의존: I13

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-23) 최초 작성 (ins_0318)
- v0.1.1 (2026-10-23) I02 범위를 실제 파일로 맞춤, 이름 규칙은 생성기 쪽 naming.mjs, 형식과 openapi 조립과 생성물 추가 (audit:I02)
- v0.1.2 (2026-10-23) I02 생성물(table.ts 요약 글, 경로 문자열)이 route-census 와 glossary 가드 셋을 깨 I03a 삽입 (audit:I02)
- v0.1.3 (2026-10-23) I04 범위에 quote 라우트(POST 이지만 read 계산)와 시험 등재용 package.json 추가 (audit:I04)
- v0.1.4 (2026-10-23) I05 범위를 실제 파일로, 관리자 키 목록은 admin/api/ApiKeysPanel.tsx, 검증 모듈과 시험 추가 (audit:I05)
