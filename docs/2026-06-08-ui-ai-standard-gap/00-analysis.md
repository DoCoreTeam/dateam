# 업무 페이지 width·텍스트·AI결과표시 불일치 — 근본원인 분석 + 표준안 (구현 0)

작성 2026-06-08 · 🟦 DC-ANA · 사용자: 분석·보고만

## A. 페이지 width 불일치
- `MobileShell <main className="page-inner">`(padding 2rem, max-width 없음)가 모든 페이지 감쌈.
- 각 페이지가 **또 `page-inner`를 선언**(이중 패딩) + **일일업무만 `.daily-page`(globals.css:1639 max-width:1200px·margin auto)**.
- 결과 실효 폭: 일일=1200px 클램프 / 부서·주간=제한 없음(전체 폭) → **탭 전환 시 폭이 튐**.
- 근본: daily-page가 일일에만 있음 + page-inner 이중 선언.

## B. 부서업무 텍스트 불일치
- 본문 표는 `.table-base`(globals.css:450) 14px로 다른 페이지(--fs-base 14px)와 **수치는 동일**.
- 단, **`DeptTaskDetail.tsx`가 globals.css에 없는 토큰 `--text-sm`/`--text-lg` 사용**(:74,77,84,96) → CSS var 폴백(0.875/1.125rem)으로 우연히 작동하나 **토큰 체계 이탈**.
- 체감 차이의 실제 원인: 부서업무는 table 레이아웃(밀도), 일일은 카드(daily-*), 주간은 Tiptap — **레이아웃 구조가 달라** 같은 14px라도 다르게 보임.

## C. AI 결과 표시 — 표준 부재 (핵심)
3개 AI 경로가 제각각:
- 일일: analyze-work → `content`=**plain text 저장**(actions.ts:428) → `{log.content}` plain 렌더. (정상)
- 주간: generate-from-tasks → 폼 → Tiptap → **HTML 저장**(sanitize-html) → `dangerouslySetInnerHTML` 렌더.
- 부서: suggest-dept-tasks → 후보 패널. source_quote를 **plain text 렌더**(DeptTaskSuggestPanel:141).

**`<br />` 노출 근본원인**: suggest API가 입력으로 `weekly_reports.performance/plan`(=**Tiptap HTML**)을 sanitize 없이 Gemini에 전달(route.ts:52, gemini-suggest-tasks.ts:51) → Gemini가 "원문 그대로 인용"해 `<br/>·<p>` 포함 source_quote 반환 → 패널이 plain text로 출력 → **태그가 글자로 보임**. 즉 같은 데이터가 저장(HTML)·추출(HTML포함)·표시(plain) 3단계 불일치.

**공용 리치텍스트 렌더 컴포넌트 없음**: OrgWeeklyView의 `sanitizeHtml`+`RichCell`이 파일 로컬에만 존재. TeamReportView/WeeklyReportForm은 sanitize 없이 dangerouslySetInnerHTML 직접 사용(중복).

## 표준안 제안 (구현은 별도 지시 시)
### 1. 페이지 폭/컨테이너 표준 (SSOT)
- **단일 규칙**: 콘텐츠 폭은 `MobileShell <main>` 한 곳에서만 제어. 페이지는 page-inner 재선언 금지.
- max-width 정책 택1 후 전 페이지 동일: (권장) `<main>`에 `max-width:1200px; margin:0 auto` → 모든 페이지 동일 폭. daily-page 개별 클래스 제거.

### 2. 텍스트 토큰 표준
- 폰트 크기는 **`--fs-xs|sm|base|md|lg|xl|2xl|3xl`만** 사용. `--text-*` 등 미정의 토큰 금지. DeptTaskDetail 4곳 교체.

### 3. AI 결과 표시 표준 (핵심)
- **데이터**: 사용자 표시 텍스트는 plain SSOT. HTML(주간 Tiptap)을 AI 입력/타화면 인용에 넘길 땐 **반드시 html→plain 변환**.
- **공용 컴포넌트 신설**: `components/ui/RichText.tsx`(sanitize+HTML 렌더, OrgWeeklyView/TeamReport/WeeklyForm 통합) + `lib/html-to-plain.ts`(AI 입력 전처리) + 인용은 PlainQuote 패턴.
- **AI 결과 UI 패턴 통일**: "제안 후보 = 체크리스트(제목·신뢰도·근거 plain) → 선택 일괄 반영"을 AI 추출류 표준 UX로. 생성류(주간)는 미리보기→편집 저장.

## 정합화 수정 범위 (구현 제외)
- A: main에 max-width, 페이지 page-inner 이중 제거 (daily-page 포함).
- B: DeptTaskDetail `--text-*`→`--fs-*` 4곳.
- C: lib/html-to-plain.ts + RichText.tsx 신설, suggest API weekly 입력 plain 변환, dangerouslySetInnerHTML 3곳 RichText로 통합.
