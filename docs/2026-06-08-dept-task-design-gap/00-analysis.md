# 부서업무 UI 디자인 불일치 — 근본원인 분석 (구현 0)

작성 2026-06-08 · 🟦 DC-ANA 진단 · 사용자 지시: 분석·보고만, 구현 금지

## 증상
`/dept-tasks` "새 부서 업무" 등록 모달이 밋밋(브라우저 기본 select/input/textarea, 라벨 뭉침).
`/calendar` EventModal 등 기존 모달은 정돈됨. design:check는 통과했는데도 이질적.

## 근본 원인 (코드 근거)
1. **폼 클래스 누락(핵심)**: DeptTaskFormModal/DeptTaskDetail의 input/select/textarea(총 10개)에 `className="input-field"` **0회**. globals.css엔 input 전역 스타일이 없어 → 브라우저 UA 스타일로 렌더. 라벨도 `className="label"` 미사용(`<span>` 날 태그).
   - 표준: EventModal/ContactForm/PasswordChangeModal은 `input-field`(globals.css:411)·`label`(:438) 사용.
2. **모달 질감 차이**: `.card`만 사용 → `var(--shadow-md)`(flat). 기존 모달은 inline `boxShadow:'0 20px 60px ...'`(광원형). `tape-title`·X버튼·`useEscClose`·backdrop색(rgba(15,23,42,..)) 모두 누락.
3. **design:check 사각지대**: 가드는 hex 색 하드코딩만 검사 → 클래스 누락·컴포넌트 미재사용 탐지 못 함. 그래서 통과.

## 재사용했어야 할 자산
- `globals.css`: `.input-field`(:411) · `.label`(:438) · `.tape-title`(:315)
- `lib/use-esc-close.ts` (useEscClose)
- 레퍼런스 모달: `calendar/EventModal.tsx`, `components/ui/PasswordChangeModal.tsx`, `contacts/ContactForm.tsx`

## 정책 보강(반영됨 — CLAUDE.md 디자인 시스템 정책)
- §2-1 폼 input/select/textarea=`input-field`, label=`label` 강제
- §2-2 모달 표준 체크리스트(useEscClose·X버튼·tape-title·광원형 shadow·backdrop색)
- §4 design:check 사각지대 명시 + 향후 가드 패턴 추가 권고

## 수정 범위(향후 — 별도 지시 시)
DeptTaskFormModal·DeptTaskDetail·DeptTasksClient의 raw 폼요소에 표준 클래스 부착 + 모달 표준화. **이번엔 구현 안 함.**
