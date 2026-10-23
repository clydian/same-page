#!/bin/bash
set -euo pipefail
out="$PWD/artifacts/verification/issue-564-library"
mkdir -p "$out"
curl -fsSL --retry 0 https://download.gnome.org/sources/libsoup/3.6/libsoup-3.6.6.tar.xz -o "$out/libsoup-3.6.6.tar.xz"
echo "51ed0ae06f9d5a40f401ff459e2e5f652f9a510b7730e1359ee66d14d4872740  $out/libsoup-3.6.6.tar.xz" | sha256sum -c -
tar -xJf "$out/libsoup-3.6.6.tar.xz" -C "$out"
meson setup "$out/build" "$out/libsoup-3.6.6" --prefix=/tmp/issue-564-libsoup-fixed --buildtype=release -Dtests=false -Dinstalled_tests=false -Dintrospection=disabled -Dvapi=disabled -Ddocs=disabled -Dsysprof=disabled -Dgssapi=disabled -Dntlm=disabled -Dbrotli=disabled -Dpkcs11_tests=disabled -Dtls_check=false
meson compile -C "$out/build" -j 2
meson install -C "$out/build"
fixed=$(find /tmp/issue-564-libsoup-fixed -name 'libsoup-3.0.so.0' -print -quit)
test -n "$fixed"
echo "LIBSOUP_FIXED=$fixed" >> "$GITHUB_ENV"
strings /ms-playwright/webkit-2336/minibrowser-wpe/sys/lib/libsoup-3.0.so.0 | awk '/^libsoup\/3/ { print; exit }' > "$out/bundled-version.txt"
sha256sum /ms-playwright/webkit-2336/minibrowser-wpe/sys/lib/libsoup-3.0.so.0 "$fixed" > "$out/library-sha256.txt"
