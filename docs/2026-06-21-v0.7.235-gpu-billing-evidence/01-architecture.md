# 01 Architecture

## 실제 렌더 경로 (확정)
`/pricing/gpu?tab=review` → `GpuPricingClient.tsx:435` → `tabs/ReviewTab.tsx` (feature flag 무관, 항상).

## ① 재분석 리포트 + 환산 정합성
- recheck 라우트(`review/[id]/recheck/route.ts`):
  - 프롬프트에 `change_summary`(한국어 근거, "무엇을 왜 바꿨는지") 출력 요청 추가.
  - 서버에서 `diffExtracted(old=item.current_extracted, new=reExtracted.extracted)` 계산 → 변경 필드 목록(before/after).
  - 응답: `{ item, extracted, iteration, change_summary, diff }`.
  - diff 계산은 SSOT 유틸 `lib/gpu/extract-diff.ts`로 분리(단위테스트 대상).
- ReviewTab:
  - `handleRecheck`가 응답 보존 → 카드 내 "재분석 결과" 패널 렌더(근거 + 필드별 before→after).
  - 단가 산출 근거 표시: `lib/gpu/price-breakdown.ts`(원본가·통화·기간·장수·환율→USD/장·hr 단계 산출) 신설, normalize-money SSOT 재사용.
- 환산 정합: 표시는 SSOT(720·주입fx) 기준 재계산값을 "정합 단가"로 같이 노출. AI 하드코딩값과 다르면 경고 배지.

## ② 설치비+월과금
- 마이그레이션 126: `supply_quotes` ADD COLUMN setup_fee_krw numeric NULL, monthly_price_krw numeric NULL, billing_model text NULL CHECK(billing_model IN ('hourly','monthly','one_time_plus_monthly')).
- 추출 스키마(schema-contract.ts)·프롬프트: setup_fee/monthly_price/billing_model raw 추출(환산 코드가 처리).
- confirm 라우트: merged에서 신규 필드 저장. unit_price_usd(시간당 단일 단가) 계산식은 불변 — 설치비는 별도 컬럼 보존.
- ReviewTab: billing_model이 one_time_plus_monthly면 "설치비 / 월단가" 분리 행 표시.

## ③ 원본 Drive 보관
- 업로드 경로(review POST, market/catalog, review/stream): 파일 수신 시 `uploadFile`로 Drive `AX사업본부/GPU견적` 폴더에 저장 → file_id 획득.
- file_id를 review_items.source_input_id(기존 driveFileId 슬롯) 또는 신규 전파 → confirm 시 supply_quotes.evidence_drive_file_id.
- Drive 미연결(`getDriveConnectionStatus` false)면 업로드 skip + 경고, 추출은 정상 진행.
- ReviewTab/HistoryTab: evidence_drive_file_id 있으면 "원본 보기" 링크(webViewLink) 노출.

## SSOT 재사용
- 환산: normalize-money.ts (절대 복붙 금지)
- diff/breakdown: 신규 lib/gpu/extract-diff.ts, price-breakdown.ts
- Drive: lib/google-drive.ts
