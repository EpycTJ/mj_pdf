# MJ PDF — compiled APKs

Built automatically by the *Android APK* workflow
(upstream source: [mudlej_android/mj_pdf_reader](https://gitlab.com/mudlej_android/mj_pdf_reader.git) @ main).

* `debug` APK — debug-signed, installable on any device
* `release-*-ci-signed` APKs — minified, per-ABI, signed with a public CI key
  (clean installs only; they will not upgrade an official MJ PDF release)

See `SHA256SUMS` for checksums. This branch is force-pushed on every
published build — do not branch off it.
