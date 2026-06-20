# v0.7.209 — 회의노트 E2E 점검 후속 결함 수정

## 배경
v0.7.206 회의노트 기능을 Playwright로 사용자 관점 E2E 점검. 핵심 무결성(저장·AI정제·KST·캘린더 멱등·릴레이션 순회·삭제정리)은 전부 통과했으나 3개 결함 발견 → 수정.

## 수정 항목

### #1 (LOW) Tiptap 중복 확장 경고
- 증상: 에디터 콘솔 `Duplicate extension names found: ['link','underline']`.
- 원인: `@tiptap/starter-kit@^3.24.0`(v3)가 Link·Underline을 내장하는데 `TiptapEditor.tsx`가 별도로 또 등록.
- 수정: `StarterKit.configure({ link: false, underline: false })` — 내장본 비활성, 커스텀 Link/Underline 설정 유지.
- 파일: `components/ui/TiptapEditor.tsx`

### #2 (MEDIUM) AI 반영 후 참석자 패널 미갱신
- 증상: "저장·선택 N건 반영" 토스트는 성공인데 참석자 패널이 "없음"으로 남아 하드 새로고침해야 표시 → 사용자 중복 추가 위험.
- 원인: `AttendeesPanel`이 `useState(initialState)`로 1회만 초기화 → `router.refresh()`로 서버 props가 바뀌어도 로컬 state 미반영.
- 수정: 서버 props 시그니처 변경 시 로컬 칩 재동기화하는 `useEffect` 추가(서버 데이터 실변경 때만 발화 → 미저장 편집 클로버 방지).
- 파일: `app/(member)/meeting-notes/AttendeesPanel.tsx`

### #3 (MEDIUM) 참석자 동명이인 외부/내부 오매칭
- 증상: 본문 "외부 협력사 정준홍"인데 조직원 명단의 "정준홍"과 이름으로 매칭되어 '조직원'(내부)로 저장.
- 원인: `matchAttendees`가 이름만으로 매칭. AI 추출 후보에 소속(내부/외부) 신호 없음.
- 수정: AI 추출에 `affiliation`(internal/external/unknown) 추가. `affiliation === 'external'`이면 동명이인 조직원과 자동매칭하지 않고 외부 텍스트로 저장.
- 파일: `lib/gemini-meeting.ts`(프롬프트·스키마), `lib/meeting/parse-helpers.ts`(타입·매핑), `app/(member)/meeting-notes/MeetingAiPanel.tsx`(배지·반영 로직)

## 영향 범위
- TiptapEditor는 전 화면 공용(SSOT) — 회의노트 외 주간보고 등 모든 에디터에 중복경고 제거 동일 적용(동작 동일).
- matchAttendees 시그니처 불변 → AttendeesPanel 초기 분류·기존 테스트 무영향.
- mapAttendees는 필드 추가만 → 기존 parse-helpers 테스트 무영향.

## DC-REV 검토 후속 (전부 완결 — 보류 없음)

🟥 DC-REV가 CRITICAL 1건 + 잔여 권고를 제기 → 전부 처리:

- **[CRITICAL] AttendeesPanel 재동기화가 미저장 편집 덮어쓰기** → `dirty` 플래그 가드. 로컬 편집 중이면 서버 재동기화 스킵, 저장 성공 시 해제. (실화면: 미저장 외부인 추가 후 AI 반영(refresh)에도 보존 확인)
- **[① 레거시 데이터]** attendees 있고 attendee_user_ids 빈 활성 행 = **0건**(DB read-only 점검) → 백필 불필요.
- **[② perf]** MeetingAiPanel 후보 배지가 후보마다 `matchAttendees` 호출 → 정규화 이름 `Set`(useMemo, `normalizeName` SSOT 재사용) O(1) 조회로 교체.
- **[③ 이탈 가드]** AttendeesPanel에 미저장(dirty) 시 `beforeunload` 경고 추가.
- **[LOW]** Gemini 프롬프트에 internal 단서 키워드 추가, parse-helpers에 비문자열 affiliation 폴백 테스트 추가.

## 검증
- `pnpm exec tsc --noEmit` 통과 (0 에러)
- `pnpm test`(parse-helpers·match-attendees 포함) 80/80 통과
- ESLint 변경 파일 0 경고 · design:check 통과
- Playwright 실화면 재검증: 에디터 경고 0, AI 반영 직후 참석자 즉시 표시, 외부 참석자 외부칩 분류(라운드트립 안전), dirty 미저장 편집 보존, perf 리팩터 배지 동작 동일
