# 전 화면 감사 — 깜빡임 안티패턴 + 오랜딩(오리다이렉트) 전수 검증

- 접수일: 2026-07-13 / 버전 기준: v0.7.292
- 성격: **분석 전용 (구현·수정·커밋 없음 — 사용자 지시 "절대 구현하지마")**
- 검증 범위: `apps/web` 전 화면 57개 페이지 + 공용 컴포넌트/훅, useEffect 약 140개, 전 네비게이션 호출처
- 실행: 🟦 DC-ANA ×4 병렬 (member-A / member-B / admin+공용 / 네비게이션) → CEO 코드 재검증

---

## 핵심 결론

1. **깜빡임(무한 리렌더 루프)은 앱 전체에서 `DailyTaskSelector.tsx`가 유일하다.** 나머지 전 화면에서 동일 시그니처(effect가 setState하는 값이 deps에 있고 조건이 재충족되는 무한루프)는 **0건**.
2. **오랜딩(잘못된 화면 랜딩)**: 실사용자에게 "엉뚱한 화면"을 보여주는 CONFIRMED 버그는 **없음**. 단, 세션 만료 시 리다이렉트가 삼켜지는 코드 결함 1건(실질 영향은 미들웨어가 선차단해 낮음) + 경미한 이중 리다이렉트/UX 혼란 2건.

---

## A. 깜빡임 안티패턴 스캔 (member-A / member-B / admin+공용)

### 🔴 CONFIRMED 무한 루프
| 파일 | 상태 |
|------|------|
| `(member)/weekly-report/DailyTaskSelector.tsx:50-54` | 기접수 건(별도 보고서). **전 화면 중 유일** |

그 외 3개 구역(총 57화면·공용) CONFIRMED **0건**.

### 🟡 의심 — 루프 아님, 경미한 성능/UX (참고)
| # | 위치 | 성격 | 실제 위험 |
|---|------|------|-----------|
| 1 | `lib/use-esc-close.ts` (공용) | 호출측이 `onClose`를 `useCallback` 없이 인라인 전달 시 ESC 리스너 매 렌더 재등록. `WeeklyReminderModal.tsx:30`에서 이미 위반 | 리스너 churn(루프 X) |
| 2 | `components/ui/EditorModal.tsx:20` | `AdminReportsPreview`가 `onClose={()=>...}` 인라인 → 리스너 churn | 리스너 churn(루프 X) |
| 3 | `components/ui/SlidePanel.tsx:19` | unstable `onClose` 시 `isOpen` 동안 cleanup 반복 → 스크롤락 해제·포커스 이동 반복(포커스 오염) | UX 오염(루프 X) |
| 4 | `lib/useCollapsibleGroups.ts:11` (공용) | `keepOpen=[]` 기본값 배열 참조 불안정 → 초기화 전 매 렌더 effect 점화 (`initialized` 가드로 루프 차단) | 불필요 재실행(루프 X) |
| 5 | `meeting-notes/MeetingEditor.tsx:76` | 인라인 `initial` 객체 → 반복 API 호출 가능성. 현재는 상위 useMemo로 안전 | 조건부 재호출(루프 X) |

> 위 5건은 **깜빡임의 원인이 아니다.** 공통 처방(구현 시): 모달/패널에 넘기는 `onClose`·`keepOpen`을 `useCallback`/`useMemo`로 안정화. 지금은 구현하지 않음.

---

## B. 오랜딩 / 네비게이션 감사

### 🔴 CONFIRMED 코드 결함 (실질 영향 낮음)
**`app/admin/content/actions.ts:162-169` — try/catch가 `redirect('/login')`을 삼킴 (확신도 90%)**

`requireAdmin()`(L13)이 미인증 시 `redirect('/login')` → Next.js는 `NEXT_REDIRECT`(비 Error 객체)를 throw. `aiApplySection`의 catch(L167)가 이를 잡아 `err instanceof Error`가 false → **리다이렉트 대신 "저장 실패" 메시지 반환**.
- 재현: `/admin/content`에서 세션 만료 상태로 AI 섹션 적용 클릭 → `/login`으로 가야 하나 에러 토스트만.
- **완화 요인**: 미들웨어(`middleware.ts`)가 서버액션 POST에서도 미인증을 먼저 `/login`으로 선차단하므로, 이 경로가 실제로 도달할 확률은 낮다. 코드 자체는 명백히 잘못된 패턴(같은 파일 다른 액션들은 try/catch 밖에서 `requireAdmin` 호출).
- 처방(미구현): `aiApplySection`의 try/catch에서 `NEXT_REDIRECT` 재throw(`if (isRedirectError(err)) throw err`) 또는 `requireAdmin`을 try 밖으로.

### 🟡 의심 — 잘못된 화면 아님(참고)
| # | 위치 | 현상 | 판정 |
|---|------|------|------|
| 1 | `login/actions.ts:42`, `change-password/actions.ts:142`, `admin/layout.tsx:83`, `admin/ai-usage/page.tsx:13`, `admin/data-quality/page.tsx:12` | `/dashboard` 경유 → `dashboard/page.tsx`는 `redirect('/home')` 패스스루 → **2-hop** | 최종 랜딩 `/home` 정확. stale ref, HTTP 왕복 1회 낭비 |
| 2 | `daily/AutolinkSection.tsx:55,61` | member가 일일업무 AI 연결카드의 거래처/영업기회/담당자 링크 클릭 → accounts/contacts/deals 레이아웃 `requireAdmin` → `/home`으로 튕김 | CRM이 admin 전용이면 의도. member엔 피드백 없이 튕겨 UX 혼란 소지 |

### 🟢 정상 확인 (요약)
middleware 3역할 분기·공개경로, Account/Contact/Deal 폼 저장 후 상세 이동, MeetingEditor create/edit 이동, 삭제 후 목록 이동, 캘린더→일일 파라미터, 주간보고 tab 파라미터, KPI redirect, 단축 리다이렉트 페이지 8종, Drive OAuth 콜백 4케이스, weekly-report `upsert` redirect — 모두 정상. 미들웨어 리다이렉트 루프 없음.

---

## 권고 (우선순위 — 모두 미구현)
1. **(주)** `DailyTaskSelector.tsx` 무한 루프 수정 — 별도 접수 보고서 참조. **유일한 실제 깜빡임.**
2. **(중)** `admin/content/actions.ts` redirect 삼킴 — `NEXT_REDIRECT` 재throw 가드.
3. **(하)** `useEscClose`/`EditorModal`/`SlidePanel` 호출측 `onClose` 안정화(리스너 churn 제거).
4. **(하)** `/dashboard` 잔재 5곳 → `/home` 직접 리다이렉트로 정리.
5. **(하)** `AutolinkSection` member 링크 노출 정책 결정(숨김 or 접근 허용).

> 사용자 지시에 따라 코드는 일절 수정하지 않았다. 항목별 수정은 별도 승인 시 진행 가능.
