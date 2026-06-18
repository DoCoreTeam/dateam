# 01 — Architecture
## 3층
[어드민] admin/changelog (requireAdmin) → CRUD/가져오기
   ↓
[DB] app_releases (115 마이그레이션) + RLS  ← SSOT
   ↓ GET /api/changelog (게시분, 멤버)
[공개] MobileShell 버전 button → ChangelogModal
## git 하이브리드 (Vercel 런타임 git 불가 대응)
- prebuild: scripts/gen-changelog-source.mjs 가 `git log` 파싱 → apps/web/public/changelog-source.json (커밋·빌드마다 갱신)
- 어드민 "가져오기": 클라이언트가 /changelog-source.json fetch → POST /api/admin/changelog/import → 미등록 버전 draft(is_published=false) upsert
- 파싱 SSOT: lib/changelog/parse-commits.ts (순수, 빌드스크립트+테스트 공유)
## DB 스키마 app_releases
id uuid pk · version text unique · released_at date · title text · changes jsonb([{text,type}]) · type text(feature|fix|improve) · is_published bool def false · sort_order int · created_at/updated_at
## RLS
enable; admin(all) using profiles.role='admin'; member select where is_published=true. default-deny.
## SSOT/표준
파싱/표시 lib 단일구현. 토큰·모달표준·input-field/label·반응형·a11y·design:check.
