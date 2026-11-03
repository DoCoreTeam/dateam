# PLAN newAX: GPU 관리 화면을 한 장으로 다시 만든다
플랜 ID: P0176
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0432
목표 버전: v0.11.101
푸시: 모음
작성: 2026-11-03
시작 커밋: 99a33945

## 목표
- /pricing/gpu 한 화면에서 모델마다 어디가 제일 싸고 그래서 얼마에 팔면 되는지 본다
- 공급사가 몇 곳이든 표의 열 수는 화면 폭만 따르고, 모델 하나의 공급사 전부는 줄 끝 단추로 여는 창 하나에서 본다
- 옛 화면(탭 12개)은 /pricing/gpu/manage 로 옮겨 견적 입력과 검토를 계속 쓴다

## 정한 것 (사용자 답, 2026-11-03)
- 금액 출처: 받은 견적(supply_quotes 확정, price_type cost) + 경쟁사 시세(market_prices), 같은 공급사에 둘 다 있으면 견적
- 줄: 모델명 + 장당 메모리, 금액은 1장 1시간
- 공급사 칸 수: 폭이 허락하는 만큼, 상한 없음
- 순서: 싼 순, 같으면 최근 것 먼저
- 맞추는 기준: 원화, 1장 1시간, 부가세 별도, 환율은 fx_rates 최신(수출입은행), 단위 모르는 값은 순위에서 빼고 창에만 「단위 모름」
- 약정: 약정 없는 가격과 섞어 줄세움, 칸에 약정 표시
- 일자: 줄 끝에 가장 최근 날짜 하나, 오래됨 표시는 안 함
- 판매가: 전략가가 있으면 그 값(장수로 나눈 1장 값), 없으면 최저가 × (1 + pricing_settings.margin_pct), 마진은 화면 위에서 고침
- 상세 창: 공급사 전부 + 전략가 넣기 지우기
- 자리: /pricing/gpu 가 새 화면, 옛 화면은 /pricing/gpu/manage

## 범위 밖
- 견적 시세 입력 경로와 옛 탭 기능 고치기, 옮기기만 함
- 부가세 구분, 원본 데이터에 근거가 없음 (견적 칸 없음, 시세 2,320줄 전부 unknown)
- 새 표와 새 설정값, 기존 pricing_settings 와 gpu_products.strategic_price_krw 만 씀

## 완료 정의
- pnpm typecheck, pnpm test, pnpm build 통과
- 사용자 노출 문자열은 lib/terms 또는 화면 문구 상수에 있음
- 설정값은 env 추가 없이 DB 저장 + UI 관리 (마진은 pricing_settings)
- 공급사 20곳을 넣은 줄에서도 표의 열 수가 그대로 (시험 + 실브라우저)
- 모델 하나의 공급사 전부를 창 하나에서 봄 (실브라우저)
- 새 조회 창구가 teamda gpu board list 로 같은 값을 냄 (웹=CLI 시험)

## 참조
- 조사 결과 (이 대화 2026-11-03): 견적 unit_price_usd 는 구성 총액 USD/시간, per_gpu_usd 는 1장 값, 시세 price_usd 는 이미 1장 1시간 USD
- 계산 SSOT 기존 apps/web/lib/gpu/pricing.ts (propKeyOf 장당 메모리 키)
- 쓰기 창구 기존 PATCH /api/pricing/gpu/settings, PATCH /api/pricing/gpu/strategic-price, POST /api/pricing/gpu/strategic-price/bulk (관리자)
- 기능 정의 apps/web/lib/actions/defs/gpu.ts, 생성 scripts/cli/gen.mjs, 대응표 docs/cli/02-기능대응표.md
- 화면 말 apps/web/lib/terms

## 항목

### I01 줄과 칸을 만드는 계산
상태: 통과
모드: 경량
범위: apps/web/lib/gpu/board.ts (신규), apps/web/lib/gpu/board.test.ts (신규), apps/web/package.json (test 줄 등재)
감사 기준:
- 보안: 해당 없음 근거 기록 (순수 함수, 저장 창구 입력 없음)
- pnpm test 에서 board.test.ts 가 돌고, 공급사 20곳을 넣은 줄의 칸 목록이 20개여도 줄 모양(열 정의)이 같다는 단정 통과
- 싼 순 정렬, 같은 값이면 최근 것 먼저, 같은 공급사의 견적과 시세가 있으면 견적이 남는 단정 통과
- 원화 원본 시간당은 원래 원화를 장수로 나누고, 그 밖은 1장 USD × 최신 환율, 단위 모름은 순위 밖이라는 단정 통과
- 판매가는 전략가 ÷ 장수가 우선이고 없으면 최저가 × (1+마진) 단정 통과
의존: 없음

