// What the chat beside a template does with a model's reply: find the template draft in it, tidy what a small model
// gets wrong the same way every time, and say what stands in the way of the draft working — the same checks the
// template's page makes as it is typed. The draft goes into the editor; the person saves it.

import { parseFormdown } from '@formdown/core'
import { templateInfo, templateProblems } from './documents.js'
import { describeError } from './errors.js'
import { strings } from './strings.js'

/** The last fenced block of a reply that holds a template — what the model was asked to send whole — or null. */
export function draftOf(reply: string): string | null {
  const blocks = [...reply.matchAll(/```[ \t]*(formdown|fd|markdown|md)?[ \t]*\r?\n([\s\S]*?)\r?\n?```/g)]
  for (const block of blocks.reverse()) {
    const body = block[2]
    if (/^---\r?\n/.test(body) || /@[^\s:]+\s*:/.test(body)) return body.endsWith('\n') ? body : `${body}\n`
  }
  return null
}

/** What a reply says besides its draft: its words, the template block taken out. */
export function wordsOf(reply: string): string {
  return reply.replace(/```[ \t]*(formdown|fd|markdown|md)?[ \t]*\r?\n[\s\S]*?```/g, '').trim()
}

/**
 * A draft with what small models get wrong mechanically put right: a field name with spaces in it (`@처리 기한: [date]`)
 * — a field's name is one word, so the spaces become underscores, as the template's rules say — and each fix the
 * parser offers for a line it could not read, such as a field written without its brackets (`@처리_기한: date`).
 */
export function tidyDraft(draft: string): string {
  const named = draft.replace(/^(\s*)@([^:@\n\[\]]*\S)(\s*):(\s*\[)/gm, (whole, indent: string, name: string, _gap: string, rest: string) =>
    /\s/.test(name) ? `${indent}@${name.trim().replace(/\s+/g, '_')}:${rest}` : whole,
  )
  return withFixes(named)
}

/** `source` with each fix the parser offers put in place of what it is for, the last first so the earlier spans hold. */
function withFixes(source: string): string {
  let fixes
  try {
    fixes = (parseFormdown(source).diagnostics ?? []).filter((d) => d.fix !== undefined && d.span !== undefined)
  } catch {
    return source
  }
  return fixes
    .sort((a, b) => b.span!.start - a.span!.start)
    .reduce((text, d) => text.slice(0, d.span!.start) + d.fix + text.slice(d.span!.end), source)
}

/** What stands in the way of the draft working as a template, in the words the template's page uses. */
export function draftProblems(draft: string): string[] {
  const said: string[] = []
  try {
    templateInfo(draft)
  } catch (e) {
    said.push(describeError(e))
  }
  for (const problem of templateProblems(draft)) said.push(strings.templateProblem(problem))
  return said
}

/** What the conversation says to the model when its draft had problems: the problems, and to send the whole template again. */
export function retryMessage(problems: readonly string[]): string {
  return [strings.chatRetry, ...problems.map((p) => `- ${p}`)].join('\n')
}

/** The fields a draft adds and takes away, by name, against the template as it was. */
export function fieldChanges(before: string, after: string): { added: string[]; removed: string[] } {
  const names = (source: string) => {
    try {
      return parseFormdown(source).forms.map((f) => f.name)
    } catch {
      return []
    }
  }
  const was = new Set(names(before))
  const now = names(after)
  return { added: now.filter((n) => !was.has(n)), removed: [...was].filter((n) => !now.includes(n)) }
}
