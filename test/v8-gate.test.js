// The grep gate (no-card, "Done when"): the code of the v8 paths names no
// card, and none of v7's top-of-tree helpers (isTop), its shared role
// preamble (PRINCIPLES), its manager model (decideProblems) or its prompt
// handlers. v7 keeps its own paths: a hit is allowed only inside a method
// only v7 runs, or, in a method both run, on a line that v7 gates.
// Comments and string text are not code and are left out.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';

const root = new URL('../', import.meta.url);
const FILES = [...readdirSync(new URL('src/', root)).filter(f => f.endsWith('.js')).map(f => `src/${f}`), 'container/build-runner.mjs'];
const NAMES = /(?<![a-z])card|Card|(?<![A-Za-z])CARD|_card|isTop\(|PRINCIPLES|decideProblems|prompt_handlers/g;
// Methods only the v7 pipeline runs (a v8 room's turns are levelTurn's).
const V7_ONLY = new Set(['view', 'solveProblems', 'decisionContext', 'askManagerModel', 'managerModelInput', 'promiseAdds', 'exhaustRounds', 'admitChildren', 'managerTurn', 'agentTurn']);
// Methods both pipelines run: a hit stands on a line v7 gates.
const SHARED = new Set(['snapshot', 'integrationEnabled', 'putFile']);
const V7_GATE = /!this\.v8\(\)|this\.v8\(\)\?/;
// Where the v7 helpers themselves live.
const OWNERS = [['src/model.js', 'decideProblems'], ['src/index.js', '(import)']];

// Code with comments and string text left out (a regex literal and a template's text too; a template's ${} stays code).
function strip(s) {
  let out = '', i = 0;
  const n = s.length;
  const regexAhead = () => { let j = out.length - 1; while (j >= 0 && /\s/.test(out[j])) j--; return j < 0 || /[(,=:[!&|?{};+\-*%<>~^]/.test(out[j]) || /\breturn$/.test(out.slice(Math.max(0, j - 6), j + 1)); };
  while (i < n) {
    const c = s[i], d = s[i + 1];
    if (c === '/' && d === '/') { while (i < n && s[i] !== '\n') i++; continue; }
    if (c === '/' && d === '*') { const end = s.indexOf('*/', i + 2); out += s.slice(i, end + 2).replace(/[^\n]/g, ''); i = end + 2; continue; }
    if (c === '"' || c === "'") { i++; while (i < n && s[i] !== c) { if (s[i] === '\\') i++; i++; } i++; out += '""'; continue; }
    if (c === '`') {
      i++; out += '`';
      while (i < n) {
        if (s[i] === '\\') { i += 2; continue; }
        if (s[i] === '`') { i++; break; }
        if (s[i] === '$' && s[i + 1] === '{') {
          i += 2; let depth = 1, expr = '';
          while (i < n && depth) { const e = s[i]; if (e === '{') depth++; else if (e === '}' && !--depth) { i++; break; } expr += e; i++; }
          out += '${' + strip(expr) + '}'; continue;
        }
        if (s[i] === '\n') out += '\n';
        i++;
      }
      out += '`'; continue;
    }
    if (c === '/' && regexAhead()) {
      i++; let cls = false;
      while (i < n) { const e = s[i]; if (e === '\\') { i += 2; continue; } if (e === '[') cls = true; else if (e === ']') cls = false; else if (e === '/' && !cls) { i++; break; } else if (e === '\n') break; i++; }
      while (/[a-z]/.test(s[i] || '')) i++;
      out += '/r/'; continue;
    }
    out += c; i++;
  }
  return out;
}
// Each hit with its file, line and enclosing method (a class method, a function or a top-level const).
function hits() {
  const out = [];
  for (const file of FILES) {
    let method = '(top)';
    strip(readFileSync(new URL(file, root), 'utf8')).split('\n').forEach((line, i) => {
      const m = /^  (?:async |static |get |set )?\*?([A-Za-z_$][\w$]*)\s*\(.*\)\s*\{/.exec(line) || /^(?:export )?(?:async )?function\*? ?([A-Za-z_$][\w$]*)/.exec(line) || /^(?:export )?const ([A-Za-z_$][\w$]*)\s*=/.exec(line);
      if (m) method = m[1];
      if (/^import\b/.test(line)) method = '(import)';
      const found = line.match(NAMES);
      if (found) out.push({file, line: i + 1, method, names: [...new Set(found)], text: line.trim()});
      if (/^import\b/.test(line)) method = '(top)';
    });
  }
  return out;
}

test('grep gate: the v8 code paths name no card, isTop(, PRINCIPLES, decideProblems or prompt_handlers; v7 keeps its own', () => {
  const all = hits();
  const outside = all.filter(h => !(V7_ONLY.has(h.method) || SHARED.has(h.method) && V7_GATE.test(h.text) || OWNERS.some(([f, m]) => f === h.file && m === h.method)));
  assert.deepEqual(outside.map(h => `${h.file}:${h.line} ${h.method}: ${h.names.join(' ')}`), []);
  // No card anywhere in the code, v7's included.
  assert.deepEqual(all.filter(h => h.names.some(x => /card/i.test(x))).map(h => `${h.file}:${h.line}`), []);
});

test('grep gate: the strip keeps code and drops comments and string text', () => {
  assert.equal(strip("const a = 'card'; // card\nconst b = `x ${card} y`; /* card */"), 'const a = ""; \nconst b = `${card}`; ');
  assert.equal(strip('const r = /card/g, d = a / b;'), 'const r = /r/, d = a / b;');
});
