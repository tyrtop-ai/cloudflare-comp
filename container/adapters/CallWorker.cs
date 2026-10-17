// C# call worker (call-native.mjs builds it, call-csharp.mjs writes the
// driver): compiled by mcs into one program with the bundle's C# files
// (the file's folder and those under it, as an SDK project compiles them),
// its entry point this class. argv: <file> <own.dll>, own.dll being the
// file compiled alone against the program (so the classes the file declares
// are the compiler's answer). It loads those classes, then reads steps as
// JSON lines on stdin and answers each as a JSON line, as CallWorker.java
// does. A function is a method of a class the file declares (static, or of
// one instance made by the class's constructor without arguments), found
// by its name ("Method" or "Class.Method") and its number of parameters;
// each argument is built from its JSON as the parameter's declared type,
// read by reflection (a class by its fields and properties or the
// constructor its JSON names; an interface or abstract class as the one
// class of the program that implements it).
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Text;

[assembly: System.Runtime.CompilerServices.InternalsVisibleTo("/*__CALL_OWN__*/")]

namespace __CallCheck {
    public static class Worker {
        static TextWriter output;
        static readonly List<Type> own = new List<Type>();
        static Type[] program = new Type[0];
        static readonly CultureInfo inv = CultureInfo.InvariantCulture;

        // JSON: null, bool, string, Num (its text), List<object>, Dictionary<string, object> (in order: Keys).
        sealed class Num { public readonly string Text; public Num(string t) { Text = t; } }
        sealed class Obj { public readonly List<KeyValuePair<string, object>> Items = new List<KeyValuePair<string, object>>(); public object Get(string k) { foreach (var e in Items) if (e.Key == k) return e.Value; return null; } public bool Has(string k) { foreach (var e in Items) if (e.Key == k) return true; return false; } }
        sealed class Parser {
            readonly string t; int i;
            public Parser(string text) { t = text; }
            void Ws() { while (i < t.Length && char.IsWhiteSpace(t[i])) i++; }
            public object Val() {
                Ws();
                char c = t[i];
                if (c == 'n') { i += 4; return null; }
                if (c == 't') { i += 4; return true; }
                if (c == 'f') { i += 5; return false; }
                if (c == '"') return Str();
                if (c == '[') {
                    i++; var a = new List<object>(); Ws();
                    if (t[i] == ']') { i++; return a; }
                    for (;;) { a.Add(Val()); Ws(); if (t[i++] == ']') return a; }
                }
                if (c == '{') {
                    i++; var o = new Obj(); Ws();
                    if (t[i] == '}') { i++; return o; }
                    for (;;) { Ws(); string k = Str(); Ws(); i++; o.Items.Add(new KeyValuePair<string, object>(k, Val())); Ws(); if (t[i++] == '}') return o; }
                }
                int s = i;
                while (i < t.Length && "+-.eE0123456789".IndexOf(t[i]) >= 0) i++;
                return new Num(t.Substring(s, i - s));
            }
            string Str() {
                var b = new StringBuilder(); i++;
                while (t[i] != '"') {
                    char c = t[i++];
                    if (c != '\\') { b.Append(c); continue; }
                    char e = t[i++];
                    switch (e) {
                        case 'n': b.Append('\n'); break; case 't': b.Append('\t'); break; case 'r': b.Append('\r'); break;
                        case 'b': b.Append('\b'); break; case 'f': b.Append('\f'); break;
                        case 'u': b.Append((char) int.Parse(t.Substring(i, 4), NumberStyles.HexNumber)); i += 4; break;
                        default: b.Append(e); break;
                    }
                }
                i++; return b.ToString();
            }
        }
        static string Quote(string s) {
            var b = new StringBuilder("\"");
            foreach (char c in s) {
                if (c == '"') b.Append("\\\""); else if (c == '\\') b.Append("\\\\");
                else if (c < ' ') b.Append("\\u").Append(((int) c).ToString("x4")); else b.Append(c);
            }
            return b.Append('"').ToString();
        }

