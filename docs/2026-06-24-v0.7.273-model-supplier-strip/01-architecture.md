# 01 아키텍처
## SSOT
- lib/gpu/canonical-model.ts: stripModelNoise(+PROVIDER leading), stripSupplierPrefix(model,supplier).
- resolveProductId(resolve-product.ts) 변경 없음(coreModelKey 강화로 자동 개선).
## 입구
- review/route.ts intake: 저장 전 stripSupplierPrefix 적용.
## 확정 해소
- confirm-review-item.ts: optional productId override.
- ReviewTab: 422(held) → ResolveModal(매핑 후보 select + 신규등록 딥링크).
- SpecsTab: ?tab=specs prefill → SpecModal 자동오픈.
## 데이터
- 정규화 스크립트: supplier leading 일치 행만 교정.
