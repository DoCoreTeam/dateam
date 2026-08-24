'use client'

// Vercel 로그 연동 — 배포·서버 로그를 **우리 화면에서** 읽기 위한 자리
//
// 왜 필요해졌나: 시스템 로그 화면에 「Vercel 로그 열기」 외부 링크만 있었다. 눌러 나가는 순간
// 우리 화면에서 보던 맥락(무엇이 언제부터 몇 번 실패했나)이 끊기고, 관리자는 두 화면을 손으로 맞춰 봐야 했다.
//
// 이 카드는 다른 연동 카드와 **같은 부품·같은 용어**를 쓴다(§2-5).
// 새로 만든 것은 아무것도 없다 — IntegrationCard / IntegrationStatus / IntegrationTest 그대로다.

import { useState, useTransition } from 'react'
import { Triangle } from 'lucide-react'
import { saveVercelKey, deleteVercelKey, checkVercelHealth } from './actions'
import { IntegrationCard, IntegrationStatus, IntegrationTest, LABEL } from './integration-ui'

interface Props {
  hasToken: boolean
  maskedToken: string | null
  projectId: string | null
  teamId: string | null
}

export default function VercelSettings({
  hasToken: initialHasToken, maskedToken: initialMasked, projectId: initialProject, teamId: initialTeam,
}: Props) {
  const [hasToken, setHasToken] = useState(initialHasToken)
  const [maskedToken, setMaskedToken] = useState(initialMasked)
  const [projectId, setProjectId] = useState(initialProject)
  const [teamId, setTeamId] = useState(initialTeam)
  const [showInput, setShowInput] = useState(!initialHasToken)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [savePending, startSave] = useTransition()
  const [deletePending, startDelete] = useTransition()
  const [healthPending, startHealth] = useTransition()
  const [healthMsg, setHealthMsg] = useState<{ ok: boolean; text: string } | null>(null)

  function handleSave(formData: FormData) {
    setMsg(null)
    // 값을 바꿨는데 지난 테스트 결과가 남아 있으면 그 문장이 **지금 상태인 척**한다
    setHealthMsg(null)
    startSave(async () => {
      const result = await saveVercelKey(formData)
      if (!result.ok) { setMsg({ ok: false, text: result.error ?? '저장 실패' }); return }
      const t = (formData.get('token') as string).trim()
      setMsg({ ok: true, text: '저장했습니다. 시스템 로그 화면의 「서버 로그」·「배포」 탭에서 바로 보입니다' })
      setHasToken(true)
      setShowInput(false)
      setMaskedToken(`${t.slice(0, 5)}••••••••${t.slice(-4)}`)
      setProjectId(((formData.get('projectId') as string) ?? '').trim() || null)
      setTeamId(((formData.get('teamId') as string) ?? '').trim() || null)
    })
  }

  function handleDelete() {
    setMsg(null)
    setHealthMsg(null)
    startDelete(async () => {
      const result = await deleteVercelKey()
      if (!result.ok) { setMsg({ ok: false, text: result.error ?? '연결 해제 실패' }); return }
      // 무엇이 멈추는지 밝힌다 — 영향을 안 말하면 시스템 로그 전체가 멈추는 줄 안다
      setMsg({ ok: true, text: '연결을 해제했습니다. 우리 기록은 그대로 쌓이지만 배포·서버 로그는 안 보입니다' })
      setHasToken(false)
      setMaskedToken(null)
      setProjectId(null)
      setTeamId(null)
      setShowInput(true)
    })
  }

  function handleHealth() {
    setHealthMsg(null)
    startHealth(async () => {
      const r = await checkVercelHealth()
      setHealthMsg({ ok: r.ok, text: r.message })
    })
  }

  return (
    <IntegrationCard
      icon={<Triangle size={18} />}
      title="Vercel 로그"
      desc="배포 상태와 서버 오류 로그를 시스템 로그 화면에서 바로 봅니다. 연결하지 않으면 Vercel 사이트로 나가야 확인할 수 있습니다."
    >
      {!showInput && (
        <>
          <IntegrationStatus
            value={hasToken ? maskedToken : null}
            emptyHint="배포·서버 로그를 우리 화면에서 볼 수 없습니다"
            onChange={() => setShowInput(true)}
            onDisconnect={handleDelete}
            disconnectPending={deletePending}
          />
          {projectId && (
            <p className="integration-test-desc" style={{ marginTop: 'var(--space-2)' }}>
              프로젝트 {projectId}{teamId ? ` · 팀 ${teamId}` : ' · 개인 프로젝트'}
            </p>
          )}
        </>
      )}

      {showInput && (
        <form action={handleSave} style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div>
            <label className="label" htmlFor="vercel-token">액세스 토큰</label>
            <input className="input-field" id="vercel-token" name="token" type="password"
              placeholder="vercel_..." autoComplete="off" disabled={savePending} />
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label className="label" htmlFor="vercel-project">프로젝트 ID 또는 이름</label>
              <input className="input-field" id="vercel-project" name="projectId" type="text"
                placeholder="prj_... 또는 web" defaultValue={projectId ?? ''}
                autoComplete="off" disabled={savePending} />
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <label className="label" htmlFor="vercel-team">팀 ID (개인 프로젝트면 비움)</label>
              <input className="input-field" id="vercel-team" name="teamId" type="text"
                placeholder="team_..." defaultValue={teamId ?? ''}
                autoComplete="off" disabled={savePending} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'flex-end' }}>
            <button type="submit" className="btn-primary" disabled={savePending}>
              {savePending ? LABEL.saving : LABEL.save}
            </button>
            {hasToken && (
              <button type="button" className="btn-ghost" onClick={() => setShowInput(false)}>취소</button>
            )}
          </div>
          <p className="integration-test-desc">
            Vercel → Account Settings → Tokens 에서 발급합니다. 읽기 전용 범위면 충분합니다.
            프로젝트 ID 는 Vercel 프로젝트 → Settings → General 에 있습니다.
          </p>
        </form>
      )}

      {msg && (
        <p className={`ci-status ${msg.ok ? 'ci-status-ok' : 'ci-status-danger'}`}
          style={{ marginTop: 'var(--space-3)', display: 'inline-flex' }} role="status">
          {msg.text}
        </p>
      )}

      <IntegrationTest
        onRun={handleHealth}
        pending={healthPending}
        result={healthMsg}
        desc="저장한 토큰으로 프로젝트를 실제로 읽을 수 있는지 확인합니다"
      />
    </IntegrationCard>
  )
}
