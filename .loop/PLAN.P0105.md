# PLAN newAX: 리포트가 기간을 말하고 활동을 센다
플랜 ID: P0105
플랜 버전: v0.1.2
상태: 진행중
지시: iv_0179
목표 버전: v0.10.867
작성: 2026-10-02
시작 커밋: 36dcd381

## 목표
- 딜을 **월·분기·반기·연**으로 보고, **지난 기간과 견줄** 수 있다, 지표 탭과 현황 탭이 같은 기간 어휘를 쓴다
- 리포트가 데이터 한 건에 화면을 다 쓰지 않는다, 빈 구간이 접히고 같은 숫자가 세 번 서지 않는다
- **활동 421건을 목록으로 보고 지표로 센다**, 누가 이번 달에 몇 번 접촉했는지 물을 자리가 생긴다

## 범위 밖
- 활동을 새로 만드는 길 (`Timeline` 의 인라인 입력이 이미 있고 이번에 바꾸지 않는다)
- 미팅·할 일·변경 이력 화면 (각자 이미 있고 활동과 다른 개체다)
- 업무 허브의 `/work/activity` (CRM 밖이고 다른 데이터다)
- 리포트 내보내기·예약 발송
- 목표(`TargetSpec`)·마감(`close`) 규칙 변경

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test, pnpm build 통과
- 리포트 두 탭이 **같은 기간 어휘**를 쓴다, 반기가 양쪽에 있고 지난 기간으로 갈 수 있다
- 기간 비교가 두 탭에 있고, 견줄 기간이 없으면 0 이 아니라 「견줄 것 없음」이라고 쓴다
- 현황 탭 세로 길이가 1440 폭에서 **2,600px 이하**다 (실측 기준선 4,278px)
- `/crm/activities` 가 서고 활동 421건이 목록으로 보인다, 종류·담당자·기간으로 거를 수 있다
- 리포트 지표에 **활동 지표가 하나 이상** 있고 담당자·종류 축으로 쪼갤 수 있다
- 화면 문구는 전부 `lib/terms` 를 지난다 (이 저장소는 i18n 메시지 파일이 없고 용어집이 그 자리다)
- 보안 5종 재측정 전부 0

## 참조
- LOOP.md 7절 보안 기준, 9절 U-N · F-N, 부록 버전 규칙
- 실측 2026-10-02 15:30 (:3100 실브라우저 · 운영 DB)
  - `crm_activity` **421건** (NOTE 397 · SYSTEM 23 · CALL 1, 전부 최근 90일). 목록 화면 0개, 리포트 지표 0개
  - 현황 탭 세로 1440폭 **4,278px** / 390폭 **7,150px**, 지표 탭 390폭 2,124px, 가로 넘침은 양쪽 0
  - 「달마다」 12줄 중 **11줄이 빈 틱과 「—」**, 실데이터는 8월 한 줄
  - 요약 카드 4장 중 **3장이 같은 숫자**(24,260,000원 — 수주 총액·인식 매출·현금 매출)
  - 지표 탭 조건 줄이 **브라우저 기본 `<select>` 4개**, 같은 화면 위쪽 탭은 `SegmentedTabs`, 현황 탭은 칩
  - 따뜻한 새로고침 2.3초 — **느리지 않다**, 처음 20초는 dev 컴파일이었다
- `lib/crm/domain/report-axis.ts:50` `PeriodKey` 넷(THIS_MONTH·THIS_QUARTER·THIS_YEAR·LAST_12M)
- `lib/crm/domain/target.ts:26` `PeriodKind` 넷(YEAR·HALF·QUARTER·MONTH) — 위 넷과 **하나도 안 겹친다**
- `lib/crm/domain/metrics.ts:99` `METRICS` 14개가 **전부 딜 기준**, 활동 지표 0개
- `lib/crm/nav/groups.ts:72` 「기록」 묶음 = 미팅·할 일·변경 이력, 활동이 없다
- `components/ui/crm/Timeline.tsx` — 활동을 그리는 유일한 자리, 딜·회사·인물 **상세 안쪽**에만 있다
- `lib/ui/picker-standard.test.ts:43` `BASELINE = 107` — 사유 없는 드롭다운은 **늘면 실패**한다
- `prisma/schema.prisma:502` `CrmActivity` — `type`·`occurredAt`·`createdById`·회사/인물/딜/미팅 연결이 다 있다

## 항목

