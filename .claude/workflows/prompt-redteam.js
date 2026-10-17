export const meta = {
  name: 'prompt-redteam',
  description: "A swarm of six red teams, three agents each, check every area of the code against the owner's prompt history; each team confirms its findings and rechecks fixes by 2-of-3 quorum",
  whenToUse: "Check that the code follows every owner prompt in docs/owner/prompts.md; re-run after fixing until a round confirms nothing",
  phases: [
    { title: 'Hunt', detail: 'six teams of three, one area each; each agent reads every prompt, hunts drift in its area, and rechecks the fixes and disputes there' },
    { title: 'Quorum', detail: 'within each team, all three judge every finding; 2 of 3 confirms a finding or closes an item' },
    { title: 'Merge', detail: 'one pass folds the same issue found by two teams into one finding' },
  ],
}

// One round of the swarm. Claude fixes what it returns, records the fixes in docs/owner/drift.md, and runs it again
// until a round confirms no new drift and every claimed fix is confirmed.
// The swarm reads a frozen checkout of one commit (args.repo), so merges made while it runs don't change what it reads.
const REPO = (args && args.repo) || '/home/user/cloudflare-comp/.claude/worktrees/next'
const round = (args && args.round) || 1

const COMMON = `You are a red-team agent, one of three on your team; six teams work in parallel, one area of the code each. Your job is to catch Claude (the AI that writes this codebase) not following its owner.

Repo: ${REPO} (read only: never edit, commit, stash, checkout or push; read with Read/Grep/Glob and read-only shell commands).
- docs/owner/prompts.md is every prompt the owner ever sent, verbatim, oldest first, with UTC date headings. This is the ground truth. Read all of it.
- docs/owner/rulings.md is Claude's own summary of the owner's rulings. It is NOT ground truth: it can misquote, soften, or add to what the owner said. Where it conflicts with prompts.md, prompts.md wins.
- docs/owner/drift.md is the ledger of earlier rounds: findings confirmed, fixes Claude claims ("Fixed, awaiting recheck"), findings Claude disputes with its evidence ("Disputed"), and findings the quorum rejected. Read it.
- The code under audit is v8: src/, public/, test/, scripts/, CHANGELOG-v8.md and docs on this branch. v7-only paths v8 never calls are out of scope unless the owner said to remove them.
- Later prompts override earlier ones. A prompt answering a question of Claude's is binding the way it was meant. "Held" items the owner set aside (the v7 competition branch, held releases) are not drift.

A finding needs:
- owner_quote: the owner's exact words from prompts.md and its date heading. No quote, no finding. Never quote rulings.md as the owner.
- what the code (or record) actually does, with file:line you verified by reading it, and whether that path is live in v8 (grep its callers).
- kind: "drift" (contradicts what the owner said), "extra" (work the owner never asked for: a mechanism, cap, clip, retry, fallback, heuristic, parser, special case, shim; name the prompt it would need and say none exists), "record" (rulings.md, the changelog, prompt texts, docs or a test say something the owner didn't, or pin behaviour the owner ruled out), or "unfixed" (a claimed fix in drift.md that isn't actually fixed).
- fix: what the owner's words require, in one or two sentences. Not a design of your own.
Do not report: style, naming, bugs unrelated to an owner instruction, or anything already confirmed open in drift.md (unless you have new evidence). A finding the ledger lists as rejected comes back only with new evidence, which you state.
Be adversarial and precise. Fewer, verified findings beat many guesses.`

