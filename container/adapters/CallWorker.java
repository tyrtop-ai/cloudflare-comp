// Java call worker (call-native.mjs), run by the source launcher:
// `java CallWorker.java <file> <classes-dir> <source roots>`. It compiles
// the bundle file with Java's own compiler (javax.tools, which names the
// source each class comes from, so the classes the file declares are
// known), loads them, then reads steps as JSON lines on stdin and answers
// each as a JSON line. A function is a method of a class the file declares
// (static, or of one instance made by the class's constructor without
// arguments), found by its name ("method" or "Class.method") and its number
// of parameters; each argument is built from its JSON as the parameter's
// declared type, read by reflection.
import java.io.*;
import java.lang.reflect.*;
import java.math.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import javax.tools.*;

public class CallWorker {
    static PrintStream out;
    static final Map<String, String> sources = new HashMap<>(); // class name -> its source's path

    // JSON: null, Boolean, String, BigDecimal, List<Object>, LinkedHashMap<String,Object>.
    static final class Parser {
        final String t; int i;
        Parser(String t) { this.t = t; }
        void ws() { while (i < t.length() && Character.isWhitespace(t.charAt(i))) i++; }
        Object val() {
            ws();
            char c = t.charAt(i);
            if (c == 'n') { i += 4; return null; }
            if (c == 't') { i += 4; return Boolean.TRUE; }
            if (c == 'f') { i += 5; return Boolean.FALSE; }
            if (c == '"') return str();
            if (c == '[') {
                i++; List<Object> a = new ArrayList<>(); ws();
                if (t.charAt(i) == ']') { i++; return a; }
                for (;;) { a.add(val()); ws(); if (t.charAt(i++) == ']') return a; }
            }
            if (c == '{') {
                i++; Map<String, Object> o = new LinkedHashMap<>(); ws();
                if (t.charAt(i) == '}') { i++; return o; }
                for (;;) { ws(); String k = str(); ws(); i++; o.put(k, val()); ws(); if (t.charAt(i++) == '}') return o; }
            }
            int s = i;
            while (i < t.length() && "+-.eE0123456789".indexOf(t.charAt(i)) >= 0) i++;
            return new BigDecimal(t.substring(s, i));
        }
        String str() {
            StringBuilder b = new StringBuilder(); i++;
            while (t.charAt(i) != '"') {
                char c = t.charAt(i++);
                if (c != '\\') { b.append(c); continue; }
                char e = t.charAt(i++);
                switch (e) {
                    case 'n': b.append('\n'); break; case 't': b.append('\t'); break; case 'r': b.append('\r'); break;
                    case 'b': b.append('\b'); break; case 'f': b.append('\f'); break;
                    case 'u': b.append((char) Integer.parseInt(t.substring(i, i + 4), 16)); i += 4; break;
                    default: b.append(e);
                }
            }
            i++; return b.toString();
        }
    }
    static String quote(String s) {
        StringBuilder b = new StringBuilder("\"");
        for (char c : s.toCharArray()) {
            if (c == '"') b.append("\\\""); else if (c == '\\') b.append("\\\\");
            else if (c < 0x20) b.append(String.format("\\u%04x", (int) c)); else b.append(c);
        }
        return b.append('"').toString();
    }

    // The JSON does not fit the parameter's type: the call's failure.
    static final class Mismatch extends RuntimeException { Mismatch(String m) { super(m); } }
    // No way to build the parameter's type from JSON: this adapter's limit.
    static final class Unsupported extends RuntimeException { Unsupported(String m) { super(m); } }
    static String shown(Object j) {
        return j == null ? "null" : j instanceof Boolean ? "a boolean" : j instanceof BigDecimal ? "a number" : j instanceof String ? "a string" : j instanceof List ? "an array" : "an object";
    }
    static Mismatch mismatch(Type t, Object j) { return new Mismatch("expected " + t.getTypeName() + ", got " + shown(j)); }

