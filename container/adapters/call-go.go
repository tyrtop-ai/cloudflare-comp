// Go call driver (call-native.mjs): a test file of the bundle file's own
// package, so its unexported functions are in scope and its main never runs;
// the test binary's TestMain reads steps as JSON lines on stdin and answers
// each as a JSON line. Each argument is decoded by encoding/json into the
// function's parameter type, which reflect reads from the function value (an
// interface with methods: the one type the file declares that implements it).
package __CALL_PACKAGE__

import (
	__bufio "bufio"
	__json "encoding/json"
	__fmt "fmt"
	__os "os"
	__reflect "reflect"
	__debug "runtime/debug"
	__syscall "syscall"
	__testing "testing"
)

// The named types the file declares (call-go-types.go).
var __callTypes = []__reflect.Type{
/*__CALL_TYPES__*/
}

func TestMain(*__testing.M) {
	__callMain(map[string]any{
/*__CALL_NAMES__*/
	})
}

type __callArg struct {
	JSON  __json.RawMessage `json:"json"`
	Saved *string           `json:"saved"`
}

type __callStep struct {
	Call string      `json:"call"`
	Args []__callArg `json:"args"`
	Save string      `json:"save"`
}

func __callMain(fns map[string]any) {
	// The protocol keeps the process's stdout; the file's own output goes to stderr.
	fd, err := __syscall.Dup(1)
	if err != nil {
		panic(err)
	}
	__syscall.Dup3(2, 1, 0)
	out := __os.NewFile(uintptr(fd), "protocol")
	__os.Stdout = __os.Stderr
	emit := func(r map[string]any) {
		b, err := __json.Marshal(r)
		if err != nil {
			b, _ = __json.Marshal(map[string]any{"ok": false, "error": err.Error()})
		}
		out.Write(append(b, '\n'))
	}
	emit(map[string]any{"loaded": true})
	saved := map[string]__reflect.Value{}
	in := __bufio.NewReader(__os.Stdin)
	for {
		line, err := in.ReadBytes('\n')
		var s __callStep
		if len(line) > 0 && __json.Unmarshal(line, &s) == nil {
			emit(__callRun(fns[s.Call], s, saved))
		}
		if err != nil {
			break
		}
	}
	emit(map[string]any{"done": true})
	__os.Exit(0)
}

var __callError = __reflect.TypeOf((*error)(nil)).Elem()

// A type encoding/json cannot decode into: a function, a channel, an
// unsafe pointer or a complex number.
func __callUnbuildable(t __reflect.Type) bool {
	switch t.Kind() {
	case __reflect.Func, __reflect.Chan, __reflect.UnsafePointer, __reflect.Complex64, __reflect.Complex128:
		return true
	}
	return false
}

// What an interface with methods is built as: the one type the file
// declares (or a pointer to it) that implements it, else why there is none.
func __callImplementor(t __reflect.Type) (__reflect.Type, string) {
	var found []__reflect.Type
	for _, k := range __callTypes {
		if k.Kind() == __reflect.Interface {
			continue
		}
		if k.Implements(t) {
			found = append(found, k)
		} else if p := __reflect.PointerTo(k); p.Implements(t) {
			found = append(found, p)
		}
	}
	if len(found) == 1 {
		return found[0], ""
	}
	if len(found) == 0 {
		return nil, "no type the file declares implements it"
	}
	return nil, __fmt.Sprintf("the JSON does not say which of %v it is", found)
}

func __callJSON(v __reflect.Value) __json.RawMessage {
	if !v.IsValid() {
		return __json.RawMessage("null")
	}
	b, err := __json.Marshal(v.Interface())
	if err != nil {
		b, _ = __json.Marshal(__fmt.Sprintf("%+v", v.Interface()))
	}
	return b
}

func __callRun(fn any, s __callStep, saved map[string]__reflect.Value) (rec map[string]any) {
	f := __reflect.ValueOf(fn)
	if !f.IsValid() || f.Kind() != __reflect.Func || f.IsNil() {
		return map[string]any{"ok": false, "missing": true, "detail": __fmt.Sprintf("%s is a %T, not a function", s.Call, fn)}
	}
	t, n := f.Type(), len(s.Args)
	if (t.IsVariadic() && n < t.NumIn()-1) || (!t.IsVariadic() && n != t.NumIn()) {
		return map[string]any{"ok": false, "error": __fmt.Sprintf("%s has %d parameters (%s); the call gives %d arguments", s.Call, t.NumIn(), t, n)}
	}
	args := make([]__reflect.Value, n)
	for i, a := range s.Args {
		var pt __reflect.Type
		if t.IsVariadic() && i >= t.NumIn()-1 {
			pt = t.In(t.NumIn() - 1).Elem()
		} else {
			pt = t.In(i)
		}
		if a.Saved != nil {
			if v, ok := saved[*a.Saved]; ok && v.IsValid() && v.Type().AssignableTo(pt) {
				args[i] = v
				continue
			}
		}
		bt := pt
		if pt.Kind() == __reflect.Interface && pt.NumMethod() > 0 {
			k, why := __callImplementor(pt)
			if k == nil {
				return map[string]any{"ok": false, "unsupported": true, "error": __fmt.Sprintf("the call adapter cannot build a %s from JSON: %s (argument %d of %s)", pt, why, i+1, s.Call)}
			}
			bt = k
		}
		if __callUnbuildable(bt) {
			return map[string]any{"ok": false, "unsupported": true, "error": __fmt.Sprintf("the call adapter cannot build a %s from JSON (argument %d of %s)", pt, i+1, s.Call)}
		}
		p := __reflect.New(bt)
		if err := __json.Unmarshal(a.JSON, p.Interface()); err != nil {
			return map[string]any{"ok": false, "error": __fmt.Sprintf("argument %d of %s: %v", i+1, s.Call, err)}
		}
		args[i] = p.Elem()
	}
	defer func() {
		if r := recover(); r != nil {
			rec = map[string]any{"ok": false, "error": __fmt.Sprintf("panic: %v", r), "stack": string(__debug.Stack())}
		}
	}()
	outs := f.Call(args)
	if k := t.NumOut(); k > 0 && t.Out(k-1) == __callError {
		e := outs[k-1]
		outs = outs[:k-1]
		if !e.IsNil() {
			return map[string]any{"ok": false, "error": __fmt.Sprintf("error: %v", e.Interface())}
		}
	}
	var v __reflect.Value
	switch len(outs) {
	case 0:
	case 1:
		v = outs[0]
	default:
		list := make([]any, len(outs))
		for i, o := range outs {
			list[i] = o.Interface()
		}
		v = __reflect.ValueOf(list)
	}
	if s.Save != "" {
		saved[s.Save] = v
	}
	return map[string]any{"ok": true, "value": __callJSON(v)}
}
