# 02 — Task Breakdown
T-1 마이그 115 app_releases+RLS+idx
T-2 lib/changelog/parse-commits.ts +types +test
T-3 gen-changelog-source.mjs + prebuild + source.json
T-4 GET /api/changelog (게시분)
T-5 admin API: list/create, [id] patch/delete, import
T-6 admin/changelog page+Client+actions (CRUD·검색·정렬·필터·페이지·게시·가져오기)
T-7 어드민 네비 메뉴
T-8 ChangelogModal (공개)
T-9 MobileShell 버전 버튼화→모달
T-10 정적검증, T-11 Playwright, T-12 DC평가, T-13 GATE+버전+커밋
순서 T-1→…→T-13. 위험: RLS 정책(기존 패턴 따름), 빌드 prebuild 순서(source.json 커밋해 dev 폴백).
