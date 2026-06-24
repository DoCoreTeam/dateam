// 조직원 피커 공용 타입 SSOT — 서버액션(getOrgTreeForPicker)과 컴포넌트(OrgPeoplePicker)가 함께 사용.
//   한 곳에서만 정의해 필드 추가 시 silent type drift 방지.

export interface OrgPickerNode {
  id: string
  type: 'company' | 'role' | 'department' | 'person'
  parent_id: string | null
  name: string
  user_id: string | null // person 노드의 구성원
  head_user_id: string | null // 부서/역할의 장(부서장·본부장·대표이사·CTO 등) — 트리에서도 선택 가능해야 함
  display_order: number | null
}

export interface PickerPerson {
  id: string // = profiles.id (= person.user_id)
  name: string
}