### I01 두 탭이 같은 기간 어휘를 쓴다
상태: 통과
모드: 경량
범위: apps/web/lib/terms/report.ts, apps/web/lib/crm/domain/target.ts, apps/web/lib/crm/domain/target.test.ts, apps/web/lib/crm/domain/close.ts, apps/web/lib/crm/domain/report-axis.ts, apps/web/lib/crm/domain/report-axis.test.ts (신규), apps/web/lib/crm/domain/metric-labels.ts (신규) apps/web/lib/crm/domain/metric-agg.ts, apps/web/lib/crm/domain/metric-agg.test.ts, apps/web/app/(crm)/crm/reports/TargetModal.tsx, apps/web/lib/changelog/entries.ts, apps/web/app/api/crm/reports/route.ts, apps/web/app/(crm)/crm/reports/BusinessPanel.tsx, apps/web/app/(crm)/crm/reports/ReportsClient.tsx, apps/web/app/(crm)/crm/reports/business-panel.module.css, apps/web/app/(crm)/crm/reports/MetricsClient.tsx, apps/web/package.json
감사 기준:
- 보안: `app/api/crm/reports/route.ts` 를 고친다, 새 창구가 아니고 `withCrmApi('READONLY')` 를 그대로 지나는 것을 확인한다, 모르는 기간 값이 와도 500 이 아니라 기본값으로 되돌아가는 기존 처리가 남아 있는 것을 확인한다
- `report-axis` 가 `target.ts` 의 `Period`(kind·year·index)를 받는다, 단위 시험이 연·반기·분기·월 네 종류와 지난 기간(2025년 2분기)의 from/to 를 단정한다
- 반기가 현황 탭에 뜬다, 상반기는 1월 1일~6월 30일이고 하반기는 7월 1일~12월 31일인 것을 단위 시험이 단정한다
- 지난 기간으로 갈 수 있다, 고른 기간이 주소에 남아 새로고침해도 같은 화면이다
- `LAST_12M` 은 남는다, 「최근 12개월」은 달력 기간이 아니라 다른 질문이므로 지우지 않는다
- 기간 어휘가 `lib/terms/report.ts` 한 곳에서 온다, 화면 파일과 도메인 파일에 「연간·반기·분기·월」·「상반기·하반기」 사본이 없다
- 두 탭이 같은 기간을 **같은 글자**로 쓴다, 단위 시험이 `periodLabel` 과 `reportPeriodLabel` 이 같은 기간에서 같은 문자열을 내는 것을 단정한다
- 기간 이름이 든 문장의 조사를 화면이 고르지 않는다, `lib/ui/josa` 를 지난다
- 새 시험 파일이 `apps/web/package.json` 의 test 스크립트에 등재되고 등재 후 총 시험 수가 늘어난다
- 화면 문구는 `lib/terms/report.ts` 를 지난다, pnpm test glossary 와 product-copy 통과
의존: 없음

### I02 기간을 견준다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/domain/period-compare.ts (신규), apps/web/lib/crm/domain/period-compare.test.ts (신규), apps/web/app/api/crm/reports/route.ts, apps/web/app/api/crm/metrics/route.ts, apps/web/app/(crm)/crm/reports/BusinessPanel.tsx, apps/web/app/(crm)/crm/reports/MetricsClient.tsx, apps/web/lib/terms/report.ts, apps/web/package.json
감사 기준:
- 보안: 창구 둘을 고친다, 새 창구가 아니고 둘 다 `withCrmApi('READONLY')` 를 그대로 지나는 것을 확인한다, 비교 기간을 주소로 받되 모르는 값은 기본값으로 되돌리고 500 을 내지 않는 것을 확인한다
- `period-compare` 가 전기와 전년 동기를 돌려준다, 단위 시험이 2026년 1분기의 전기는 2025년 4분기이고 전년 동기는 2025년 1분기인 것을 단정한다
- 비교 기간에 값이 없으면 **0 이 아니라 null** 을 돌려준다, 단위 시험이 단정한다
- 카드에 증감이 붙는다, 견줄 것이 없으면 「견줄 것 없음」이라고 쓰고 「0%」라고 쓰지 않는다
- 통화를 합치지 않는다, 비교도 통화별로 한다, 단위 시험이 섞인 통화에서 합계를 안 내는 것을 단정한다
- 새 시험 파일이 `apps/web/package.json` 의 test 스크립트에 등재되고 등재 후 총 시험 수가 늘어난다
의존: I01

### I03 한 건짜리 데이터가 화면을 다 안 먹는다
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/reports/BusinessPanel.tsx, apps/web/app/(crm)/crm/reports/business-panel.module.css, apps/web/lib/terms/report.ts
감사 기준:
- 보안: 해당 없음, 읽기 화면이고 창구도 권한 판정도 안 건드린다
- 「달마다」가 값 없는 구간을 접는다, 12줄 중 11줄이 빈 틱이던 것이 사라지고 접은 줄 수를 화면이 말한다
- 요약 카드가 같은 숫자를 세 번 안 쓴다, 수주·인식 매출·현금 매출이 같은 값일 때 그 사실을 한 줄로 말한다
- 실브라우저 1440 폭에서 현황 탭 `main.page-inner` 의 scrollHeight 가 **2,600px 이하**다 (기준선 4,278px)
- 실브라우저 390 폭에서 **4,000px 이하**다 (기준선 7,150px)
- 1440 폭과 390 폭에서 가로 넘침이 0 이다 (scrollWidth 와 clientWidth 비교)
- 화면 문구는 `lib/terms/report.ts` 를 지난다, pnpm test glossary 와 product-copy 통과
의존: I01