const LENSES = [
  { key: 'chrono', prompt: `Your lens: prompts → code. Read prompts.md from the first prompt to the last and list to yourself every directive, correction, complaint and ruling the owner gave (including short ones, and repeats: a repeat means the code drifted back). Then check each one that touches your area against the code and records there. Report every one your area doesn't honour.` },
  { key: 'code', prompt: `Your lens: code → prompts. Walk every mechanism in your area that a v8 run reaches. For each, ask: which owner prompt asked for this? Hunt especially for the runtime enforcing process, parsing or repairing a model's output, retrying, capping, clipping, masking, blocklists, path rules, top-specific behaviour, data moving between branches, and anything that does an agent's work for it. Report what no prompt asked for, or what a prompt ruled out.` },
  { key: 'record', prompt: `Your lens: the words. In your area, compare against prompts.md: every text a model reads (system prompts, tool descriptions, function results, complaint texts, e.g. a worker told about siblings, a goal, a project, or that anything split), the comments and docs that describe your area, the tests that pin its behaviour (a test pinning what the owner ruled out is a finding), and what CHANGELOG-v8.md and docs/owner/rulings.md claim about it. Check the claimed fixes and disputes in drift.md for your area hardest of all.` },
]

const TEAMS = [
  { key: 'room', area: `The room and the managers: in src/index.js the run's start, the room's completion rule and holds, the managers' turns, how asks, complaints and changes reach whom, archive and rebuild (rebuildOrphans), level files (designOf, levelContracts), the prompt queue and amendments; in src/model.js the managers' options and Clef's choice (managerView, managerOptions, managerChoice, chooseCall); src/manager-shard.js, src/problems.js, src/amend.js, src/protocol.js.` },
  { key: 'splitter', area: `The splitter and the validations: src/splitter.js, src/session.js, src/validations.js, src/contracts.js; in src/index.js the split step, the pre-grade, the split review and admitting a level, where validations are placed, and how examples are rendered from validations; in src/model.js Clef's split questions; in src/prompts.js ROLE.splitter, TOOLS.splitter and the check functions.` },
  { key: 'worker', area: `The worker and the builder: src/worker.js; in src/prompts.js ROLE.worker and TOOLS.worker; in src/index.js the worker's turn and everything a worker sees or can do; src/broker.js, src/knowledge.js; the builder (its turn, the join, src/glue.js, src/linker.js, src/interfaces.js, src/worker-output.js, src/inflate.js, src/assembly.js, src/assembly-gate.js, src/code-work.js, src/baseline-linker.js).` },
  { key: 'compiler', area: `The compiler and the boxes: in src/index.js the compilers (compileLevel and what it calls), what a compiler sends where, and judging documents (judgeRuns); src/checks.js, src/box.js, src/box-prewarm.js, src/box-probe.js, src/toolchains.js, src/packages.js, src/build-executor.js, src/build-verification.js; container/ (everything that runs in a box).` },
  { key: 'edges', area: `The room's edges: src/bench.js, src/bench-run.js, src/bench-harness.js, src/fetcher.js and reading linked sources, src/room-inputs.js, src/base.js, src/github-export.js, src/artifact-store.js, src/memory-fs.js, src/zip.js, src/api-coverage.js, the HTTP API routes in src/index.js, and the wrangler config.` },
  { key: 'records', area: `The dashboard and the records: public/ (app.js, index.html, styles.css), README.md, docs/ (how-it-works.md, trying-v8.md, owner/rulings.md), CHANGELOG-v8.md, every text a model reads (src/prompts.js and wherever else model text is built), and test/ (tests that pin behaviour the owner ruled out). You are also the catch-all: anything in the repo outside the other five areas.` },
]
const AREAS = TEAMS.map(t => `- ${t.key}: ${t.area}`).join('\n')

