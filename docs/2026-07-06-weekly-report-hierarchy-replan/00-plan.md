# 주간보고 작성 위계 재설계 기획안 (구현 전 — 보고용)

> ⚠️ 이 문서는 **기획 전용**. 사용자 지시 "절대구현하지마" 준수. 코드 변경 없음.
> 작성 2026-07-06 / 대상 화면 `/weekly-report?tab=mine`

## 1. 문제 (사용자 피드백)

> "기존방식이라고 접혀 있는게 메인인데 접혀있고 일일보고는 너무 벌려져 있는데 이게 의도한바가 아니야… 기존 방식이 기본 방식이라고. 거기에 일일보고에서 가져온 것을 매핑하는 방식이어야 하지. 차라리 기존방식 작성 우측에 항목들을 작게 표시해서 체크해서 반영하게 하던가. AI 자동초안은 서포트니까 가볍게 보여야 하는데 덩그러니 있고 주간보고는 접혀있으면 어쩌라고."

핵심: **위계가 뒤집혔다.** 서포트여야 할 AI 자동초안이 메인 자리를, 메인이어야 할 기존 작성폼이 접힘(`<details>`)으로 강등됨.

## 2. 현행 구조 (실측 — `app/(member)/weekly-report/page.tsx:213–266`)

| 위치 | 컴포넌트 | 현재 상태 | 주석상 의도 |
|------|----------|-----------|-------------|
| 최상단 큰 `.card`(space-6, 항상 펼침) | **`AutoDraftPanel`** (AI push 초안) | 🔴 화면 지배 | "기본 작성 흐름" |
| `<details>` 접힘 "직접 편집(기존 방식)" | **`WeeklyReportForm`** (실제 작성폼) | 🔵 강등·접힘 | "하위호환 보조 영역" |
| 하단 | `ReportAccordion` (과거 보고) | — | — |

- 이 배치는 **v0.7.281**에서 "AI 자동선작성(push) 전환"으로 도입됨. AutoDraftPanel을 전면에 놓고 기존폼을 접었다.

## 3. 이미 존재하는 매핑 기능 (중요 — 새로 만들 필요 없음)

`WeeklyReportForm`(기존폼)은 **이미 일일보고→폼 매핑 UI를 내장**하고 있다:

- **`DailyTaskSelector`** (`WeeklyReportForm.tsx:404`, 컴포넌트 287줄)
  - 접이식 섹션 → 이번 주 일일업무를 **체크박스 리스트**로 표시 → "주간보고 생성" 버튼 → AI가 주간형으로 변환 → `mergeWeeklyRows(prev, generated)`로 **폼 행(구분×성과/계획/이슈)에 병합**.
  - = 사용자가 말한 "항목들을 체크해서 반영" 그 자체.
- 폼 본체: `구분 | 성과 | 계획 | 이슈/협조사항` 테이블, 각 셀은 Tiptap `EditorCell`. 이월(carry-forward)·임시저장·AI 정비(diff 확인) 내장.

즉 **사용자가 원하는 "기존폼 + 일일보고 체크 매핑"은 pre-v0.7.281의 원래 UX**였고, v0.7.281이 이를 접어버린 것이 문제의 본질이다.

## 4. 제안 (3안)

### ✅ 안 A — 위계 스왑 (최소 변경, 저위험) *[CEO 1차 추천]*
- `WeeklyReportForm`을 **최상단 메인 카드로 펼침**(현 AutoDraftPanel 자리). 내장 `DailyTaskSelector`가 일일보고 매핑을 담당.
- `AutoDraftPanel`(AI push)을 **`<details>` 접힘 "AI 자동초안(실험)" 보조**로 강등(역전).
- 변경: `page.tsx` 렌더 순서/래퍼만 교체. 컴포넌트 로직 무변경. DB·API 무변경.
- 장점: 반나절, 회귀 최소, 즉시 사용자 의도 충족. 단점: "우측에 작게" 사이드 배치까지는 아님(상단 접이식 유지).

