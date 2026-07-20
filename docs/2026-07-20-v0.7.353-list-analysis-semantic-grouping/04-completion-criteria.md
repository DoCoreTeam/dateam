# 04 — 완료 기준

- 버전: v0.7.353
- 선행 문서: `00-requirements.md` ~ `03-test-strategy.md`
- **판정 규칙**: 전 항목 ✅ 이전에는 완료 선언 금지. ❌ 1건이라도 있으면 재작업.

---

## Phase 0 — 응급 복구

- [ ] `161_ai_analysis_v2.sql` 실DB 적용 완료 (`migrate.sh --status`에서 161 ✅)
- [ ] `information_schema.columns` 대조 — `ai_analysis_sessions`에 `command, phase, control, synth_status, coverage` 존재 확인
- [ ] 에러 은폐 제거 — `session-persist-actions.ts:52,61`, `session-list-actions.ts:111` 및 동일 파일 전 error 분기에 서버 로그 원문 기록
- [ ] 마이그레이션 전체 적용 감사 완료 — 커밋됐으나 미적용 번호 전수 목록 산출
- [ ] 마이그레이션 번호 중복 스캔 — 동일 prefix 2개 이상 존재 여부 확인 (163 충돌 포함)
- [ ] **실화면**: 세션 저장 성공 + "내 분석 문서" 목록 렌더 (E8)

---

## Phase 1 — 구조 트리 복원 (결정론)

- [ ] `structure-tree.ts` 구현 + 단위 테스트 (헤딩/번호/들여쓰기/표/혼합/줄글 폴백)
- [ ] `doc-meta.ts` 구현 + 테스트 — 본문 내 유사 문자열 오분류 없음
- [ ] `assemble-groups.ts` 구현 + 테스트 — `source_span` 오프셋 정확
- [ ] `coverage-check.ts` 구현 + 테스트 — `L \ (G ∪ M) == ∅`
- [ ] 골든 픽스처 3종 구축 (요구사항정의서 / 회의록 / **141개 사고 원문**)
- [ ] 골든 3종 전부 미귀속 줄 0
- [ ] 골든 3종의 그룹 경계가 육안 검수와 일치
- [ ] 신규 테스트 파일 전부 `apps/web/package.json` `test` 목록에 등록

---

## Phase 2 — 지시 지배 배선 ★핵심

- [ ] 추출 요청 payload에 `command` 포함 (`AnalyzeClient.tsx` FormData + `actions.ts` 수신)
- [ ] `classify-doc.ts` — 문서 유형 판정, 지시에 유형 명시 시 **지시 우선**
- [ ] `cut-groups.ts` — 지시+유형+트리 → 절단 레벨 결정, 반환 스키마 검증, 오염 키 거부
- [ ] `analyzeDocument` 서버액션 — ①~④ 오케스트레이션
- [ ] `regroup` 서버액션 — revision +1, 이전 리비전 보존, **원문 불변**
- [ ] 마이그 `166_ai_analysis_grouping.sql` — sessions/items ALTER + RLS(owner default-deny)
- [ ] 마이그 166 실DB 적용 + 컬럼 대조
- [ ] **★ 동일 문서 + 다른 지시 → 그룹 개수·경계가 실제로 달라짐** (이 항목 실패 시 재정의 전체 무효)
- [ ] **★ 141개 사고 원문에서 141개가 나오지 않음** — 문서 섹션 수 규모
- [ ] **★ `문서 버전: v0.1.0`, `작성일`, `상태`가 그룹이 아니라 `doc_meta`로 분류됨**

---

## Phase 3 — 화면 재구성

- [ ] 입력 화면 — 문서 + 지시 + 실행이 한 덩어리 (명령↔실행 사이에 검수 없음)
- [ ] 결과 화면 — 그룹 접힘 리스트, 펼치면 원문 슬라이스 표시
- [ ] 문서 유형 배지 + 유형 변경 수단
- [ ] 문서 메타 패널 — 분리 보관된 메타 노출 (삭제 아님)
- [ ] **미귀속 0 배지** — 미귀속 발생 시 원문 노출 + 그룹 승격 (P0 신뢰 장치)
- [ ] 재지시 루프 — "다시 묶기" 입력 + revision 히스토리
- [ ] 실행 전 계약 표시 — `N개 그룹 · 예상 M콜 · 예상 시간`
- [ ] lens 칩 5개 제거
- [ ] 141개 전수 체크박스 검수 제거
- [ ] "전체 세션" → "내 분석 문서" 개칭·재구성
- [ ] 디자인 표준 — `input-field`·`label` 클래스, 공용 컴포넌트 재사용 (CLAUDE.md §2-1·2-2)
- [ ] `pnpm design:check` 통과
- [ ] 반응형 — 모바일/태블릿/데스크탑 렌더 확인, 가로 스크롤 없음

