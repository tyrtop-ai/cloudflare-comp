// Rust call driver (call-native.mjs): the last module of the bundle file's
// own crate, so the file's private functions are in scope. A binary calls
// run(), which reads steps as JSON lines on stdin and answers each as a JSON
// line. Each call is written with the step's number of arguments; the
// compiler infers each argument's type from the function, and FromJ builds
// a value of that type from the argument's JSON (the file's own structs and
// enums included). What a call returns is
// written as JSON when its type is one FromJ/ToJ know, else by its Debug
// form, else by its type's name.
#![allow(dead_code, unused_imports, unused_macros, unused_variables, non_snake_case)]
use std::cell::RefCell;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet, VecDeque};
use std::fmt::Debug;
use std::hash::Hash;
use std::io::{BufRead, Write};
use std::rc::Rc;
use std::sync::Arc;

#[derive(Clone)]
pub enum J { Null, Bool(bool), Num(String), Str(String), Arr(Vec<J>), Obj(Vec<(String, J)>) }

struct P<'a> { s: &'a [u8], i: usize }
impl<'a> P<'a> {
    fn ws(&mut self) { while self.i < self.s.len() && (self.s[self.i] as char).is_ascii_whitespace() { self.i += 1; } }
    fn val(&mut self) -> Result<J, String> {
        self.ws();
        let c = *self.s.get(self.i).ok_or("unexpected end of JSON")?;
        match c {
            b'n' => { self.i += 4; Ok(J::Null) }
            b't' => { self.i += 4; Ok(J::Bool(true)) }
            b'f' => { self.i += 5; Ok(J::Bool(false)) }
            b'"' => Ok(J::Str(self.string()?)),
            b'[' => {
                self.i += 1; let mut a = Vec::new(); self.ws();
                if self.s.get(self.i) == Some(&b']') { self.i += 1; return Ok(J::Arr(a)); }
                loop { a.push(self.val()?); self.ws(); match self.s.get(self.i) { Some(b',') => self.i += 1, Some(b']') => { self.i += 1; return Ok(J::Arr(a)); } _ => return Err("bad JSON array".into()) } }
            }
            b'{' => {
                self.i += 1; let mut o = Vec::new(); self.ws();
                if self.s.get(self.i) == Some(&b'}') { self.i += 1; return Ok(J::Obj(o)); }
                loop {
                    self.ws(); let k = self.string()?; self.ws(); self.i += 1; let v = self.val()?; o.push((k, v)); self.ws();
                    match self.s.get(self.i) { Some(b',') => self.i += 1, Some(b'}') => { self.i += 1; return Ok(J::Obj(o)); } _ => return Err("bad JSON object".into()) }
                }
            }
            _ => {
                let start = self.i;
                while self.i < self.s.len() && matches!(self.s[self.i], b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9') { self.i += 1; }
                Ok(J::Num(String::from_utf8_lossy(&self.s[start..self.i]).into_owned()))
            }
        }
    }
    fn hex4(&mut self) -> u32 { let h = std::str::from_utf8(&self.s[self.i..self.i + 4]).unwrap_or("0"); self.i += 4; u32::from_str_radix(h, 16).unwrap_or(0xfffd) }
    fn string(&mut self) -> Result<String, String> {
        self.i += 1; let mut out = Vec::new();
        loop {
            let c = *self.s.get(self.i).ok_or("unterminated JSON string")?; self.i += 1;
            match c {
                b'"' => return Ok(String::from_utf8_lossy(&out).into_owned()),
                b'\\' => {
                    let e = self.s[self.i]; self.i += 1;
                    let ch = match e {
                        b'n' => '\n', b't' => '\t', b'r' => '\r', b'b' => '\u{8}', b'f' => '\u{c}',
                        b'u' => {
                            let mut u = self.hex4();
                            if (0xd800..0xdc00).contains(&u) && self.s.get(self.i) == Some(&b'\\') { self.i += 2; let lo = self.hex4(); u = 0x10000 + ((u - 0xd800) << 10) + (lo - 0xdc00); }
                            char::from_u32(u).unwrap_or('\u{fffd}')
                        }
                        other => other as char,
                    };
                    let mut b = [0u8; 4]; out.extend_from_slice(ch.encode_utf8(&mut b).as_bytes());
                }
                _ => out.push(c),
            }
        }
    }
}
pub fn parse(t: &str) -> Result<J, String> { P { s: t.as_bytes(), i: 0 }.val() }
pub fn quote(s: &str) -> String {
    let mut o = String::from("\"");
    for c in s.chars() { match c { '"' => o.push_str("\\\""), '\\' => o.push_str("\\\\"), c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)), c => o.push(c) } }
    o.push('"'); o
}
fn field<'a>(j: &'a J, k: &str) -> Option<&'a J> { if let J::Obj(o) = j { o.iter().find(|(x, _)| x == k).map(|(_, v)| v) } else { None } }
fn shown(j: &J) -> &'static str { match j { J::Null => "null", J::Bool(_) => "a boolean", J::Num(_) => "a number", J::Str(_) => "a string", J::Arr(_) => "an array", J::Obj(_) => "an object" } }
fn want<T>(j: &J) -> String { format!("expected {}, got {}", std::any::type_name::<T>(), shown(j)) }

