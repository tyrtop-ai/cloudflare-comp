// C and C++ call driver (call-native.mjs): included after the bundle file
// (C++) or after the prototypes gcc wrote for it (C). Registry::add takes a
// function's address, so template deduction gives its parameter and return
// types; each argument is built from its JSON as its parameter type, or is
// a saved result of exactly that type. run() reads steps as JSON lines on
// stdin and answers each as a JSON line.
#include <any>
#include <array>
#include <charconv>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cxxabi.h>
#include <deque>
#include <functional>
#include <iostream>
#include <limits>
#include <list>
#include <map>
#include <memory>
#include <optional>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <tuple>
#include <type_traits>
#include <typeinfo>
#include <unistd.h>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace __call {

struct J {
  enum K { Null, Bool, Num, Str, Arr, Obj } k = Null;
  bool b = false;
  std::string s;  // a number's text, or a string
  std::vector<J> a;
  std::vector<std::pair<std::string, J>> o;
  const J* get(const std::string& key) const { for (auto& kv : o) if (kv.first == key) return &kv.second; return nullptr; }
};

struct Parser {
  const std::string& t; size_t i = 0;
  void ws() { while (i < t.size() && std::isspace(static_cast<unsigned char>(t[i]))) i++; }
  static void utf8(std::string& out, unsigned u) {
    if (u < 0x80) out += char(u);
    else if (u < 0x800) { out += char(0xc0 | (u >> 6)); out += char(0x80 | (u & 0x3f)); }
    else if (u < 0x10000) { out += char(0xe0 | (u >> 12)); out += char(0x80 | ((u >> 6) & 0x3f)); out += char(0x80 | (u & 0x3f)); }
    else { out += char(0xf0 | (u >> 18)); out += char(0x80 | ((u >> 12) & 0x3f)); out += char(0x80 | ((u >> 6) & 0x3f)); out += char(0x80 | (u & 0x3f)); }
  }
  unsigned hex4() { unsigned u = std::stoul(t.substr(i, 4), nullptr, 16); i += 4; return u; }
  std::string str() {
    std::string out; i++;
    while (i < t.size() && t[i] != '"') {
      char c = t[i++];
      if (c != '\\') { out += c; continue; }
      char e = t[i++];
      switch (e) {
        case 'n': out += '\n'; break; case 't': out += '\t'; break; case 'r': out += '\r'; break;
        case 'b': out += '\b'; break; case 'f': out += '\f'; break;
        case 'u': { unsigned u = hex4(); if (u >= 0xd800 && u < 0xdc00 && t.compare(i, 2, "\\u") == 0) { i += 2; u = 0x10000 + ((u - 0xd800) << 10) + (hex4() - 0xdc00); } utf8(out, u); break; }
        default: out += e;
      }
    }
    i++; return out;
  }
  J val() {
    ws(); J j;
    if (i >= t.size()) return j;
    char c = t[i];
    if (c == 'n') { i += 4; }
    else if (c == 't') { j.k = J::Bool; j.b = true; i += 4; }
    else if (c == 'f') { j.k = J::Bool; i += 5; }
    else if (c == '"') { j.k = J::Str; j.s = str(); }
    else if (c == '[') { j.k = J::Arr; i++; ws(); if (t[i] == ']') { i++; return j; } for (;;) { j.a.push_back(val()); ws(); if (t[i++] == ']') break; } }
    else if (c == '{') { j.k = J::Obj; i++; ws(); if (t[i] == '}') { i++; return j; } for (;;) { ws(); std::string k = str(); ws(); i++; J v = val(); j.o.emplace_back(k, v); ws(); if (t[i++] == '}') break; } }
    else { j.k = J::Num; size_t s = i; while (i < t.size() && std::strchr("+-.eE0123456789", t[i])) i++; j.s = t.substr(s, i - s); }
    return j;
  }
};
inline J parse(const std::string& t) { Parser p{t}; return p.val(); }
inline std::string quote(const std::string& s) {
  std::string o = "\"";
  for (unsigned char c : s) {
    if (c == '"') o += "\\\""; else if (c == '\\') o += "\\\\";
    else if (c < 0x20) { char b[8]; std::snprintf(b, sizeof b, "\\u%04x", c); o += b; }
    else o += char(c);
  }
  return o + "\"";
}
inline std::string dump(const J& j) {
  switch (j.k) {
    case J::Null: return "null"; case J::Bool: return j.b ? "true" : "false"; case J::Num: return j.s; case J::Str: return quote(j.s);
    case J::Arr: { std::string o = "["; for (size_t i = 0; i < j.a.size(); i++) o += (i ? "," : "") + dump(j.a[i]); return o + "]"; }
    case J::Obj: { std::string o = "{"; for (size_t i = 0; i < j.o.size(); i++) o += (i ? "," : "") + quote(j.o[i].first) + ":" + dump(j.o[i].second); return o + "}"; }
  }
  return "null";
}
inline std::string demangle(const char* name) {
  int status = 0; char* d = abi::__cxa_demangle(name, nullptr, nullptr, &status);
  std::string out = status == 0 && d ? d : name; std::free(d); return out;
}
template <class T> std::string type_name() { return demangle(typeid(T).name()); }
inline const char* shown(const J& j) { static const char* n[] = {"null", "a boolean", "a number", "a string", "an array", "an object"}; return n[j.k]; }

