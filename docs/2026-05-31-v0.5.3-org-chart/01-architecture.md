# 아키텍처 — 조직도

## DB 스키마

```sql
-- 회사 (단일 행)
CREATE TABLE org_company (
  id    INT PRIMARY KEY DEFAULT 1,
  name  TEXT NOT NULL DEFAULT '회사명',
  description TEXT,
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- 부서 (자기참조 트리)
CREATE TABLE org_departments (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  description   TEXT,
  parent_id     UUID REFERENCES org_departments(id) ON DELETE RESTRICT,
  display_order INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- 부서-사용자 연결
CREATE TABLE org_department_members (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id UUID NOT NULL REFERENCES org_departments(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE(department_id, user_id)
);
```

## 파일 구조

```
apps/web/app/
├── admin/
│   ├── org-chart/
│   │   ├── page.tsx          # 서버 컴포넌트 (데이터 fetch)
│   │   ├── actions.ts        # 서버 액션 (CRUD)
│   │   ├── OrgTree.tsx       # 클라이언트 트리 UI
│   │   ├── CompanyForm.tsx   # 회사명 수정 폼
│   │   └── DeptMemberPicker.tsx  # 사용자 할당 모달
│   └── layout.tsx            # nav 추가
├── (member)/
│   └── org/
│       └── page.tsx          # 읽기전용 조직도
└── api/
    └── org/
        └── members/route.ts  # 사용자 검색용 API
supabase/migrations/037_org_chart.sql
```

## 데이터 흐름
- 관리자: page.tsx(서버) → OrgTree(클라이언트) → actions.ts(서버액션) → DB
- 일반사용자: /org page(서버) → 정적 렌더
