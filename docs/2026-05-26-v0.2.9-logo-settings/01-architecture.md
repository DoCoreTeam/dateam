# 01. 아키텍처 설계 — 시스템 로고·브랜드명 관리

## 데이터 모델

### DB 테이블: `system_settings` (신규)
```sql
CREATE TABLE system_settings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,        -- 설정 키 (e.g. 'logo_url', 'brand_name')
  value       text,                         -- 설정 값
  updated_at  timestamptz DEFAULT now(),
  updated_by  uuid REFERENCES auth.users(id)
);

-- 기본 데이터 seed
INSERT INTO system_settings (key, value) VALUES
  ('brand_name', 'AX사업본부'),
  ('logo_url', null);

-- RLS
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;
-- 읽기: 로그인한 사용자 전체
CREATE POLICY "읽기_로그인" ON system_settings FOR SELECT TO authenticated USING (true);
-- 쓰기: admin 역할만
CREATE POLICY "쓰기_admin" ON system_settings FOR ALL TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin' AND deleted_at IS NULL)
  );
```

### Supabase Storage
- 버킷명: `branding` (public)
- 경로: `logo/{파일명}` (예: `logo/logo-1748234567890.png`)
- 정책: public read, authenticated write (admin 서버에서만 업로드)

---

## API 설계

### GET /api/settings/branding
- 인증 불필요 (public — 모든 페이지에서 로고 표시용)
- 응답: `{ logoUrl: string | null, brandName: string }`
- 캐싱: `next: { revalidate: 60 }` (1분 캐시, 변경 후 최대 1분 내 반영)

### POST /api/admin/settings/branding
- 인증 필수 (admin 전용, 서버에서 role 검증)
- Body (multipart/form-data):
  ```
  brandName?: string
  logoFile?: File
  deleteLogo?: boolean
  ```
- 처리 흐름:
  1. role 검증 (admin 아니면 403)
  2. logoFile 있으면 Supabase Storage 업로드 → public URL 획득
  3. 구 로고 URL DB에서 읽어 Storage에서 삭제
  4. `system_settings` upsert (`logo_url`, `brand_name`)
  5. `revalidatePath('/')` — Next.js 캐시 무효화
  6. 응답: `{ success: true, logoUrl, brandName }`

---

## 컴포넌트 변경 목록

| 파일 | 변경 내용 |
|------|---------|
| `supabase/migrations/008_system_settings.sql` | 신규 — 테이블·RLS·seed |
| `apps/web/app/api/settings/branding/route.ts` | 신규 — public GET |
| `apps/web/app/api/admin/settings/branding/route.ts` | 신규 — admin POST |
| `apps/web/app/admin/settings/BrandingSettings.tsx` | 신규 — 로고 업로드 UI 컴포넌트 |
| `apps/web/app/admin/settings/page.tsx` | 수정 — BrandingSettings 섹션 추가 |
| `apps/web/app/admin/layout.tsx` | 수정 — 사이드바에 "시스템 설정" 그룹 추가 (기존 "API 설정" 재분류) |
| `apps/web/components/ui/Sidebar.tsx` | 수정 — 로고 이미지 or 브랜드명 텍스트 동적 표시 |
| `apps/web/components/ui/NavigationLoader.tsx` | 수정 — orgName prop 제거, 내부에서 branding fetch |
| `apps/web/app/(member)/layout.tsx` | 수정 — NavigationLoader에 orgName 하드코딩 제거 |
| `apps/web/app/login/page.tsx` | 수정 — 로고 or 브랜드명 표시 추가 |

---

## 데이터 흐름

```
[Admin 설정 페이지]
  │  파일 선택 + 브랜드명 입력
  ▼
POST /api/admin/settings/branding
  │  1. admin role 검증
  │  2. Storage 업로드 (logo/{timestamp}.ext)
  │  3. 구 파일 Storage 삭제
  │  4. system_settings upsert
  │  5. revalidatePath('/')
  ▼
[모든 서버 컴포넌트]
  GET /api/settings/branding (next: revalidate 60)
  └─ Sidebar 상단: <img src=logoUrl> or <span>brandName</span>
  └─ NavigationLoader: brandName 웨이브 텍스트 or 로고 이미지
  └─ Login 페이지: 로고 or 브랜드명
```

---

## 폴백 로직 (공통)
```
logoUrl 있음 → <img src={logoUrl} alt={brandName} />
logoUrl 없음 → <span>{brandName}</span>
fetch 실패   → 하드코딩 기본값 "AX사업본부" (에러 바운더리)
```
