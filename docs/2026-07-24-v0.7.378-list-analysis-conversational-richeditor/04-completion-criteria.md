# 04 — 완료 기준 (전 항목 ✅ 필요)

## ⑥ 리치 에디터 입력
- [ ] '자료 붙여넣기'가 Tiptap 리치 에디터(표 지원)로 교체됨
- [ ] Word/Excel/웹 표 붙여넣기 시 셀 구분이 보존됨(실브라우저 확인)
- [ ] 저장: 원본 HTML(source_html) + 마크다운 정규화본(source_text) 둘 다 영속(마이그175)
- [ ] 기존 html-to-plain.ts 무변경(주간보고·회의노트 회귀 0)

## ⑥ 그룹핑 표 인식
- [ ] cut-groups가 파이프 표를 하나의 의미블록으로 원자화(표 중간 절단 0) + 테스트
- [ ] 재그룹(regroup)도 표 인식 일관

## ⑦ 출력·렌더 구조 보존
- [ ] RichText가 표 태그 렌더(화이트리스트) + XSS 속성 제거 유지
- [ ] md/txt/docx/pdf 다운로드에 표/서식 보존(실다운로드 확인)
- [ ] 재열람·문서상세에 표 렌더

## ④ 대화형 지시 흐름
- [ ] 그룹핑 후 항목(의미블록)별 채팅형 지시·응답(다회차) 가능
- [ ] 대화 이력 영속(ai_analysis_item_messages, 마이그176) + 재열람 시 로드(AI 재호출 0)
- [ ] 항목 확정 → result_text 스냅샷 → 종합 단일 문서에 반영
- [ ] analyzeItem.customInstruction 죽은 경로 배선(또는 신규 경로로 대체) + 일괄 심화 폴백 존치

## 공통
- [ ] tsc 0 · 전체 node:test green(신규 테스트 test 목록 등록) · design:check · next build
- [ ] 유실0 회귀 fixture green
- [ ] RLS owner-only(item_messages) · 소프트삭제/cascade 정합
- [ ] 버전 4파일 동기화 · changelog 어드민전용 사유 명시 후 생략
- [ ] 실브라우저(Playwright) throwaway 데이터로 end-to-end 검증(운영 오염 0)
