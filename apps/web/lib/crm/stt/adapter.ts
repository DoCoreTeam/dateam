/**
 * 음성 인식 어댑터 (dacrm 구현명세 §3.2-3)
 *
 * 업체는 갈아 끼울 수 있어야 한다 — 한국어는 Clova, 영어는 Deepgram 이 낫고,
 * 어느 쪽이든 키가 없는 환경(개발·테스트)에서도 미팅 흐름 전체가 돌아야 한다.
 * 그래서 호출부는 이 인터페이스만 알고, 어느 업체인지는 설정이 정한다.
 *
 * **mock 이 기본값이다.** 키 없이 도는 것이 기본이어야
 * "STT 를 못 붙여서 미팅 기능을 한 번도 못 써 봤다"가 안 된다(절대규칙 7).
 */

/** 전사 한 조각 — 이 id 가 5축 추출의 근거가 된다 */
export interface TranscriptSegment {
  idx: number
  speaker: string
  startMs: number
  endMs: number
  text: string
}

export interface TranscriptResult {
  segments: TranscriptSegment[]
  /** 녹음 길이. 못 읽으면 null — 지어내지 않는다 */
  durationSec: number | null
}

export interface SttAdapter {
  /** 업체 이름 — 어느 것으로 전사했는지 기록에 남는다 */
  readonly vendor: string
  transcribe(fileUrl: string): Promise<TranscriptResult>
}

/**
 * 키가 없을 때 쓰는 어댑터.
 *
 * **전사하는 척하지 않는다.** 파일을 읽지 않고, 대신 "여기에 전사가 들어온다"는
 * 자리만 만든다. 가짜 대화를 지어내면 그걸로 뽑은 5축이 그럴듯해 보이고,
 * 사람은 기능이 되는 줄 안다 — 그게 가장 나쁜 실패다.
 */
export function mockSttAdapter(): SttAdapter {
  return {
    vendor: 'mock',
    async transcribe() {
      return {
        segments: [{
          idx: 0, speaker: '안내', startMs: 0, endMs: 1000,
          text: '음성 인식 업체가 아직 연결되지 않아 전사를 만들지 못했습니다. 시스템 설정에서 업체와 키를 등록해 주세요.',
        }],
        durationSec: null,
      }
    },
  }
}

/**
 * 붙여넣은 전사를 그대로 쓰는 어댑터.
 *
 * 녹음 파일이 없어도 미팅 기능을 쓸 수 있어야 한다 — 실제로 많은 사람이
 * 회의록을 손으로 적거나 다른 도구의 전사를 들고 온다. 그걸 버리게 하면
 * "녹음을 안 했으니 이 미팅은 CRM 에 못 넣는다"가 된다.
 *
 * 줄 하나가 구간 하나다. `이름: 말` 형태면 화자를 갈라 읽는다.
 */
export function pastedTranscriptAdapter(text: string, vendor = 'pasted'): SttAdapter {
  return {
    // 어디서 온 글인지 기록에 남는다. 회의노트 발행은 'note-snapshot' 을 넘긴다 —
    // 사람이 붙여넣은 것과 원본에서 떠 온 것은 나중에 구분할 수 있어야 한다.
    vendor,
    async transcribe() {
      const lines = text.split('\n').map((l) => l.trim()).filter(Boolean)
      const segments: TranscriptSegment[] = lines.map((line, i) => {
        const m = line.match(/^([^:：]{1,20})[:：]\s*(.+)$/)
        return {
          idx: i,
          speaker: m ? m[1].trim() : '화자',
          // 붙여넣은 글에는 시각이 없다. 순서를 지키는 값만 넣는다 —
          // DB 가 end > start 를 요구하므로(DI-23) 0 으로 두면 저장이 막힌다.
          startMs: i * 1000,
          endMs: i * 1000 + 999,
          text: m ? m[2].trim() : line,
        }
      })
      return { segments, durationSec: null }
    },
  }
}

/**
 * 설정이 가리키는 업체로 어댑터를 만든다.
 *
 * 아직 실업체(Clova·Deepgram)는 안 붙었다. 붙지 않은 업체를 가리키면
 * **조용히 mock 으로 돌지 않고** 그 사실을 말한다 — 조용히 넘어가면
 * 사용자는 키를 넣었으니 전사가 됐다고 믿는다.
 */
export function sttAdapterFor(vendor: string | null | undefined): SttAdapter {
  const v = (vendor ?? 'mock').trim().toLowerCase()
  if (v === 'mock' || v === '') return mockSttAdapter()
  throw new Error(
    `음성 인식 업체(${vendor})가 아직 연결되지 않았습니다. 지금은 전사를 붙여넣는 방식만 됩니다.`,
  )
}
