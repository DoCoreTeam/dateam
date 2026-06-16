# 기획 — 임시저장(새로고침 유지) + Ctrl+Z 되돌리기, 앱 전 영역 공통 (미구현)

## 요구
- 작성 중인 내용은 **저장 버튼 누르기 전에도 임시 보관**되고, **새로고침/탭 닫힘에도 유지**된다.
- **Ctrl+Z(되돌리기)/Ctrl+Shift+Z(다시실행)** 가 일반 프로그램처럼 동작한다.
- **일일업무만이 아니라 앱의 모든 입력 영역**에서 동작한다.
- 한 기능으로 통째 설계(단계로 쪼개지 않음).

## 🟦 DC-ANA — 현황 (코드 근거): **둘 다 사실상 전무**
- **임시저장: 앱 전역 0건.** 입력 초안을 localStorage/sessionStorage에 저장하는 코드 없음. `beforeunload` 0건. (sessionStorage는 GPU 뷰상태·온보딩 플래그 등 UI 상태에만 쓰임 — 입력 초안 아님)
- **Undo: Tiptap(주간보고 셀 편집)만** 자체 history 있음. 그 외 모든 textarea/input은 브라우저 기본(OS) undo뿐 — 제어 컴포넌트라 사실상 깨짐. 커스텀 undo 스택 0건.
- **react-hook-form**이 package.json에 있으나 **실사용 0건**(전부 bare `useState`).
- **끼울 자리 명확**: `lib/use-esc-close.ts`(모달 ESC 단일훅) 패턴처럼 `lib/`에 공통 훅 1개 + 각 폼 onChange/저장성공에 1~2줄.

### 적용 대상 입력면 (전수 인벤토리 — 전 영역)
- **긴 텍스트(유실 위험 큼)**: 일일업무 입력/편집/스레드 textarea(3), 주간보고 Tiptap rows, 리드 인테이크, GPU 통합입력, AI 프롬프트 편집.
- **멀티필드 폼**: 거래처(ContactForm)·딜(DealForm)·거래처회사(AccountForm)·부서업무 모달·딜 활동로그·캘린더 EventModal·공급사 견적 편집.
- **단일/짧은 입력**: 홈 빠른입력·어드민(콘텐츠/회사/조직노드/파트너티어/초대/프로필/토큰알림)·DB채팅·MultimodalIntake·상품추가모달 등.
- **임시저장 제외(민감)**: 비밀번호(PasswordChangeModal)·비밀번호확인·API키 이름·1회성 이름설정.

## 🟦 DC-RES — 정석 아키텍처

### A. 임시저장(Draft)
- **저장소**: 일반 텍스트 폼 = **localStorage**(요구가 "탭 닫힘에도 유지" → sessionStorage 탈락). **Tiptap/대용량 = IndexedDB**(`idb-keyval`). 하나의 훅 인터페이스 뒤 어댑터로 분기.
- **키**: `draft:v1:{userId}:{formId}:{recordId}` (공용PC 유출 방지 userId 필수, new/수정 구분, 스키마버전 v1).
- **생명주기**: onChange 디바운스(300~800ms) 저장 → 마운트 시 **"임시저장본 복원/버리기" 배너**(수정 폼은 자동 덮어쓰기 금지) → **저장 성공 시 draft 삭제**(누락하면 유령 복원) → beforeunload flush(조용히, 확인창 남용 금지) → TTL(savedAt, 7~30일 만료).
- **함정**: SSR hydration(마운트 후 복원), 멀티탭(storage 이벤트 감지·경고), 민감필드 exclude, 5MB 초과 시 IDB 폴백, plain/HTML 경계는 html-to-plain 경유.

### B. Undo/Redo
- **왜 깨지나**: 제어 컴포넌트(`value/onChange`)는 매 입력마다 React가 DOM value를 재설정 → 브라우저 undo 스택 무효화. `execCommand`로 살리는 트릭은 **deprecated·비권장**.
- **정석**: **앱이 직접 스냅샷 히스토리 관리**(`{past, present, future}`). 폼 값은 작아 스냅샷으로 충분(대형은 immer patch). `maxHistory` 캡(무한스택 방지).
- **스코프**: "현재 포커스/활성 폼" 단위 — **전역 Ctrl+Z는 함정**(엉뚱한 곳 되돌림).
- **키바인딩**: Cmd(mac)/Ctrl(win), Redo는 Ctrl+Y와 Cmd/Ctrl+Shift+Z 둘 다. **IME(한글) 조합 중 undo 가로채기 금지**(compositionstart~end 보류). undo/redo **버튼도 제공**(a11y, `aria-keyshortcuts`).
- **Tiptap 경계**: 에디터 포커스 중엔 우리 핸들러 손 떼기(이중 undo 방지).

### C. 결합 + "한 줄 적용"
- 복원이 undo 시작점(복원 시 history 초기화). undo 결과도 draft에 자연 저장(같은 present 공유).
- **합본 공용 훅** `lib/forms/useFormCore.ts`: undo + draft + 단축키를 묶어 `{ value, set, undo, redo, canUndo, canRedo, hasDraft, restore, discard, onSubmitSuccess }` 반환.
  - 새 폼/입력면: `const f = useFormCore({ formId, recordId, initial, exclude, store })` **한 줄** + 복원 배너 1줄 (+선택 undo 버튼).
  - SSOT(§재사용 정책): `lib/`에 단일 구현, 모든 폼이 import. `useEscClose`처럼 횡단 표준.

### 라이브러리 vs 직접
- 저수준 스토리지 = `use-local-storage-state`(멀티탭·SSR 안전) + 리치텍스트 `idb-keyval`.
- undo 스냅샷 = `use-undoable` 드롭인 또는 자체 ~40줄.
- **생명주기 정책·단축키 스코프·IME·Tiptap 경계는 자체**(앱 맥락 필요). 전부 자체 구현해도 합계 ~150줄.

## 핵심 원칙 (불변)
- 공통 훅 **하나**(`useFormCore`)로 전 폼에 동일 적용 — 폼마다 제각각 구현 금지(SSOT).
- 임시저장 = localStorage(텍스트)/IDB(리치). **민감정보 제외**. 저장 성공 시 draft 삭제.
- Undo = 앱 스냅샷 히스토리(execCommand 금지), 포커스/폼 스코프, IME·Tiptap 안전.
- 복원은 **배너 확인**(자동 덮어쓰기 금지). 단축키 + 버튼 둘 다(a11y).

## 재사용/신규
- 재사용: `useEscClose` 패턴, `NbField`(입력 래퍼), sessionStorage 패턴, Tiptap 자체 history, html-to-plain.
- 신규: `lib/drafts/useDraft.ts`, `lib/forms/useFormCore.ts`(+ undo 훅·단축키 훅), 복원 배너 공용 컴포넌트. 신규 테이블 없음(클라이언트 영속).

## 미결(착수 시 Q&A)
1. 멀티탭 동시편집: 감지·경고만 vs 잠금.
2. 리치텍스트(Tiptap)도 임시저장 대상에 포함(IDB) vs Tiptap 자체에 위임.
3. undo 스코프: 입력필드 단위 vs 폼 전체 값 단위(기본 권장=활성 폼).
4. draft TTL 기간(7/14/30일).
