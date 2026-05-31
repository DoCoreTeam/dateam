# 아키텍처

## DB
- 신규 테이블: `partner_tiers` (id, name, discount_rate, created_at, updated_at)
- RLS: 팀원 SELECT, admin만 INSERT/UPDATE/DELETE
- Migration: 036_partner_tiers.sql

## 파일 구조
```
apps/web/app/admin/partner-tiers/
  page.tsx          — 서버 컴포넌트 (목록 + 폼 렌더)
  actions.ts        — 서버 액션 (create/update/delete)
  TierForm.tsx      — 클라이언트 폼 (인라인 생성/수정)
  DeleteTierButton.tsx — 클라이언트 삭제 버튼
```

## 네비게이션
- `admin/layout.tsx` ADMIN_NAV_ITEMS에 파트너 등급 메뉴 추가
