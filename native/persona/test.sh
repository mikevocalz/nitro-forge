#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT
cxx="${CXX:-c++}"
cc="${CC:-cc}"
# Sanitizers are opt-in so the same command works with toolchains lacking them.
flags=(-std=c++17 -Wall -Wextra -Werror -pthread -I include)
if [[ "${PERSONA_SANITIZE:-0}" == 1 ]]; then
  flags+=(-fsanitize=address,undefined -fno-omit-frame-pointer -g)
fi
"$cxx" "${flags[@]}" src/persona.cpp tests/persona_test.cpp -o "$build/core"
"$build/core"
"$cc" -std=c11 -Wall -Wextra -Werror -I include -c tests/c_consumer.c -o "$build/consumer.o"
"$cxx" "${flags[@]}" src/persona.cpp src/persona_c.cpp "$build/consumer.o" -o "$build/consumer"
"$build/consumer"
