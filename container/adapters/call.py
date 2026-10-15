# Python call adapter (v8 §4.6): calls named functions of one bundle module
# in ONE process, step after step, keeping saved results, and reports each
# step as a JSON line. The runner (build-runner.mjs verifyCard) owns the
# comparison: steps arrive without their expectations.
#
# Two processes. The SUPERVISOR (this file run as `call.py <nonce-file>`)
# never imports bundle code: it reads this run's nonce from the file, deletes
# it, starts the WORKER (`call.py --worker`, a fresh interpreter that never
# held the nonce), forwards the request, and re-emits each worker record with
# the nonce attached. It reports the end ({"done":true}) only when the worker
# answered every step and then exited 0 by itself; a module that calls
# os._exit() or sys.exit() at import or in a step never produces a done.
# stdin: {"module":"<bundle path>","steps":[{call,args,save?}]} (JSON lines).
# stdout: {"nonce","step","ok":true,"value"} | {"nonce","step","ok":false,
# "error","stack"} per step, {"nonce","load":false,"error","stack"} when the
# module does not load, {"nonce","worker_exit":N} when the worker died, then
# {"nonce","done":true}.
#
# KNOWN LIMIT. The worker runs bundle code, so that code controls what the
# worker reports: a module that already knows a step's expected value can
# hard-code it, or patch the worker's reporting to claim it. No adapter can
# stop that; the defence is that a requirement's check (its args, expected
# values and steps) is never shown to the agents that write the code, only
# the contract's own examples (S4b). What the split does guarantee: the
# module cannot read the nonce (it is never in the worker's memory, and the
# file is gone before the worker starts), so it cannot write records past
# the supervisor or claim the end, and an early exit is always a failure.
import json
import os
import re
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))


def supervise():
    nonce_file = sys.argv[1]
    with open(nonce_file, encoding="utf-8") as f:
        nonce = f.read().strip()
    os.unlink(nonce_file)
    out = sys.stdout

    def emit(record):
        out.write(json.dumps({"nonce": nonce, **record}, ensure_ascii=False) + "\n")
        out.flush()

    request = sys.stdin.read()
    # v8 S5 review: the worker starts isolated too (-I: no PYTHON* variables,
    # no user site, no script or working folder on sys.path), so no bundle
    # file can stand in for a standard module; load() adds the bundle root
    # after the standard library.
    worker = subprocess.Popen([sys.executable, "-I", "-X", "utf8", "-B", os.path.abspath(__file__), "--worker"],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=None)
    worker.stdin.write(request.encode("utf-8"))
    worker.stdin.close()
    done = False
    for raw in worker.stdout:
        try:
            record = json.loads(raw)
        except ValueError:
            continue
        if not isinstance(record, dict):
            continue
        if record.get("done") is True:
            done = True
            continue
        if done:
            continue  # nothing counts after the worker's end
        if isinstance(record.get("step"), int) and not isinstance(record.get("step"), bool):
            clean = {"step": record["step"], "ok": record.get("ok") is True}
            for key in ("value", "error", "stack", "missing"):
                if key in record:
                    clean[key] = record[key]
            emit(clean)
        elif record.get("load") is False:
            emit({"load": False, "error": str(record.get("error", ""))[:2000], "stack": str(record.get("stack", ""))[-4000:]})
    code = worker.wait()
    if code != 0:
        emit({"worker_exit": code})
    elif done:
        emit({"done": True})


