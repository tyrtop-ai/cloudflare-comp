<?php
// PHP call adapter (v8 §4.6), as call.mjs is JavaScript's: calls named
// functions of one bundle file in ONE process, step after step, keeping
// saved results, and reports each step as a JSON line. The runner
// (build-runner.mjs verifyChecks) owns the comparison: steps arrive without
// their expectations.
//
// argv[1]: a file holding this run's nonce. It is read and deleted before
// the file loads and kept in a static of a closure, which no loaded file can
// name. Every line this adapter prints carries it, written to a stdout
// handle opened BEFORE the file loads; the file's own output is buffered to
// stderr. The runner counts the end only when the done line arrives AND
// this process exits 0 by itself, so a file that exits early always fails.
// stdin (JSON lines): {"module":"<bundle path>","steps":[{call,args,save?}]}.
// stdout: as call.mjs's.
//
// A function is the name the file defines it by: a function it declares.
//
// KNOWN LIMIT: as call.mjs's. The file runs in this process, so it controls
// the values it returns; the defence is that a requirement's check is never
// shown to the agents that write the code (S4b).
//
// Everything below runs inside one closure, so the adapter holds no global
// a loaded file could read, and the file loads in a closure of its own.
(function () {
$emit = (function () {
    $nonce = trim(file_get_contents($GLOBALS['argv'][1]));
    unlink($GLOBALS['argv'][1]);
    $out = fopen('php://stdout', 'w');
    return function (array $record) use ($nonce, $out) {
        $text = '{"nonce":' . json_encode($nonce);
        foreach (['step', 'ok', 'load', 'missing', 'done'] as $k) if (array_key_exists($k, $record)) $text .= ',"' . $k . '":' . json_encode($record[$k]);
        foreach (['error', 'stack'] as $k) if (array_key_exists($k, $record)) $text .= ',"' . $k . '":' . json_encode((string)$record[$k], JSON_INVALID_UTF8_SUBSTITUTE);
        if (array_key_exists('value', $record)) $text .= ',"value":' . $record['value'];
        fwrite($out, $text . "}\n");
        fflush($out);
    };
})();
// The file's own output goes to stderr: stdout is the protocol's.
ini_set('display_errors', 'stderr');
ob_start(function ($buffer) { fwrite(STDERR, $buffer); return ''; }, 1);

$lines = array_values(array_filter(explode("\n", stream_get_contents(STDIN)), fn($l) => trim($l) !== ''));
$request = $lines ? json_decode($lines[0], true) : [];
$steps = array_merge(is_array($request['steps'] ?? null) ? $request['steps'] : [], array_map(fn($l) => json_decode($l, true), array_slice($lines, 1)));
$module = (string)($request['module'] ?? '');

$errorText = fn(Throwable $e) => get_class($e) . ': ' . $e->getMessage();
$toJson = function ($v) {
    $t = json_encode($v, JSON_PARTIAL_OUTPUT_ON_ERROR | JSON_INVALID_UTF8_SUBSTITUTE);
    return $t === false ? json_encode(var_export($v, true)) : $t;
};
$substitute = function ($arg, array $saved) use (&$substitute) {
    if (is_string($arg)) {
        if (!preg_match('/^\$([A-Za-z_]\w*)((?:\.[A-Za-z0-9_]+)*)$/', $arg, $m) || !array_key_exists($m[1], $saved)) return $arg;
        $v = $saved[$m[1]];
        foreach (array_slice(explode('.', $m[2]), 1) as $key) {
            if (is_array($v)) $v = $v[$key] ?? null;
            elseif (is_object($v)) $v = $v->$key ?? null;
            else $v = null;
        }
        return $v;
    }
    if (is_array($arg)) return array_map(fn($a) => $substitute($a, $saved), $arg);
    return $arg;
};

$before = get_defined_functions()['user'];
$root = getcwd();
$absolute = $root . '/' . $module;
set_include_path(get_include_path() . PATH_SEPARATOR . $root . PATH_SEPARATOR . dirname($absolute));
try {
    (function () use ($absolute) { require $absolute; })();
} catch (Throwable $e) { // a ParseError, an Error at load
    $emit(['load' => false, 'error' => $errorText($e), 'stack' => (string)$e]);
    $emit(['done' => true]);
    exit(0);
}
$defined = array_values(array_diff(get_defined_functions()['user'], $before));
$saved = [];
foreach ($steps as $i => $step) {
    $name = $step['call'] ?? null;
    if (!is_string($name) || !in_array(strtolower($name), $defined, true)) {
        $emit(['step' => $i, 'ok' => false, 'missing' => true, 'error' => "$module has no function $name (it defines: " . ($defined ? implode(', ', $defined) : 'no functions') . ')', 'stack' => '']);
        continue;
    }
    try {
        $args = array_map(fn($a) => $substitute($a, $saved), is_array($step['args'] ?? null) ? $step['args'] : []);
        $value = $name(...$args);
        if (is_string($step['save'] ?? null) && $step['save'] !== '') $saved[$step['save']] = $value;
        $emit(['step' => $i, 'ok' => true, 'value' => $toJson($value)]);
    } catch (Throwable $e) {
        $emit(['step' => $i, 'ok' => false, 'error' => $errorText($e), 'stack' => (string)$e]);
    }
}
$emit(['done' => true]);
exit(0);
})();
