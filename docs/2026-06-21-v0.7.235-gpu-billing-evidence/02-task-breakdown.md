# 02 Task Breakdown

## Phase A — ① 재분석 리포트 + 환산 정합성
- A1 `lib/gpu/extract-diff.ts` — diffExtracted(old,new): 변경 필드 [{field,label,before,after}] (+test)
- A1b recheck/route.ts — 프롬프트에 change_summary 요청 + diff 계산 + 응답에 포함
- A2 ReviewTab — handleRecheck 응답 보존, "재분석 결과" 패널(근거+diff) 렌더
- A3 `lib/gpu/price-breakdown.ts` — 원본가→통화→기간→장수→USD/장·hr 단계 산출(normalize-money 재사용) (+test)
- A3b ReviewTab — 단가 행에 "산출 근거" 펼침(breakdown) + SSOT 정합단가 경고배지

## Phase B — ② 설치비+월과금
- B1 마이그레이션 126 (ADD COLUMN, NULL) + migrate.sh 적용
- B2 schema-contract.ts + gpu.quote-extract 프롬프트(DB ai_prompts)에 setup_fee/monthly_price/billing_model
- B3 review/[id]/route.ts confirm — 신규 필드 저장
- B3b ReviewTab — billing_model 분리 행 표시
- B4 pricing.ts ConfirmedQuote 타입 + 표시(설치비 보존, 계산 불변)
- B5 단위테스트(빌링 파싱/표시)

## Phase C — ③ 원본 Drive 보관
- C1 `lib/gpu/evidence-store.ts` — storeEvidence(file): Drive 연결시 uploadFile→{fileId,webViewLink}, 미연결 null (SSOT 래퍼)
- C2 review POST/stream/catalog 업로드 경로에 storeEvidence 배선 + review_items 전파
- C3 confirm → supply_quotes.evidence_drive_file_id 저장
- C4 ReviewTab/HistoryTab "원본 보기" 링크 + degrade 경고

## Phase D — 검증
- D1 단위테스트 전체(node --test) + package.json 등재
- D2 Playwright E2E: throwaway+is_test로 ①재분석diff ②설치비입력 ③원본링크
- D3 GATE: tsc / next build / design:check / lint
- D4 버전 0.7.235(package.json×2, CLAUDE.md, AGENTS.md) + commit