### I02 조회 창구와 CLI
상태: 통과
모드: 경량
범위: apps/web/app/api/pricing/gpu/board/route.ts (신규), apps/web/lib/actions/defs/gpu.ts, 생성물(openapi.json, CLI), docs/cli/02-기능대응표.md, apps/web/lib/gpu/board-parity.test.ts (신규)
감사 기준:
- 보안: GET /api/pricing/gpu/board 는 requireMemberApi 를 부르고 미인증 401, 서비스롤을 쓰지 않고 사용자 클라이언트로 읽음
- 보안: 오류 응답에 내부 오류 문구를 싣지 않음
- 정의 한 줄 gpu.board.list 가 있고 생성기를 돌린 뒤 cli-parity 검사 통과
- 웹=CLI 시험: 화면이 쓰는 함수와 창구가 같은 buildBoard 를 거친다는 단정 통과
의존: I01

### I03 새 화면과 옛 화면 옮기기
상태: 통과
모드: 경량
범위: apps/web/app/(member)/pricing/gpu/page.tsx, apps/web/app/(member)/pricing/gpu/manage/page.tsx (신규), apps/web/app/(member)/pricing/gpu/board/ (신규 디렉터리), apps/web/lib/terms/pricebook.ts 또는 신규 문구 파일
감사 기준:
- 보안: 해당 없음 근거 기록 (읽기 화면, 권한은 기존 레이아웃 게이트와 창구가 판정)
- /pricing/gpu?tab=xxx 는 /pricing/gpu/manage?tab=xxx 로 넘어가고 옛 탭이 그대로 열림
- 표 열은 모델, 판매가, 공급사 칸 N개, 최근 일자, 단추이고 N 은 표 폭 ÷ 칸 최소 폭으로만 정해짐 (공급사 수와 무관)
- 빈 상태 로딩 오류가 서로 다른 화면으로 보임
의존: I02

### I04 상세 창과 마진 전략가 고치기
상태: 통과
모드: 경량
범위: apps/web/app/(member)/pricing/gpu/board/ (I03 신규 파일), apps/web/lib/gpu/board.ts
감사 기준:
- 보안: 쓰기는 기존 관리자 창구(settings PATCH, strategic-price PATCH, strategic-price/bulk)만 부르고 새 쓰기 창구가 없음, 관리자 아닌 사람에게 고치기 칸이 없고 서버도 403
- 창 하나에 그 줄의 공급사 전부(견적 시세 구분, 원래 금액 통화 단위, 약정, 날짜, 출처)가 싼 순으로 나오고 단위 모름은 맨 아래
- 전략가를 넣으면 그 줄 상품마다 1장 값 × 장수로 저장되고, 지우면 전부 해제되고, 표 판매가가 바로 바뀜
- 브라우저 기본 대화상자를 쓰지 않음 (native-dialog 가드 통과)
의존: I03

### I05 실브라우저 확인
상태: 통과
모드: 경량
범위: .loop/PLAN.P0175.md (기록만)
감사 기준:
- 보안: 해당 없음 근거 기록 (확인만)
- ego-browser 로 1280 과 390 폭에서 /pricing/gpu 를 열어 칸 수가 폭에 따라 바뀌고 가로 넘침 0
- A100 줄 단추로 창을 열어 공급사 전부가 보이고, 공급사 수와 표 열 수를 같이 적음
- 마진을 바꿨다가 원래 값 20 으로 되돌리고, 전략가를 넣었다 지워 원래 상태로 되돌림 (실데이터 원상 복구 확인)
의존: I04
실측 (2026-11-03, ego-browser, 격리 빌드 :3175)
- 폭별 칸: 1280 표 폭 932 에 공급사 칸 2, 1920 표 폭 1572 에 칸 7, 390 표 폭 326 에 칸 1, 셋 다 가로 넘침 0 줄 넘침 0
- A100 40GB 줄: 가격 있는 공급사 7곳, 창에 공급사 값 21건(단위 모름 12건 맨 아래), 창이 열린 동안 표 열 수 6 그대로
- 마진 20 에서 25 로 바꾸자 A100 PCIe 80GB 판매가 1,194 에서 1,244, 20 으로 되돌려 1,194 와 창구 margin_pct 20 확인
- A100 PCIe 80GB 전략가 1,500 저장 시 상품 2개 모두 1,500 과 표 판매가 1,500 전략가, 삭제 뒤 두 상품 null 과 1,194 최저가 +20% 로 원상 복구
- /pricing/gpu?tab=market 이 /pricing/gpu/manage?tab=market 으로 넘어감
- 발견해 고침: 원래 금액에 통화가 두 번 찍힘(1.95 USD USD/hr), 판매가 계산 줄 조사 어색함
- 미확인: 관리자 아닌 계정의 화면은 안 열어 봄, 코드상 isAdmin 거짓이면 전략가 칸 없음과 창구 requireAdminApi 403

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-11-03) 최초 작성 (ins_0432)
