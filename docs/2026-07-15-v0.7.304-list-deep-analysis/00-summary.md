# 목록 심층분석 — 작업 요약 (v0.7.304 예정)

## 요구사항
다른 곳에서 나온 답변/자료/파일을 넣으면 → 그 안의 목록(번호·기호·문장형) 항목을 **무손실**로 전부 추출 →
사용자가 검수(선택/수정/추가/삭제) → 각 항목을 개별로 심층 분석. AI채팅과 같은 provider(Gemini) 재사용.
최우선 하드 요구사항: **추출 시 항목을 생략·축소·요약·병합·절단하지 않는다.**

중간에 코디네이터 지시로 스코프가 3차 확장됨:
1. (최초) 텍스트 붙여넣기 + 기본 파일(pdf/docx/txt) → 추출 → 검수 → 항목별 분석.
2. 전 포맷 지원 확장: 이미지(비전 OCR)·엑셀·PPT·docx·md/txt/csv·html·pdf.
3. 무손실 원칙 명문화: 구조 파싱(parseListItems)이 잡은 항목은 AI 보정을 거쳐도 절대 사라지지 않음(병합 계약).
4. 완성형 확장(A~H 우선순위): A 완전성검증, B 관점선택, C 부분실패회복, D 맥락기반+종합, E 내보내기, F 채팅연계, G DB영속화, H 비용표시.

## 구현 완료 (A·B·C·D·E + 코어 + 전포맷 + 무손실)

### 신규/수정 파일
- `apps/web/lib/ai-chat/list-extract.ts` (신규, 순수함수 SSOT)
  - `parseListItems(text)`: 번호(1./1)) · 원문자(①~⑳) · 한글순번(가./나)) · 기호(-*•) 목록 줄 추출. 코드블록 제외. 텍스트 절대 절단 안 함.
  - `mergeExtractedItems(parsed, aiTexts)`: AI 보정 결과와 1차 구조 파싱 결과 병합. **parsed의 모든 항목은 반드시 최종 결과에 포함**(recovered 플래그로 표시). 완전 동일(정규화 키)만 중복 제거, 애매하면 둘 다 남김.
  - `classifySourceMime(mime, filename)`: 업로드 소스 → 처리방식(text/office/pdf/html/image) 판정, mime 우선 + 확장자 폴백.
- `apps/web/lib/ai-chat/list-extract.test.ts` (신규) — 18개 케이스(마커별 파싱, 코드블록 제외, 무손실 병합, 분류 판정).
- `apps/web/lib/ai-chat/document-extract.ts` (수정) — `extractPdfText` 신설(officeparser pdf 경로 SSOT화). 기존 knowledge-upload 라우트의 로컬 중복 함수를 제거하고 이 함수를 재사용하도록 정리(재사용 정책 §).
- `apps/web/app/api/admin/ai-chat/knowledge-upload/route.ts` (수정) — 위 정리에 따라 로컬 `extractPdfText`/`PDF_PARSE_TIMEOUT_MS` 제거, import로 대체. 동작 동일.
- `apps/web/types/database.ts` (수정) — `AiFeature`에 `'ai-chat-analyze'` 추가(DB는 text 컬럼이라 마이그레이션 불필요).
- `apps/web/app/(member)/ai-chat/analyze/page.tsx` (신규) — `requireAdmin()` 게이트.
- `apps/web/app/(member)/ai-chat/analyze/actions.ts` (신규, `'use server'`)
  - `extractItems(formData)`: 텍스트 붙여넣기 또는 파일(전 포맷) → 소스별 텍스트/비전 추출 → parseListItems + Gemini 보정 → mergeExtractedItems. 파일 크기·매직바이트 검증. 대용량 문서는 100,000자 상한(기존 attachments.ts SSOT와 동일) — 절단 시 `truncated:true`로 명시 반환(침묵 절단 금지).
  - `analyzeItem(input)`: 항목 1건 + 관점(lens) + 자유 지시 + 원문 컨텍스트(최대 8,000자, 배경 참고용이며 항목 본문이 아님) → Gemini 심층분석(마크다운).
  - `synthesizeInsights(entries)`: 완료된 항목들의 분석 결과를 모아 cross-item 종합 인사이트 생성.
  - Gemini 호출은 `lib/ai-chat/registry.ts`(getProviderConfig/getProvider) + `providers/gemini.ts`(streamChat, attachments 포함) 그대로 재사용. 토큰 로깅은 `logTokenUsage(feature:'ai-chat-analyze')`.
