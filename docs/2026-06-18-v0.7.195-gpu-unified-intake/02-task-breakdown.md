# 02 — Task Breakdown

| ID | 파일 | 내용 | 검증 |
|----|------|------|------|
| T-1 | `lib/gpu/intake-routing.ts` (신규) | INTAKE_LIMITS, ACCEPT_ALL, classifyFile(SSOT) | tsc |
| T-2 | `lib/gpu/image-downscale.ts` (신규) | canvas 다운스케일 → File 반환 | tsc(브라우저 전용 가드) |
| T-3 | `lib/gpu/intake-routing.test.ts` (신규) | classifyFile 분기·상한 단위테스트 + package.json 등록 | node --test |
| T-4 | `app/api/pricing/gpu/review/stream/route.ts` | multipart 수용(text+files[]) + JSON back-compat. 파일→inlineData. size-guard | build |
| T-5 | `tabs/QuoteRegisterTab.tsx` | 단일 드롭존, classifyFile 자동 라우팅, multipart 전송, 이미지 다운스케일 | build |
| T-6 | `tabs/QuoteRegisterTab.tsx` + `CatalogUploadSection.tsx` | ②③ 시각 섹션 통합/흡수, 배지 정보성 강등 | design:check |
| T-7 | 동상 | 혼합 드롭·큰파일 안내·3상태·반응형·is_test 유지 | 직접테스트 |
| T-8 | — | tsc + next build + design:check + node --test | 그린 |
| T-9 | e2e/ (필요시) + 수동 Playwright | 5경로 실화면 스크린샷 | 통과 |
| T-10 | — | DC-QA/SEC/REV | PASS/80+ |
| T-11 | package.json×2, CLAUDE.md, AGENTS.md | v0.7.195 + 로컬 커밋 | GATE |

## 순서
T-1 → T-2 → T-3 → T-4 → T-5 → T-6 → T-7 → T-8 → T-9 → T-10 → T-11

## 위험/완화
- multipart+SSE 응답 혼용: 요청만 multipart, 응답은 그대로 SSE — 영향 없음. (검증: T-9)
- back-compat 깨짐: JSON 분기 보존 + 기존 호출부(있으면) 확인. (검증: build/grep)
- 다운스케일이 텍스트 PDF엔 무의미: 이미지에만 적용. PDF는 raw multipart로 천장만 상승.