        // The JSON does not fit the parameter's type: the call's failure.
        sealed class Mismatch : Exception { public Mismatch(string m) : base(m) {} }
        // No way to build the parameter's type from JSON: this adapter's limit.
        sealed class Unsupported : Exception { public Unsupported(string m) : base(m) {} }
        static string Shown(object j) {
            return j == null ? "null" : j is bool ? "a boolean" : j is Num ? "a number" : j is string ? "a string" : j is List<object> ? "an array" : "an object";
        }
        static string Name(Type t) {
            if (!t.IsGenericType) return t.FullName ?? t.Name;
            string n = t.GetGenericTypeDefinition().FullName ?? t.Name;
            return n.Substring(0, n.IndexOf('`')) + "<" + string.Join(", ", t.GetGenericArguments().Select(Name)) + ">";
        }
        static Mismatch Mis(Type t, object j) { return new Mismatch("expected " + Name(t) + ", got " + Shown(j)); }

        // The JSON as C#'s own values, for a parameter of type object.
        static object Natural(object j) {
            var n = j as Num;
            if (n != null) { long l; if (long.TryParse(n.Text, NumberStyles.Integer, inv, out l)) return l; return double.Parse(n.Text, inv); }
            var a = j as List<object>;
            if (a != null) return a.Select(Natural).ToList();
            var o = j as Obj;
            if (o != null) { var d = new Dictionary<string, object>(); foreach (var e in o.Items) d[e.Key] = Natural(e.Value); return d; }
            return j;
        }
        static Type Generic(Type t, Type def) {
            if (t.IsGenericType && t.GetGenericTypeDefinition() == def) return t;
            foreach (var i in t.GetInterfaces()) if (i.IsGenericType && i.GetGenericTypeDefinition() == def) return i;
            return null;
        }
        static object Number(Num n, Type t, object j) {
            var s = NumberStyles.Float;
            try {
                if (t == typeof(int)) return int.Parse(n.Text, NumberStyles.Integer, inv);
                if (t == typeof(long)) return long.Parse(n.Text, NumberStyles.Integer, inv);
                if (t == typeof(short)) return short.Parse(n.Text, NumberStyles.Integer, inv);
                if (t == typeof(byte)) return byte.Parse(n.Text, NumberStyles.Integer, inv);
                if (t == typeof(sbyte)) return sbyte.Parse(n.Text, NumberStyles.Integer, inv);
                if (t == typeof(uint)) return uint.Parse(n.Text, NumberStyles.Integer, inv);
                if (t == typeof(ulong)) return ulong.Parse(n.Text, NumberStyles.Integer, inv);
                if (t == typeof(ushort)) return ushort.Parse(n.Text, NumberStyles.Integer, inv);
                if (t == typeof(double)) return double.Parse(n.Text, s, inv);
                if (t == typeof(float)) return float.Parse(n.Text, s, inv);
                if (t == typeof(decimal)) return decimal.Parse(n.Text, s, inv);
            } catch (FormatException) { throw Mis(t, j); } catch (OverflowException) { throw Mis(t, j); }
            throw new Unsupported("the call adapter cannot build a " + Name(t) + " from JSON");
        }

