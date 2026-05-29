# FAST PATH Summary
작업: 약정(term) 필드 정규화 — term_months integer 컬럼 추가 + AI 프롬프트 v1.1 + confirm 흐름 연결
대상:
  - supabase/migrations/034_supply_quotes_term_months.sql (신규)
  - apps/web/app/api/pricing/gpu/review/[id]/route.ts
  - apps/web/app/(member)/pricing/gpu/tabs/QuoteRegisterTab.tsx
이유: term 필드가 자유 텍스트로만 저장되어 필터링/집계 불가 — 개월 정수(term_months)로 정규화 필요
영향: supply_quotes 테이블 스키마 변경, ai_prompts 프롬프트 버전 1.0→1.1 업데이트

## 변경 사항
1. **034_supply_quotes_term_months.sql**: supply_quotes.term_months integer 컬럼 추가 + 인덱스 + ai_prompts v1.1 업데이트
   - 1년→12, 6개월→6, 3개월→3, 스팟/온디맨드/무약정→0, 불명확→null
2. **review/[id]/route.ts**: supply_quotes insert 시 term_months 포함
3. **QuoteRegisterTab.tsx**: CONF_LABELS에 `term: '약정 원문'`, `term_months: '약정 (개월)'` 추가

## DB 적용 확인
- term_months integer 컬럼: 확인
- ai_prompts version=1.1 (active=true): 확인
