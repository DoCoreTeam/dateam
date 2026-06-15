# 03 테스트 전략

## 단위 (node:test, --experimental-strip-types)
### catalog-parse.test.ts
- xlsx 버퍼 → headers 12개 정확 추출
- rows 184개, sample 8개
- 셀 수식인젝션("=cmd") → sanitizeCell 적용 확인

### catalog-map.test.ts (핵심 — 결정성)
- validateMapping: 필수필드(competitor_name·model_name·price_usd) 없으면 null
- validateMapping: 화이트리스트 밖 필드 무시
- applyMapping: location "spheron-ai/CANADA-1" → competitor_name="spheron-ai"
- applyMapping: price 문자열 "0.54" → 0.54(number)
- applyMapping: spot=true → pricing_model="spot", false → "on_demand"
- applyMapping: model_name 빈행 skip
- applyMapping: 동일 입력 2회 → 동일 출력(결정성)

## 통합/E2E (Playwright, is_test 격리)
1. 실 xlsx 업로드 → 매핑표 노출 + "검토대기 184건(또는 dedup 후 N건) 적재"
2. DB: review_items where is_test=true and target=competitor → N건 pending 확인
3. 검토대기 1건 승인 → market_prices/competitors에 행 생성 확인(is_test 추적)
4. 다각도:
   - 변형 A: 컬럼 순서 뒤섞은 xlsx → 동일 매핑 성공
   - 변형 B: 헤더명 변경(price→hourly_usd, gpu_name→model) → AI 매핑 성공 or 자가합성
   - 모호: 단위 컬럼 없음 → 매핑 _unit 추정 + 사용자 확인 가능
5. **revert**: 테스트로 만든 is_test 행 전부 삭제 → 운영 데이터 오염 0 확인

## "AI가 프롬프트를 바꿔가며" 실증
- 정상 형식: gpu.catalog-map 프롬프트로 매핑 성공(응답 ai.prompt_key=gpu.catalog-map, synthesized=false)
- 미준비 형식: 매핑 실패 → 자가합성 프롬프트 생성(ai.synthesized=true, 새 prompt_key) → 재시도 성공
- ai_prompts/gpu_audit_logs에 흔적 확인

## 통과 기준
- 단위 전부 PASS, lint·tsc 0 에러
- Playwright 1~5 통과
- is_test revert 후 운영 가격DB diff 0
- DC-QA CRITICAL/HIGH 0, DC-SEC 통과, DC-REV ≥80
