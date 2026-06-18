# 00 — Requirements · GPU 통합입력 통합 리팩터링 (v0.7.195)

## 문제 (직전 진단)
`/pricing/gpu?tab=intake` 실제 렌더 `QuoteRegisterTab.tsx`:
1. **입력 3분할** — ① 메인 textarea+파일첨부 ② CSV·표 붙여넣기(MultimodalIntake) ③ 카탈로그 xlsx/csv(CatalogUploadSection). 백엔드도 각각 `/review/stream`·`/review/commit`·`/market/catalog`.
2. **엑셀 실패(착시)** — 메인 `accept`에 xlsx 없음. 실제론 ③에서만 동작. 사용자는 ①에 넣고 "안 됨" 판단.
3. **PDF/이미지 실패(실버그)** — base64를 JSON body로 전송 → Vercel 4.5MB 본문 한도 초과 → `!res.ok` "AI 분석 시작 실패". (원본 ~3.3MB 초과 시. base64 +33% 인플레)
4. **장식 배지** — "지원 형식" 배지가 탭처럼 보이나 클릭 불가.

## 요구사항
- R1 입력 1곳(단일 드롭존)으로 통합. 사용자가 "어디에 넣나" 고민 제거.
- R2 한 드롭존이 텍스트·이미지·PDF·xlsx/xls·csv·URL 전부 수용.
- R3 종류별 자동 라우팅(코드, SSOT). 사용자에게 입구를 묻지 않음.
- R4 전송 multipart 전환 → base64 인플레 제거. 이미지 클라이언트 다운스케일.
- R5 상한 초과 파일 = 명확한 안내 에러(무음 실패 금지).
- R6 직접 Playwright 자가검증(throwaway). 5경로 실화면.
- R7 배지 혼란 제거.

## 비범위 (이번 스프린트 제외)
- Supabase Storage 직업로드(>4.4MB 완전 무제한) — 후속(01-architecture §미래) 명시.
- 검토대기/게이트 로직 변경 없음(자동확정 금지 패턴 보존).
- 기존 API 라우트 시그니처 파괴 금지(JSON back-compat 유지).

## 완료 정의
PROMPT.md "완료 기준" 1~12 전부 충족 + 직접 테스트 통과 + 로컬 커밋.