// A value of a parameter's type from its JSON.
pub trait FromJ: Sized { fn from_j(j: &J) -> Result<Self, String>; }
macro_rules! from_int { ($($t:ty),*) => { $(impl FromJ for $t { fn from_j(j: &J) -> Result<Self, String> {
    match j { J::Num(n) => n.parse::<$t>().or_else(|_| n.parse::<f64>().ok().filter(|f| f.fract() == 0.0 && *f >= <$t>::MIN as f64 && *f <= <$t>::MAX as f64).map(|f| f as $t).ok_or_else(|| want::<$t>(j))), _ => Err(want::<$t>(j)) }
} })* } }
from_int!(i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize);
macro_rules! from_float { ($($t:ty),*) => { $(impl FromJ for $t { fn from_j(j: &J) -> Result<Self, String> { match j { J::Num(n) => n.parse::<$t>().map_err(|_| want::<$t>(j)), _ => Err(want::<$t>(j)) } } })* } }
from_float!(f32, f64);
impl FromJ for bool { fn from_j(j: &J) -> Result<Self, String> { match j { J::Bool(b) => Ok(*b), _ => Err(want::<bool>(j)) } } }
impl FromJ for char { fn from_j(j: &J) -> Result<Self, String> { match j { J::Str(s) if s.chars().count() == 1 => Ok(s.chars().next().unwrap()), _ => Err(want::<char>(j)) } } }
impl FromJ for String { fn from_j(j: &J) -> Result<Self, String> { match j { J::Str(s) => Ok(s.clone()), _ => Err(want::<String>(j)) } } }
impl FromJ for () { fn from_j(j: &J) -> Result<Self, String> { Ok(()) } }
impl FromJ for &'static str { fn from_j(j: &J) -> Result<Self, String> { Ok(Box::leak(String::from_j(j)?.into_boxed_str())) } }
impl FromJ for &'static mut str { fn from_j(j: &J) -> Result<Self, String> { Ok(Box::leak(String::from_j(j)?.into_boxed_str())) } }
impl<T: FromJ + 'static> FromJ for &'static T { fn from_j(j: &J) -> Result<Self, String> { Ok(Box::leak(Box::new(T::from_j(j)?))) } }
impl<T: FromJ + 'static> FromJ for &'static mut T { fn from_j(j: &J) -> Result<Self, String> { Ok(Box::leak(Box::new(T::from_j(j)?))) } }
impl<T: FromJ + 'static> FromJ for &'static [T] { fn from_j(j: &J) -> Result<Self, String> { Ok(Box::leak(Vec::<T>::from_j(j)?.into_boxed_slice())) } }
impl<T: FromJ + 'static> FromJ for &'static mut [T] { fn from_j(j: &J) -> Result<Self, String> { Ok(Box::leak(Vec::<T>::from_j(j)?.into_boxed_slice())) } }
impl<T: FromJ> FromJ for Box<T> { fn from_j(j: &J) -> Result<Self, String> { T::from_j(j).map(Box::new) } }
impl<T: FromJ> FromJ for Rc<T> { fn from_j(j: &J) -> Result<Self, String> { T::from_j(j).map(Rc::new) } }
impl<T: FromJ> FromJ for Arc<T> { fn from_j(j: &J) -> Result<Self, String> { T::from_j(j).map(Arc::new) } }
impl<T: FromJ> FromJ for Option<T> { fn from_j(j: &J) -> Result<Self, String> { match j { J::Null => Ok(None), _ => T::from_j(j).map(Some) } } }
fn items<T: FromJ>(j: &J) -> Result<Vec<T>, String> { match j { J::Arr(a) => a.iter().map(T::from_j).collect(), _ => Err(want::<Vec<T>>(j)) } }
impl<T: FromJ> FromJ for Vec<T> { fn from_j(j: &J) -> Result<Self, String> { items(j) } }
impl<T: FromJ> FromJ for VecDeque<T> { fn from_j(j: &J) -> Result<Self, String> { items(j).map(VecDeque::from) } }
impl<T: FromJ + Eq + Hash> FromJ for HashSet<T> { fn from_j(j: &J) -> Result<Self, String> { items(j).map(|v| v.into_iter().collect()) } }
impl<T: FromJ + Ord> FromJ for BTreeSet<T> { fn from_j(j: &J) -> Result<Self, String> { items(j).map(|v| v.into_iter().collect()) } }
impl<T: FromJ, const N: usize> FromJ for [T; N] { fn from_j(j: &J) -> Result<Self, String> { items::<T>(j)?.try_into().map_err(|_| want::<[T; N]>(j)) } }
// A map's key from an object's key: the text itself, or the number it reads as.
pub trait FromKey: Sized { fn from_key(k: &str) -> Result<Self, String>; }
impl FromKey for String { fn from_key(k: &str) -> Result<Self, String> { Ok(k.to_string()) } }
impl FromKey for &'static str { fn from_key(k: &str) -> Result<Self, String> { Ok(Box::leak(k.to_string().into_boxed_str())) } }
macro_rules! key_num { ($($t:ty),*) => { $(impl FromKey for $t { fn from_key(k: &str) -> Result<Self, String> { k.parse::<$t>().map_err(|_| format!("expected a {} key, got {:?}", stringify!($t), k)) } })* } }
key_num!(i8, i16, i32, i64, i128, isize, u8, u16, u32, u64, u128, usize, char, bool);
fn pairs<K: FromKey, V: FromJ>(j: &J) -> Result<Vec<(K, V)>, String> { match j { J::Obj(o) => o.iter().map(|(k, v)| Ok((K::from_key(k)?, V::from_j(v)?))).collect(), _ => Err(want::<Vec<(K, V)>>(j)) } }
impl<K: FromKey + Eq + Hash, V: FromJ> FromJ for HashMap<K, V> { fn from_j(j: &J) -> Result<Self, String> { pairs(j).map(|v| v.into_iter().collect()) } }
impl<K: FromKey + Ord, V: FromJ> FromJ for BTreeMap<K, V> { fn from_j(j: &J) -> Result<Self, String> { pairs(j).map(|v| v.into_iter().collect()) } }
macro_rules! from_tuple { ($($n:tt $t:ident),+) => { impl<$($t: FromJ),+> FromJ for ($($t,)+) { fn from_j(j: &J) -> Result<Self, String> {
    match j { J::Arr(a) if a.len() == [$($n),+].len() => Ok(($($t::from_j(&a[$n])?,)+)), _ => Err(want::<Self>(j)) }
} } } }
from_tuple!(0 A); from_tuple!(0 A, 1 B); from_tuple!(0 A, 1 B, 2 C); from_tuple!(0 A, 1 B, 2 C, 3 D); from_tuple!(0 A, 1 B, 2 C, 3 D, 4 E); from_tuple!(0 A, 1 B, 2 C, 3 D, 4 E, 5 F);
// The file's own structs and enums (call-native.mjs writes their FromJ from
// the fields and variants rustc's debug information gives each): a struct
// from an object by its fields' names (a tuple struct from an array of its
// fields), a fieldless enum from its variant's name.
pub fn __field<T: FromJ>(j: &J, k: &str) -> Result<T, String> { T::from_j(field(j, k).unwrap_or(&J::Null)).map_err(|e| format!("{}: {}", k, e)) }
pub fn __item<T: FromJ>(a: &[J], i: usize) -> Result<T, String> { T::from_j(&a[i]).map_err(|e| format!("{}: {}", i, e)) }
pub fn __fields<T>(j: &J, names: &[&str]) -> Result<(), String> {
    match j { J::Obj(o) => match o.iter().find(|(k, _)| !names.contains(&k.as_str())) { Some((k, _)) => Err(format!("{} has no field {}", std::any::type_name::<T>(), k)), None => Ok(()) }, _ => Err(want::<T>(j)) }
}
/*__CALL_IMPLS__*/