// The JSON does not fit the parameter's type: the call's failure.
struct Mismatch : std::runtime_error { using std::runtime_error::runtime_error; };
// No way to build the parameter's type from JSON: this adapter's limit.
struct Unsupported : std::runtime_error { using std::runtime_error::runtime_error; };
template <class T> [[noreturn]] void mismatch(const J& j) { throw Mismatch("expected " + type_name<T>() + ", got " + shown(j)); }
template <class T> [[noreturn]] void unsupported() { throw Unsupported("the call adapter cannot build a " + type_name<T>() + " from JSON"); }

// Storage that lives as long as the worker: what a pointer or a view argument points into.
inline std::vector<std::shared_ptr<void>>& arena() { static std::vector<std::shared_ptr<void>> a; return a; }
template <class T> T* keep(T&& v) { auto p = std::make_shared<std::decay_t<T>>(std::forward<T>(v)); arena().push_back(p); return p.get(); }

template <class T, class = void> struct complete : std::false_type {};
template <class T> struct complete<T, std::void_t<decltype(sizeof(T))>> : std::true_type {};
template <class T> struct seq_of : std::false_type {};
template <class T, class A> struct seq_of<std::vector<T, A>> : std::true_type { using E = T; };
template <class T, class A> struct seq_of<std::list<T, A>> : std::true_type { using E = T; };
template <class T, class A> struct seq_of<std::deque<T, A>> : std::true_type { using E = T; };
template <class T> struct set_of : std::false_type {};
template <class T, class C, class A> struct set_of<std::set<T, C, A>> : std::true_type { using E = T; };
template <class T, class C, class A> struct set_of<std::multiset<T, C, A>> : std::true_type { using E = T; };
template <class T, class H, class E2, class A> struct set_of<std::unordered_set<T, H, E2, A>> : std::true_type { using E = T; };
template <class T> struct map_of : std::false_type {};
template <class K, class V, class C, class A> struct map_of<std::map<K, V, C, A>> : std::true_type { using Key = K; using Val = V; };
template <class K, class V, class H, class E, class A> struct map_of<std::unordered_map<K, V, H, E, A>> : std::true_type { using Key = K; using Val = V; };
template <class T> struct array_of : std::false_type {};
template <class T, size_t N> struct array_of<std::array<T, N>> : std::true_type { using E = T; static constexpr size_t n = N; };
template <class T> struct tuple_of : std::false_type {};
template <class... T> struct tuple_of<std::tuple<T...>> : std::true_type {};
template <class A, class B> struct tuple_of<std::pair<A, B>> : std::true_type {};
template <class T> struct optional_of : std::false_type {};
template <class T> struct optional_of<std::optional<T>> : std::true_type { using E = T; };
// conjunction: an incomplete type is never asked whether it is abstract.
template <class T> constexpr bool buildable = std::conjunction_v<std::is_object<T>, complete<T>, std::negation<std::is_abstract<T>>, std::is_move_constructible<T>>;

