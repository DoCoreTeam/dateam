import { redirect } from 'next/navigation'

// /crm 은 그 자체로 보여 줄 것이 없다 — 일상 동선의 첫 화면인 인박스로 보낸다.
export default function CrmIndexPage() {
  redirect('/crm/inbox')
}