    // The JSON as Java's own values, for a parameter of type Object.
    static Object natural(Object j) {
        if (j instanceof BigDecimal) { BigDecimal d = (BigDecimal) j; try { return d.longValueExact(); } catch (ArithmeticException e) { return d.doubleValue(); } }
        if (j instanceof List) { List<Object> a = new ArrayList<>(); for (Object x : (List<?>) j) a.add(natural(x)); return a; }
        if (j instanceof Map) { Map<String, Object> o = new LinkedHashMap<>(); for (Map.Entry<?, ?> e : ((Map<?, ?>) j).entrySet()) o.put((String) e.getKey(), natural(e.getValue())); return o; }
        return j;
    }

    @SuppressWarnings({"unchecked", "rawtypes"})
    static Object build(Object j, Type t) throws Exception {
        if (t instanceof WildcardType) return build(j, ((WildcardType) t).getUpperBounds()[0]);
        if (t instanceof TypeVariable) return build(j, ((TypeVariable<?>) t).getBounds()[0]);
        if (t instanceof GenericArrayType) {
            Type e = ((GenericArrayType) t).getGenericComponentType();
            if (!(j instanceof List)) throw mismatch(t, j);
            List<?> a = (List<?>) j; Object arr = Array.newInstance(raw(e), a.size());
            for (int i = 0; i < a.size(); i++) Array.set(arr, i, build(a.get(i), e));
            return arr;
        }
        Type[] params = t instanceof ParameterizedType ? ((ParameterizedType) t).getActualTypeArguments() : new Type[0];
        Class<?> c = raw(t);
        Type p0 = params.length > 0 ? params[0] : Object.class, p1 = params.length > 1 ? params[1] : Object.class;
        if (j == null) { if (c.isPrimitive()) throw mismatch(t, j); return c == Optional.class ? Optional.empty() : null; }
        if (c == Object.class) return natural(j);
        if (c == boolean.class || c == Boolean.class) { if (j instanceof Boolean) return j; throw mismatch(t, j); }
        if (c == char.class || c == Character.class) { if (j instanceof String && ((String) j).length() == 1) return ((String) j).charAt(0); throw mismatch(t, j); }
        if (c == String.class || c == CharSequence.class) { if (j instanceof String) return j; throw mismatch(t, j); }
        if (c.isPrimitive() || Number.class.isAssignableFrom(c)) {
            if (!(j instanceof BigDecimal)) throw mismatch(t, j);
            BigDecimal d = (BigDecimal) j;
            try {
                if (c == int.class || c == Integer.class) return d.intValueExact();
                if (c == long.class || c == Long.class) return d.longValueExact();
                if (c == short.class || c == Short.class) return d.shortValueExact();
                if (c == byte.class || c == Byte.class) return d.byteValueExact();
                if (c == double.class || c == Double.class) return d.doubleValue();
                if (c == float.class || c == Float.class) return d.floatValue();
                if (c == BigInteger.class) return d.toBigIntegerExact();
                if (c == BigDecimal.class || c == Number.class) return d;
            } catch (ArithmeticException e) { throw mismatch(t, j); }
            throw new Unsupported("the call adapter cannot build a " + t.getTypeName() + " from JSON");
        }
        if (c.isArray()) {
            if (!(j instanceof List)) throw mismatch(t, j);
            List<?> a = (List<?>) j; Object arr = Array.newInstance(c.getComponentType(), a.size());
            for (int i = 0; i < a.size(); i++) Array.set(arr, i, build(a.get(i), c.getComponentType()));
            return arr;
        }
        if (c.isEnum()) {
            if (!(j instanceof String)) throw mismatch(t, j);
            try { return Enum.valueOf((Class<Enum>) c, (String) j); } catch (IllegalArgumentException e) { throw new Mismatch(c.getName() + " has no constant " + j); }
        }
        if (c == Optional.class) return Optional.ofNullable(build(j, p0));
        if (Collection.class.isAssignableFrom(c) || c == Iterable.class) {
            if (!(j instanceof List)) throw mismatch(t, j);
            Collection<Object> col;
            if (!c.isInterface() && !Modifier.isAbstract(c.getModifiers())) col = (Collection<Object>) c.getDeclaredConstructor().newInstance();
            else if (SortedSet.class.isAssignableFrom(c)) col = new TreeSet<>();
            else if (Set.class.isAssignableFrom(c)) col = new LinkedHashSet<>();
            else if (Queue.class.isAssignableFrom(c)) col = new ArrayDeque<>();
            else col = new ArrayList<>();
            for (Object x : (List<?>) j) col.add(build(x, p0));
            return col;
        }
        if (Map.class.isAssignableFrom(c)) {
            if (!(j instanceof Map)) throw mismatch(t, j);
            Map<Object, Object> m;
            if (!c.isInterface() && !Modifier.isAbstract(c.getModifiers())) m = (Map<Object, Object>) c.getDeclaredConstructor().newInstance();
            else if (SortedMap.class.isAssignableFrom(c)) m = new TreeMap<>();
            else m = new LinkedHashMap<>();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) j).entrySet()) {
                String k = (String) e.getKey(); Class<?> kc = raw(p0);
                Object key = kc == String.class || kc == Object.class || kc == CharSequence.class ? k : build(Number.class.isAssignableFrom(kc) || kc.isPrimitive() ? (Object) new BigDecimal(k) : k, p0);
                m.put(key, build(e.getValue(), p1));
            }
            return m;
        }
        if (c.isRecord()) {
            if (!(j instanceof Map)) throw mismatch(t, j);
            Map<?, ?> o = (Map<?, ?>) j; RecordComponent[] rc = c.getRecordComponents();
            Object[] vals = new Object[rc.length]; Class<?>[] types = new Class<?>[rc.length];
            for (int i = 0; i < rc.length; i++) { vals[i] = build(o.get(rc[i].getName()), rc[i].getGenericType()); types[i] = rc[i].getType(); }
            Constructor<?> k = c.getDeclaredConstructor(types); k.setAccessible(true); return k.newInstance(vals);
        }
        // An object of a class: made by its constructor without arguments, each field set by its name.
        if (!c.isInterface() && !Modifier.isAbstract(c.getModifiers()) && j instanceof Map) {
            Constructor<?> k;
            try { k = c.getDeclaredConstructor(); } catch (NoSuchMethodException e) { throw new Unsupported("the call adapter cannot build a " + t.getTypeName() + " from JSON (it has no constructor without arguments)"); }
            k.setAccessible(true); Object v = k.newInstance();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) j).entrySet()) {
                Field f = field(c, (String) e.getKey());
                if (f == null) throw new Mismatch(c.getName() + " has no field " + e.getKey());
                f.setAccessible(true); f.set(v, build(e.getValue(), f.getGenericType()));
            }
            return v;
        }
        if (c.isInterface() || Modifier.isAbstract(c.getModifiers())) throw new Unsupported("the call adapter cannot build a " + t.getTypeName() + " from JSON");
        throw mismatch(t, j);
    }
    static Field field(Class<?> c, String name) {
        for (Class<?> k = c; k != null && k != Object.class; k = k.getSuperclass())
            for (Field f : k.getDeclaredFields()) if (f.getName().equals(name) && !Modifier.isStatic(f.getModifiers())) return f;
        return null;
    }
    static Class<?> raw(Type t) {
        if (t instanceof Class) return (Class<?>) t;
        if (t instanceof ParameterizedType) return (Class<?>) ((ParameterizedType) t).getRawType();
        if (t instanceof GenericArrayType) return Array.newInstance(raw(((GenericArrayType) t).getGenericComponentType()), 0).getClass();
        if (t instanceof WildcardType) return raw(((WildcardType) t).getUpperBounds()[0]);
        if (t instanceof TypeVariable) return raw(((TypeVariable<?>) t).getBounds()[0]);
        return Object.class;
    }

    // A value as JSON text: a record or an object of the bundle's classes by its fields.
    static String json(Object v, IdentityHashMap<Object, Boolean> seen) {
        if (v == null) return "null";
        if (v instanceof Boolean || v instanceof Integer || v instanceof Long || v instanceof Short || v instanceof Byte || v instanceof BigInteger) return v.toString();
        if (v instanceof Double || v instanceof Float) { double d = ((Number) v).doubleValue(); return Double.isFinite(d) ? (d == Math.rint(d) && Math.abs(d) < 1e15 ? Long.toString((long) d) : Double.toString(d)) : "null"; }
        if (v instanceof BigDecimal) return ((BigDecimal) v).toString();
        if (v instanceof Character || v instanceof CharSequence) return quote(v.toString());
        if (v instanceof Enum) return quote(((Enum<?>) v).name());
        if (v instanceof Optional) return ((Optional<?>) v).map(x -> json(x, seen)).orElse("null");
        if (seen.containsKey(v)) return quote("[Circular]");
        seen.put(v, true);
        try {
            StringJoiner s;
            if (v.getClass().isArray()) { s = new StringJoiner(",", "[", "]"); for (int i = 0; i < Array.getLength(v); i++) s.add(json(Array.get(v, i), seen)); return s.toString(); }
            if (v instanceof Iterable) { s = new StringJoiner(",", "[", "]"); for (Object x : (Iterable<?>) v) s.add(json(x, seen)); return s.toString(); }
            if (v instanceof Map) { s = new StringJoiner(",", "{", "}"); for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) s.add(quote(String.valueOf(e.getKey())) + ":" + json(e.getValue(), seen)); return s.toString(); }
            Class<?> c = v.getClass();
            if (c.isRecord()) {
                s = new StringJoiner(",", "{", "}");
                for (RecordComponent rc : c.getRecordComponents()) { Method m = rc.getAccessor(); m.setAccessible(true); s.add(quote(rc.getName()) + ":" + json(m.invoke(v), seen)); }
                return s.toString();
            }
            if (sources.containsKey(c.getName())) {
                s = new StringJoiner(",", "{", "}");
                for (Class<?> k = c; k != null && k != Object.class; k = k.getSuperclass())
                    for (Field f : k.getDeclaredFields()) if (!Modifier.isStatic(f.getModifiers()) && !f.isSynthetic()) { f.setAccessible(true); s.add(quote(f.getName()) + ":" + json(f.get(v), seen)); }
                return s.toString();
            }
            return quote(v.toString());
        } catch (Exception e) {
            return quote(String.valueOf(v));
        } finally { seen.remove(v); }
    }

    // A throwable as Java prints it, each frame of a bundle class at its source's path.
    static String stack(Throwable t) {
        StringBuilder b = new StringBuilder();
        Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<>());
        for (String prefix = ""; t != null && seen.add(t); t = t.getCause(), prefix = "Caused by: ") {
            b.append(prefix).append(t).append('\n');
            for (StackTraceElement f : t.getStackTrace()) {
                String src = sources.get(f.getClassName());
                String at = src != null && f.getLineNumber() > 0 ? src + ":" + f.getLineNumber() : f.isNativeMethod() ? "Native Method" : f.getFileName() == null ? "Unknown Source" : f.getFileName() + (f.getLineNumber() > 0 ? ":" + f.getLineNumber() : "");
                b.append("\tat ").append(f.getClassName()).append('.').append(f.getMethodName()).append('(').append(at).append(")\n");
            }
        }
        return b.toString();
    }

    static void emit(String record) { out.print(record + "\n"); out.flush(); }

    public static void main(String[] argv) throws Exception {
        // The protocol keeps the process's stdout; the file's own output goes to stderr.
        out = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
        System.setOut(System.err);
        Path file = Paths.get(argv[0]).toAbsolutePath().normalize(), classes = Paths.get(argv[1]);
        Files.createDirectories(classes);
        JavaCompiler javac = ToolProvider.getSystemJavaCompiler();
        DiagnosticCollector<JavaFileObject> diagnostics = new DiagnosticCollector<>();
        StandardJavaFileManager standard = javac.getStandardFileManager(diagnostics, null, StandardCharsets.UTF_8);
        JavaFileManager manager = new ForwardingJavaFileManager<>(standard) {
            @Override public JavaFileObject getJavaFileForOutput(Location location, String className, JavaFileObject.Kind kind, FileObject sibling) throws IOException {
                if (sibling != null && "file".equals(sibling.toUri().getScheme())) sources.put(className, Paths.get(sibling.toUri()).toString());
                return super.getJavaFileForOutput(location, className, kind, sibling);
            }
        };
        String classpath = Optional.ofNullable(System.getenv("CLASSPATH")).orElse("");
        List<String> options = new ArrayList<>(List.of("-d", classes.toString(), "-sourcepath", argv[2], "-implicit:class", "-proc:none", "-g", "-nowarn"));
        if (!classpath.isEmpty()) options.addAll(List.of("-classpath", classpath));
        boolean ok = javac.getTask(null, manager, diagnostics, options, null, standard.getJavaFileObjects(file.toFile())).call();
        if (!ok) {
            StringJoiner text = new StringJoiner("\n");
            for (Diagnostic<?> d : diagnostics.getDiagnostics()) if (d.getKind() == Diagnostic.Kind.ERROR) text.add(d.toString());
            emit("{\"load\":false,\"error\":" + quote("javac: " + text) + ",\"stack\":\"\"}");
            emit("{\"done\":true}");
            System.exit(0);
        }
        List<URL> urls = new ArrayList<>(List.of(classes.toUri().toURL()));
        for (String e : classpath.split(File.pathSeparator)) if (!e.isEmpty()) {
            if (e.endsWith("*")) { File[] jars = new File(e.substring(0, e.length() - 1)).listFiles((d, n) -> n.endsWith(".jar")); if (jars != null) for (File jar : jars) urls.add(jar.toURI().toURL()); }
            else urls.add(new File(e).toURI().toURL());
        }
        ClassLoader loader = new URLClassLoader(urls.toArray(new URL[0]), CallWorker.class.getClassLoader().getParent());
        // The file's classes, the one named as the file first; each top-level class is initialised here (its load).
        String stem = file.getFileName().toString().replaceAll("\\.java$", "");
        List<Class<?>> own = new ArrayList<>();
        try {
            List<String> names = new ArrayList<>();
            for (Map.Entry<String, String> e : sources.entrySet()) if (Paths.get(e.getValue()).equals(file)) names.add(e.getKey());
            names.sort(Comparator.comparing((String n) -> !n.replaceAll(".*\\.", "").equals(stem)).thenComparing(n -> n));
            for (String n : names) own.add(Class.forName(n, !n.contains("$"), loader));
        } catch (Throwable e) {
            Throwable t = e instanceof ExceptionInInitializerError && e.getCause() != null ? e.getCause() : e;
            emit("{\"load\":false,\"error\":" + quote(t.toString()) + ",\"stack\":" + quote(stack(t)) + "}");
            emit("{\"done\":true}");
            System.exit(0);
        }
        emit("{\"loaded\":true}");
        Map<String, Object> saved = new HashMap<>(), receivers = new HashMap<>();
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
        for (String line; (line = in.readLine()) != null; ) {
            if (line.isBlank()) continue;
            Map<?, ?> step = (Map<?, ?>) new Parser(line).val();
            String name = (String) step.get("call"), save = (String) step.get("save");
            List<?> args = (List<?>) step.get("args");
            emit(call(own, name, args, save, saved, receivers));
        }
        emit("{\"done\":true}");
        System.exit(0);
    }

    static String call(List<Class<?>> own, String name, List<?> args, String save, Map<String, Object> saved, Map<String, Object> receivers) {
        int dot = name.lastIndexOf('.');
        String cls = dot < 0 ? null : name.substring(0, dot), method = name.substring(dot + 1);
        List<Method> named = new ArrayList<>(), fit = new ArrayList<>();
        Set<String> defined = new TreeSet<>();
        for (Class<?> c : own) {
            String simple = c.getName().replaceAll(".*[.$]", "");
            for (Method m : c.getDeclaredMethods()) {
                if (m.isSynthetic() || m.isBridge()) continue;
                defined.add(m.getName());
                if (m.getName().equals(method) && (cls == null || simple.equals(cls) || c.getName().equals(cls))) named.add(m);
            }
        }
        if (named.isEmpty()) return "{\"ok\":false,\"missing\":true,\"detail\":" + quote("it defines: " + (defined.isEmpty() ? "no methods" : String.join(", ", defined))) + "}";
        for (Method m : named) if (m.isVarArgs() ? args.size() >= m.getParameterCount() - 1 : args.size() == m.getParameterCount()) fit.add(m);
        if (fit.isEmpty()) return "{\"ok\":false,\"error\":" + quote(name + " has " + named.get(0).getParameterCount() + " parameters; the call gives " + args.size() + " arguments") + "}";
        RuntimeException first = null;
        for (Method m : fit) {
            Object[] values;
            try { values = arguments(m, args, saved); }
            catch (Mismatch | Unsupported e) { if (first == null || first instanceof Mismatch && e instanceof Unsupported) first = e; continue; }
            catch (Exception e) { first = new Unsupported("the call adapter cannot build the arguments of " + name + ": " + e); continue; }
            Object receiver = null;
            if (!Modifier.isStatic(m.getModifiers())) {
                Class<?> c = m.getDeclaringClass();
                receiver = receivers.get(c.getName());
                if (receiver == null) {
                    try { Constructor<?> k = c.getDeclaredConstructor(); k.setAccessible(true); receiver = k.newInstance(); receivers.put(c.getName(), receiver); }
                    catch (NoSuchMethodException e) { return "{\"ok\":false,\"unsupported\":true,\"error\":" + quote("the call adapter cannot call " + name + ", an instance method of " + c.getName() + ", which has no constructor without arguments") + "}"; }
                    catch (InvocationTargetException e) { return failure(e.getCause()); }
                    catch (Exception e) { return failure(e); }
                }
            }
            try {
                m.setAccessible(true);
                Object v = m.invoke(receiver, values);
                if (save != null && !save.isEmpty()) saved.put(save, v);
                return "{\"ok\":true,\"value\":" + (m.getReturnType() == void.class ? "null" : json(v, new IdentityHashMap<>())) + "}";
            } catch (InvocationTargetException e) { return failure(e.getCause()); }
            catch (Exception e) { return failure(e); }
        }
        return first instanceof Unsupported ? "{\"ok\":false,\"unsupported\":true,\"error\":" + quote(first.getMessage()) + "}" : "{\"ok\":false,\"error\":" + quote(first.getMessage()) + "}";
    }
    static String failure(Throwable t) { return "{\"ok\":false,\"error\":" + quote(t.toString()) + ",\"stack\":" + quote(stack(t)) + "}"; }

    static Object[] arguments(Method m, List<?> args, Map<String, Object> saved) throws Exception {
        Type[] types = m.getGenericParameterTypes();
        int fixed = m.isVarArgs() ? types.length - 1 : types.length;
        Object[] values = new Object[types.length];
        for (int i = 0; i < fixed; i++) values[i] = argument((Map<?, ?>) args.get(i), types[i], i, saved);
        if (m.isVarArgs()) {
            Class<?> e = m.getParameterTypes()[fixed].getComponentType();
            Object rest = Array.newInstance(e, args.size() - fixed);
            for (int i = fixed; i < args.size(); i++) Array.set(rest, i - fixed, argument((Map<?, ?>) args.get(i), e, i, saved));
            values[fixed] = rest;
        }
        return values;
    }
    static Object argument(Map<?, ?> arg, Type t, int i, Map<String, Object> saved) throws Exception {
        Object name = arg.get("saved");
        if (name != null && saved.containsKey(name)) {
            Object v = saved.get(name); Class<?> c = raw(t);
            if (v == null ? !c.isPrimitive() : box(c).isInstance(v)) return v;
        }
        try { return build(arg.get("json"), t); }
        catch (Mismatch e) { throw new Mismatch("argument " + (i + 1) + ": " + e.getMessage()); }
        catch (Unsupported e) { throw new Unsupported(e.getMessage() + " (argument " + (i + 1) + ")"); }
    }
    static Class<?> box(Class<?> c) {
        if (!c.isPrimitive()) return c;
        return c == int.class ? Integer.class : c == long.class ? Long.class : c == double.class ? Double.class : c == boolean.class ? Boolean.class
            : c == char.class ? Character.class : c == float.class ? Float.class : c == short.class ? Short.class : c == byte.class ? Byte.class : Void.class;
    }
}