template <class T> T from(const J& j);
template <class T, size_t... I> T tuple_from(const J& j, std::index_sequence<I...>) {
  if (j.k != J::Arr || j.a.size() != sizeof...(I)) mismatch<T>(j);
  return T(from<std::tuple_element_t<I, T>>(j.a[I])...);
}
template <class T> T number(const J& j) {
  if (j.k != J::Num) mismatch<T>(j);
  if constexpr (std::is_floating_point_v<T>) return static_cast<T>(std::strtold(j.s.c_str(), nullptr));
  else {
    T v{}; auto r = std::from_chars(j.s.data(), j.s.data() + j.s.size(), v);
    if (r.ec == std::errc() && r.ptr == j.s.data() + j.s.size()) return v;
    long double d = std::strtold(j.s.c_str(), nullptr);
    if (std::floor(d) == d && d >= static_cast<long double>(std::numeric_limits<T>::min()) && d <= static_cast<long double>(std::numeric_limits<T>::max())) return static_cast<T>(d);
    mismatch<T>(j);
  }
}
// A value of a parameter's type from its JSON.
template <class T> T from(const J& j) {
  if constexpr (std::is_same_v<T, bool>) { if (j.k != J::Bool) mismatch<T>(j); return j.b; }
  else if constexpr (std::is_same_v<T, char>) { if (j.k == J::Str && j.s.size() == 1) return j.s[0]; return static_cast<char>(number<int>(j)); }
  else if constexpr (std::is_arithmetic_v<T>) return number<T>(j);
  else if constexpr (std::is_enum_v<T>) return static_cast<T>(number<std::underlying_type_t<T>>(j));
  else if constexpr (std::is_same_v<T, std::string>) { if (j.k != J::Str) mismatch<T>(j); return j.s; }
  else if constexpr (std::is_same_v<T, std::string_view>) { if (j.k != J::Str) mismatch<T>(j); return *keep(std::string(j.s)); }
  else if constexpr (std::is_same_v<T, const char*> || std::is_same_v<T, char*>) {
    if (j.k == J::Null) return nullptr;
    if (j.k != J::Str) mismatch<T>(j);
    return keep(std::vector<char>(j.s.c_str(), j.s.c_str() + j.s.size() + 1))->data();
  }
  else if constexpr (std::is_pointer_v<T>) {
    using E = std::remove_cv_t<std::remove_pointer_t<T>>;
    if (j.k == J::Null) return nullptr;
    if constexpr (buildable<E>) {
      if (j.k != J::Arr) return keep(from<E>(j));  // one value, by its address
      std::vector<E> v; v.reserve(j.a.size()); for (auto& x : j.a) v.push_back(from<E>(x));
      return keep(std::move(v))->data();  // an array, by its first element
    } else unsupported<T>();
  }
  else if constexpr (seq_of<T>::value) { if (j.k != J::Arr) mismatch<T>(j); T v; for (auto& x : j.a) v.push_back(from<typename seq_of<T>::E>(x)); return v; }
  else if constexpr (set_of<T>::value) { if (j.k != J::Arr) mismatch<T>(j); T v; for (auto& x : j.a) v.insert(from<typename set_of<T>::E>(x)); return v; }
  else if constexpr (array_of<T>::value) { if (j.k != J::Arr || j.a.size() != array_of<T>::n) mismatch<T>(j); T v{}; for (size_t i = 0; i < v.size(); i++) v[i] = from<typename array_of<T>::E>(j.a[i]); return v; }
  else if constexpr (map_of<T>::value) {
    using K = typename map_of<T>::Key; using V = typename map_of<T>::Val;
    if (j.k != J::Obj) mismatch<T>(j);
    T m;
    for (auto& [k, v] : j.o) {
      if constexpr (std::is_same_v<K, std::string>) m.emplace(k, from<V>(v));
      else { J key; key.k = std::is_arithmetic_v<K> ? J::Num : J::Str; key.s = k; m.emplace(from<K>(key), from<V>(v)); }
    }
    return m;
  }
  else if constexpr (tuple_of<T>::value) return tuple_from<T>(j, std::make_index_sequence<std::tuple_size_v<T>>{});
  else if constexpr (optional_of<T>::value) { if (j.k == J::Null) return std::nullopt; return from<typename optional_of<T>::E>(j); }
  else unsupported<T>();
}

