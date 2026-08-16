import { redirect } from 'next/navigation'

/**
 * `/crm` 의 첫 화면.
 *
 * 예전엔 인박스로 보냈다. 그런데 인박스는 "AI 가 찾아낸 제안을 확인하는 곳"이라
 * **처음 온 사람에겐 구조적으로 비어 있다** — 회사도 미팅도 없으니 AI 가 넣어 줄 것이 없다.
 * 가장 나중에 의미가 생기는 화면을 첫 화면으로 뒀던 셈이다.
 *
 * 통상의 CRM 첫 화면은 "오늘 내가 뭘 해야 하나"다(HubSpot Sales Workspace).
 */
export default function CrmIndexPage() {
  redirect('/crm/today')
}
