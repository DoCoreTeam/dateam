'use client'

// 설정 카드 (dacrm T1-08)
//
// 카드마다 저장한다(§2-5-4) — 탭 하단 일괄 저장 바를 두지 않는다.
// 각 설정이 서로 다른 시스템을 가리키고, 하나가 실패해도 나머지는 저장돼야 하기 때문이다.
//
// 시크릿은 **저장하면 다시 볼 수 없다.** 그 사실을 화면이 먼저 말해야
// 사용자가 "어? 아까 넣은 키가 왜 안 보이지"를 겪지 않는다.

import { useCallback, useEffect, useState } from 'react'
import NbButton from '@/components/ui/nb/NbButton'
import AXDotLoader from '@/components/ui/AXDotLoader'
import FormErrorBanner from '@/components/ui/FormErrorBanner'
import {
  SETTING_GROUP as GROUP, SETTING_GROUP_ORDER as GROUP_ORDER,
  type SettingGroupKey,
} from '@/lib/crm/domain/setting-group'
import { unknownChoiceValue } from '@/lib/crm/domain/setting-value'
import QuoteNoField from './QuoteNoField'
import { kstTodayKey } from '@/lib/datetime/kst'
import styles from './settings.module.css'
import SharedSettingsCard from '@/components/ui/settings/SettingsCard'
import StatusPill from '@/components/ui/settings/StatusPill'
import {
  ACTION, progress, settingFieldState, SETTING_SAVE_LABEL, settingSaveDisabled,
  settingUnknownValue, settingUnknownOptionLabel,
} from '@/lib/terms'

interface Choice { value: string; label: string; hint?: string }

interface SettingItem {
  key: string
  label: string
  kind: 'text' | 'number' | 'secret' | 'choice' | 'multiline' | 'image' | 'quoteNo'
  /** 어느 카드에 설지 — 성격이 다른 설정을 한 목록에 늘어놓지 않는다 */
  group: string
  description: string
  value: string | null
  masked: string | null
  source: 'WORKSPACE' | 'GLOBAL' | 'FALLBACK'
  /** 고를 수 있는 것 — 지금 등록된 AI 키에 따라 달라진다 */
  choices?: Choice[]
}

/** 값이 어디서 왔는지 — "설정했는데 왜 안 바뀌지"를 없애는 유일한 표시 */
const SOURCE_LABEL: Record<SettingItem['source'], string> = {
  WORKSPACE: '이 워크스페이스',
  GLOBAL: '공통 설정',
  FALLBACK: '기본값',
}

/**
 * 저장된 값이 고를 수 있는 목록 밖인가 — 판정 자체는 도메인에 있다(검사할 수 있어야 한다).
 *
 * 선택지가 아직 안 온 동안에는 묻지 않는다. 그때는 어떤 값이든 «목록 밖»이라
 * 로딩 중에 경고가 번쩍인다.
 */
function unknownChoice(s: SettingItem): string | null {
  if (s.kind !== 'choice' || !s.choices || s.choices.length === 0) return null
  return unknownChoiceValue(s.value, s.choices)
}

/**
 * 설정 묶음 하나를 그린다.
 *
 * `group` 을 주면 그 묶음만 그린다. 안 주면 예전처럼 있는 묶음을 전부 그린다.
 * 왜 나눌 수 있어야 하나: 설정 화면이 분류 탭으로 나뉜 뒤로, 한 부품이 성격이 다른
 * 카드 둘(견적서 공급자 정보 · AI·연동 설정)을 함께 그리면 **어느 탭에 넣어도 한쪽이 거짓말을 한다.**
 * 실제로 AI 카드가 「견적」 탭에 실려 나왔다(실브라우저 확인 2026-09-20).
 */
