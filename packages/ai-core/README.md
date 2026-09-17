# @ax/ai-core

The contract an AI result has to satisfy, and nothing else. No vendor, no network, no React.

## The seven things a result carries

`AiValue` is not a value. It is a value **plus the six things that make it reviewable**:

```ts
import { newAiValue } from '@ax/ai-core'

const v = newAiValue({
  capability: 'extract',
  value: '2026-10-31',
  confidence: 0.82,              // null if the model said nothing, not 0
  evidence: [{ blockId: 'p3', start: 12, end: 24, quote: 'deadline: 2026-10-31' }],
  source: { providerId: 'gemini', modelId: 'gemini-3-flash', at: '2026-09-17T02:00:00Z' },
  status: 'candidate',
})
```

- **value** — what it says
- **confidence** — how sure, or `null`. `null` and `0` are different facts: `null` means the
  model never said, and drawing that as 0% asserts certainty nobody claimed.
- **evidence** — where in the source it came from: a block id and a character span, with the
  quoted text kept so a screen can show it without refetching. A claim with no evidence
  cannot be checked.
- **source** — which provider, which model, when.
- **status** — `streaming` · `candidate` · `confirmed` · `corrected`. `streaming` is a real
  state, not a loading flag: a half-arrived value that looks settled teaches people to trust
  half-arrived values.
- **corrections** — what a person changed, kept. `applyCorrection` appends; it never
  overwrites, because "the AI was wrong here" is the most valuable thing in the row.
- **contractVersion** — which shape this row was written under.

`isAiValue` checks a row at a boundary. `canTransition` says whether a status change is legal,
so the machine lives in one place instead of in each screen's click handler.

## Versions climb, they do not get guessed

```ts
import { climb, isCurrent, versionOf } from '@ax/ai-core'

const result = climb(row, [
  // one rung per version step. `from` is the version it moves off of
  { from: 1, up: (r) => ({ ...(r as object), evidence: [] }) },
])
// result.status: 'current' | 'climbed' | 'held'
```

A rung moves a row forward by exactly one version. `held` means no rung exists for that
version — the row is returned untouched and the caller decides what to show. `versionOf`
returns `null` for a row with no version rather than assuming `1`: an unstamped row is a bug
in whatever wrote it, and defaulting hides the bug instead of surfacing it.

## Capabilities

`AI_CAPABILITIES` names the eight things a model is asked to do (extract, assess, compare,
cross-verify, and so on). `REQUIRED_PRESENTATION` says, for each one, what a screen must show
alongside the answer — an extraction without its evidence is not a finished extraction.

## Who may read which field

```ts
import { canRead, readableFields, validateCatalog } from '@ax/ai-core'
```

A field is readable only when **both** things hold: the field is open at that sensitivity, and
the row is inside the reader's scope. Checking one and not the other is how a system ends up
showing the right kind of field from the wrong tenant's row. `validateCatalog` rejects a
catalog that declares a field twice or names a sensitivity that does not exist.

## Tests

```bash
cd packages/ai-core && pnpm typecheck
node --test --experimental-strip-types src/*.test.ts
```
