# FAST PATH Summary
작업: Gemini API로 모델 목록 동적 조회 + 관리자 설정 페이지에 모델 선택 드롭다운 추가
대상: apps/web/app/admin/settings/actions.ts, GeminiSettings.tsx, page.tsx
이유: 하드코딩된 모델명 없이 실제 API에서 사용 가능 모델 목록을 받아와 선택 가능하게 함
영향: META JSON에 gemini_model 필드 추가 저장 (기존 gemini_api_key와 동일 패턴)
