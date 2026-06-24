# 03 테스트 전략
- canonical-model.test.ts: stripSupplierPrefix('Nebius H100 SXM 80GB','Nebius')→'H100 SXM 80GB'; coreModelKey leading provider 제거; 폼팩터/세대 보존(오제거 0).
- resolve-product.test.ts: 공급사 오염명이 기존 변형에 resolve 되는지(coreModelKey 경유).
- 실데이터(읽기): 정규화 대상 행 사전 점검. 운영 변경은 결정론 스크립트+검증.
