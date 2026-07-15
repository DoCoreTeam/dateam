# 04 · 완료 기준 (구현 GO 후 GATE 2 라인별 대조)

## A. 기능 완료 (FR ↔ 검증)
- [ ] FR1 다형 문서 투입(md·이미지·엑셀·ppt·html·pdf) — 각 스모크 GREEN
- [ ] FR2 항목 추출 유실0 — parseListItems+AI병합, 생략0 배지
- [ ] FR3 맥락 팩(원문앵커+의도주석 idx-only) — 앵커 span 테스트
- [ ] FR4 command 세션 영속 + resume 복원
- [ ] FR5 서버 워커풀 K개 병렬 + 항목 상태전이 DB 기록
- [ ] FR6 무손실 취합 — **커버리지 게이트 100%**(누락 시 부록 append), 패치 무왜곡
- [ ] FR7 실시간 — count(status) 파생(하드코딩0) + SSE + 폴링 폴백 + 열람 delta
- [ ] FR8 백그라운드 — **탭 닫아도 크론 드레인이 완주**(E2E #3 GREEN)
- [ ] FR9 임의 중단 — 취소(in-flight abort)·일시정지 즉시 반영, 완료분 보존
- [ ] FR10 재개 — 멱등 claim, 부분 완료 즉시 열람

## B. Feature Defaults (신규 엔티티=세션 → 자동 전개)
- [ ] **CRUD 전체**: 세션 Create/Read/Update(rename·command수정)/Delete(**소프트삭제**) + 각 연산 권한(owner)
- [ ] **List 화면** + **행 수준 RLS**(owner-only, default-deny) — 157 패턴
- [ ] **검색**(q, 서버 sanitization) · **정렬**(sort 화이트리스트) · **필터**(status/phase 화이트리스트)
- [ ] **성능 로딩** = 서버 페이지네이션(cursor/limit) + 메타
- [ ] 검색/정렬/필터/페이지 상태 **URL 동기화** + 로딩/빈/에러 3종 UI

## C. 품질 게이트
- [ ] `tsc --noEmit` exit 0
- [ ] `pnpm test` 신규 단위(context-anchor·synthesize-hierarchical·concurrency) 등록+PASS
- [ ] E2E 크리티컬(#3 백그라운드·#4 중단·#5 커버리지100%) GREEN
- [ ] `pnpm design:check` PASS · 폼/모달 표준 클래스(input-field·label) 눈대조
- [ ] 정적 가드: 30k slice 재유입 차단 · 상태값 하드코딩 부재
- [ ] 🟥 DC-QA/SEC/REV PASS(인젝션·크론 인증·SSOT 무왜곡)

## D. 산출물 / 배포
- [ ] 마이그 158 적용(--status ✅) · `vercel.json` crons 등록
- [ ] export 4종(md/txt/pdf/docx) 연결 · 완료 알림(activity 재사용)
- [ ] 사용자향 changelog 1블록(admin 전용이면 생략 판정) · 버전 범프 4파일

## E. 불변(위반 시 FAIL)
- [ ] 유실0/생략0 = **코드 게이트가 최종**(AI 신뢰 아님)
- [ ] 진행상태 파생만(하드코딩 금지)
- [ ] 이탈 지속 + 임의 중단 = 동작 실증(E2E)
