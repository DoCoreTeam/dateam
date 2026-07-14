# no_oper.md — 아직 안 된(미작동) 항목 정리

> 작성: 2026-07-14 · 기준 버전 v0.7.298 (main `cf99f5e`)
> 목적: "지금 안 한 것"을 항목별로 남겨, 무엇이 왜 미작동인지·어떻게 해결하는지 한눈에 파악.
> ✅ 참고: **코드 구현·빌드·배포는 완료**됨(`tsc` exit0, `next build` exit0, Gemini 자동연결 정상).
> 아래는 전부 **"코드는 됐는데 아직 안 돌아가는/안 채운" 운영·설정·완결도 항목**이다.

---

## 🔴 BLOCKER — 이게 안 돼서 AI 채팅이 실제로 안 됨

### N-1. AI 채팅 DB 테이블(150~153) 라이브 DB 미적용
- **무엇**: `supabase/migrations/150~153`이 만드는 표가 라이브 DB에 없음(추정 확정 단계).
  - `150_ai_chat.sql` → `ai_conversations`, `ai_messages` (+RLS, 트리거)
  - `151_ai_chat_attachments.sql` → `ai_attachments` (+Storage `ai-chat` 버킷 정책)
  - `152_ai_chat_projects.sql` → `ai_projects`, `ai_project_knowledge` (pgvector RAG)
  - `153_ai_chat_share.sql` → `ai_conversations.shared`, `share_token` 컬럼
- **왜 안 됐나**: 이 프로젝트는 배포 시 자동 마이그레이션이 아니라 **`scripts/migrate.sh` 수동 적용**인데, 그 스크립트가 이 PC(Windows)에서 **작동하지 않음**(→ N-2). 그래서 최근 마이그레이션이 실제로 적용된 적 없음.
- **영향**: 표가 없으면 대화 목록 로드·메시지 전송·첨부·프로젝트가 전부 실패 → **채팅이 안 됨의 직접 원인.**
- **해결**: 아래 3중 택1
  1. `pg` 드라이버로 CEO가 직접 150→151→152→153 순차 적용 (올바른 DB 비밀번호 필요)
  2. Supabase 대시보드 SQL Editor에서 150→151→152→153 순서대로 실행
  3. psql이 정상 설치된 환경(Mac 등)에서 `migrate.sh`로 적용
- **검증**: 적용 후 `information_schema.tables`에 `ai_conversations` 등 8개 존재 확인 → `/admin/ai-chat`에서 전송 정상.

### N-2. `scripts/migrate.sh`가 Windows에서 고장 (psql 경로 하드코딩)
- **무엇**: `migrate.sh:19`가 `/opt/homebrew/bin/psql`(**macOS 전용 경로**)를 하드코딩.
- **왜 문제**: 이 PC엔 그 경로가 없어 psql 실행 자체가 실패. `--status`가 DB 접속 없이 **전부 "미적용"으로 보이는 가짜 결과**를 냄(에러도 조용히 삼켜짐).
- **영향**: 이 머신에서 돌린 마이그레이션은 **아무것도 실제 적용되지 않음**(N-1의 근본 원인). 상태 조회도 신뢰 불가.
- **해결**: psql 경로를 환경 독립적으로 수정(예: `PSQL_BIN` 환경변수 또는 `command -v psql` 우선, homebrew는 폴백). 또는 Windows에 psql 설치 후 PATH 등록.

### N-3. DB 비밀번호 미검증 (인증 실패)
- **무엇**: 상태 확인에 쓴 비밀번호로 `pg` 직접 접속 시 `password authentication failed`.
- **왜**: 테넌트(`tsnlplkslfcwtchzdaai`)는 유효하나 그 비번은 이 DB의 Postgres 비번이 아님. migrate.sh가 그동안 psql을 못 찾아 실행 자체가 안 됐으니 이 비번이 맞는지 검증된 적이 없었음.
- **영향**: 올바른 DB 비밀번호가 없으면 N-1을 CEO가 직접(옵션1) 적용 불가.
- **해결**: Supabase 대시보드 → Project Settings → Database에서 올바른 Connection Password 확보. (또는 옵션2로 대시보드에서 직접 적용)

