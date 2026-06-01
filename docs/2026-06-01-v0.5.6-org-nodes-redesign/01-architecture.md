# 아키텍처

## DB 스키마
```sql
org_nodes (
  id UUID PK,
  type TEXT CHECK IN ('company','role','department','person'),
  parent_id UUID FK → org_nodes(id),
  name TEXT,
  subtitle TEXT,  -- 부서설명 / 직함
  display_order INT DEFAULT 999,
  head_user_id UUID FK → profiles(id),  -- department/role용 부서장
  user_id UUID FK → profiles(id),       -- person 타입만
  color TEXT,
  created_at TIMESTAMPTZ
)
```

## 마이그레이션 경로
org_company(id=1) → org_nodes(type='company')
org_departments → org_nodes(type='department'), parent_id 재매핑
org_department_members → org_nodes(type='person'), parent_id=부서노드

## 컴포넌트 구조
OrgTree (DndContext)
  └─ renderNode(node) → NodeCard
      ├─ CompanyCard
      ├─ RoleCard
      ├─ DeptCard
      └─ PersonCard
