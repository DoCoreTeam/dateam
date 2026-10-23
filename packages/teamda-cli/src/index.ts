/**
 * Library surface of @ax/teamda-cli, for tests and for tools that embed the command tree.
 */
export { run } from './run.ts'
export { EXIT, CliError, exitForStatus, type ExitCode, type ErrorBody } from './exit.ts'
export { buildCommandTree, resolveCommand, loadSpec, type Command, type CommandTree, type OpenApiSpec } from './spec.ts'
export { helpJson, type HelpJson, type HelpEntry } from './commands/help.ts'
export { buildRequest, type BuiltRequest } from './commands/invoke.ts'
export { defaultContext, maskKey, VERSION, KEY_VISIBLE_CHARS, type Context } from './context.ts'