### I04 조건 줄이 앱의 선택 UI 를 쓴다
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/reports/MetricsClient.tsx, apps/web/app/(crm)/crm/reports/metrics.module.css, apps/web/lib/ui/picker-standard.test.ts, apps/web/lib/terms/report.ts
감사 기준:
- 보안: 해당 없음, 읽기 화면이고 주소 값은 서버가 이미 모르는 값을 버린다
- 기간·연도 고르기가 현황 탭과 같은 생김새다, 같은 화면 안에서 선택 UI 가 두 가지가 아니다
- 반기·분기 칸이 맨숫자 `1` `2` 가 아니다, 「상반기」 「1분기」처럼 읽히는 말을 쓰고 그 말은 `lib/terms/report.ts` 에서 온다
- `picker-standard.test.ts` 의 `BASELINE` 이 107 보다 **작아진다**, 줄인 만큼 내리고 올리지 않는다
- 가드를 일부러 깨 본다, `BASELINE` 을 새 값보다 1 작게 두면 실패하는 것을 확인하고 pass --notes 에 적는다
- 실브라우저 1440 폭과 390 폭에서 조건 줄의 가로 넘침이 0 이고 390 폭에서 칸이 겹치지 않는다
- 화면 문구는 `lib/terms/report.ts` 를 지난다, pnpm test glossary 와 product-copy 통과
의존: 없음

### I05 활동을 목록으로 본다
상태: 대기
모드: 경량
범위: apps/web/app/(crm)/crm/activities/page.tsx (신규), apps/web/app/(crm)/crm/activities/ActivitiesClient.tsx (신규), apps/web/app/api/crm/activities/route.ts, apps/web/lib/crm/nav/groups.ts, apps/web/lib/crm/nav/groups.test.ts, apps/web/lib/terms/entity.ts, apps/web/lib/policy/api-auth-surface.test.ts
감사 기준:
- 보안: 기존 창구에 목록 조회를 더한다, `withCrmApi('READONLY')` 를 그대로 지나는 것과 워크스페이스 밖 활동이 안 섞이는 것을 확인한다, 남의 워크스페이스 id 를 주소에 넣어 불러 0건이 오는 것을 실제로 확인한다
- 보안: `api-auth-surface.test.ts` 가 이 경로를 알고 통과한다, 열어 둔 목록에 새로 들어가지 않는다
- `/crm/activities` 가 서고 활동 **421건**이 목록으로 보인다, 상한에 걸리면 몇 건 중 몇 건인지 화면이 말한다
- 종류(노트·통화·미팅·메일·시스템)·담당자·기간으로 거를 수 있다, 고른 조건이 주소에 남아 새로고침해도 같은 화면이다
- 목록의 한 줄에서 그 활동이 붙은 회사·인물·딜로 갈 수 있다, 붙은 데가 없으면 없다고 쓴다
- 「기록」 묶음에 탭이 선다, `groups.test.ts` 와 `nav-standard.test.ts` 가 통과한다
- 실브라우저에서 `/crm/activities` 를 열어 목록이 그려지고 거르기가 실제로 건수를 바꾸는 것까지 확인한다 (1440 폭과 390 폭, 가로 넘침 0)
- 화면 문구는 `lib/terms` 를 지난다, pnpm test glossary 와 product-copy 통과
의존: 없음

### I06 활동 지표가 리포트에 선다
상태: 대기
모드: 경량
범위: apps/web/lib/crm/domain/metrics.ts, apps/web/lib/crm/domain/metrics.test.ts, apps/web/lib/crm/services/activity-metrics.ts (신규), apps/web/lib/crm/services/activity-metrics.test.ts (신규), apps/web/app/api/crm/metrics/route.ts, apps/web/app/(crm)/crm/reports/MetricsClient.tsx, apps/web/lib/terms/report.ts, apps/web/package.json
감사 기준:
- 보안: 창구를 고친다, 새 창구가 아니고 `withCrmApi('READONLY')` 를 그대로 지나는 것을 확인한다, 활동 조회가 워크스페이스로 걸러지는 것을 확인한다
- 활동 지표가 하나 이상 선다, 활동 건수가 기간으로 걸리고 단위 시험이 `occurredAt` 기준인 것을 단정한다
- 담당자(`createdById`)·종류(`type`) 축으로 쪼갤 수 있다, 단위 시험이 교차표 칸 합이 전체와 같은 것을 단정한다
- 시스템 활동이 사람 활동과 섞이지 않는다, 단위 시험이 `SYSTEM` 23건을 사람 접촉으로 안 세는 것을 단정한다
- 카드를 누르면 그 지표가 센 활동이 목록으로 열린다, 그 목록의 건수가 카드 숫자와 같다
- 새 시험 파일이 `apps/web/package.json` 의 test 스크립트에 등재되고 등재 후 총 시험 수가 늘어난다
- 실브라우저에서 활동 카드를 눌러 교차표가 열리고 담당자별 숫자가 그려지는 것까지 확인한다
- 화면 문구는 `lib/terms/report.ts` 를 지난다, pnpm test glossary 와 product-copy 통과
의존: I04, I05

