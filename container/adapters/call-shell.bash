# Shell call worker (call-native.mjs): `bash call-shell.bash <file> <tmp>`.
# It sources the bundle file, then calls each step's function in this same
# shell (what a call sets stays set for the next), its stdout written to
# <tmp>/out (the step's value) and its stderr to the worker's stderr.
# Requests on stdin, NUL-separated: the name, the argument count, then each
# argument. Answers on stdout, one line each: L (the file is loaded),
# R <status> (the call returned that status), M <names> (no such function:
# the functions the file defines), D (no more steps).
exec 3>&1 1>&2 4<&0 0</dev/null
__call_file=$1 __call_tmp=$2
set --
# shellcheck disable=SC1090
source "$__call_file"
printf 'L\n' >&3
while IFS= read -r -d '' __call_name <&4 && IFS= read -r -d '' __call_argc <&4; do
  __call_args=()
  for ((__call_i = 0; __call_i < __call_argc; __call_i++)); do
    IFS= read -r -d '' __call_arg <&4
    __call_args+=("$__call_arg")
  done
  if [[ "$(type -t -- "$__call_name")" != function ]]; then
    printf 'M %s\n' "$(compgen -A function | tr '\n' ' ')" >&3
    continue
  fi
  "$__call_name" "${__call_args[@]}" >"$__call_tmp/out" && __call_status=0 || __call_status=$?
  printf 'R %s\n' "$__call_status" >&3
done
printf 'D\n' >&3
exit 0
