# 03 Test Strategy

## 단위 (node --test, package.json 등재)
- canonical-model.test.ts:
  - "RTX PRO 6000"="RTX Pro 6000"(합침, confident) / "rtx pro 6000" 동일
  - "RTX 6000 Ada" ≠ "RTX Pro 6000" ≠ "Quadro RTX 6000"(별도, 미병합)
  - "RTX 4000 Ada" ≠ "RTX 5000 Ada"(숫자차 미병합)
  - alias 'A6000'→'RTX A6000'(확실시), 애매 입력 confident:false→원본
- 확정 매칭 dedup 헬퍼(추출 가능시): (canonical,memory,gpu_count) 동일→같은 product, 다르면 별도. 멱등.

## 통합/E2E (Playwright, throwaway+is_test)
- 같은 모델 다른 표기("RTX PRO 6000" / "RTX Pro 6000") 견적 2회 확정 → gpu_products 1행만, supply_quotes 최신화(supersede) 확인.
- 유령 차단: 확정 후 ×2/×4/×8 신규 phantom 행 0 확인.
- board 가격표: 정리 후 해당 모델 중복행 0, 가격 정상 확인(스샷).
- 정리: is_test/throwaway 삭제.

## 마이그레이션 검증
- 129 적용 후: 유령 219행 deleted_at 처리, 백업테이블 행수=정리전 전체, gcube/견적행 보존, confirmed 단가 SUM 불변(가격 회귀 0).
- 롤백 리허설: 백업에서 복원 가능 확인(쿼리).

## 회귀 게이트
- 기존 테스트 그린. pricing.ts 단위 불변. next build(React18). design:check.
- 실데이터 단가 회귀 0 — confirmed supply_quotes 미변경.
