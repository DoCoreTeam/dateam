# 04 완료 기준

## ④ 통합 검색
- [ ] /api/work/search: 일일(personal,본인)·부서(org-scope)·주간(htmlToPlain) 키워드 검색, type 레이블, 커서 페이지네이션, 빈 q 가드
- [ ] daily_logs.content trgm GIN 인덱스 적용(실DB)
- [ ] FE 검색창(글로벌) + 결과 페이지(type 그룹·로딩/빈/에러·URL q 동기화·결과 클릭 이동)
- [ ] 권한: 타인 개인 일일 미노출, 조직 부서업무만 가시
## ② 부서 릴레이션
- [ ] 일일 행 "부서업무 연결됨" 영속 뱃지(promoted_from 역링크) + 클릭 이동
- [ ] 부서업무 상세/목록: 원본 일일 인용 + 작성자·담당자 표시
## ③ AI 프로젝트 그룹핑
- [ ] 프로젝트 모델 결정 문서(.ralph/decisions) + 병렬기획 정합
- [ ] project 엔티티/링크 + RLS(실DB)
- [ ] /work/overview project 축 + autolink 프로젝트 매칭
## 공통
- [ ] tsc 0 · design:check 통과 · DC-QA/SEC/REV 통과 · GATE 1-5
- [ ] main 증분 커밋(push 없음), 버전 정합
- [ ] Feature Defaults(신규 project 엔티티): CRUD/List/검색·정렬·필터/페이지네이션/URL상태/RLS
