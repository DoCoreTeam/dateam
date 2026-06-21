# v0.7.226 — 공급가 "만료" 제거 (영속 원가기준)

## 작업
공급가(supply cost)가 `valid_until` 경과로 폐기되어 가격결정에서 추종가로 자동 폴백되던 동작을 제거. 한 번 확보한 공급가는 사용자가 명시 변경하기 전까지 영속 원가기준으로 유지된다. (사용자 결정: **중립화** — `valid_until` DB 컬럼/입력은 데이터로 보존, 게이팅·폴백·배지만 제거)

## 배경 (사용자 신고)
A100 40GB(NHN Cloud) 지정공급가 Equinix Metal ₩2,971이 `valid_until=2026-06-15` 경과(오늘 06-21) 후 가격결정 공급원가가 ₩3,565(추종가)로 폴백됨. 사용자: "공급가는 매번 받는 게 아니다 — 만료라는 건 없다." → 만료 개념 자체가 업무 모델과 불일치.

## 수정 파일
1. `apps/web/lib/gpu/pricing.ts` — `isValid` 게이팅 무력화(SSOT 단일 길목). 만료된 견적도 cost 풀·채택(is_selected)·전파에 그대로 포함. `basis='fallback'` 분기는 도달 불가가 됨(코드 보존 — 재도입 시 한 줄 복원).
2. `supabase/migrations/124_lowest_quotes_no_expiry.sql` — `v_lowest_quotes` 뷰에서 `valid_until >= CURRENT_DATE` 필터 제거(confirmed 전체 포함). 비파괴(뷰 교체).
3. `apps/web/components/pricing/gpu/unified/DetailPanel.tsx` — 공급원가 견적표의 만료/D-N 경고 배지 제거(`expiryInfo`·`expiryState` import 제거). 유효기한 날짜 자체는 정보로 계속 표시.
4. `apps/web/lib/gpu/pricing.test.ts` — 만료 동작 테스트 2개를 "만료 비활성" 회귀가드로 갱신.

## 변경 이유
"매번 견적 재요청하지 않으려고 만든 시스템"인데 날짜 경과로 공급가를 자동 폐기 → 업무 모델 충돌. 만료는 spot 견적 가정의 잔재였음.

## 영향 범위
- 가격결정(콕핏) 공급원가·판매가추천: `buildCatalog` SSOT 경유 → 지정공급가 영속 반영. (사용자 신고 직접 해결)
- 공급사 목록/공개 API: `v_lowest_quotes` 경유 → 만료 견적도 최저가 후보 포함.
- `lib/gpu/expiry.ts`는 소비처가 사라져 미사용이 됨(파일·테스트 보존 — 비파괴).

## 트레이드오프 (고지)
만료된 옛 단가가 무기한 원가기준으로 쓰일 수 있음 → 시장 괴리 시 시스템이 자동 경고하지 않음. 사용자 업무상 허용(공급가=협상 확보값). 추후 "정보성 재확인 알림"으로 보완 가능.

## 완료조건
- [x] tsc --noEmit 통과
- [x] pricing.test.ts 포함 전체 단위테스트 통과 446건 (만료 견적 포함·채택 영속 검증)
- [x] next build 통과 (React18 런타임 검증)
- [x] design:check 통과
- [x] 실데이터 검증: A100 40GB 가격결정 공급원가 = Equinix ₩2,971, basis=selected (만료 무시) — 실 Supabase 읽기검증
- [x] 🟥 DC-REV 승인 (88/100) + 롤백경로 PriceTableTab fmtDday 동조

## 추가 반영 (DC-REV 권고)
- PriceTableTab.tsx `fmtDday` → null 반환(롤백 경로 만료/D-N 라벨 제거, 정책 일치)
- expiry.ts 헤더에 "v0.7.226 분리·미사용" 주석
