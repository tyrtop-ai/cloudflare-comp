// Rebuilds docs/owner/prompts.md from a Claude Code transcript: every message
// the owner typed, verbatim, oldest first. Messages sent while Claude was
// working arrive as queued_command attachments and are marked as such.
// Usage: node scripts/owner-prompts.mjs <transcript.jsonl> [out.md]
import { readFileSync, writeFileSync } from 'node:fs'

const [transcript, out = new URL('../docs/owner/prompts.md', import.meta.url)] = process.argv.slice(2)
const human = e => e.origin?.kind === 'human' || e.attachment?.origin?.kind === 'human'

const text = e => {
  if (e.type === 'attachment') return e.attachment.type === 'queued_command' ? e.attachment.prompt : null
  if (e.type !== 'user' || e.isMeta || e.isCompactSummary) return null
  const c = e.message?.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c) || c.some(b => b.type === 'tool_result')) return null
  return c.filter(b => b.type === 'text').map(b => b.text).join('\n') || null
}

const seen = new Set()
const entries = []
for (const line of readFileSync(transcript, 'utf8').split('\n')) {
  if (!line) continue
  let e
  try { e = JSON.parse(line) } catch { continue }
  if (!human(e)) continue
  const t = text(e)
  const id = e.attachment?.source_uuid ?? e.uuid
  if (t == null || seen.has(id)) continue
  seen.add(id)
  entries.push({ at: e.timestamp, queued: e.type === 'attachment', text: t })
}

const fence = t => '`'.repeat(Math.max(4, ...[...t.matchAll(/`+/g)].map(m => m[0].length + 1)))
const md = ['# Owner prompts', '', 'Every message the owner sent, verbatim, oldest first (UTC). Rebuilt from the session transcript by `scripts/owner-prompts.mjs`.', '', 'Uploads appear as the paths they were sent with; the files themselves are not here.', '']
for (const { at, queued, text: t } of entries) {
  const f = fence(t)
  md.push(`## ${at.slice(0, 16).replace('T', ' ')}${queued ? ' (sent while Claude was working)' : ''}`, '', f + 'text', t, f, '')
}
writeFileSync(out, md.join('\n'))
console.log(`${entries.length} prompts`)