### I07 용어 가드가 파일 이름이 아니라 화면 글을 본다
상태: 대기
모드: 경량
범위: apps/web/lib/ui/glossary.test.ts, apps/web/scripts/.glossary-baseline.json, apps/web/lib/crm/domain/report-axis.ts, apps/web/lib/crm/domain/metric-agg.ts
감사 기준:
- 보안: 해당 없음, 가드와 라벨 파일만 고친다
- 가드가 `(terms|labels)` 라는 **파일 이름**으로 고르는 것을 그만둔다, `lib` 아래에서 화면이 읽어 가는 한글 문구를 보고 고른다
- AI 프롬프트와 서버 로그는 화면 글이 아니므로 사유와 함께 뺀다, 뺀 목록이 코드에 있고 한 줄짜리 사유가 붙는다
- 「—」 규칙을 넓힌 범위에서 실제로 세고 결과를 적는다 (실측 2026-10-03 전체 `lib` 236줄, 그중 다수가 프롬프트와 로그)
- 즉시 0 으로 잠글 수 없으면 기존 ratchet 방식으로 걸고 줄어든 값이 자동으로 내려가는 것을 확인한다
- 가드를 일부러 깨 본다, `domain/*.ts` 에 「—」 든 문구를 한 줄 넣어 실패하는 것을 확인하고 pass --notes 에 적는다
의존: 없음

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-10-02) 최초 작성 (iv_0179)
- v0.1.1 (2026-10-03) I01 범위에 기간 어휘 SSOT 를 넣음 (ins_0185)
  - 왜: 같은 기간을 `target.periodLabel` 은 「2026 3분기」로, 새로 쓴 `reportPeriodLabel` 은 「2026년 3분기」로 적고 있었다. I01 의 목표가 「두 탭이 같은 기간 어휘를 쓴다」인데 구현이 어휘를 하나 더 만들고 있었다
  - 실측: 기간 이름을 적는 자리가 넷 — `terms/report.ts` 밖에 `target.ts:28`·`target.ts:49`·`report-axis.ts:142`·`MetricsClient.tsx:207,442`
  - `MetricsClient.tsx` 는 **말만** 고친다, 선택 UI 의 생김새(`<select>` → 탭)와 `picker-standard` 기준선은 I04 의 일이다
  - 「상반기」 사본이 `lib/work/project-display.ts`·`lib/work/activity-diff.ts` 에도 있으나 업무 허브는 이 플랜의 범위 밖이라 손대지 않고 적어 둠
- v0.1.2 (2026-10-03) I07 추가 (ins_0185)
  - 왜: 「—」 가드와 금지어 가드가 `(terms|labels)` 라는 **파일 이름**으로 대상을 고른다. 그래서 화면 글이 든 `domain/report-axis.ts` 를 못 봤고, LENS_HINT 두 줄이 「—」를 달고 화면에 떠 있었다. 내가 새로 만든 `metric-labels.ts` 가 걸린 것은 이름에 labels 가 들어갔기 때문이고 그건 운이다
  - 실측 2026-10-03: 범위를 `lib` 전체로 넓히면 「—」 위반 236줄. 그중 상당수가 AI 프롬프트(`lib/ai-chat/grouping/*`)와 `console.warn` 로그라 화면 글과 갈라야 한다
  - 이번 항목에서는 손대는 파일 안의 두 줄만 고쳤다 (report-axis.ts LENS_HINT)
- v0.1.1 (2026-10-03) I01 범위에 기간 어휘 SSOT 를 넣음, 같은 기간을 target 은 2026 3분기 report-axis 는 2026년 3분기로 적어 구현이 어휘를 하나 더 만들고 있었음 (ins_0185)
- v0.1.2 (2026-10-03) 용어 가드가 파일 이름으로 대상을 골라 domain 의 화면 글을 못 보는 것을 I07 로 추가, 실측 lib 전체 236줄 (audit:I01)
