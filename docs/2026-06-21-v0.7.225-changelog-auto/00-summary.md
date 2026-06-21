# v0.7.225 — 사용자향 업데이트 내역 자동 게시 (CI 무인)

## 작업 (1줄)
버전이 올라가면 **CI(GitHub Action)가 푸시 후 비동기로** git log를 읽어 → Gemini가 사용자 고시 필요 여부 판단 + 사용자향 문구 작성 → `apps/web/lib/changelog/entries.ts`에 자동 커밋백 → 배포=게시. (DB 없음 · 사람 개입 없음 · 로컬 작업 속도 0 영향)

## 왜 (배경)
- changelog 갱신이 **어떤 체크리스트/훅/CI에도 책임으로 정의돼 있지 않아**(설계 공백) v0.7.205 이후 19개 버전이 누락됨.
- "클로드코드가 매 커밋마다 인라인 생성"은 평소 개발을 느리게 함 → **CI에서 비동기 실행**으로 분리.
- 런타임 무인(app_releases DB)은 v0.7.207에 의도적으로 삭제됐던 구조 → 부활 대신 **정적 파일 유지 + CI 생성**으로 동일 목표 달성, DB 불필요.

## 수정/신규 파일
- (신규) `scripts/changelog-gen.mjs` — 버전 감지 → git log 수집 → Gemini 판단·작성 → entries.ts 프리펜드. SSOT 생성기.
- (신규) `.github/workflows/changelog-gen.yml` — push(main) 트리거, 비동기 실행, entries.ts 변경 시 `[skip changelog]` 커밋백(루프 가드).
- (수정) `package.json` — `changelog:gen` 스크립트 추가.
- (자동 갱신 대상) `apps/web/lib/changelog/entries.ts` — CI가 콘텐츠 추가(사람이 직접 안 만짐).

## 동작 흐름
```
개발자: 평소 작업 → 버전업 → 커밋 → 푸시      ← 여기서 끝(안 느려짐)
   └ push(main) ─▶ [GitHub Action: changelog-gen]
        1. root package.json version vs entries.ts 최신 version 비교(올랐으면 발동)
        2. git log: 마지막 게시 버전 초과 ~ 현재까지 커밋(`vX.Y.Z: … claude`) 수집·버전별 그룹
        3. Gemini: 사용자 체감 변경만 선별(내부/어드민/백엔드/리팩터/버전범프 제외) + 친절어 작성
        4. entries.ts 맨 위에 블록 프리펜드 → `[skip changelog]` 커밋백 → 배포=게시
```

## 판단 기준(Gemini 프롬프트에 강제 — entries.ts 헤더 규율과 동일)
- 포함 ✅ 새 사용자 기능 · 사용자가 겪던 버그 수정 · 눈에 보이는 개선(속도/UI/편의)
- 제외 ❌ 어드민 전용 · 백엔드/DB/인프라 · 리팩터/테스트/CI · 버전범프 · 내부검증문구
- 톤: 귀엽고 친절한 비즈니스 언어("~했어요/~돼요"), 개발 용어 금지.

## 완료 조건
- [ ] `scripts/changelog-gen.mjs`: 버전 비교·git 파싱·Gemini 호출·프리펜드·idempotent(변경 없으면 파일 무수정)
- [ ] `--dry-run` 지원(미리보기), 로컬 `.env.local` 자동 로드
- [ ] CI 워크플로우: push(main) 트리거 + `[skip changelog]` 루프 가드 + `contents: write` 권한 + 커밋백
- [ ] 첫 실행 시 v0.7.206~현재 백필(누락 19버전 채움)
- [ ] 🟥 DC-REV 통과

## 사용자 수동 1회 (외부 인증 — 자동화 불가)
- **새 시크릿 등록 불필요.** 키 소스는 앱과 동일하게 DB `org_content`(META).gemini_api_key 를 서비스롤로 조회 → CI는 gcube-price-check가 이미 쓰는 **기존 Secrets `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` 재사용**.
- (폴백, 선택) DB 경로 대신 직접 키를 쓰려면 `GEMINI_API_KEY` 시크릿 등록(없어도 됨).
- (확인) main 브랜치 보호 규칙(서명 커밋 강제 등)이 있으면 changelog-bot 푸시가 막힐 수 있으니 Actions 푸시 허용 확인. ※ GITHUB_TOKEN 푸시는 다른 워크플로우를 재트리거하지 않음(루프·중복빌드 없음).

## 제외 범위
DB 적재 / 런타임 조회 / 다국어(en·ja) changelog / 어드민 노출.