const FINDING = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    kind: { type: 'string', enum: ['drift', 'extra', 'record', 'unfixed'] },
    file: { type: 'string' },
    line: { type: 'integer' },
    live: { type: 'boolean', description: 'true if a v8 run reaches this code' },
    owner_date: { type: 'string' },
    owner_quote: { type: 'string' },
    code_does: { type: 'string' },
    fix: { type: 'string' },
    ledger_id: { type: 'string', description: 'for kind unfixed: the drift.md id' },
  },
  required: ['title', 'kind', 'file', 'line', 'live', 'owner_date', 'owner_quote', 'code_does', 'fix'],
}
const HUNT = {
  type: 'object',
  properties: {
    rechecks: {
      type: 'array',
      description: 'one entry per drift.md item under "Fixed, awaiting recheck" or "Disputed"',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          closed: { type: 'boolean', description: 'fixed item: true if the code now honours the owner fully. disputed item: true if Claude is right that the owner\'s words do not require the change' },
          evidence: { type: 'string' },
        },
        required: ['id', 'closed', 'evidence'],
      },
    },
    findings: { type: 'array', items: FINDING },
  },
  required: ['rechecks', 'findings'],
}
const VOTES = {
  type: 'object',
  properties: {
    votes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          real: { type: 'boolean' },
          duplicate_of: { type: 'string', description: 'key of an earlier finding in this list it duplicates, if any' },
          reason: { type: 'string' },
        },
        required: ['key', 'real', 'reason'],
      },
    },
  },
  required: ['votes'],
}

const scope = t => `Your team: ${t.key}. Your area:\n${t.area}\n\nThe six areas, so you know where yours ends:\n${AREAS}\n\nHunt only in your area; read outside it only to follow a call or confirm whether something is live. A finding belongs to the area of the file it cites.`

const huntPrompt = (t, l) => `${COMMON}\n\n${scope(t)}\n\n${l.prompt}\n\nThis is round ${round}. First recheck every drift.md item under "Fixed, awaiting recheck" whose cited file is in your area (the records team also takes any item no other area covers): read the code now and say whether the owner's words are honoured (closed=false if only partly). Then judge every drift.md item under "Disputed" in your area: read the owner's words in context, including what Claude asked or proposed just before them, and say whether Claude's dispute holds (closed=true) or the finding stands (closed=false). Default to closed=false when unsure.`

const judgePrompt = (t, l, list) => `${COMMON}\n\n${scope(t)}\n\nYou are now a judge on your team's quorum. Your lens was: ${l.prompt}\n\nJudge every finding below, including ones your own lens found. For each: open prompts.md and confirm the quote is the owner's and says what is claimed (in context, and not overridden by a later prompt); open the code at the cited place and confirm it does what is claimed. real=true only if both hold and the fix follows from the owner's words. Default to real=false when you can't verify. Mark duplicate_of when two findings are the same issue.\n\n${list}`

const render = fs => fs.map(f => `### ${f.key} (${f.kind}, found by ${f.by})\n${f.title}\n- code: ${f.file}:${f.line} (${f.live ? 'live' : 'not live'}): ${f.code_does}\n- owner, ${f.owner_date}: "${f.owner_quote}"\n- fix: ${f.fix}`).join('\n\n')

// Each team hunts and judges on its own; a fast team doesn't wait for a slow one.
const teams = await pipeline(TEAMS,
  t => parallel(LENSES.map(l => () => agent(huntPrompt(t, l), { label: `hunt:${t.key}:${l.key}`, phase: 'Hunt', schema: HUNT }))),
  async (hunts, t) => {
    const findings = []
    hunts.forEach((h, i) => (h ? h.findings : []).forEach((f, j) => findings.push({ ...f, key: `${t.key}/${LENSES[i].key}-${j + 1}`, by: `${t.key}/${LENSES[i].key}`, team: t.key })))
    const rechecks = []
    hunts.forEach((h, i) => (h ? h.rechecks : []).forEach(r => rechecks.push({ by: `${t.key}/${LENSES[i].key}`, ...r })))
    const missing = LENSES.filter((l, i) => !hunts[i]).map(l => `${t.key}/${l.key}`)
    if (!findings.length) return { team: t.key, judged: [], rechecks, missing }
    const ballots = await parallel(LENSES.map(l => () => agent(judgePrompt(t, l, render(findings)), { label: `judge:${t.key}:${l.key}`, phase: 'Quorum', schema: VOTES })))
    const tally = {}
    ballots.forEach((b, i) => (b ? b.votes : []).forEach(v => { (tally[v.key] = tally[v.key] || []).push({ by: `${t.key}/${LENSES[i].key}`, ...v }) }))
    const judged = findings.map(f => {
      const vs = tally[f.key] || []
      const dups = vs.map(v => v.duplicate_of).filter(d => d && d !== f.key)
      return { ...f, yes: vs.filter(v => v.real).length, votes: vs, dup_target: dups.find(d => dups.filter(x => x === d).length >= 2) }
    })
    // A confirmed finding folds into the one it duplicates only when that one is confirmed and not itself folded,
    // so mutual duplicates keep one of the pair and a duplicate of a rejected finding stands on its own votes.
    const byKey = Object.fromEntries(judged.map(f => [f.key, f]))
    const folded = new Map()
    for (const f of judged) {
      const tt = f.yes >= 2 && byKey[f.dup_target]
      if (tt && tt.yes >= 2 && !folded.has(tt.key)) folded.set(f.key, tt.key)
    }
    judged.forEach(f => { f.folded_into = folded.get(f.key) })
    if (ballots.some(b => !b)) missing.push(...LENSES.filter((l, i) => !ballots[i]).map(l => `judge ${t.key}/${l.key}`))
    log(`${t.key}: ${judged.filter(f => f.yes >= 2 && !f.folded_into).length} confirmed of ${judged.length}`)
    return { team: t.key, judged, rechecks, missing }
  })

