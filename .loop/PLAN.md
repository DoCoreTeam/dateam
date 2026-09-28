# PLAN newAX: 화면이 저장된 값을 읽고 모순 없이 말한다
플랜 ID: P0085
플랜 버전: v0.2.1
상태: 진행중
지시: ins_0143
목표 버전: v0.10.668
작성: 2026-09-28
시작 커밋: 80c93cdb

## 목표
- 검증 화면이 「아직 못 잼」이라고 말하던 아홉 줄 중 실제로 잴 수 있는 것을 잰다 (값은 이미 표에 있었다)
- 현황 화면이 스스로 모순되지 않는다 (AI 판단 기록이 있는데 「AI 판단이 꺼져 있다」고 하지 않는다)
- 없는 자리를 가리키는 안내를 없앤다 (「이 판에서 쓸 키」는 등록할 칸이 없다)
- 「지금 예측」이 언제 것인지, 장이 닫혔는지를 화면이 말한다

## 범위 밖
- 백테스트를 실제로 돌리는 것 (봉이 하루치뿐이라 거래 표본이 안 나옴, 이번 판의 일이 아님)
- KIS 계좌번호 교정 (사용자만 아는 값)
- 판별 AI 키 칸 신설 (표 스키마 변경, 이번 판에서는 사실을 정확히 말하는 데까지)

## 완료 정의
- pnpm tsc --noEmit, pnpm test, pnpm build 통과
- 로컬 :3000 에서 일곱 화면이 200 이고 서로 모순되는 문장이 없음
- 화면이 「못 잼」이라고 적은 줄은 실제로 잴 수 없는 줄뿐임 (표에 값이 있는데 못 잼이라고 하지 않음)
- 사용자 노출 문자열은 lib/ 의 라벨 상수에 둠 (화면 파일 안 라벨 표 금지)

## 참조
- LOOP.md 7절 보안 기준
- lib/trading/gate/criteria.ts 의 관문 아홉 줄
- supabase/migrations/281_trading_validation.sql (trading_backtest_runs 요약 칼럼)

## 항목

### I01 검증 화면이 표에 저장된 백테스트 요약을 읽는다
상태: 통과
모드: 경량
범위: lib/trading/overview.ts, lib/trading/overview-gate.ts (신규), lib/trading/overview-gate.test.ts (신규), lib/trading/risk/arithmetic.ts, lib/trading/validation/pipeline.ts, lib/trading/settings/store.ts, lib/trading/validation/pipeline-core.test.ts
감사 기준:
- trading_backtest_runs 의 net_expectancy_r·profit_factor·max_drawdown_krw 를 읽어 게이트에 넘김 (지금은 select 로 가져와 놓고 버림)
- riskArithmeticOk 와 riskPerTradeKrw 를 설정값으로 계산해 넘김
- 한 거래 위험 계산이 한 자리에만 있음 — 파이프라인의 고정값 1100·1.56·0.4 와 설정 저장소의 사본(store.ts 의 atr 1.3·reference 1100)이 그 자리로 들어가고 설정에서 나옴
- 새 가드가 고정 null 을 되살린 판과 계산을 한 자리 더 복사한 판에서 실패함 (깨뜨려 확인)
- 보안: 새 표도 새 창구도 없음, 읽는 표는 이미 이 함수가 읽던 것 — 해당 없음
의존: 없음

### I01a 「못 잼」을 시스템 용어로 바꾼다
상태: 통과
모드: 경량
범위: lib/terms/measure.ts (신규), lib/terms/measure.test.ts (신규), lib/terms/index.ts, lib/trading/gate/labels.ts, lib/trading/gate/criteria.ts, lib/trading/position-labels.ts, lib/trading/operator/report-core.ts, app/(trading)/trading/BacktestPanel.tsx, app/(trading)/trading/LatencyPanel.tsx, app/(trading)/trading/validation/page.tsx, lib/trading/operator/checks.ts, lib/trading/operator/handoff-content.ts, lib/trading/operator/run-reason.ts, lib/trading/notify/enable-gate.ts, lib/trading/order/arming-policy.ts, lib/trading/settings/registry.ts, lib/trading/settings/start-labels.ts, app/(trading)/trading/PositionPanel.tsx, lib/trading/overview-shape.test.ts, lib/trading/operator/report.test.ts
감사 기준:
- 화면에 「못 잼」·「못 쟀습니다」·「잴 수 없습니다」·「잰 것 없음」이 없음 (`grep -rn "못 잼\|못 쟀\|못 잽\|잰 것 없음" lib app --include=*.ts --include=*.tsx` 가 주석 밖에서 0건)
- 그 자리의 말이 한 곳에서 나옴 — 화면 파일 안에 라벨 문자열을 안 둠
- 세 상태가 같은 결의 말임 (통과·미달과 나란히 읽히는 명사)
- 가드가 금지어를 값으로 대조하고, 옛 말을 되살린 판에서 실패함 (깨뜨려 확인)
- 보안: 문자열만 바뀜 — 해당 없음
의존: 없음

