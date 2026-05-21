# FAST PATH Summary
작업: 콘텐츠 관리 테이블 섹션에 섹션별 AI 작성 버튼 추가 — 프롬프트 모달 → Gemini AI → diff 확인 → 저장
대상: ContentSections.tsx / actions.ts / lib/gemini-content-edit.ts / api/content/ai-edit/route.ts / ContentDiffModal.tsx (신규)
이유: 관리자가 자연어로 프로젝트·멤버·미션 등 섹션 데이터를 AI로 편집할 수 있도록
영향: admin/content 페이지만 영향, 기존 수동 저장 흐름 유지