export default function SettingsCard({ group }: { group?: SettingGroupKey } = {}) {
  // 「오늘」은 KST 다 — 미리보기 번호가 한국 자정~아침 9시에 어제 날짜로 보이면 안 된다
  const todayKey = kstTodayKey()
  const [items, setItems] = useState<SettingItem[]>([])
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (opts?: { keepDraftsExcept?: string }) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/crm/settings')
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '설정을 불러오지 못했습니다.'); return }
      const list: SettingItem[] = body.items ?? []
      setItems(list)
      // 시크릿은 초안을 비워 둔다 — 마스킹된 값을 그대로 저장하면 그게 키가 된다
      // 시크릿과 이미지는 초안을 비워 둔다 — 목록이 원본을 주지 않는다(크기만 온다).
      // 마스킹된 값을 그대로 저장하면 그게 값이 된다.
      const fresh = Object.fromEntries(list.map((s) =>
        [s.key, s.kind === 'secret' || s.kind === 'image' ? '' : (s.value ?? '')]))
      const only = opts?.keepDraftsExcept
      // 처음 읽을 때는 전부 서버 값으로. 저장 뒤에는 **그 칸만** — 나머지는 쓰던 글을 지킨다
      setDrafts((prev) => (only ? { ...prev, [only]: fresh[only] ?? '' } : fresh))
    } catch {
      setError('설정을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  /** 고른 파일을 data URI 로. 검증은 서버가 다시 한다 — 여기서는 빨리 알려 주는 것뿐이다 */
  async function pickImage(key: string, file: File | null) {
    if (!file) { setDrafts((d) => ({ ...d, [key]: '' })); return }
    setError(null)
    const uri = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result ?? ''))
      r.onerror = () => reject(new Error('read'))
      r.readAsDataURL(file)
    }).catch(() => '')
    if (!uri) { setError('이미지를 읽지 못했어요. 다른 파일로 시도해 주세요.'); return }
    setDrafts((d) => ({ ...d, [key]: uri }))
  }

  async function save(key: string) {
    setSavingKey(key)
    setError(null)
    try {
      const res = await fetch('/api/crm/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: drafts[key] ?? '' }),
      })
      const body = await res.json()
      if (!res.ok) { setError(body?.error?.message ?? '저장하지 못했습니다.'); return }
      /*
        **다시 읽되 남의 초안은 건드리지 않는다.**

        예전에는 `load()` 가 목록과 함께 **초안 전체**를 서버 값으로 덮었다.
        그래서 상호를 저장하면 그 옆에서 아직 안 누른 주소·대표자 초안이 조용히 사라졌다.
        방금 데이터를 잃은 화면에서 또 잃게 할 수는 없다 — 저장한 칸만 서버 값으로 맞춘다.
      */
      await load({ keepDraftsExcept: key })
    } catch {
      setError('저장하지 못했습니다. 잠시 후 다시 시도해 주세요.')
    } finally {
      setSavingKey(null)
    }
  }

  /**
   * 이 칸이 지금 어떤 상태인가 — 저장된 값이 있나, 초안이 그것과 다른가.
   *
   * 시크릿과 이미지는 목록이 원본을 안 준다(마스킹·크기만 온다). 그래서 «초안이 비었나»로
   * 갈린다 — 새 값을 넣었으면 고치는 중이고, 안 넣었으면 그대로다.
   */
  const fieldState = (s: SettingItem) => {
    const hasSaved = s.source !== 'FALLBACK'
    const opaque = s.kind === 'secret' || s.kind === 'image'
    const changed = opaque ? (drafts[s.key] ?? '') !== '' : (drafts[s.key] ?? '') !== (s.value ?? '')
    return settingFieldState(hasSaved, changed)
  }

  if (loading && items.length === 0) return <AXDotLoader />

  // 순서는 상수가 정한다 — 화면이 정하면 카드가 늘어날 때마다 여기가 갈린다
  const groups = GROUP_ORDER
    .filter((g) => (group ? g === group : true))
    .filter((g) => items.some((s) => s.group === g))

  return (
    <>
      <FormErrorBanner message={error} />
      {groups.map((g) => (
    <SharedSettingsCard title={GROUP[g].label} headingLevel={2} key={g}>

      <div className={styles.settings}>
        {items.filter((s) => s.group === g).map((s) => (
          <div key={s.key} className={styles.setting}>
            <div className={styles.settingHead}>
              <label className="label" htmlFor={`set-${s.key}`}>{s.label}</label>
              <StatusPill tone="neutral">{SOURCE_LABEL[s.source]}</StatusPill>
            </div>
            <p className="field-note">{s.description}</p>
            {unknownChoice(s) !== null && (
              <FormErrorBanner message={settingUnknownValue(unknownChoice(s)!)} />
            )}

            <div className={styles.row}>
              <div className={styles.field}>
                {/*
                  고를 수 있는 설정은 **드롭다운**이다.
                  예전에는 텍스트 칸에 `gemini` 라고 직접 적으라고 했다 —
                  무엇을 적어야 하는지 모르고, 적어도 키가 없으면 그제야 실패를 듣는다.
                  고를 수 없는 것은 목록에 아예 없다.
                */}
                {s.kind === 'choice' ? (
                  <select
                    id={`set-${s.key}`}
                    className="input-field"
                    value={drafts[s.key] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                  >
                    {/*
                      목록 밖의 값이면 **그 값을 그대로 항목으로 얹는다.**
                      안 얹으면 select 가 첫 항목을 그려, 이상한 값이 저장돼 있는데도
                      화면은 멀쩡한 값을 고른 것처럼 보인다.
                    */}
                    {unknownChoice(s) !== null && (
                      <option value={unknownChoice(s)!}>
                        {settingUnknownOptionLabel(unknownChoice(s)!)}
                      </option>
                    )}
                    {(s.choices ?? []).map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                ) : s.kind === 'image' ? (
                  /*
                    파일을 고르면 그 자리에서 data URI 로 바꿔 초안에 넣는다.
                    별도 업로드 API 를 두지 않는 이유: 로고는 작고 자주 안 바뀐다 —
                    버킷·권한·URL 수명을 따로 관리할 만큼의 일이 아니다.
                  */
                  <input
                    id={`set-${s.key}`}
                    className="input-field"
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => void pickImage(s.key, e.target.files?.[0] ?? null)}
                  />
                ) : s.kind === 'quoteNo' ? (
                  /*
                    번호 형식은 **결과를 보면서** 고쳐야 한다 — 형식 문자열만 보고는
                    무엇이 나올지 모르고, 틀린 채로 저장하면 고객 문서에 그 오타가 실린다.
                  */
                  <QuoteNoField
                    id={`set-${s.key}`}
                    value={drafts[s.key] ?? ''}
                    onChange={(next) => setDrafts((d) => ({ ...d, [s.key]: next }))}
                    todayKey={todayKey}
                  />
                ) : s.kind === 'multiline' ? (
                  /*
                    여러 줄이 들어갈 값(거래 조건)을 한 줄 칸에 받으면 사용자는
                    줄바꿈을 못 넣고 전부 한 줄로 적는다 — 그게 그대로 인쇄된다.
                  */
                  <textarea
                    id={`set-${s.key}`}
                    className="input-field"
                    rows={3}
                    value={drafts[s.key] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                  />
                ) : (
                  <input
                    id={`set-${s.key}`}
                    className="input-field"
                    type={s.kind === 'secret' ? 'password' : 'text'}
                    value={drafts[s.key] ?? ''}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.key]: e.target.value }))}
                    placeholder={s.kind === 'secret'
                      ? (s.masked ? `저장됨 ${s.masked}: 바꾸려면 새 값을 넣으세요` : '아직 없음')
                      : ''}
                    autoComplete="off"
                  />
                )}
              </div>
              {/*
                **단추가 칸의 상태를 말한다.** 늘 「저장」이면 눌렀던 것이 먹었는지,
                지금 누르면 무슨 일이 나는지 둘 다 못 말한다 — 사람은 안 먹은 줄 알고 다시 누른다
                (사용자 지적 2026-09-20). 말은 lib/terms 가 정한다.
              */}
              <NbButton
                onClick={() => void save(s.key)}
                disabled={savingKey === s.key || settingSaveDisabled(fieldState(s))}
              >
                {savingKey === s.key ? progress(ACTION.save) : SETTING_SAVE_LABEL[fieldState(s)]}
              </NbButton>
            </div>

            {/* 고른 것이 무슨 뜻인지 그 자리에서 말한다 — 설명이 목록 밖에 있으면 아무도 안 읽는다 */}
            {s.kind === 'image' && (drafts[s.key] || s.masked) && (
              <div className={styles.imagePreview}>
                {drafts[s.key] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={drafts[s.key]} alt={`${s.label} 미리보기`} />
                ) : (
                  <span className="field-note">저장됨 · {s.masked}: 바꾸려면 새 파일을 고르세요</span>
                )}
              </div>
            )}

            {s.kind === 'choice' && (
              <p className="field-note">
                {(s.choices ?? []).find((c) => c.value === (drafts[s.key] ?? ''))?.hint ?? ''}
              </p>
            )}
          </div>
        ))}
      </div>

      {g === 'ai' && items.some((s) => s.kind === 'choice' && (s.choices ?? []).length <= 2) && (
        <p className={styles.blocked}>
          아직 등록된 AI 키가 없어 &quot;AI 안 씀&quot;으로만 돌아갑니다.
          시스템 설정 → 통합에서 Gemini·Claude·OpenAI 중 하나를 등록하면 여기에 나타납니다.
        </p>
      )}

      <p className="field-note">{GROUP[g].description}</p>
    </SharedSettingsCard>
      ))}
    </>
  )
}