### 안 B — 기존폼 메인 + 우측 매핑 사이드패널 (사용자 문구에 가장 근접)
- `responsive-grid-2`(desktop: `1fr 352px`, mobile: 1열)로 **좌=기존폼 / 우=일일보고 후보 패널**.
- 우측 패널 = `DailyTaskSelector`의 체크→반영 로직을 **재사용하되 우측 사이드 소형 리스트로 재배치·축소**(항목 작게, 체크 시 해당 구분/섹션 폼 행에 삽입).
- `AutoDraftPanel`은 접힘 강등 또는 제거(§5 결정 필요).
- 장점: "우측에 작게 표시해서 체크" 문구 정확 구현. 단점: 우측 패널 신규 레이아웃 + 삽입 타겟팅 로직, 모바일 스택 처리 → 중간 규모.

### 안 C — AI push 전면 롤백
- `AutoDraftPanel`/`weekly_report_items`/`/api/weekly-report/draft` 제거, 폼+DailyTaskSelector만 유지(pre-v0.7.281 복귀).
- 장점: 구조 단순화. 단점: v0.7.281 자산(마이그138/139, draft SSOT, 직렬화 브리지) 폐기 — 되돌리기 큼. 지연추적·취합 호환 재검증 필요. **비추천**(과잉 파괴).

## 5. 결정 (2026-07-06 사용자 확정) → **안 B 채택**
- ✅ **레이아웃 = 안 B (우측 사이드패널)**. 좌=기존 작성폼(메인) / 우=일일보고 후보 작게 → 체크 → 폼 반영.
- ✅ **v0.7.284**(AI초안 `<ul><li>` 태그버그 수정) = **재설계 방향 확정 후 함께 결정** → 안 B는 AI 자산 존치이므로 유효, 재설계 커밋과 동반 예정. (지금 보류 유지)
- 하위 기본값(별도 반대 없으면 적용): AI 자동초안(push)은 **접힘 보조로 존치**(제거 아님), 우측 후보 **소스 = 일일업무 원문**(`DailyTaskSelector` 데이터·로직 재사용).

---

## 5-1. 안 B 상세 설계 (구현 착수 시 기준 — 지금은 기획만)

### (a) 레이아웃
- `page.tsx`의 mine 탭을 `responsive-grid-2`(desktop `1fr 352px`, tablet/mobile 1열 스택)로 구성:
  - **좌 (1fr)**: 기존 `WeeklyReportForm` 카드 = **메인, 항상 펼침**. (현재 상단 AutoDraftPanel 자리를 대체)
  - **우 (352px)**: **일일보고 후보 패널**(신규 소형) — sticky 권장, 모바일에선 폼 아래로 스택.
- 현행 상단 `AutoDraftPanel` 큰 카드 → 하단 `<details>` "AI 자동초안(실험·보조)"로 이동(역전). `WeeklyReportForm`을 감싸던 `<details>`는 제거하고 카드로 승격.
- 폭·패딩은 `MobileShell page-inner`가 SSOT(페이지 전용 폭 클래스 금지). 카드는 `.card`+모달외 공용 토큰.

### (b) 우측 후보 패널 동작 (DailyTaskSelector 재사용·경량화)
- 데이터/AI 변환/`mergeWeeklyRows` 병합 로직은 **`DailyTaskSelector` 그대로 재사용**(SSOT — 복붙 금지). 표현만 "우측 소형 리스트"로 변형.
  - 옵션 1(권장·최소): `DailyTaskSelector`에 `variant="side"` prop 추가 → 접이식 버튼 대신 항상 펼친 소형 체크리스트로 렌더. 로직 100% 공유.
  - 옵션 2: 얇은 래퍼 `DailyMappingSidePanel`이 `DailyTaskSelector` 로직 훅을 재사용.
- 항목 표시: 제목(일일업무 내용 1줄 말줄임) + 체크박스. 폰트 `--fs-2xs`(11px) 이상, 10px 미만 금지. `input-field`/`label` 표준.
- 반영: 체크 → "선택 반영"(N) 버튼 → 기존 `onGenerate(rows)` → `mergeWeeklyRows(prev, generated)`로 좌측 폼 행에 병합(구분 단위, 기존 내용 보존). = 현행 매핑 계약 그대로.
- 빈/로딩/에러 3종 UI: "이번 주 일일업무 없음"/스켈레톤/에러 배너(현행 문구 재사용).

### (c) AI 자동초안(push) 존치 위치
- 하단 `<details>` "AI 자동초안 (보조)"에 현행 `AutoDraftPanel` 그대로. v0.7.284 태그수정이 여기 적용됨(그래서 함께 커밋).
- weekly_report_items·draft API·직렬화 브리지·지연추적 **무변경**(위계·표시만 바뀜).

