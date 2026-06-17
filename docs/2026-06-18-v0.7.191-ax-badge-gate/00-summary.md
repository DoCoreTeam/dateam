# FAST PATH Summary — 홈 KPI/루틴/본부운영 배지 AX사업본부 전용 게이트

## 작업
홈 헤더의 KPI·루틴·본부운영 배지를 "AX사업본부 소속 person만" 노출하도록 게이트 엄격화 + 대표이사 완전 제외.

## 원인 (확인 결과)
`lib/org-scope.ts` `isInDivisionByName(admin, userId, 'AX사업본부', isAdmin)` 두 누수:
1. `if (isAdmin) return true` (line 160) — 홈이 `profile.role==='admin'`을 넘겨, **모든 admin(타 조직 포함)·대표이사(admin)** 무조건 노출.
2. `iManageDeptOrAbove` (line 172) — AX의 **상위 노드(전사/대표) head**도 노출 → 대표이사가 전사 head면 admin 아니어도 노출.

## 대상 파일
- `lib/org-scope.ts` — 엄격 멤버십 함수 `isMemberOfDivisionByName` 신설(서브트리 소속 person만, admin/관할 무관)
- `app/(member)/home/page.tsx` — 배지 게이트를 신설 함수 + `position !== '대표이사'` 제외로 교체. profiles select에 position 추가

## 이유
사용자 요구: 배지는 AX사업본부 소속에게만. 대표이사는 "완전 예외"라 AX 관할/admin이어도 숨김.

## 영향
- `isInDivisionByName`은 홈이 유일 사용처였음 → 신설 함수로 교체(기존 함수는 보존, 미사용 시 후속 정리 가능).
- 다른 조직/관할자/대표이사: 배지 미노출. AX사업본부 소속 일반 구성원·본부장: 노출 유지.
