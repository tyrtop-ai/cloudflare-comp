// B1: tiny synthetic benchmark tasks in each format (no real dataset rows).
export const HUMANEVAL = [
  {task_id: 'Toy/0', prompt: 'from typing import List\n\n\ndef total(xs: List[int]) -> int:\n    """Sum of the list.\n    >>> total([1, 2])\n    3\n    """\n', canonical_solution: '    return sum(xs)\n',
    test: '\n\nMETADATA = {}\n\n\ndef check(candidate):\n    assert candidate([4, 5, 6]) == 15  # toy-he-0-marker\n    assert candidate([]) == 0\n', entry_point: 'total'},
  {task_id: 'Toy/1', prompt: '\n\ndef shout(s: str):\n    """return s upper-cased"""\n    return s.upper()\n\n\ndef whisper(s: str, times: int = 1) -> str:\n    """Undo shout.\n    >>> whisper("AB")\n    \'ab\'\n    """\n',
    canonical_solution: '    return s.lower()\n', test: '\n\ndef check(candidate):\n    assert candidate(shout("qrs")) == "qrs"  # toy-he-1-marker\n', entry_point: 'whisper'},
  {task_id: 'Toy/2', prompt: '\ndef double(n):\n    """Twice n."""\n', canonical_solution: '    return 2 * n\n', test: '\ndef check(candidate):\n    assert candidate(21) == 42\n', entry_point: 'double'}
];
export const MBPP = [
  {task_id: 901, text: 'Write a function to cube a number.', code: 'def helper(x):\n    return x\n\ndef cube_it(n):\n    return helper(n) ** 3', test_list: ['assert cube_it(2) == 8', 'assert cube_it(3) == 27  # toy-mbpp-marker'], test_setup_code: '', challenge_test_list: []},
  {task_id: 902, prompt: 'Write a python function to join words with a dash.', code: 'def dash_join(words, sep="-"):\n    return sep.join(words)', test_imports: ['import math'], test_list: ['assert dash_join(["a", "b"]) == "a-b"']},
  {task_id: 903, text: 'Write a function to check whether a number is even.', code: 'def is_even(n): \n  return n % 2 == 0', test_list: ['assert is_even(4)', 'assert not is_even(7)'], test_setup_code: 'import os'}
];
export const MULTIPLE_JS = [
  {name: 'Toy_0_add_two', language: 'js', prompt: '//Add two numbers.\n// >>> add_two(1, 2)\n// 3\nfunction add_two(a, b){\n', doctests: 'transform', original: 'x.py', prompt_terminology: 'reworded',
    tests: "const assert = require('node:assert');\n\n\nfunction test() {\n  let candidate = add_two;\n  assert.deepEqual(candidate(40, 2),42); // toy-mjs-marker\n}\n\ntest();", stop_tokens: ['\nfunction ']},
  {name: 'Toy_1_rev', language: 'js', prompt: '//Reverse a string.\nfunction rev(s){\n', tests: "const assert = require('node:assert');\nfunction test() {\n  let candidate = rev;\n  assert.deepEqual(candidate('abc'),'cba');\n}\ntest();", stop_tokens: []},
  {name: 'Toy_2_neg', language: 'js', prompt: '//Negate.\nfunction neg(n){\n', tests: "const assert = require('node:assert');\nfunction test() {\n  assert.equal(neg(3), -3);\n}\ntest();", stop_tokens: []},
  {name: 'Toy_3_rs', language: 'rs', prompt: '/// Add\nfn add(a: i64) -> i64 {\n', tests: 'fn main() {}', stop_tokens: []}
];
export const GENERIC = [
  {id: 'g-py', language: 'python', prompt: 'Write a function triple(n) that returns three times n.', entry: 'triple', tests: 'assert triple(3) == 9\nassert candidate(1) == 3  # toy-generic-marker\n'},
  {id: 'g-js', prompt: 'Complete:\nfunction greet(name) {\n  // returns "hi <name>"\n}\n', tests: "require('node:assert').equal(greet('ann'), 'hi ann');"},
  {id: 'g-check', prompt: 'def inc(n):\n    """n plus one"""\n', tests: ['def check(candidate):', '    assert candidate(1) == 2']},
  {id: 'g-none', prompt: 'Make something nice.', tests: 'assert True'}
];
