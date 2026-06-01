# 조직도 재설계 요구사항

## 핵심 요구사항
1. org_nodes 통합 테이블 — company/role/department/person 4타입
2. 기존 데이터 자동 마이그레이션 (org_company + org_departments + org_department_members)
3. role 노드 = C레벨 슬롯 (1명만), 부서장(head_user_id) 설정
4. 사람 표시: 직책(position) > 직급(rank) 우선
5. DnD A+C: 드롭존 하이라이트 + 형제 삽입선
6. 공개 /org 페이지: 읽기전용 동일 트리
7. Playwright 브라우저 테스트 필수

## 노드 타입 정의
| type | 설명 |
|------|------|
| company | 법인/조직 (최상위 또는 모회사) |
| role | C레벨 슬롯 (대표이사, CTO 등), 1명 |
| department | 일반 부서/팀, 부서장 설정 가능 |
| person | 구성원 (profiles 연동) |