// A value as JSON text.
pub trait ToJ { fn to_j(&self) -> String; }
macro_rules! to_num { ($($t:ty),*) => { $(impl ToJ for $t { fn to_j(&self) -> String { self.to_string() } })* } }
to_num!(i8, i16, i32, i64, isize, u8, u16, u32, u64, usize, bool);
impl ToJ for i128 { fn to_j(&self) -> String { self.to_string() } }
impl ToJ for u128 { fn to_j(&self) -> String { self.to_string() } }
impl ToJ for f64 { fn to_j(&self) -> String { if self.is_finite() { format!("{:?}", self) } else { "null".into() } } }
impl ToJ for f32 { fn to_j(&self) -> String { (*self as f64).to_j() } }
impl ToJ for char { fn to_j(&self) -> String { quote(&self.to_string()) } }
impl ToJ for str { fn to_j(&self) -> String { quote(self) } }
impl ToJ for String { fn to_j(&self) -> String { quote(self) } }
impl ToJ for () { fn to_j(&self) -> String { "null".into() } }
impl<T: ToJ + ?Sized> ToJ for &T { fn to_j(&self) -> String { (**self).to_j() } }
impl<T: ToJ + ?Sized> ToJ for &mut T { fn to_j(&self) -> String { (**self).to_j() } }
impl<T: ToJ + ?Sized> ToJ for Box<T> { fn to_j(&self) -> String { (**self).to_j() } }
impl<T: ToJ + ?Sized> ToJ for Rc<T> { fn to_j(&self) -> String { (**self).to_j() } }
impl<T: ToJ + ?Sized> ToJ for Arc<T> { fn to_j(&self) -> String { (**self).to_j() } }
impl<T: ToJ> ToJ for Option<T> { fn to_j(&self) -> String { match self { Some(v) => v.to_j(), None => "null".into() } } }
fn list<'a, T: ToJ + 'a>(it: impl Iterator<Item = &'a T>) -> String { format!("[{}]", it.map(|v| v.to_j()).collect::<Vec<_>>().join(",")) }
impl<T: ToJ> ToJ for [T] { fn to_j(&self) -> String { list(self.iter()) } }
impl<T: ToJ, const N: usize> ToJ for [T; N] { fn to_j(&self) -> String { list(self.iter()) } }
impl<T: ToJ> ToJ for Vec<T> { fn to_j(&self) -> String { list(self.iter()) } }
impl<T: ToJ> ToJ for VecDeque<T> { fn to_j(&self) -> String { list(self.iter()) } }
impl<T: ToJ> ToJ for HashSet<T> { fn to_j(&self) -> String { list(self.iter()) } }
impl<T: ToJ> ToJ for BTreeSet<T> { fn to_j(&self) -> String { list(self.iter()) } }
fn object<'a, K: std::fmt::Display + 'a, V: ToJ + 'a>(it: impl Iterator<Item = (&'a K, &'a V)>) -> String { format!("{{{}}}", it.map(|(k, v)| format!("{}:{}", quote(&k.to_string()), v.to_j())).collect::<Vec<_>>().join(",")) }
impl<K: std::fmt::Display, V: ToJ> ToJ for HashMap<K, V> { fn to_j(&self) -> String { object(self.iter()) } }
impl<K: std::fmt::Display, V: ToJ> ToJ for BTreeMap<K, V> { fn to_j(&self) -> String { object(self.iter()) } }
macro_rules! to_tuple { ($($n:tt $t:ident),+) => { impl<$($t: ToJ),+> ToJ for ($($t,)+) { fn to_j(&self) -> String { format!("[{}]", [$(self.$n.to_j()),+].join(",")) } } } }
to_tuple!(0 A); to_tuple!(0 A, 1 B); to_tuple!(0 A, 1 B, 2 C); to_tuple!(0 A, 1 B, 2 C, 3 D); to_tuple!(0 A, 1 B, 2 C, 3 D, 4 E); to_tuple!(0 A, 1 B, 2 C, 3 D, 4 E, 5 F);

pub enum Out { Val(String), Fail(String), Unsupported(String) }
// What a call returned, by the most exact of its type's capabilities (the
// receiver with the most references is tried first): a Result whose Err is
// the call's failure, a value ToJ writes, a value's Debug form, its type's name.
pub struct W<T>(pub T);
pub trait O4 { fn out(&self) -> Out; }
impl<T: ToJ, E: Debug> O4 for &&&&W<Result<T, E>> { fn out(&self) -> Out { match &self.0 { Ok(v) => Out::Val(v.to_j()), Err(e) => Out::Fail(format!("Err({:?})", e)) } } }
pub trait O3 { fn out(&self) -> Out; }
impl<T: Debug, E: Debug> O3 for &&&W<Result<T, E>> { fn out(&self) -> Out { match &self.0 { Ok(v) => Out::Val(quote(&format!("{:?}", v))), Err(e) => Out::Fail(format!("Err({:?})", e)) } } }
pub trait O2 { fn out(&self) -> Out; }
impl<T: ToJ> O2 for &&W<T> { fn out(&self) -> Out { Out::Val(self.0.to_j()) } }
pub trait O1 { fn out(&self) -> Out; }
impl<T: Debug> O1 for &W<T> { fn out(&self) -> Out { Out::Val(quote(&format!("{:?}", self.0))) } }
pub trait O0 { fn out(&self) -> Out; }
impl<T> O0 for W<T> { fn out(&self) -> Out { Out::Val(quote(&format!("<{}>", std::any::type_name::<T>()))) } }

pub fn __arg<T: FromJ>(j: &J, i: usize) -> Result<T, String> { T::from_j(j).map_err(|e| format!("argument {}: {}", i + 1, e)) }
macro_rules! __call {
    ($args:ident; $f:path $(, $i:tt)*) => {
        (|| -> Result<Out, String> { let __v = $f($(__arg(&$args[$i], $i)?),*); Ok((&&&&&W(__v)).out()) })().unwrap_or_else(Out::Fail)
    };
}
// A function's number of parameters, from its type.
// touch: a value of each of its parameter and result types, so the debug
// information describes them (call-native.mjs reads their fields there).
pub trait FnArity<M> { const N: usize; fn touch(); }
macro_rules! arity { ($n:expr; $($a:ident),*) => { impl<F, R, $($a),*> FnArity<(R, $($a,)*)> for F where F: Fn($($a),*) -> R {
    const N: usize = $n;
    fn touch() { let __t: ($(Option<$a>,)* Option<R>,) = ($(None::<$a>,)* None,); let _ = &__t; }
} } }
arity!(0;); arity!(1; A1); arity!(2; A1, A2); arity!(3; A1, A2, A3); arity!(4; A1, A2, A3, A4); arity!(5; A1, A2, A3, A4, A5); arity!(6; A1, A2, A3, A4, A5, A6);
arity!(7; A1, A2, A3, A4, A5, A6, A7); arity!(8; A1, A2, A3, A4, A5, A6, A7, A8); arity!(9; A1, A2, A3, A4, A5, A6, A7, A8, A9); arity!(10; A1, A2, A3, A4, A5, A6, A7, A8, A9, A10);
pub fn __arity_of<F: FnArity<M>, M>(_: &F) -> usize { F::N }
pub fn __touch<F: FnArity<M>, M>(_: &F) -> Option<Out> { F::touch(); None }
pub fn __arity_only(_: usize) -> Out { Out::Val("null".into()) }
// A call that does not build: another number of arguments than the
// function's parameters is the call's failure; otherwise this adapter cannot build it.
pub fn __stub(n: usize, k: usize, name: &str, why: &str) -> Out {
    if n != k { Out::Fail(format!("{} has {} parameters; the call gives {} arguments", name, n, k)) } else { Out::Unsupported(why.to_string()) }
}

fn __dispatch(name: &str, args: &[J]) -> Option<Out> {
    match (name, args.len()) {
/*__CALL_DISPATCH__*/
        _ => None,
    }
}

thread_local! { static PANIC: RefCell<Option<String>> = RefCell::new(None); }
extern "C" { fn dup(fd: i32) -> i32; fn dup2(from: i32, to: i32) -> i32; }

pub fn run() {
    use std::os::unix::io::FromRawFd;
    // The protocol keeps the process's stdout; the file's own output goes to stderr.
    let mut out = unsafe { let fd = dup(1); dup2(2, 1); std::fs::File::from_raw_fd(fd) };
    // A panic's message is the step's error; Rust's own hook prints it and
    // its backtrace (RUST_BACKTRACE) to stderr, where its frames are read.
    let rust_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let p = info.payload();
        let msg = p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "a panic".into());
        let at = info.location().map(|l| format!(" at {}:{}:{}", l.file(), l.line(), l.column())).unwrap_or_default();
        PANIC.with(|x| *x.borrow_mut() = Some(format!("{}{}", msg, at)));
        rust_hook(info);
    }));
    let _ = writeln!(out, "{{\"loaded\":true}}");
    for line in std::io::stdin().lock().lines() {
        let line = match line { Ok(l) => l, Err(_) => break };
        let step = match parse(&line) { Ok(s) => s, Err(_) => continue };
        let name = match field(&step, "call") { Some(J::Str(s)) => s.clone(), _ => String::new() };
        let args: Vec<J> = match field(&step, "args") {
            Some(J::Arr(a)) => a.iter().map(|x| field(x, "json").cloned().unwrap_or(J::Null)).collect(),
            _ => Vec::new(),
        };
        let record = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| __dispatch(&name, &args))) {
            Ok(Some(Out::Val(v))) => format!("{{\"ok\":true,\"value\":{}}}", v),
            Ok(Some(Out::Fail(e))) => format!("{{\"ok\":false,\"error\":{}}}", quote(&e)),
            Ok(Some(Out::Unsupported(e))) => format!("{{\"ok\":false,\"unsupported\":true,\"error\":{}}}", quote(&e)),
            Ok(None) => "{\"ok\":false,\"missing\":true}".to_string(),
            Err(_) => {
                let msg = PANIC.with(|x| x.borrow_mut().take()).unwrap_or_default();
                format!("{{\"ok\":false,\"error\":{}}}", quote(&format!("panicked: {}", msg)))
            }
        };
        let _ = writeln!(out, "{}", record);
    }
    let _ = writeln!(out, "{{\"done\":true}}");
    let _ = out.flush();
    std::process::exit(0);
}

fn dump(j: &J) -> String {
    match j {
        J::Null => "null".into(), J::Bool(b) => b.to_string(), J::Num(n) => n.clone(), J::Str(s) => quote(s),
        J::Arr(a) => format!("[{}]", a.iter().map(dump).collect::<Vec<_>>().join(",")),
        J::Obj(o) => format!("{{{}}}", o.iter().map(|(k, v)| format!("{}:{}", quote(k), dump(v))).collect::<Vec<_>>().join(",")),
    }
}