---

## Phase 4 — 그룹별 재가공

- [ ] `templates/*` 선별 이식 + 마이그 `168`로 번호 재할당 (163 사용 금지)
- [ ] `field-fill.ts` 입력 계약 교체 — 그룹(제목+원문 전체+문서맥락)
- [ ] ⑥ 스트리밍 경로 입력 계약 교체
- [ ] `breadth-pass.ts` 그룹 단위 전환 + **자동 반영 금지**, 사용자 확인 후 추가
- [ ] `consistency-pass.ts` + `assemble-template.ts` 이식
- [ ] 429 정상경로 — 자동 백오프·재개, 진행률 DB 영속
- [ ] 멱등성 — `session+revision+group` 키로 성공분 재과금 없음
- [ ] 실패 그룹이 사용자에게 명시 노출 (조용한 드롭 없음)
- [ ] 429 메시지가 사용자 언어로 표시
- [ ] **실화면**: 그룹 N개 문서 완주 → 완성 문서 생성 (E6)
- [ ] **실화면**: 강제 중단 후 재개 시 성공분 유지 (E7)

---

## Phase 5 — 산출물 배출 (4경로)

- [ ] 마이그 `167_ai_analysis_documents.sql` + RLS(owner default-deny)
- [ ] 파일 내보내기 — md/txt/docx/pdf
- [ ] 앱 내 문서 라이브러리 — 결과 문서가 1급 객체
- [ ] 업무 흐름 연계 — 주간보고·부서업무·프로젝트·회의노트 전달
- [ ] AI 채팅으로 이어가기 — 결과를 채팅 컨텍스트로 승계

### [Feature Defaults] 신규 엔티티(`ai_analysis_documents`) 자동 전개

- [ ] CRUD 전체 (Create/Read/Update/Delete, **소프트삭제**, 각 연산 권한)
- [ ] List 화면 + **행 수준 RLS·owner 필터 (default-deny)**
- [ ] 검색(`q`, 서버 sanitization) · 정렬(`sort`, 화이트리스트) · 필터(`filter[]`, 화이트리스트)
- [ ] 서버 페이지네이션(`page/limit` 또는 `cursor/limit`) + 메타
- [ ] 검색/정렬/필터/페이지 상태 **URL 동기화**
- [ ] 로딩 / 빈 / 에러 3종 UI

---

## 회귀 가드

- [ ] 평탄화 재유입 차단 가드 — `parseListItems` 계열이 신규 경로에 재도입되지 않음
- [ ] **지시 미전달 차단 가드** — 추출 payload에 `command` 포함 여부 정적 검사
- [ ] 마이그 번호 중복 스캔 가드
- [ ] 에러 은폐 스캔 가드 — 로그 없는 고정 문자열 반환 패턴 탐지

---

## 전역 게이트

- [ ] `pnpm exec tsc --noEmit` 0 에러
- [ ] `pnpm lint` 통과
- [ ] `pnpm test` 전체 통과 (신규 테스트 전부 목록 등록됨)
- [ ] `pnpm design:check` 통과
- [ ] **E2E 8종(E1~E8) 전부 통과 — 기본 렌더 경로에서 실행**
- [ ] 🟥 DC-REV 리뷰 통과
- [ ] 🟥 DC-SEC 리뷰 통과 (RLS·권한·입력검증)
- [ ] 🟥 DC-QA 리뷰 통과
- [ ] 버전 체크리스트 — 루트 `package.json` / `apps/web/package.json` / `CLAUDE.md` / `AGENTS.md` / changelog

---

## ★ 최종 인수 조건 (사용자 관점)

이 3개가 전부 참이 아니면 **어떤 내부 지표가 초록이어도 실패**다:

1. **141개 사고 원문을 넣었을 때, 문서의 실제 구조대로 그룹이 잡힌다.** 메타데이터가 항목으로 나오지 않는다.
2. **지시를 바꾸면 그룹이 실제로 달라진다.** "크게 묶어" / "쪼개" / "이 부분만"이 작동한다.
3. **"뭐가 빠졌냐"에 답할 수 있다.** 미귀속 0줄이 표시되고, 문서 메타는 삭제가 아니라 분리 보관됐음을 화면에서 확인할 수 있다.
