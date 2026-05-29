# Requirements — GPU 견적 다중 모델 동시 추출

## 문제
단일 메일에 H100 + A100 + B200 정보가 혼재할 때 현재는 1개만 추출됨.

## 요구사항
1. AI가 N개 모델을 items 배열로 분리 반환
2. API가 items 수만큼 review_items N건 배치 insert (source_batch_id로 묶음)
3. UI 우측 패널: 단일 카드 → 탭 형식 (모델별 탭)
4. 기존 단일 모델 데이터 하위 호환 유지

## 완료 기준
- 혼합 텍스트 분석 시 탭 N개 표시
- DB에 N건 저장 + source_batch_id 동일
- Playwright 브라우저 테스트 PASS