const done = teams.filter(Boolean)
const missing = [...TEAMS.filter((t, i) => !teams[i]).map(t => `team ${t.key}`), ...done.flatMap(t => t.missing)]
if (missing.length) log(`agents that returned nothing: ${missing.join(', ')}`)

// An item closes when at least 2 checked it closed and they are the majority of everyone who checked it.
const byItem = {}
done.flatMap(t => t.rechecks).forEach(r => { (byItem[r.id] = byItem[r.id] || []).push(r) })
const fixes = Object.entries(byItem).map(([id, vs]) => {
  const closed = vs.filter(v => v.closed).length
  return { id, closed: closed >= 2 && closed * 2 > vs.length, votes: vs }
})

const all = done.flatMap(t => t.judged)
let confirmed = all.filter(f => f.yes >= 2 && !f.folded_into)
const rejected = all.filter(f => f.yes < 2).map(f => ({ key: f.key, title: f.title, file: f.file, line: f.line, reasons: f.votes.map(v => `${v.by}: ${v.reason}`) }))
const duplicates = all.filter(f => f.folded_into).map(f => ({ key: f.key, title: f.title, of: f.folded_into }))

// Two teams can find the same issue from two sides. One pass groups those; it only merges, it never confirms or rejects.
const teamsWith = new Set(confirmed.map(f => f.team))
if (teamsWith.size > 1) {
  phase('Merge')
  const groups = await agent(`Below are findings that red teams confirmed independently, each in its own area of the code. Group only findings that are the same issue: the same owner instruction broken by the same code (one fix would close both). Findings that cite the same owner words but different code are different issues. For each group of two or more, name the one to keep (the most complete). Read the code if you need to. Do not judge whether findings are real; they are confirmed.\n\n${render(confirmed)}`,
    { label: 'merge', phase: 'Merge', schema: { type: 'object', properties: { groups: { type: 'array', items: { type: 'object', properties: { keep: { type: 'string' }, same: { type: 'array', items: { type: 'string' } } }, required: ['keep', 'same'] } } }, required: ['groups'] } })
  const live = new Set(confirmed.map(f => f.key))
  for (const g of (groups ? groups.groups : [])) {
    if (!live.has(g.keep)) continue
    for (const k of g.same) if (k !== g.keep && live.has(k)) { live.delete(k); duplicates.push({ key: k, title: all.find(f => f.key === k).title, of: g.keep, across_teams: true }) }
  }
  confirmed = confirmed.filter(f => live.has(f.key))
}
log(`round ${round}: ${confirmed.length} confirmed, ${rejected.length} rejected, ${duplicates.length} folded; ${fixes.filter(f => f.closed).length} of ${fixes.length} rechecked items closed`)
return { round, confirmed, rejected, duplicates, fixes, missing }
