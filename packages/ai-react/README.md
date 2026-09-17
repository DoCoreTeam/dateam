# @ax/ai-react

Drawing an AI result. The decisions live in `.ts` files that a test runner can read; the
`.tsx` next to them only draws the answer.

## Every word comes from the caller

```ts
import { missingLabels, type AiLabels } from '@ax/ai-react'

const LABELS: AiLabels = {
  generated: 'AI가 만든 결과입니다',
  confidence: '확신',
  confidenceUnknown: '확신을 말하지 않았어요',
  // …thirteen in all
}
```

There is no default. A component that ships its own wording decides the wording of every
screen that uses it, and the first screen needing different words forks the component instead
— which is how twenty-eight separate ways of drawing the same value happened here. Filling a
missing label with English would ship English into a Korean product quietly, and the first
person to notice would be a user. `missingLabels()` answers at runtime what the types answer
at build time.

## Confidence, decided once

```ts
import { confidenceView, confidencePercentView } from '@ax/ai-react'

confidenceView(0.82, LABELS)          // { kind: 'known', percent: 82, text: '82%', low: false }
confidenceView(null, LABELS)          // { kind: 'unknown', text: labels.confidenceUnknown }
confidencePercentView(73.5, LABELS)   // { …, text: '73.5%' }
```

Two entry points because half of a real product stores confidence as `0..1` and the other half
as `0..100`. Making the second group divide first is how a displayed number changes during a
migration: 73.5 becomes 74, and afterwards nobody can say whether the model got less sure or
the code did.

`low` is a **presentation** line, not a correctness one — nothing is hidden or dropped below
it. `LOW_CONFIDENCE_BELOW` is a default and each screen may pass its own, because where the
line sits is a product decision.

## The rules, as functions

| Function | Question it answers |
|---|---|
| `statusText` · `isSettled` | What word for this status, and is it settled yet |
| `evidenceView` · `evidenceSpan` | What to show for a source, and where in it to point |
| `canConfirmCandidates` · `confirmBlockedReason` | May this be confirmed, and if not, why not |
| `diffRows` · `decidableRows` | What changed, and what a person can still decide |
| `correctionTrail` · `wasCorrected` | What people changed, in order |
| `needsGeneratedNotice` · `noticeIsMandatory` | Must this screen say an AI made it |
| `progressView` · `canAskAgain` | How far along, and may it be asked again |

`noticeIsMandatory` has no off switch. A notice that can be turned off is a notice nobody has
to keep.

## The components

`AiValue` · `Evidence` · `CandidateList` · `SuggestionDiff` · `CorrectionTrail` ·
`GeneratedNotice` · `AskAgain` · `Progress`

Each takes `labels` and draws what the rule above decided. They carry no colours of their own
beyond CSS custom properties, so a host theme reaches them.

## React

`react` is a peer dependency (`^18.3.1`). The package does not bring its own copy — two Reacts
in one tree break hooks in a way whose error message points at the wrong thing.

## Tests

```bash
cd packages/ai-react && pnpm typecheck
node --test --experimental-strip-types src/value.test.ts   # .tsx cannot be loaded by node --test
```

The `.tsx` files are unreachable to `node --test` (`ERR_UNKNOWN_FILE_EXTENSION`), which is the
practical reason the rules live in `.ts`: a rule inside a component is a rule no test can see.
