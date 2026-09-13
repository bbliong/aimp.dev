# Release runbook

1. Pastikan `package.json` version, `repository`, changelog, README, dan supported platforms benar.
2. Jalankan `npm ci` dan `npm run verify` pada Node 22 dan 24.
3. Review `npm pack --dry-run --json`, lalu install tarball ke prefix sementara.
4. Push tag `v<version>` dari commit yang sudah diverifikasi. Workflow GitHub Actions menjalankan test dan publish beta melalui npm trusted publishing.
5. Setelah smoke test `npm install -g @bbliong/aimp@beta` dan `npx @bbliong/aimp@beta --version`, dokumentasikan hasil pilot sebelum memindahkan dist-tag ke `latest`.

Jangan memakai token publish pada job pull request. Versi yang sudah dipublikasikan tidak dapat digunakan ulang.
