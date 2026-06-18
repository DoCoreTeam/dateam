# 03 — Test Strategy

## 단위 (node --test)
`lib/gpu/intake-routing.test.ts`:
- image/png → {route:'stream', kind:'image'}
- application/pdf → {route:'stream', kind:'pdf'}
- name.xlsx → {route:'catalog', kind:'spreadsheet'}
- name.csv / text/plain → {route:'text'}
- 상한 초과 → tooLarge:true 플래그
- 알 수 없는 확장자 → text 폴백(무음 실패 금지: kind 'unknown' 명시)

## 빌드/정적
- `pnpm exec tsc --noEmit` (image-downscale는 `typeof document` 가드로 SSR 안전)
- `pnpm build` (React18 실빌드 — 런타임 API 확인)
- `pnpm design:check`

## 직접 E2E (Playwright, 사용자 필수 지시) — throwaway admin
실제 렌더 경로(`?tab=intake`, QuoteRegisterTab)에서:
1. 텍스트 붙여넣기 → AI 분석 시작 → 결과/에러 표시
2. 이미지 첨부(작은 png) → 다운스케일 → multipart 전송 → 성공
3. PDF 첨부 → multipart 전송 → 분석 진행(4.5MB 실패 미발생 확인)
4. xlsx 첨부 → 자동 catalog 라우팅 → 검토대기 적재 결과
5. csv 붙여넣기/파일 → csv-intake 흡수
- 각 단계 스크린샷 저장. is_test 태깅 ON으로 실데이터 오염 방지.
- 네트워크 탭에서 stream 요청 Content-Type=multipart 및 200 확인.

## 회귀 가드
- 기존 JSON 경로(back-compat) 1건 확인(있으면). 
- design:check·tsc·node --test 그린이 최소 게이트.