### (d) 마이그레이션·정합
- DB/RLS/마이그레이션 **없음**. 순수 프론트 재배치.
- 온보딩(`weekly` seq): 타겟 id(`onboarding-category/performance/plan/issues`)가 폼에 있으므로 폼이 메인 승격되면 스포트라이트 정합 향상 — 회귀 아닌 개선. 시작 스텝만 폼 기준으로 확인.
- `QueryToast(saved)` 저장 리다이렉트 경로 유지(`/weekly-report?tab=mine&saved=1`).

### (d-2) 이월(carry-forward) 게이트 버그 수정 — 함께 구현 (사용자 지적)
- **버그**: `page.tsx`의 이월은 `prefillRows.length === 0`(이번주 weekly_reports 없음)일 때만 동작. 그런데 AI 자동초안 저장(PUT /draft)이 `replace_weekly_report`로 weekly_reports를 먼저 채워 → 게이트가 깨지고, AI초안엔 "지난주 계획→이번주 성과" 이월이 없어 **성과칸이 빈다.**
- **수정**: 게이트를 "행 없음"이 아니라 **"셀 비었음"** 기준으로 전환.
  - `prevPlanByCategory` = 지난주 구분별 계획(비어있지 않은 것).
  - 이번주 프리필 각 행: **성과가 빈 경우에만** 해당 구분의 지난주 계획으로 채움(사용자 작성 성과는 **절대 미덮어씀**).
  - 지난주에만 있던 구분(계획 존재) → 이번주 이월 행으로 추가.
  - `initialWeek === thisWeek`에서만. `hasCarryForward` = 실제 이월 발생 여부(배너용).
- 코드 삭제 없음. weekly_reports 쓰기 경로·AI초안 존치.

### (e) 완료 조건 (구현 승인 시 04-completion 기준)
- [ ] 이월: AI초안 저장으로 weekly_reports가 채워진 뒤에도 빈 성과칸이 지난주 계획으로 채워짐(사용자 성과 미덮어씀)
- [ ] 데스크탑: 좌 폼 메인 펼침 + 우 일일보고 후보 패널(352px) 나란히
- [ ] 모바일/태블릿: 1열 스택(폼 → 후보 패널), 가로스크롤 0
- [ ] 우측 후보 체크 → "선택 반영" → 폼 행 병합(기존 내용 보존) 실동작
- [ ] AI 자동초안은 하단 접힘 보조로만 노출(메인 아님)
- [ ] DailyTaskSelector 로직 재사용(중복구현 0), 표시 토큰 표준 준수, `design:check` 통과
- [ ] Playwright로 실렌더 경로 확인(플래그/기본 상태)

### (f) 규모·위험
- 규모: MEDIUM(프론트 3~4파일: `page.tsx` + `DailyTaskSelector`(variant) + 필요시 소형 래퍼 + CSS 토큰). DB 0.
- 위험: 낮음. 최대 변수 = 우측 패널 모바일 스택 위치 + sticky, 그리고 체크 반영 타겟(구분 없는 후보의 행 매칭 — 기존 mergeWeeklyRows 규칙 그대로 사용).

## 6. 영향 범위 (구현 시)
- 🎯 직접: `page.tsx`(위계·레이아웃). 안 B면 `DailyTaskSelector` 재배치 또는 소형 사이드 변형 추가.
- 🌊 파급: 온보딩(`weekly` seq 타겟 id `onboarding-category/performance/...`는 폼에 있음 → 폼이 메인이면 온보딩 정합 ↑), `QueryToast(saved)` 리다이렉트 경로.
- ⚠️ 위험: 안 B 모바일 스택 시 우측 패널 위치, 삽입 타겟(구분 없는 항목의 행 매칭). 안 A는 위험 거의 없음.
- DB/RLS/직렬화: 안 A·B는 **무변경**(표시 위계만). 안 C만 스키마 롤백.

## 7. 선행 별건 — v0.7.284 (커밋 보류중)
AI 초안 `<ul><li>` 태그 노출 버그 수정(section-lines.ts 등)은 완료·🟥 DC-REV APPROVED. 이 재설계에서 AI 패널이 존치(안 A/B)면 그대로 유효 → 재설계 방향 확정 후 함께 커밋 권장. 안 C(제거)면 해당 코드도 함께 폐기.