// A value as JSON text.
template <class T> std::string to_json(const T& v);
template <class T> std::string items(const T& c) { std::string o = "["; bool first = true; for (auto& x : c) { o += (first ? "" : ",") + to_json(x); first = false; } return o + "]"; }
template <class T, class = void> struct streamable : std::false_type {};
template <class T> struct streamable<T, std::void_t<decltype(std::declval<std::ostream&>() << std::declval<const T&>())>> : std::true_type {};
template <class T> std::string to_json(const T& v) {
  if constexpr (std::is_same_v<T, bool>) return v ? "true" : "false";
  else if constexpr (std::is_same_v<T, char>) return quote(std::string(1, v));
  else if constexpr (std::is_integral_v<T>) return std::to_string(v);
  else if constexpr (std::is_floating_point_v<T>) {
    if (!std::isfinite(v)) return "null";
    char b[64]; auto r = std::to_chars(b, b + sizeof b, v); return std::string(b, r.ptr);
  }
  else if constexpr (std::is_enum_v<T>) return to_json(static_cast<std::underlying_type_t<T>>(v));
  else if constexpr (std::is_same_v<T, std::string> || std::is_same_v<T, std::string_view>) return quote(std::string(v));
  else if constexpr (std::is_same_v<T, const char*> || std::is_same_v<T, char*>) return v ? quote(v) : "null";
  else if constexpr (std::is_pointer_v<T> || std::is_null_pointer_v<T>) { if (!v) return "null"; std::ostringstream s; s << static_cast<const void*>(v); return quote(s.str()); }
  else if constexpr (seq_of<T>::value || set_of<T>::value || array_of<T>::value) return items(v);
  else if constexpr (map_of<T>::value) {
    std::string o = "{"; bool first = true;
    for (auto& [k, x] : v) { std::string key = to_json(k); if (key.empty() || key[0] != '"') key = quote(key); o += (first ? "" : ",") + key + ":" + to_json(x); first = false; }
    return o + "}";
  }
  else if constexpr (tuple_of<T>::value) { std::string o = "["; std::apply([&](auto&... x) { bool first = true; ((o += (first ? "" : ",") + to_json(x), first = false), ...); }, v); return o + "]"; }
  else if constexpr (optional_of<T>::value) return v ? to_json(*v) : "null";
  else if constexpr (streamable<T>::value) { std::ostringstream s; s << v; return quote(s.str()); }
  else return quote("<" + type_name<T>() + ">");
}

// A step's argument: its JSON, and the saved result it names (when it is one).
struct Arg { J json; std::any* saved = nullptr; };
template <class A> struct Slot {
  using D = std::remove_cv_t<std::remove_reference_t<A>>;
  std::unique_ptr<D> own; D* ptr = nullptr;
  void fill(Arg& a, size_t i) {
    if (a.saved) {
      if (auto p = std::any_cast<D>(a.saved)) { ptr = p; return; }
      if constexpr (std::is_pointer_v<D>) {
        using E = std::remove_cv_t<std::remove_pointer_t<D>>;
        // A saved pointer, as a pointer to const; a saved value, by its address.
        if (auto p = std::any_cast<E*>(a.saved)) { own = std::make_unique<D>(*p); ptr = own.get(); return; }
        if constexpr (std::is_object_v<E> && complete<E>::value) if (auto p = std::any_cast<E>(a.saved)) { own = std::make_unique<D>(p); ptr = own.get(); return; }
      }
    }
    try {
      if constexpr (buildable<D>) { own = std::make_unique<D>(from<D>(a.json)); ptr = own.get(); }
      else unsupported<D>();
    } catch (Mismatch& e) { throw Mismatch("argument " + std::to_string(i + 1) + ": " + e.what()); }
    catch (Unsupported& e) { throw Unsupported(std::string(e.what()) + " (argument " + std::to_string(i + 1) + ")"); }
  }
  decltype(auto) get() {
    if constexpr (std::is_lvalue_reference_v<A>) return static_cast<A>(*ptr);
    else if constexpr (std::is_rvalue_reference_v<A> || !std::is_copy_constructible_v<D>) return std::move(*ptr);
    else return static_cast<D&>(*ptr);
  }
};

