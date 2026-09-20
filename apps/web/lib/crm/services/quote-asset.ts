/**
 * 견적서가 굳힌 그림 — 지금은 로고 하나뿐이다
 *
 * **왜 따로 표인가**: 로고는 실측 97KB 짜리 data URI 다. 견적 행에 통째로 담으면
 * 견적 천 건에 100MB 가 되고, 그 대부분은 **같은 그림의 복사본**이다.
 * 내용 해시를 키로 두면 로고를 바꾸기 전까지 행이 하나고, 견적은 그 해시만 가리킨다.
 *
 * **지우지 않는다.** 옛 견적서가 그 해시를 가리키고 있고, 그 문서는 이미 고객에게 갔다.
 */

import { createHash } from 'node:crypto'

/** 내용이 같으면 해시도 같다 — 그래서 같은 로고는 행을 안 늘린다 */
export function assetHash(dataUri: string): string {
  return createHash('sha256').update(dataUri, 'utf8').digest('hex')
}

/**
 * 그림을 굳히고 그 해시를 돌려준다. 빈 값이면 굳힐 것이 없으므로 null 이다
 * (로고를 안 올린 회사의 견적서에 빈 그림 자리를 만들지 않는다).
 */
export async function freezeAsset(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  dataUri: string | null | undefined,
): Promise<string | null> {
  const v = (dataUri ?? '').trim()
  if (!v) return null
  const hash = assetHash(v)
  /*
    **있으면 그대로 둔다.** 같은 해시는 곧 같은 내용이라 덮어쓸 것이 없고,
    덮어쓰면 그 그림을 가리키는 옛 견적서가 전부 흔들린다.
  */
  await tx.crmQuoteAsset.upsert({
    where: { hash },
    update: {},
    create: { hash, dataUri: v },
  })
  return hash
}

/** 굳은 그림을 읽는다. 해시가 없거나 행이 사라졌으면 빈 문자열 — 문서는 로고 없이도 나간다 */
export async function readAsset(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  hash: string | null | undefined,
): Promise<string> {
  if (!hash) return ''
  const row = await db.crmQuoteAsset.findFirst({
    where: { hash },
    select: { dataUri: true },
  }) as { dataUri: string } | null
  return row?.dataUri ?? ''
}
