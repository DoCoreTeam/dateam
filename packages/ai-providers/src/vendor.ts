/**
 * What a vendor is, as opposed to what we call it.
 *
 * Adding a vendor used to mean editing nine places: the type, the label table, the settings
 * key map, the default model table, the order array, a branch in the lookup, the catalog,
 * the model screen and the admin card. One vendor ended up wired into a single card and
 * never became a general provider; another never got in at all.
 *
 * Split by owner: an endpoint, a key prefix and what the vendor can do are facts about the
 * vendor. A display name, where its key is stored and which model we default to are facts
 * about the deployment, so they stay with the caller.
 */

export interface VendorCapabilities {
  vision: boolean
  tools: boolean
  thinking: boolean
  defaultMaxOutputTokens: number
}

export interface VendorSpec<Id extends string = string> {
  id: Id
  /**
   * OpenAI-compatible endpoint. Null when an official SDK is used instead,
   * in which case the SDK owns the address.
   */
  baseUrl: string | null
  /** Checked before a key is stored, so a key pasted into the wrong field fails there */
  keyPrefixes: readonly string[]
  capabilities: VendorCapabilities
  /** Where a key is issued, so nobody has to leave the screen to find out */
  keyIssueUrl: string
}

export const GEMINI: VendorSpec<'gemini'> = {
  id: 'gemini',
  baseUrl: null,
  keyPrefixes: ['AIza'],
  capabilities: { vision: true, tools: true, thinking: false, defaultMaxOutputTokens: 8192 },
  keyIssueUrl: 'https://aistudio.google.com/apikey',
}

export const CLAUDE: VendorSpec<'claude'> = {
  id: 'claude',
  baseUrl: null,
  keyPrefixes: ['sk-ant-'],
  capabilities: { vision: true, tools: true, thinking: true, defaultMaxOutputTokens: 16384 },
  keyIssueUrl: 'https://console.anthropic.com/settings/keys',
}

export const OPENAI: VendorSpec<'openai'> = {
  id: 'openai',
  baseUrl: null,
  keyPrefixes: ['sk-'],
  capabilities: { vision: true, tools: false, thinking: false, defaultMaxOutputTokens: 16384 },
  keyIssueUrl: 'https://platform.openai.com/api-keys',
}

export const GROQ: VendorSpec<'groq'> = {
  id: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  keyPrefixes: ['gsk_'],
  /**
   * Open models on someone else's accelerators. No tools.
   *
   * Images: measured 2026-09-14 against a live account. `qwen/qwen3.6-27b` and
   * `qwen/qwen3.8-27b` report `input_modalities: [text, image]`, so the vendor does serve
   * vision models and the OpenAI-compatible adapter already sends image parts.
   * This flag is the vendor ceiling, not a per-model answer — the listing says which
   * individual model reads images, and the catalog reads that.
   */
  capabilities: { vision: true, tools: false, thinking: false, defaultMaxOutputTokens: 8192 },
  keyIssueUrl: 'https://console.groq.com/keys',
}

/**
 * Vercel AI Gateway. Not a model maker but a gateway in front of many, so one key reaches
 * whatever model a deployment settles on. The trading module's judge calls it; chat can too.
 */
export const JEV: VendorSpec<'jev'> = {
  id: 'jev',
  baseUrl: 'https://ai-gateway.vercel.sh/v1',
  keyPrefixes: ['vck_'],
  capabilities: { vision: true, tools: true, thinking: true, defaultMaxOutputTokens: 8192 },
  keyIssueUrl: 'https://vercel.com/docs/ai-gateway/authentication-and-byok/api-keys',
}

export const GROK: VendorSpec<'grok'> = {
  id: 'grok',
  baseUrl: 'https://api.x.ai/v1',
  keyPrefixes: ['xai-'],
  capabilities: { vision: true, tools: false, thinking: true, defaultMaxOutputTokens: 16384 },
  keyIssueUrl: 'https://console.x.ai',
}