struct Result { bool ok = false; std::string value, error; bool unsupported = false; std::any native; };
using Call = std::function<Result(std::vector<Arg>&)>;

template <class R, class... A, size_t... I> Result invoke(R (*f)(A...), std::vector<Arg>& args, std::index_sequence<I...>) {
  Result r;
  std::tuple<Slot<A>...> slots;
  (std::get<I>(slots).fill(args[I], I), ...);
  if constexpr (std::is_void_v<R>) { f(std::get<I>(slots).get()...); r.value = "null"; }
  else {
    R value = f(std::get<I>(slots).get()...);
    using V = std::remove_cv_t<std::remove_reference_t<R>>;
    r.value = to_json<V>(value);
    if constexpr (std::is_copy_constructible_v<V>) r.native = V(value);
  }
  r.ok = true;
  return r;
}
template <class R, class... A> Call wrap(R (*f)(A...)) {
  return [f](std::vector<Arg>& args) -> Result {
    if (args.size() != sizeof...(A)) { Result r; r.error = "the function has " + std::to_string(sizeof...(A)) + " parameters; the call gives " + std::to_string(args.size()) + " arguments"; return r; }
    return invoke(f, args, std::index_sequence_for<A...>{});
  };
}

struct Registry {
  std::map<std::string, Call> calls;
  template <class R, class... A> void add(const char* name, R (*f)(A...)) { calls[name] = wrap(f); }
  template <class R, class... A> void add(const char* name, R (*f)(A...) noexcept) { calls[name] = wrap(reinterpret_cast<R (*)(A...)>(f)); }
  template <class R, class... A> void add(const char* name, R (*)(A..., ...)) {
    calls[name] = [](std::vector<Arg>&) { Result r; r.unsupported = true; r.error = "the call adapter cannot call a function with a variable argument list"; return r; };
  }
};

inline int run(void (*registrations)(Registry&)) {
  // The protocol keeps the process's stdout; the file's own output goes to stderr.
  int out = dup(1);
  std::fflush(stdout);
  dup2(2, 1);
  auto emit = [out](const std::string& line) { std::string l = line + "\n"; for (size_t i = 0; i < l.size();) { ssize_t n = write(out, l.data() + i, l.size() - i); if (n <= 0) break; i += n; } };
  Registry reg;
  registrations(reg);
  emit("{\"loaded\":true}");
  std::map<std::string, std::any> saved;
  std::string line;
  while (std::getline(std::cin, line)) {
    if (line.empty()) continue;
    J step = parse(line);
    const J* call = step.get("call"); const J* list = step.get("args"); const J* save = step.get("save");
    std::string name = call ? call->s : "";
    std::vector<Arg> args;
    if (list) for (auto& x : list->a) {
      Arg a; if (const J* j = x.get("json")) a.json = *j;
      if (const J* s = x.get("saved")) { auto it = saved.find(s->s); if (it != saved.end()) a.saved = &it->second; }
      args.push_back(std::move(a));
    }
    auto it = reg.calls.find(name);
    if (it == reg.calls.end()) { emit("{\"ok\":false,\"missing\":true}"); continue; }
    Result r;
    try { r = it->second(args); }
    catch (Unsupported& e) { r.unsupported = true; r.error = e.what(); }
    catch (Mismatch& e) { r.error = e.what(); }
    catch (const std::exception& e) { r.error = demangle(typeid(e).name()) + ": " + e.what(); }
    catch (...) { auto t = abi::__cxa_current_exception_type(); r.error = "threw " + (t ? demangle(t->name()) : std::string("an exception")); }
    std::fflush(stdout); std::cout.flush();
    if (r.ok) {
      if (save && save->k == J::Str && !save->s.empty()) saved[save->s] = std::move(r.native);
      emit("{\"ok\":true,\"value\":" + r.value + "}");
    } else emit(std::string("{\"ok\":false,") + (r.unsupported ? "\"unsupported\":true," : "") + "\"error\":" + quote(r.error) + "}");
  }
  std::fflush(stdout);
  emit("{\"done\":true}");
  std::_Exit(0);
}

}  // namespace __call