def work():
    # The adapter's own folder is no import root: a bundle module named
    # call (or anything beside this file) must resolve inside the bundle.
    sys.path[:] = [p for p in sys.path if os.path.abspath(p or ".") != HERE]
    import traceback
    # The module's own prints go to stderr: stdout is the protocol's.
    out = os.fdopen(os.dup(1), "w", encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    dumps = json.dumps

    def emit(record):
        out.write(dumps(record, default=to_json, ensure_ascii=False) + "\n")
        out.flush()

    lines = [l for l in sys.stdin.read().split("\n") if l.strip()]
    request = json.loads(lines[0]) if lines else {}
    steps = list(request.get("steps") or []) + [json.loads(l) for l in lines[1:]]
    module_path = str(request.get("module") or "")

    try:
        module = load(module_path)
    except BaseException as e:  # SyntaxError, ImportError, SystemExit at import
        emit({"load": False, "error": error_text(e), "stack": traceback.format_exc()[-4000:]})
        emit({"done": True})
        return
    loop = None  # one event loop for every awaited step, made on first use
    saved = {}
    for i, step in enumerate(steps):
        name = step.get("call")
        fn = getattr(module, name, None) if isinstance(name, str) else None
        if not callable(fn):
            names = [n for n, v in vars(module).items() if callable(v) and not n.startswith("_")
                     and getattr(v, "__module__", None) == module.__name__][:12]
            emit({"step": i, "ok": False, "missing": True,
                  "error": f"{module_path} has no function {name} (it defines: {', '.join(names) or 'no functions'})", "stack": ""})
            continue
        try:
            args = [substitute(a, saved) for a in (step.get("args") or [])]
            value = fn(*args)
            if hasattr(value, "__await__"):
                # asyncio is imported only when a step returns an awaitable:
                # its import is most of the adapter's start-up time.
                import asyncio
                loop = loop or asyncio.new_event_loop()
                value = loop.run_until_complete(value)
            if isinstance(step.get("save"), str) and step["save"]:
                saved[step["save"]] = value
            emit({"step": i, "ok": True, "value": plain(value)})
        except BaseException as e:  # a step's SystemExit is its failure, not the adapter's end
            emit({"step": i, "ok": False, "error": error_text(e), "stack": traceback.format_exc()[-4000:]})
    emit({"done": True})


def load(module_path):
    import importlib
    import importlib.util
    root = os.getcwd()
    absolute = os.path.join(root, module_path)
    directory = os.path.dirname(absolute)
    # v8 S5 review: the bundle root (dotted imports, the runtime's root shims)
    # and, for a file placed in a folder outside components/, that folder (a
    # sibling read by its bare name, as when the file runs as a script): both
    # AFTER the standard library, so no bundle file shadows a standard module.
    # A piece's own files refer to each other relatively (the linker's form).
    extra = [root]
    if not module_path.startswith("components/") and directory != root:
        extra.append(directory)
    for p in extra:
        if p not in sys.path:
            sys.path.append(p)
    parts = module_path[:-3].split("/") if module_path.endswith(".py") else []
    if parts and all(p and "." not in p for p in parts):
        return importlib.import_module(".".join(parts))
    spec = importlib.util.spec_from_file_location("bundle_module", absolute)
    if spec is None or spec.loader is None:
        raise ImportError(f"cannot load {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["bundle_module"] = module
    spec.loader.exec_module(module)
    return module


SAVED = re.compile(r"^\$([A-Za-z_]\w*)((?:\.[A-Za-z0-9_]+)*)$")


def substitute(arg, saved):
    """"$name" or "$name.field.0" reads a saved result; other values pass through."""
    if isinstance(arg, str):
        m = SAVED.match(arg)
        if not m or m.group(1) not in saved:
            return arg
        value = saved[m.group(1)]
        for key in m.group(2).split(".")[1:]:
            value = read_field(value, key)
        return value
    if isinstance(arg, list):
        return [substitute(a, saved) for a in arg]
    if isinstance(arg, dict):
        return {k: substitute(v, saved) for k, v in arg.items()}
    return arg


def read_field(value, key):
    if value is None:
        return None
    if isinstance(value, dict):
        return value.get(key)
    if isinstance(value, (list, tuple)) and key.isdigit():
        i = int(key)
        return value[i] if i < len(value) else None
    return getattr(value, key, None)


def to_json(o):
    if hasattr(o, "__dataclass_fields__") and not isinstance(o, type):
        import dataclasses
        return dataclasses.asdict(o)
    import enum
    if isinstance(o, enum.Enum):
        return o.value
    if isinstance(o, (set, frozenset)):
        return sorted(o, key=repr)
    if isinstance(o, (bytes, bytearray)):
        return o.decode("utf-8", "replace")
    if hasattr(o, "__dict__"):
        return {k: v for k, v in vars(o).items() if not k.startswith("_")}
    return repr(o)


def plain(value):
    """The value as JSON data: tuples as lists, objects by their fields."""
    try:
        return json.loads(json.dumps(value, default=to_json))
    except (ValueError, TypeError, RecursionError):
        return repr(value)


def error_text(e):
    return f"{type(e).__name__}: {e}"


if __name__ == "__main__":
    if sys.argv[1:2] == ["--worker"]:
        work()
    else:
        supervise()
