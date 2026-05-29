# FAST PATH Summary
작업: GPU 가격 통합 입력 — 이미지 단독 분석 지원
대상: apps/web/app/(member)/pricing/gpu/tabs/QuoteRegisterTab.tsx, apps/web/app/api/pricing/gpu/review/route.ts
이유: 이미지만 붙여넣으면 "분석할 텍스트를 입력해 주세요." 오류 발생 — handleAnalyze가 textContent만 검사하고 previewUrl(이미지) 무시
영향: 없음 (기존 텍스트 분석 동작 그대로 유지)

## 변경 사항
1. **QuoteRegisterTab.tsx**
   - AttachedFile 인터페이스에 `base64Data?: string` 추가
   - processFile(): 이미지 첨부 시 FileReader로 base64 추출하여 저장
   - handleAnalyze(): 이미지 첨부 시 텍스트 검증 스킵 + imageData payload 전송 + 채널 자동 'img' 설정

2. **review/route.ts**
   - body 타입에 `imageData?: unknown` 추가
   - text OR imageBase64 둘 중 하나만 있으면 통과
   - Gemini parts 배열 구성: 이미지 있으면 inlineData part 먼저 추가 → multimodal 요청
