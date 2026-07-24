# 03-test-strategy

## 단위
- `baseModelKey`: "H100"/"H100 SXM"/"H100 PCIe"/"H100 NVL" → 동일 키 "h100";
  "A100 SXM"/"A100" → "a100"; "RTX 4090"→"rtx4090"(폼팩터 없음 무변); "B200 SXM6"→"b200";
  alias 보존("A6000"/"RTX A6000"→ base 동일); 빈입력 안전.
- specs 그룹핑(순수 함수로 분리 시): 혼합 model_name 배열 → base 그룹 수/폼팩터 서브그룹 정확.

## 통합(DB, 수동 psql)
- 마이그 174 적용 후: 완전중복 그룹 count>1 = **0**.
- 재연결 무손실: 병합 전후 competitor_product_mapping/supply_quotes/gpu_audit_logs/term/stats **총 참조수 보존**
  (충돌삭제분 제외한 순증감 = 0, survivor로 이동).
- 소프트삭제된 loser는 deleted_at NOT NULL, 활성 목록에서 제외.
- 멱등: 174 재실행 시 추가 변경 0.

## E2E/브라우저 (실측 — self-test 정책)
- GPU 관리 진입 → "H100" 카드 1개(4개 아님) → 클릭 → SXM/PCIe/NVL + generic 폼팩터 전개 → 각 ×1/2/4/8 표시.
- 가격표·시장비교·재고·고객가격표 진입 → 오류/빈화면 없음(회귀 0).

## 회귀 경계
- specs API 응답 형태 변경 → SpecsTab 외 소비자 없는지 grep 확인. 있으면 하위호환 필드 유지.
