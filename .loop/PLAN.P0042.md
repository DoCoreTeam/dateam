# PLAN newAX: 합쳐져 온 구성을 원문 줄 경계로 되살린다
플랜 ID: P0043
플랜 버전: v0.1.0
상태: 진행중
지시: ins_0058
목표 버전: v0.10.327
작성: 2026-09-20
시작 커밋: 54165c44

## 목표
- 모델이 구성을 한 덩어리로 합쳐 와도 원문의 줄 경계로 다시 갈라 견적서에 줄로 보이게 함

## 범위 밖
- 이미 저장된 옛 견적을 고쳐 쓰는 일 (다시 읽으면 고쳐진다)
- 원문에 없던 줄바꿈을 지어내는 일

## 완료 정의
- pnpm tsc --noEmit, pnpm lint, pnpm test 통과
- 합쳐진 규격을 원문 줄과 대조해 정확히 같을 때만 되가르는 순수 함수가 있고 값으로 시험됨
- 실브라우저에서 구성이 줄로 보이는 것을 확인

## 참조
- .loop/archive/P0040-*.md (구성 읽기를 만든 판)
- 사용자 실측 2026-09-21: 광양분소 견적서에서 구성이 한 문장으로 이어져 보임

## 항목

### I01 합쳐져 온 구성을 원문 줄 경계로 되가른다
상태: 통과
모드: 경량
범위: apps/web/lib/crm/domain/quote-components.ts (신규), apps/web/lib/crm/domain/quote-components.test.ts (신규), apps/web/lib/crm/services/quote-from-file.ts, apps/web/package.json
감사 기준:
- 합쳐진 규격이 원문 연속 줄들의 이어붙임과 **정확히 같을 때만** 되가르는 단정이 있다
- 하나라도 어긋나면 손대지 않는 단정이 있다 (원문에 없던 줄바꿈을 지어내지 않는다)
- 모델이 이미 구성을 나눠 줬으면 건드리지 않는 단정이 있다
- pnpm --filter web exec node --test lib/crm/domain/quote-components.test.ts 통과
- 보안: 순수 함수, 새 표·창구·외부 입력 없음
의존: 없음

## 종합 감사
- (전 항목 통과 후 기록)

## 변경 이력
- v0.1.0 (2026-09-20) 최초 작성 (ins_0058)
