# 03 — 테스트 전략 (회의노트)

> 러너: `node:test`(jest/vitest 아님). 새 `*.test.ts`는 `apps/web/package.json` test 목록에 **수동 등록** 필수(자동 포함 안 됨). E2E: Playwright(`apps/web/e2e`).

---

## 1. 단위 테스트 (lib — 순수 로직 우선)

| 대상 | 케이스 |
|---|---|
| `gemini-meeting` 추출 매핑 | 후보 JSON → `{tasks,events,highlights}` 정규화. `source_quote` 누락 시 후보 제외. 날짜 파싱(상대표현 "다음 주 화요일" → 절대일자) |
| `htmlToPlain` 통과 보장 | Tiptap `<br>`/`<ul>` → plain. AI 입력 전 HTML 잔존 0 (회귀: 주간보고 `<br/>` 노출 사고 재발 방지) |
| 권한 매핑 | `resolveOrgScope` 결과로 List 필터 — 타부서 회의노트 비노출 |
| 추출→daily_logs 매핑 | `source_type='ai_derived'` + `meeting_note_id` 세팅. 일정→`calendar_events` 필드 매핑 |
| STT 청크 병합(Phase2) | 다중 청크 transcript 순서 보존 병합 |

## 2. 통합 테스트 (API/DB)

| 대상 | 케이스 |
|---|---|
| CRUD + RLS | 본인 생성/조회/수정/소프트삭제 OK. **타인 회의노트 접근 차단**(RLS). admin 조회 OK |
| List 쿼리 | 검색/정렬(화이트리스트)/필터/페이지네이션 + 메타 정확. 정렬 화이트리스트 외 값 거부 |
| meeting-extract route | 본문 입력 → 후보 반환, `logTokenUsage` 호출 검증(mock) |
| 일괄 반영 | 선택 후보만 daily_logs/calendar 생성. 미선택 후보 미생성. **자동 등록 안 됨 확인** |
| 이중 집계 방지 | 회의 파생 daily_logs(`ai_derived`)가 daily→weekly·dept_tasks에서 정책대로 포함/제외 |
| STT route(Phase2) | 음성 FormData → 텍스트. GROQ키 서버 전용(클라 노출 0). 파일 한도 초과 시 에러 메시지 |
| Drive 업로드(Phase2) | audio MIME 허용, `meeting_notes` 기반 IDOR 검증(타인 파일 stream 차단) |

## 3. E2E (Playwright — 핵심 플로우)

1. 로그인 → 회의노트 작성(텍스트) → 저장 → List 표시.
2. AI 정제 → 요약 미리보기/편집 → 저장.
3. AI 추출 → 후보 체크 → 일괄 반영 → `/daily`·`/calendar`에서 생성 확인.
4. 검색/필터/정렬 URL 동기화 — 새로고침 후 상태 유지.
5. 권한: 타 멤버 회의노트 URL 직접 접근 차단.
6. (Phase2) 녹음 → 타이머 표시 → 정지 → 총시간 → STT → 본문 삽입. (Playwright 마이크는 fake device; 메모리 file_dialog_automation 참조 — 실확인 별도)
7. 반응형: 320/768/1024/1440 — table-card 카드 변환, 오버플로우 0.

## 4. 비기능 검증

- `pnpm design:check` 통과(토큰/하드코딩). 폼/모달 `input-field`·`label`·`tape-title` 눈 대조(가드 사각지대).
- `pnpm exec tsc --noEmit` 0 에러.
- **실제 next build 검증 필수**(메모리 react18_build_verify: tsc만으론 React API 런타임 부재 못 잡음).
- a11y: 녹음 버튼/체크리스트 키보드·aria. 색 대비.
- 보안: RLS 실제 동작, GROQ키 grep 노출 0, 음성권한 `Permissions-Policy` 확인.

## 5. 테스트 데이터 격리 (메모리 test_isolation)

- 운영 daily_logs/주간보고 실데이터로 테스트 금지. throwaway 계정 + `is_test`/draft 행 사용.
- Groq/Gemini 호출은 통합테스트에서 mock, 실호출은 throwaway 키 + 최소 1건 스모크.

## 6. 커버리지 목표
- lib 로직 80%+. RLS·권한·일괄반영은 필수 경로 100% 커버.
