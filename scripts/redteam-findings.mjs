// Writes one round of the prompt red team into docs/owner/redteam-findings.md: every finding each
// hunter made, every judge's vote and reason, the verdict, and every recheck of a fixed or disputed
// item. Built from the workflow's journal, so nothing a red-team agent said is lost or reworded.
// Usage: node scripts/redteam-findings.mjs <journal.jsonl> <round> [out.md]
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const [journal, round, out = new URL('../docs/owner/redteam-findings.md', import.meta.url)] = process.argv.slice(2)
const rows = readFileSync(journal, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
const label = Object.fromEntries(rows.filter(r => r.type === 'started').map(r => [r.key, r.label]))
const results = rows.filter(r => r.type === 'result' && r.result).map(r => ({ label: label[r.key] || '', ...r.result }))
// Round 1 had one team (hunt:<lens>); the swarm has six (hunt:<team>:<lens>).
const lensOf = l => l.split(':').slice(1).join('/')

const findings = []
const rechecks = {}
for (const h of results.filter(r => r.label.startsWith('hunt:'))) {
  const lens = lensOf(h.label)
  h.findings.forEach((f, j) => findings.push({ ...f, key: `${lens}-${j + 1}`, team: lens.includes('/') ? lens.split('/')[0] : '' }))
  h.rechecks.forEach(r => (rechecks[r.id] ||= []).push({ lens, ...r }))
}
const votes = {}
for (const b of results.filter(r => r.label.startsWith('judge:'))) for (const v of b.votes) (votes[v.key] ||= []).push({ lens: lensOf(b.label), ...v })

// The same verdict rule as the workflow: 2 of 3 real confirms; a duplicate folds only into a confirmed, unfolded finding.
const judged = findings.map(f => {
  const vs = votes[f.key] || []
  const dups = vs.map(v => v.duplicate_of).filter(d => d && d !== f.key)
  return { ...f, vs, yes: vs.filter(v => v.real).length, dup: dups.find(d => dups.filter(x => x === d).length >= 2) }
})
const byKey = Object.fromEntries(judged.map(f => [f.key, f]))
const folded = new Map()
for (const f of judged) {
  const t = f.yes >= 2 && byKey[f.dup]
  if (t && t.yes >= 2 && !folded.has(t.key)) folded.set(f.key, t.key)
}
// The merge pass groups the same issue found by two teams; it never confirms or rejects.
const merge = results.find(r => r.label === 'merge')
for (const g of merge ? merge.groups : []) for (const k of g.same) if (k !== g.keep && byKey[k]?.yes >= 2 && !folded.has(k) && byKey[g.keep]?.yes >= 2 && !folded.has(g.keep)) folded.set(k, g.keep)
const verdict = f => f.yes < 2 ? `rejected (${f.yes} of 3)` : folded.has(f.key) ? `confirmed (${f.yes} of 3), same issue as R${round}-${folded.get(f.key)}` : `confirmed (${f.yes} of 3)`

const one = s => String(s ?? '').replace(/\s*\n\s*/g, ' ')
const L = [`## Round ${round}`, '']
const counts = { confirmed: judged.filter(f => f.yes >= 2 && !folded.has(f.key)).length, folded: folded.size, rejected: judged.filter(f => f.yes < 2).length }
L.push(`${judged.length} findings: ${counts.confirmed} confirmed, ${counts.folded} the same issue as a confirmed one, ${counts.rejected} rejected.`, '')
if (Object.keys(rechecks).length) {
  L.push('### Rechecks of fixed and disputed items', '')
  for (const [id, vs] of Object.entries(rechecks)) {
    const closed = vs.filter(v => v.closed ?? v.fixed).length
    L.push(`- **${id}**: ${closed >= 2 && closed * 2 > vs.length ? 'closed' : 'still open'} (${closed} of ${vs.length})`)
    for (const v of vs) L.push(`  - ${v.lens}: ${(v.closed ?? v.fixed) ? 'closed' : 'open'}. ${one(v.evidence)}`)
  }
  L.push('')
}
const rank = f => f.yes < 2 ? 2 : folded.has(f.key) ? 1 : 0
for (const f of [...judged].sort((a, b) => rank(a) - rank(b))) {
  L.push(`### R${round}-${f.key}: ${one(f.title)}`, '',
    `- **Verdict:** ${verdict(f)}`,
    `- **Kind:** ${f.kind}${f.ledger_id ? ` (recheck of ${f.ledger_id})` : ''}`,
    `- **Where:** \`${f.file}:${f.line}\`${f.live ? ', live in v8' : ', not live'}`,
    `- **Owner (${f.owner_date}):** ${one(f.owner_quote)}`,
    `- **What the code does:** ${one(f.code_does)}`,
    `- **What the owner's words require:** ${one(f.fix)}`,
    '- **Votes:**')
  for (const v of f.vs) L.push(`  - ${v.lens}: ${v.real ? 'real' : 'not real'}${v.duplicate_of && v.duplicate_of !== f.key ? `, same as ${v.duplicate_of}` : ''}. ${one(v.reason)}`)
  L.push('')
}
const section = L.join('\n')

const head = '# Red-team findings\n\nEvery finding the prompt red team (`.claude/workflows/prompt-redteam.js`, a swarm of teams of three from round 2) has made, round by round, with each judge\'s vote and reason, written from the workflow journals by `scripts/redteam-findings.mjs`. Status and fixes are tracked in `drift.md`.\n'
let doc = existsSync(out) ? readFileSync(out, 'utf8') : head
const re = new RegExp(`## Round ${round}\\n[\\s\\S]*?(?=\\n## Round |$)`)
doc = re.test(doc) ? doc.replace(re, section) : doc.trimEnd() + '\n\n' + section
writeFileSync(out, doc.trimEnd() + '\n')
console.log(`round ${round}: ${judged.length} findings`, counts)