---

## 🟠 확인 필요 — 위와 같은 이유로 함께 안 됐을 수 있는 것

### N-4. 149_org_weekly_reports 적용 여부 불확실
- **무엇**: 이번 세션 초반 구현한 주간보고 취합본 영속 테이블(`org_weekly_reports`, migration 149).
- **왜**: N-2(migrate.sh 고장)와 같은 이유로 **이 PC에서 적용 시도했다면 실제로는 미적용**일 수 있음.
- **영향**: 미적용 시 주간보고 취합본이 여전히 DB에 안 남고 매번 재취합될 수 있음.
- **해결**: N-1 적용 시 **149도 함께** 적용/검증. 실제 표 존재 여부 조회로 확정.

---

## 🟡 완결도 갭 (배포 차단 아님 — 감사에서 발견, 나중에 처리 가능)

> 4개 🟦 DC-ANA 갭 감사 결과. 매니페스트 83항목 중 81 완전 / 2 부분, 세션1~3 완료기준 대부분 충족. 아래는 잔여 갭.

| ID | 항목 | 내용 | 심각도 |
|----|------|------|--------|
| GAP-SSE | `lib/ai-chat/sse.test.ts` 부재 | SSE 파서(SSOT) 단위테스트 없음·`package.json` test 목록 미등록. 회귀 방지망 공백(동작 자체는 통합레벨 검증됨) | MED |
| GAP-G5 | provider별 토큰 임계 알림 UI | 단가표·비용집계(pricing.ts·ai-usage)는 완성이나 ai-chat 전용 임계 경고 발화/배선 미확인 | MED |
| GAP-PROJ | Projects 목록 4어포던스 | 검색·정렬·필터·서버페이지네이션 미구현(세션3 명세는 "최신순 목록"만 요구 — 명세 자체는 충족, 일반정책 기준 갭) | MED |
| GAP-L1 | 모달 포커스 트랩 | `SystemPromptModal` ESC·X닫기는 있으나 tabIndex 포커스 순환(WCAG) 미검증 | MED |
| GAP-EDIT | 편집모드 첨부 UI | 사용자 메시지 편집 시 기존 첨부 읽기전용 칩 표시·새 첨부 추가 UI 없음(서버·데이터모델은 완비) | LOW |
| GAP-PDF | 프로젝트 지식 PDF 추출 | `extractDocumentText` 재사용 아닌 `parseOffice` 직접 호출(기능 정상, DC-REV PASS) | LOW |
| GAP-TS | node:test 경고 | `MODULE_TYPELESS_PACKAGE_JSON` 경고(기능 무영향) — `apps/web/package.json`에 `"type":"module"` 추가로 해소 | LOW |

---

## ✅ 이미 된 것 (참고 — 여기 있는 건 미작동 아님)
- AI 채팅 코드 3세션(기반·멀티모달·고급) 전량 구현 + main 병합(`cf99f5e`).
- officeparser 클라이언트 번들 오염 수정(`document-extract.ts` 분리) — `next build` 복구.
- `tsc --noEmit` exit0 · ai-chat 테스트 59+/0 fail · 좌측 메뉴 "AI 채팅" 배선.
- ai-chat 레지스트리가 시스템의 `gemini_api_key`를 그대로 읽음 → **Gemini 프로바이더 자동 available**.

---

## 다음 액션 (우선순위)
1. **[필수]** N-3(올바른 DB 비번) → N-1(150~153 적용) + N-4(149 확인). 이게 되면 채팅 실제 동작.
2. **[권장]** N-2(migrate.sh Windows 대응 수정) — 향후 마이그레이션 반복 문제 예방.
3. **[선택]** 🟡 완결도 갭(GAP-*) — 별도 `/ceo`로 순차 처리.