        static object Build(object j, Type t) {
            if (t.IsByRef) t = t.GetElementType();
            var under = Nullable.GetUnderlyingType(t);
            if (j == null) { if (t.IsValueType && under == null) throw Mis(t, j); return null; }
            if (under != null) return Build(j, under);
            if (t == typeof(object)) return Natural(j);
            if (t == typeof(bool)) { if (j is bool) return j; throw Mis(t, j); }
            if (t == typeof(char)) { var s = j as string; if (s != null && s.Length == 1) return s[0]; throw Mis(t, j); }
            if (t == typeof(string)) { if (j is string) return j; throw Mis(t, j); }
            if (t.IsEnum) {
                var s = j as string;
                if (s == null) throw Mis(t, j);
                if (!Enum.GetNames(t).Contains(s)) throw new Mismatch(Name(t) + " has no constant " + s);
                return Enum.Parse(t, s);
            }
            if (t.IsPrimitive || t == typeof(decimal)) { var n = j as Num; if (n == null) throw Mis(t, j); return Number(n, t, j); }
            if (typeof(Delegate).IsAssignableFrom(t)) throw new Unsupported("the call adapter cannot build a " + Name(t) + " from JSON");
            if (t.IsArray) {
                var a = j as List<object>;
                if (a == null) throw Mis(t, j);
                var e = t.GetElementType(); var arr = Array.CreateInstance(e, a.Count);
                for (int i = 0; i < a.Count; i++) arr.SetValue(Build(a[i], e), i);
                return arr;
            }
            var dict = Generic(t, typeof(IDictionary<,>)) ?? (t.IsGenericType && t.GetGenericTypeDefinition() == typeof(IReadOnlyDictionary<,>) ? t : null);
            if (dict != null) {
                var o = j as Obj;
                if (o == null) throw Mis(t, j);
                var kv = dict.GetGenericArguments();
                var concrete = t.IsInterface || t.IsAbstract ? typeof(Dictionary<,>).MakeGenericType(kv) : t;
                var m = (IDictionary) Activator.CreateInstance(concrete, true);
                foreach (var e in o.Items) m[kv[0] == typeof(string) || kv[0] == typeof(object) ? e.Key : Build(kv[0].IsPrimitive || kv[0] == typeof(decimal) ? (object) new Num(e.Key) : e.Key, kv[0])] = Build(e.Value, kv[1]);
                return m;
            }
            var seq = Generic(t, typeof(IEnumerable<>));
            if (seq != null) {
                var a = j as List<object>;
                if (a == null) throw Mis(t, j);
                var e = seq.GetGenericArguments()[0];
                Type concrete = t;
                if (t.IsInterface || t.IsAbstract) concrete = (t.IsGenericType && t.GetGenericTypeDefinition() == typeof(ISet<>) ? typeof(HashSet<>) : typeof(List<>)).MakeGenericType(e);
                var add = concrete.GetMethod("Add", new[] { e });
                if (add == null || concrete.GetConstructor(Type.EmptyTypes) == null) throw new Unsupported("the call adapter cannot build a " + Name(t) + " from JSON");
                var col = Activator.CreateInstance(concrete);
                foreach (var x in a) add.Invoke(col, new[] { Build(x, e) });
                return col;
            }
            // An interface or an abstract class: the one class of the program that implements it.
            if (t.IsInterface || t.IsAbstract) {
                var impl = program.Where(k => k != t && t.IsAssignableFrom(k) && !k.IsInterface && !k.IsAbstract && !k.IsGenericTypeDefinition).ToList();
                if (impl.Count == 1) return Build(j, impl[0]);
                throw new Unsupported("the call adapter cannot build a " + Name(t) + " from JSON (" + (impl.Count == 0 ? "no class of the program implements it" : "the JSON does not say which of " + string.Join(", ", impl.Select(Name).OrderBy(x => x, StringComparer.Ordinal)) + " it is") + ")");
            }
            const BindingFlags all = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
            // An object: by the constructor without arguments (a struct's default), each field or property set by its name;
            // else by the constructor whose parameters the object's keys name, or that takes the array's values.
            var obj = j as Obj;
            if (obj != null) {
                if (t.IsValueType || t.GetConstructor(all, null, Type.EmptyTypes, null) != null) {
                    object v = Activator.CreateInstance(t, true);
                    foreach (var e in obj.Items) {
                        var f = Field(t, e.Key);
                        if (f != null) { f.SetValue(v, Build(e.Value, f.FieldType)); continue; }
                        var p = Property(t, e.Key);
                        if (p == null) throw new Mismatch(Name(t) + " has no field " + e.Key);
                        p.SetValue(v, Build(e.Value, p.PropertyType), null);
                    }
                    return v;
                }
                foreach (var k in t.GetConstructors(all)) {
                    var ps = k.GetParameters();
                    if (ps.Length != obj.Items.Count || !ps.All(p => obj.Has(p.Name))) continue;
                    return k.Invoke(ps.Select(p => Build(obj.Get(p.Name), p.ParameterType)).ToArray());
                }
                throw new Mismatch(Name(t) + " has no constructor without arguments and none whose parameters are " + string.Join(", ", obj.Items.Select(e => e.Key).OrderBy(x => x, StringComparer.Ordinal)));
            }
            var list = j as List<object>;
            if (list != null) {
                Mismatch first = null;
                foreach (var k in t.GetConstructors(all)) {
                    var ps = k.GetParameters();
                    if (ps.Length != list.Count) continue;
                    object[] vals;
                    try { vals = ps.Select((p, i) => Build(list[i], p.ParameterType)).ToArray(); }
                    catch (Mismatch e) { if (first == null) first = e; continue; }
                    return k.Invoke(vals);
                }
                throw first ?? new Mismatch(Name(t) + " has no constructor of " + list.Count + " parameters");
            }
            throw Mis(t, j);
        }
        static FieldInfo Field(Type t, string name) {
            for (var k = t; k != null && k != typeof(object); k = k.BaseType) {
                var f = k.GetField(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly);
                if (f != null) return f;
            }
            return null;
        }
        static PropertyInfo Property(Type t, string name) {
            for (var k = t; k != null && k != typeof(object); k = k.BaseType) {
                var p = k.GetProperty(name, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly);
                if (p != null && p.GetIndexParameters().Length == 0 && p.GetSetMethod(true) != null) return p;
            }
            return null;
        }

