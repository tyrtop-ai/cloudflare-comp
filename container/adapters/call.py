# Python call adapter (v8 §4.6): calls named functions of one bundle module
# in ONE process, step after step, keeping saved results, and reports each
# step as a JSON line. The runner (build-runner.mjs verifyCard) owns the
# comparison: steps arrive without their expectations, so a module can only
# pass by returning the right values.
#
# argv[1]: a file holding this run's nonce. It is read and deleted before the
# module loads, and every line this adapter prints carries it, so a module
# that prints its own lines or calls os._exit(0) cannot fake a step or the end.
# stdin (JSON lines): {"module":"<bundle path>","steps":[{call,args,save?}]}.
# stdout: {"nonce","step","ok":true,"value"} | {"nonce","step","ok":false,
# "error","stack"} per step, {"nonce","load":false,"error","stack"} when the
# module does not load, then {"nonce","done":true}.
import enum
import importlib
import importlib.util
import json
import os
import re
import sys
import traceback


def main():
    # The adapter's own folder is no import root: a bundle module named
    # call (or anything beside this file) must resolve inside the bundle.
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path[:] = [p for p in sys.path if os.path.abspath(p or ".") != here]
    nonce_file = sys.argv[1]
    with open(nonce_file, encoding="utf-8") as f:
        nonce = f.read().strip()
    os.unlink(nonce_file)
    # The module's own prints go to stderr: stdout is the protocol's.
    out = os.fdopen(os.dup(1), "w", encoding="utf-8")
    os.dup2(2, 1)
    sys.stdout = sys.stderr

    def emit(record):
        out.write(json.dumps({"nonce": nonce, **record}, default=to_json, ensure_ascii=False) + "\n")
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
    root = os.getcwd()
    absolute = os.path.join(root, module_path)
    directory = os.path.dirname(absolute)
    # The bundle root first (dotted imports), then the module's own folder
    # (a sibling imported by its bare name, as when the file runs as a script).
    for p in (directory, root):
        if p not in sys.path:
            sys.path.insert(0, p)
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
    main()
