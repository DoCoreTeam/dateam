# FAST PATH Summary — 시스템 README 작성

작업: root `README.md`를 실제 newAX 시스템(기능 인벤토리 + 아키텍처 + 구조 + 실행법)을 정확히 담은 문서로 전면 교체
대상: `/README.md` (기존은 무관한 구 "dateam" HTML 대시보드 목록 — stale)
이유: 사용자 지적 — 시스템에 어떤 기능이 있고 어떤 형태인지 git 문서로 남아있지 않음. 신규 합류자/에이전트가 README만으로 전모 파악 불가
영향: 문서 1개(README.md). 코드/DB/동작 변경 없음. CLAUDE.md·AGENTS.md는 이미 상세하므로 README에서 링크만 연결

검증 근거(코드 실측):
- 버전 v0.7.282 (root package.json)
- 라우트 그룹: (auth)/(member)/admin/api + public(develop/api-access)
- (member) 20개 라우트, admin 18개, api 23개 (ls 실측)
- 마이그레이션 145개, 최신 140_gpu_product_term_prices.sql
- 테스트: node:test 러너, package.json 명시 파일 리스트(75+ 파일)
- 핵심 도메인: lib/gpu (100+ 파일), lib/gemini-* (7 모듈), lib/weekly-report, lib/datetime/kst