        sealed class Same : IEqualityComparer<object> {
            public new bool Equals(object a, object b) { return ReferenceEquals(a, b); }
            public int GetHashCode(object o) { return System.Runtime.CompilerServices.RuntimeHelpers.GetHashCode(o); }
        }
        // A value as JSON text: an object of the program's classes by its public fields and properties.
        static string Json(object v, HashSet<object> seen) {
            if (v == null) return "null";
            if (v is bool) return (bool) v ? "true" : "false";
            if (v is int || v is long || v is short || v is byte || v is sbyte || v is uint || v is ulong || v is ushort) return Convert.ToString(v, inv);
            if (v is double || v is float) {
                double d = Convert.ToDouble(v, inv);
                if (double.IsNaN(d) || double.IsInfinity(d)) return "null";
                return d == Math.Floor(d) && Math.Abs(d) < 1e15 ? ((long) d).ToString(inv) : d.ToString("R", inv);
            }
            if (v is decimal) return ((decimal) v).ToString(inv);
            if (v is string || v is char) return Quote(v.ToString());
            if (v is Enum) return Quote(v.ToString());
            var type = v.GetType();
            if (!type.IsValueType) { if (seen.Contains(v)) return Quote("[Circular]"); seen.Add(v); }
            try {
                var dict = v as IDictionary;
                if (dict != null) { var parts = new List<string>(); foreach (DictionaryEntry e in dict) parts.Add(Quote(Convert.ToString(e.Key, inv)) + ":" + Json(e.Value, seen)); return "{" + string.Join(",", parts) + "}"; }
                var seq = v as IEnumerable;
                if (seq != null) { var parts = new List<string>(); foreach (var x in seq) parts.Add(Json(x, seen)); return "[" + string.Join(",", parts) + "]"; }
                if (program.Contains(type) || type.IsGenericType && program.Contains(type.GetGenericTypeDefinition())) {
                    var parts = new List<string>();
                    foreach (var f in type.GetFields(BindingFlags.Instance | BindingFlags.Public)) parts.Add(Quote(f.Name) + ":" + Json(f.GetValue(v), seen));
                    foreach (var p in type.GetProperties(BindingFlags.Instance | BindingFlags.Public)) if (p.GetIndexParameters().Length == 0 && p.GetGetMethod() != null) parts.Add(Quote(p.Name) + ":" + Json(p.GetValue(v, null), seen));
                    return "{" + string.Join(",", parts) + "}";
                }
                return Quote(v.ToString());
            } catch (Exception) {
                return Quote(Convert.ToString(v, inv));
            } finally { if (!type.IsValueType) seen.Remove(v); }
        }

