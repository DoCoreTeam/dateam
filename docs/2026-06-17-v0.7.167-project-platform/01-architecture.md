# v0.7.167 — 프로젝트 고도화 + AI 예상프로젝트 + 메뉴 + 성능보완

근거: 사용자 Q&A(풀필드·제안확정·업무탭메뉴·둘다풀). 기존 projects(v0.7.161 name만)·work_entity_links kind=project·autolink 보존, additive.

## ① projects 엔티티 고도화 (mig111, additive ALTER)
projects 컬럼 추가(전부 nullable, 기존 행 무영향):
- year int, quarter int(1-4) null, half text('H1'|'H2') null, month int(1-12) null
- start_date date null, end_date date null
- budget numeric null, currency text default 'KRW'
- status text default 'active' check(active|planning|done|hold)
기존: id, name, user_id, embedding, created_at, updated_at, deleted_at 유지.
신규 project_members(project_id FK projects, user_id, role text null, created_at) + UNIQUE(project_id,user_id). RLS: 프로젝트 소유자 또는 본인이 멤버면 select; 쓰기는 프로젝트 소유자. default-deny.
projects RLS는 소유자(기존) 유지 — 멤버 가시는 후속(이번엔 소유자 기준 유지, 멤버는 표시·투입정보용).

## ② AI 예상 프로젝트 제안→확정
- 신규 GET /api/work/projects/suggest: 본인 daily_logs(personal) 임베딩/autolink 후보를 클러스터/그룹핑해 "예상 프로젝트 후보"(name 후보 + 근거 + 묶일 업무 수) 반환. **자동생성 금지** — 후보 리스트만.
- 확정: 후보 선택 → 기존 POST /api/projects(name + 선택 필드) 생성 + 묶일 업무를 work_entity_links kind=project로 연결(선택). §5-3 추출형(후보 체크리스트→확정) 패턴.
- 콜드스타트: 업무 없으면 빈 후보.

## ③ 메뉴 — 업무 탭에 '프로젝트'
- WorkTabBar에 5번째 탭 '프로젝트'(/work/projects) 추가. projects/page.tsx를 WorkPageShell로 전환(4화면과 동일 골격). 현황>프로젝트별 "프로젝트 관리" 링크는 유지(중복 진입 OK).

## ④ 성능보완 (풀)
- loading.tsx: (member) 주요 라우트(daily/dept-tasks/weekly-report/work/overview/work/projects/calendar/accounts/deals/contacts/pricing) 스켈레톤 추가 → 서버 await 동안 즉시 폴백.
- 미들웨어 role 캐시: middleware.ts profiles.role 매요청 조회 → JWT app_metadata claim 또는 단기 쿠키 캐시로 DB왕복 제거(가역, 실패시 기존 폴백).
- 서버쿼리 병렬화: weekly-report 6단계·dept-tasks 3단계 waterfall 중 독립 쿼리 Promise.all.
- layout 배지 캐시: getBranding/getRoutineWeeklyStatus 등 layout DB호출 캐시(unstable_cache 또는 React cache()), profiles 중복조회 제거.

## 재사용/안전
임베딩·match RPC·autolink·org-scope·WorkPageShell/WorkSubTabs·PageHeader·§5-3 패턴. 전부 additive·가역. 공개 직전이라 미들웨어 변경은 실패시 기존 동작 폴백 보장.