- `apps/web/app/(member)/ai-chat/analyze/AnalyzeClient.tsx` (신규) — 오케스트레이터. Step1(입력: 붙여넣기/파일) 인라인.
- `apps/web/app/(member)/ai-chat/analyze/ItemReviewList.tsx` (신규) — Step2(검수): 완전성 배지(구조파싱 N개, AI가 놓쳐 복구된 항목 R개 강조), 전체선택/해제, 항목별 편집(전체 텍스트, 절단 없음)/삭제, 수동 추가, 분석 관점 5종 라디오 + 자유지시.
- `apps/web/app/(member)/ai-chat/analyze/AnalysisResults.tsx` (신규) — Step3(분석): 동시성 제한(3) 병렬 분석, 항목별 상태(대기/분석중/완료/실패) 배지, **실패 항목만 재시도**(완료분 유실 없음), 종합 인사이트 버튼, 결과 md/txt/docx 내보내기(기존 `lib/ai-chat/export.ts`·`export-docx.ts` 재사용), 항목별 복사 버튼.
- `apps/web/app/admin/ai-chat/AiChatClient.tsx` (수정) — 상단바에 "목록 심층분석"(ListChecks 아이콘) 링크 버튼 추가 → `/ai-chat/analyze`.
- `apps/web/package.json` (수정) — `test` 스크립트에 `list-extract.test.ts` 추가.

### 지원 포맷
- 이미지(png/jpg/webp): Gemini 비전(attachments 경로, `toGeminiParts` 그대로 재사용)으로 OCR+항목추출.
- 엑셀(xlsx)/PPT(pptx)/워드(docx): `extractDocumentText`(officeparser) 재사용.
- PDF: `extractPdfText`(officeparser, 신규 SSOT) 재사용.
- HTML(html/htm): `htmlToPlain` 재사용 후 텍스트 파이프라인.
- md/txt/csv/json: `extractDocumentText` 텍스트 디코드 경로 재사용.

### 무손실 계약
- `parseListItems`가 구조적으로 잡은 항목은 `mergeExtractedItems`를 거쳐도 100% 결과에 남는다(단위테스트로 고정).
- 항목 텍스트는 파싱·병합·검수·분석 어느 단계에서도 잘리지 않는다(고정폭 clamp/line-clamp 미적용, `white-space:pre-wrap`).
- 대용량 문서 처리 시 시스템 상한(100,000자)에 걸리면 **명시적 배지로 경고**(침묵 절단 금지) — "원본이 커서 앞부분까지만 처리했습니다".
- Gemini 추출 실패 시 1차 구조 파싱 결과만으로 진행(폴백), 완전 실패는 없음.

## 완료기준 검증
- `cd apps/web && pnpm exec tsc --noEmit` → exit 0.
- `cd apps/web && pnpm test` → 916 tests pass, 0 fail.
- `pnpm design:check` → 통과(hex 0, 신규 ratchet 위반 0).

## 미구현 / 보류 (우선순위 F·G·H — 명시적 보고)
- **F. AI채팅 연계("채팅으로 이어가기")**: 미구현. `createConversation`은 있으나 초기 메시지를 프리필하는 메커니즘이 기존 `Composer`/`AiChatClient`에 없어(스트리밍 전송 전 초안 주입 경로 부재), 안전하게 붙이려면 핵심 공용 컴포넌트 수정이 필요 — 리스크 대비 이번 범위에서 보류.
- **G. 영속 저장(DB)**: 미구현. `ai_analysis_sessions`/`ai_analysis_items` 마이그레이션과 세션 재방문 UI 모두 보류(코디네이터 지시상 "마이그는 파일만"이었으나, 파일만 만들고 배선 코드가 없으면 죽은 스키마가 되어 오히려 혼란 — 완전한 페어(마이그+세션 저장/조회 코드)로 별도 스프린트에서 착수 권장).
- **H. 토큰 비용 표시**: 미구현. `logTokenUsage(feature:'ai-chat-analyze')`로 로깅 자체는 이미 되고 있으나(운영 DB `ai_token_logs`에서 조회 가능), 세션 내 합계를 UI에 표시하는 기능은 없음.
- PDF 내보내기(E의 4번째 포맷)는 미구현 — 기존 `/api/admin/ai-chat/export-pdf` 라우트가 실제 `ai_conversations` 레코드에 결합되어 있어 임시 분석 세션에는 그대로 재사용 불가(G 미구현과 연결됨). md/txt/docx 3종은 완료.

## 커밋/배포
사용자 지시에 따라 **커밋·푸시하지 않음**. CEO가 E2E 검증 후 커밋 예정.
