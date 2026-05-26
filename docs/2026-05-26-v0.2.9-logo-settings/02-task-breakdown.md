# 02. 태스크 분해 — 시스템 로고·브랜드명 관리

## Sprint 순서 (의존성 기준)

---

### Phase 1 — DB·Storage (선행 필수)

**Task 1-1. Supabase 마이그레이션**
- 파일: `supabase/migrations/008_system_settings.sql`
- 내용: `system_settings` 테이블, RLS 2개, seed 2행
- 완료 조건: `supabase db push` 성공, Supabase 대시보드에서 테이블 확인

**Task 1-2. Supabase Storage 버킷 설정**
- Supabase 대시보드에서 `branding` 버킷 생성 (Public)
- Storage 정책: public read, authenticated write
- 완료 조건: 브라우저에서 public URL로 파일 접근 가능

---

### Phase 2 — API 레이어

**Task 2-1. Public branding GET API**
- 파일: `apps/web/app/api/settings/branding/route.ts`
- 로직: `system_settings`에서 `logo_url`, `brand_name` SELECT → JSON 반환
- 캐시: `next: { revalidate: 60 }`
- 완료 조건: curl로 GET 시 `{ logoUrl, brandName }` 반환

**Task 2-2. Admin branding POST API**
- 파일: `apps/web/app/api/admin/settings/branding/route.ts`
- 로직: role 검증 → Storage 업로드 → 구 파일 삭제 → upsert → revalidatePath
- 완료 조건: admin 계정으로 POST 시 DB 갱신 확인, 비admin 403 반환

---

### Phase 3 — 어드민 UI

**Task 3-1. BrandingSettings 컴포넌트**
- 파일: `apps/web/app/admin/settings/BrandingSettings.tsx`
- UI 구성:
  ```
  [로고 미리보기 영역]
    현재 로고 이미지 or "로고" 플레이스홀더
    [로고 삭제] 버튼 (로고 있을 때만)
  [파일 업로드]
    드래그앤드롭 or 파일 선택 버튼
    허용 형식/크기 안내 텍스트
  [브랜드명 입력]
    텍스트 입력 (최대 30자)
  [저장] 버튼
  ```
- 완료 조건: 파일 선택 후 미리보기 표시, 저장 시 API 호출 성공 토스트

**Task 3-2. settings/page.tsx 수정**
- 기존 GeminiSettings 위에 BrandingSettings 섹션 추가
- 섹션 제목: "브랜딩 설정"
- 완료 조건: `/admin/settings` 접근 시 브랜딩 섹션 렌더링

**Task 3-3. admin layout 사이드바 메뉴 재구성**
- 파일: `apps/web/app/admin/layout.tsx`
- 변경: 기존 "API 설정" → "시스템 설정"으로 라벨 변경 (href `/admin/settings` 유지)
- 아이콘: `Settings2` → `Sliders` (또는 동일 유지)
- 완료 조건: 사이드바에서 "시스템 설정" 클릭 시 설정 페이지 이동

---

### Phase 4 — 로고 반영 (표시 위치별)

**Task 4-1. Sidebar 상단 동적화**
- 파일: `apps/web/components/ui/Sidebar.tsx`
- 변경: `SidebarProps`에 `logoUrl?: string`, `brandName: string` 추가
  ```tsx
  {logoUrl
    ? <img src={logoUrl} alt={brandName} style={{ maxHeight: '32px', objectFit: 'contain' }} />
    : <span>{brandName}</span>
  }
  ```
- admin layout, member layout 에서 branding fetch 후 Sidebar에 prop 전달
- 완료 조건: 로고 설정 후 사이드바 상단에 이미지 표시

**Task 4-2. NavigationLoader 동적화**
- 파일: `apps/web/components/ui/NavigationLoader.tsx`
- 변경:
  - `orgName` prop 제거
  - `logoUrl`, `brandName` prop 수신
  - 로고 있으면 이미지 + 프로그레스바 / 없으면 기존 웨이브 텍스트 + 프로그레스바
- member layout에서 branding fetch 후 prop 전달
- 완료 조건: 로고 설정 후 페이지 이동 시 로딩 화면에 로고 표시

**Task 4-3. 로그인 화면 로고 추가**
- 파일: `apps/web/app/login/page.tsx` (또는 login layout)
- 변경: 상단에 로고 이미지 or 브랜드명 텍스트 추가
- branding API fetch (로그인 화면은 비인증이므로 public API 사용)
- 완료 조건: 로그인 화면 상단에 로고 or 브랜드명 표시

---

## 의존성 다이어그램

```
Task 1-1 (DB)
Task 1-2 (Storage)
    ↓
Task 2-1 (GET API)
Task 2-2 (POST API)
    ↓
Task 3-1 (Admin UI)  ←  Task 2-2
Task 3-2 (설정 페이지) ← Task 3-1
Task 3-3 (사이드바 메뉴)
    ↓
Task 4-1 (Sidebar) ← Task 2-1
Task 4-2 (Loading) ← Task 2-1
Task 4-3 (Login)   ← Task 2-1
```

---

## 예상 작업량

| Phase | 예상 시간 |
|-------|---------|
| Phase 1 (DB·Storage) | 30분 |
| Phase 2 (API) | 1시간 |
| Phase 3 (Admin UI) | 1.5시간 |
| Phase 4 (반영) | 1시간 |
| **합계** | **~4시간** |