### I02 관문 안내가 이미 한 일을 하라고 시키지 않는다
상태: 대기
모드: 경량
범위: lib/trading/gate/criteria.ts, lib/trading/gate/criteria.test.ts
감사 기준:
- 판단기 비교 안내가 「설정에서 AI 판단 모델을 고르면」이라고 하지 않음 (모델은 이미 골라져 있고 두 판단기가 나란히 기록되고 있음)
- 못 잰 줄의 안내가 「무엇이 모자란가」를 말함 (검증 거래 수)
- 리스크 산술 안내가 실제로 안 정해진 것만 가리킴
- 가드가 안내 문구를 값으로 대조함 (이름이 아니라)
- 보안: 문자열만 바뀜 — 해당 없음
의존: 없음

### I03 AI 판단 꺼짐 배너가 화면의 기록과 모순되지 않는다
상태: 대기
모드: 경량
범위: lib/trading/jev-labels.ts, lib/trading/jev-labels.test.ts, app/(trading)/trading/page.tsx
감사 기준:
- 오늘 AI 판단 기록이 있으면 「그동안은 규칙 판단만 기록됩니다」라고 하지 않음
- 그 자리에 무엇이 참인지 적음 (이 판은 새 AI 판단을 안 만들고, 화면의 기록은 다른 판이 만든 것)
- 가드가 「기록이 있는 경우」와 「없는 경우」 두 문장을 모두 확인함
- 보안: 문자열과 조건만 바뀜 — 해당 없음
의존: 없음

### I04 판이 막은 키 안내가 할 수 있는 조치를 말한다
상태: 대기
모드: 경량
범위: lib/trading/jev-labels.ts, lib/ai/provider-key-source.ts, lib/ai/provider-key-source.test.ts
감사 기준:
- 「이 판에서 쓸 키를 등록하면」이라는 문장이 없음 (ai_provider_keys 에 판 칼럼이 없어 등록할 칸이 없음: `grep -c "env" supabase/migrations/264_ai_provider_keys.sql` 로 확인)
- 안내가 실제 조치를 말함 (키 목록에 등록하면 판을 안 가리고 쓰인다는 사실 포함)
- 가드가 없는 자리를 가리키는 말을 막음
- 보안: 키 값은 안 싣고 「있다/없다」만 말함 — 기존과 같음
의존: 없음

### I05 지금 예측이 언제 것인지 말한다
상태: 대기
모드: 경량
범위: lib/trading/chart/series.ts, lib/trading/chart/series.test.ts, app/(trading)/trading/ChartPanel.tsx
감사 기준:
- 판단 시각이 지금보다 한참 전이면 그 나이를 화면에 적음 (오후 07:42 에 오후 03:26 판단이면 「4시간 전」)
- 나이 계산이 서버 시각이 아니라 화면 시각 기준이면 하이드레이션이 안 어긋남
- 가드가 갓 나온 판단과 오래된 판단 두 경우를 확인함
- 보안: 해당 없음
의존: 없음

### I06 장이 닫히면 다시 읽기를 멈춘다
상태: 대기
모드: 경량
범위: lib/trading/live-window.ts (신규), lib/trading/live-window.test.ts (신규), app/(trading)/trading/LiveRefresh.tsx, app/(trading)/trading/page.tsx
감사 기준:
- 장이 닫힌 뒤에는 카운트다운을 그리지 않고 다시 읽지 않음
- 그 자리에 무엇이 참인지 적음 (장이 닫혔고 다음에 언제 열리는지)
- 가드가 장중·장 마감 두 경우를 확인하고, 멈추는 조건을 지운 판에서 실패함
- 보안: 해당 없음
의존: 없음

### I07 차트 제목이 실제로 그리는 것을 말한다
상태: 대기
모드: 경량
범위: app/(trading)/trading/ChartPanel.tsx, lib/trading/chart/series.ts, lib/trading/chart/series.test.ts
감사 기준:
- 신호가 0건이면 제목이 「가격과 신호」가 아님
- 판단 점이 차트에 실제로 그려짐 (판단이 있는데 아무 표시도 없지 않음)
- 가드가 신호 유무 두 경우의 제목을 확인함
- 보안: 해당 없음
의존: I05

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-28) 최초 작성 (ins_0143)
- v0.1.1 (2026-09-28) I01 범위에 risk/arithmetic.ts 와 validation/pipeline.ts 추가 — 한 거래 위험 계산이 파이프라인에만 있어 overview 로 복사하면 두 자리가 갈린다 (audit:I01)
- v0.1.3 (2026-09-28) I01 범위에 settings/store.ts 추가 — 같은 계산의 세 번째 사본이 checkLimitAgainstRisk 안에 있었다, 두 자리만 합치면 한도 검사만 옛 셈법으로 남는다 (audit:I01)
- v0.1.4 (2026-09-28) I01 범위에 validation/pipeline-core.test.ts 추가 — 기존 배선 가드가 computeRisk( 라는 이름을 요구해 한 자리로 모으자 빨개졌다, 가드가 요구할 이름은 typicalTradeRisk( 다 (audit:I01)
- v0.2.0 (2026-09-28) I01a 삽입 — 사용자 개입: 「아직 못 잼」은 시스템 용어가 아니다, 화면 넷과 라벨 셋에 같은 말투가 퍼져 있어 한 판에 바꿔야 화면이 안 섞인다 (iv_0125)
- v0.2.1 (2026-09-28) I01a 범위에 열 파일 추가 — 새 가드가 눈으로 못 본 열 자리를 찾아냈다(운영 점검·알림 관문·무장 판정·설정 도움말·손익 화면), 옛 가드 둘은 옛 말을 글자로 들고 있어 같이 고침 (audit:I01a)