        static void Emit(string record) { output.Write(record + "\n"); output.Flush(); }
        static Exception Inner(Exception e) {
            while ((e is TargetInvocationException || e is TypeInitializationException || e is AggregateException) && e.InnerException != null) e = e.InnerException;
            return e;
        }
        static string Failure(Exception e) { e = Inner(e); return "{\"ok\":false,\"error\":" + Quote(e.GetType().FullName + ": " + e.Message) + ",\"stack\":" + Quote(e.ToString()) + "}"; }

        public static int Main(string[] argv) {
            // The protocol keeps the process's stdout; the file's own output goes to stderr.
            output = new StreamWriter(Console.OpenStandardOutput(), new UTF8Encoding(false));
            Console.SetOut(Console.Error);
            program = typeof(Worker).Assembly.GetTypes().Where(k => k.Namespace != "__CallCheck").ToArray();
            try {
                // The classes the file declares: those of its own compile, by name, as the program has them; each initialised here (its load).
                Type[] declared;
                try { declared = Assembly.LoadFile(Path.GetFullPath(argv[1])).GetTypes(); }
                catch (ReflectionTypeLoadException e) { declared = e.Types.Where(x => x != null).ToArray(); }
                var names = new HashSet<string>(declared.Select(x => x.FullName));
                own.AddRange(program.Where(k => names.Contains(k.FullName)).OrderBy(k => k.FullName, StringComparer.Ordinal));
                foreach (var k in own) if (!k.IsGenericTypeDefinition) System.Runtime.CompilerServices.RuntimeHelpers.RunClassConstructor(k.TypeHandle);
            } catch (Exception e) {
                e = Inner(e);
                Emit("{\"load\":false,\"error\":" + Quote(e.GetType().FullName + ": " + e.Message) + ",\"stack\":" + Quote(e.ToString()) + "}");
                Emit("{\"done\":true}");
                return 0;
            }
            Emit("{\"loaded\":true}");
            var saved = new Dictionary<string, object>();
            var receivers = new Dictionary<Type, object>();
            var input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false));
            for (string line; (line = input.ReadLine()) != null; ) {
                if (line.Trim().Length == 0) continue;
                var step = (Obj) new Parser(line).Val();
                var args = (List<object>) step.Get("args") ?? new List<object>();
                Emit(Call((string) step.Get("call"), args, step.Get("save") as string, saved, receivers));
            }
            Emit("{\"done\":true}");
            return 0;
        }

        static string Call(string name, List<object> args, string save, Dictionary<string, object> saved, Dictionary<Type, object> receivers) {
            int dot = name.LastIndexOf('.');
            string cls = dot < 0 ? null : name.Substring(0, dot), method = name.Substring(dot + 1);
            var named = new List<MethodInfo>();
            var defined = new SortedSet<string>(StringComparer.Ordinal);
            const BindingFlags all = BindingFlags.Static | BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly;
            foreach (var c in own) foreach (var m in c.GetMethods(all)) {
                if (m.IsDefined(typeof(System.Runtime.CompilerServices.CompilerGeneratedAttribute), false)) continue;
                defined.Add(m.Name);
                if (m.Name == method && (cls == null || c.Name == cls || c.FullName == cls || c.FullName.Replace('+', '.') == cls)) named.Add(m);
            }
            if (named.Count == 0) return "{\"ok\":false,\"missing\":true,\"detail\":" + Quote("it defines: " + (defined.Count == 0 ? "no methods" : string.Join(", ", defined))) + "}";
            var fit = named.Where(m => Fits(m, args.Count)).ToList();
            if (fit.Count == 0) return "{\"ok\":false,\"error\":" + Quote(name + " has " + named[0].GetParameters().Length + " parameters; the call gives " + args.Count + " arguments") + "}";
            Exception first = null;
            foreach (var m in fit) {
                if (m.ContainsGenericParameters) { if (first == null) first = new Unsupported("the call adapter cannot call " + name + ", a generic method"); continue; }
                object[] values;
                try { values = Arguments(m, args, saved); }
                catch (Mismatch e) { if (first == null) first = e; continue; }
                catch (Unsupported e) { if (first == null || first is Mismatch) first = e; continue; }
                catch (Exception e) { first = new Unsupported("the call adapter cannot build the arguments of " + name + ": " + Inner(e).Message); continue; }
                object receiver = null;
                if (!m.IsStatic) {
                    var c = m.DeclaringType;
                    if (!receivers.TryGetValue(c, out receiver)) {
                        if (!c.IsValueType && c.GetConstructor(BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic, null, Type.EmptyTypes, null) == null || c.IsAbstract)
                            return "{\"ok\":false,\"unsupported\":true,\"error\":" + Quote("the call adapter cannot call " + name + ", an instance method of " + Name(c) + ", which has no constructor without arguments") + "}";
                        try { receiver = Activator.CreateInstance(c, true); receivers[c] = receiver; }
                        catch (Exception e) { return Failure(e); }
                    }
                }
                try {
                    object v = m.Invoke(receiver, values);
                    var task = v as System.Threading.Tasks.Task;
                    if (task != null) { task.Wait(); var r = task.GetType().GetProperty("Result"); v = r != null && task.GetType().IsGenericType ? r.GetValue(task, null) : null; }
                    if (!string.IsNullOrEmpty(save)) saved[save] = v;
                    return "{\"ok\":true,\"value\":" + (m.ReturnType == typeof(void) ? "null" : Json(v, new HashSet<object>(new Same()))) + "}";
                } catch (Exception e) { return Failure(e); }
            }
            return first is Unsupported ? "{\"ok\":false,\"unsupported\":true,\"error\":" + Quote(first.Message) + "}" : "{\"ok\":false,\"error\":" + Quote(first.Message) + "}";
        }
        static bool IsParams(ParameterInfo p) { return p.IsDefined(typeof(ParamArrayAttribute), false); }
        static bool Fits(MethodInfo m, int n) {
            var ps = m.GetParameters();
            int required = ps.Count(p => !p.IsOptional && !IsParams(p));
            return n >= required && (n <= ps.Length || ps.Length > 0 && IsParams(ps[ps.Length - 1]));
        }
        static object[] Arguments(MethodInfo m, List<object> args, Dictionary<string, object> saved) {
            var ps = m.GetParameters();
            bool rest = ps.Length > 0 && IsParams(ps[ps.Length - 1]);
            var values = new object[ps.Length];
            int fixedCount = rest ? ps.Length - 1 : ps.Length;
            for (int i = 0; i < fixedCount; i++) values[i] = i < args.Count ? Argument((Obj) args[i], ps[i].ParameterType, i, saved) : ps[i].DefaultValue;
            if (rest) {
                var e = ps[fixedCount].ParameterType.GetElementType();
                var arr = Array.CreateInstance(e, Math.Max(0, args.Count - fixedCount));
                for (int i = fixedCount; i < args.Count; i++) arr.SetValue(Argument((Obj) args[i], e, i, saved), i - fixedCount);
                values[fixedCount] = arr;
            }
            return values;
        }
        static object Argument(Obj arg, Type t, int i, Dictionary<string, object> saved) {
            var name = arg.Get("saved") as string;
            object v;
            if (name != null && saved.TryGetValue(name, out v)) {
                var u = t.IsByRef ? t.GetElementType() : t;
                if (v == null ? !u.IsValueType || Nullable.GetUnderlyingType(u) != null : u.IsInstanceOfType(v)) return v;
            }
            try { return Build(arg.Get("json"), t); }
            catch (Mismatch e) { throw new Mismatch("argument " + (i + 1) + ": " + e.Message); }
            catch (Unsupported e) { throw new Unsupported(e.Message + " (argument " + (i + 1) + ")"); }
        }
    }
}
