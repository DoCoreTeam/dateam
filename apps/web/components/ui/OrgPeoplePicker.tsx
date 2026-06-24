'use client'

// 공용 조직원 선택 모달 — 검색(전체 구성원) + 조직도 트리(배치 인원) 다중선택.
//  - 드롭다운 대체. 부모가 people(전체 profiles)·tree(org_nodes)·이미 추가된 id를 넘기면
//    체크박스로 여러 명 고른 뒤 "N명 추가"로 일괄 반영.
//  - 재사용 가능(회의노트 참석자 외 다른 화면도 동일 시그니처로 연결).
import { useMemo, useState } from 'react'
import { X, Search, Users, ChevronRight, Check } from 'lucide-react'
import NbButton from '@/components/ui/nb/NbButton'
import { useEscClose } from '@/lib/use-esc-close'
import type { OrgPickerNode, PickerPerson } from '@/lib/org/picker-types'

export type { OrgPickerNode, PickerPerson } from '@/lib/org/picker-types'

interface Props {
  people: PickerPerson[] // 전체 구성원(검색 소스)
  tree: OrgPickerNode[] // 조직도 계층
  existingIds: string[] // 이미 추가된 사람 — 비활성+체크
  onConfirm: (added: PickerPerson[]) => void
  onClose: () => void
}

export default function OrgPeoplePicker({ people, tree, existingIds, onConfirm, onClose }: Props) {
  useEscClose(onClose)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const existing = useMemo(() => new Set(existingIds), [existingIds])
  const nameById = useMemo(() => new Map(people.map((p) => [p.id, p.name])), [people])

  // 트리 person 리프 표시명(profiles 우선, 없으면 노드명)
  const personLabel = (node: OrgPickerNode) =>
    (node.user_id && nameById.get(node.user_id)) || node.name || '이름 없음'

  // parent_id → children (입력은 display_order·name 정렬됨)
  const childrenByParent = useMemo(() => {
    const m = new Map<string | null, OrgPickerNode[]>()
    for (const n of tree) {
      const k = n.parent_id
      m.set(k, [...(m.get(k) ?? []), n])
    }
    return m
  }, [tree])

  // 검색 결과(전체 구성원, 미배치 포함)
  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return people.filter((p) => p.name.toLowerCase().includes(q))
  }, [query, people])

  function toggle(id: string | null) {
    if (!id || existing.has(id)) return
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function confirm() {
    const added: PickerPerson[] = []
    for (const id of Array.from(picked)) {
      if (existing.has(id)) continue
      added.push({ id, name: nameById.get(id) ?? id })
    }
    if (added.length > 0) onConfirm(added)
    onClose()
  }

  const rowState = (id: string | null): 'disabled' | 'on' | 'off' => {
    if (!id) return 'disabled'
    if (existing.has(id)) return 'disabled'
    return picked.has(id) ? 'on' : 'off'
  }

  function PersonRow({ id, label, hint, depth = 0 }: { id: string | null; label: string; hint?: string; depth?: number }) {
    const state = rowState(id)
    return (
      <button
        type="button"
        className={`oap-person oap-person--${state}`}
        style={{ paddingLeft: `calc(var(--space-3) + ${depth} * var(--space-4))` }}
        disabled={state === 'disabled'}
        aria-pressed={state === 'on'}
        onClick={() => toggle(id)}
      >
        <span className={`oap-check oap-check--${state}`}>{(state === 'on' || state === 'disabled') && <Check size={12} />}</span>
        <span className="oap-person-name">{label}</span>
        {hint && <span className="oap-person-hint" title="부서·역할의 장">{hint}</span>}
        {state === 'disabled' && id && <span className="oap-person-added">추가됨</span>}
      </button>
    )
  }

  // 트리 재귀 렌더. seen=이미 트리에 표시한 user_id(장이 구성원으로도 있으면 한 번만).
  //   가지치기는 정적 검사 대신 '자식 실제 렌더 결과가 비었는지'로 판단 → dedup과 항상 일관.
  function renderNode(node: OrgPickerNode, depth: number, seen: Set<string>): React.ReactNode {
    if (node.type === 'person') {
      if (!node.user_id || seen.has(node.user_id)) return null // 공석/중복 — 선택 불가
      seen.add(node.user_id)
      return <PersonRow key={node.id} id={node.user_id} label={personLabel(node)} depth={depth} />
    }
    const headId = node.head_user_id
    const showHead = !!headId && nameById.has(headId) && !seen.has(headId)
    if (showHead) seen.add(headId) // 장을 먼저 점유 → 구성원 중복 방지
    const childEls = (childrenByParent.get(node.id) ?? [])
      .map((k) => renderNode(k, depth + 1, seen))
      .filter(Boolean)
    if (!showHead && childEls.length === 0) return null // 실제로 표시할 사람이 없는 브랜치 생략
    return (
      <div key={node.id} className="oap-branch">
        <div className="oap-branch-head" style={{ paddingLeft: `calc(var(--space-2) + ${depth} * var(--space-4))` }}>
          <ChevronRight size={13} className="oap-branch-icon" /> {node.name}
        </div>
        {showHead && (
          <PersonRow key={`head-${node.id}`} id={headId} label={nameById.get(headId as string) as string} hint="장" depth={depth + 1} />
        )}
        {childEls}
      </div>
    )
  }

  const roots = childrenByParent.get(null) ?? []
  const seen = new Set<string>()

  return (
    <div
      className="oap-backdrop"
      style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'var(--modal-backdrop)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'var(--space-4)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="oap-card"
        style={{ width: '100%', maxWidth: 520, maxHeight: '85vh', display: 'flex', flexDirection: 'column', background: 'var(--color-surface)', borderRadius: 'var(--radius-lg)', boxShadow: 'var(--shadow-modal)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="oap-head">
          <strong className="tape-title" style={{ margin: 0, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Users size={16} color="var(--brand)" /> 조직원 선택
          </strong>
          <button type="button" onClick={onClose} className="oap-close" aria-label="닫기"><X size={18} /></button>
        </div>

        <div className="oap-search">
          <Search size={15} />
          <input className="input-field" placeholder="이름으로 검색 (전체 구성원)" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
        </div>

        <div className="oap-body">
          {query.trim() ? (
            searchResults.length === 0 ? (
              <p className="oap-empty">검색 결과가 없습니다.</p>
            ) : (
              <div className="oap-list">
                {searchResults.map((p) => <PersonRow key={p.id} id={p.id} label={p.name} />)}
              </div>
            )
          ) : roots.length === 0 ? (
            <p className="oap-empty">조직도가 비어 있습니다. 검색으로 선택하세요.</p>
          ) : (
            <div className="oap-tree">{roots.map((n) => renderNode(n, 0, seen))}</div>
          )}
        </div>

        <div className="oap-foot">
          <span className="oap-foot-count">{picked.size > 0 ? `${picked.size}명 선택` : '선택 안 됨'}</span>
          <div className="oap-foot-actions">
            <NbButton variant="ghost" onClick={onClose}>취소</NbButton>
            <NbButton onClick={confirm} disabled={picked.size === 0} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
              <Check size={15} /> {picked.size > 0 ? `${picked.size}명 추가` : '추가'}
            </NbButton>
          </div>
        </div>
      </div>
    </div>
  )
}
