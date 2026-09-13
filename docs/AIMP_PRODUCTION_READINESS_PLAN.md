# AIMP — audit dan rencana menuju rilis npm

Tanggal audit: 12 September 2026. Lokasi: `/home/bbliong/project/AI`.

**Keputusan: belum layak dirilis stabil.** Paket sudah dapat dibentuk oleh npm, tetapi jalur utama sync memiliki masalah integritas data, pengecualian file, recovery, dan deteksi perubahan. Prioritas pertama adalah memperbaiki kontrak sync dan membuktikannya melalui pengujian integrasi, kemudian mengukur performa, memperbaiki TUI, dan menyiapkan rilis.

Dokumen ini merupakan rencana pekerjaan, bukan pernyataan bahwa perbaikannya sudah diimplementasikan. Untuk pekerjaan berikutnya, gunakan kontrak di sini sebagai pengganti bagian yang bertentangan dalam `AIMP_IMPLEMENTATION_PLAN.md` dan `AIMP_EXECUTION_PROMPT.md`. Kedua dokumen lama masih menjelaskan sanitasi otomatis, merge tiga arah, commit original, dan antarmuka yang sudah berubah.

## 1. Kontrak produk yang dipertahankan

- Nama paket dan executable: `aimp`, dengan kepemilikan nama diperiksa ulang menjelang publikasi.
- CLI lokal, dapat digunakan bersama berbagai AI, IDE, dan harness tanpa integrasi API wajib.
- Satu project original, satu repo mirror independen, pasangan branch. Jangan otomatis mengganti branch mirror ketika original berubah; `/use` melakukan perpindahan secara eksplisit.
- Semua sync manual. Panel monitoring tampil sebagai snapshot ketika `/status`, tanpa polling seluruh repo saat idle.
- `/sync`: preview perubahan AI, konfirmasi, terapkan hanya path yang disetujui ke original, lalu buat checkpoint lokal AI dengan akhiran `(synced)`.
- Original boleh memiliki perubahan belum di-commit. Tampilkan path yang akan bertabrakan dan minta persetujuan overwrite. Isi dan staging path lain harus tetap utuh.
- AIMP tidak membuat commit di original dan tidak melakukan push.
- `/sync-original-to-ai`: refresh manual dari original. Untuk rilis pertama tetap mensyaratkan original bersih, sesuai perilaku sekarang, dan mirror tidak memiliki perubahan yang belum ditangani. Dukungan original dirty pada arah ini ditunda agar kontraknya jelas.
- `.aimpignore` menjadi pengecualian kuat untuk kedua arah, termasuk file yang sudah tracked. File yang dikecualikan tidak disalin, dihapus, atau dimasukkan ke checkpoint sync secara tidak sengaja.
- Tidak ada sanitasi otomatis, pemulihan credential, atau penyimpanan credential asli pada mesin sync baru. Placeholder disiapkan pengguna.
- `/serialize` dipertahankan sebagai adopsi perubahan terpilih menjadi baseline lokal mirror, dengan preview dan checkpoint lokal. Tidak lagi memindai atau mengubah pola credential secara otomatis.
- Bahasa default Inggris, dapat diganti ke Indonesia. Bantuan, error, konfirmasi, template, dan TUI mengikuti pengaturan yang sama.
- `AGENTS-AIMP.md` menjelaskan AIMP dan aturan penggunaan; instruksi ini bukan sandbox. Pengguna memasangnya ke konteks harness jika tidak dibaca otomatis.
- Target dukungan pertama: Linux dan WSL2 pada filesystem Linux. macOS, Windows native, network filesystem, dan WSL `/mnt/c` belum diklaim didukung sampai diuji.

Catatan `/serialize`: mengadopsi baseline saja tidak membuat file terlindungi dari refresh berikutnya. Preview harus membedakan “baseline lokal” dan “kecualikan dua arah melalui `.aimpignore`”. Jangan menjanjikan merge otomatis antara placeholder dan credential asli dalam file yang sama. Pengguna yang membutuhkan perlindungan seluruh file memilih pengecualian path tersebut.

## 2. Bukti pemeriksaan saat ini

| Pemeriksaan | Hasil | Batas bukti |
|---|---|---|
| Kode | `src/cli.js` 592 baris; `src/ui.js` 149 baris, banyak fungsi padat dalam satu baris | Semua jalur command utama diperiksa secara statis |
| Git workspace AIMP | `git rev-parse` menyatakan bukan repository Git | Belum tersedia riwayat, tag, remote, atau workflow CI di workspace ini |
| Runtime | Node 22.22.2, npm 10.9.7, Git 2.34.1 | Versi lain belum diuji |
| Test existing | `npm test` dan eksekusi test langsung selesai sukses; source mendefinisikan dua kasus sanitizer/merge | Belum menguji jalur `/sync` aktif, recovery, branch, ataupun Ink |
| Packaging | `npm pack --dry-run --json` sukses: 6 file, 18.197 byte tarball, 65.904 byte unpacked | Belum merupakan instalasi tarball atau publikasi registry |
| CLI dasar | `--help` dan `--version` berjalan | `--version` masih hardcoded; help masih Indonesia |
| Audit integrasi | Tujuh kasus terisolasi direproduksi dengan repo dan state sementara | Tidak mengubah project Polong, mirror pengguna, atau state asli |

Metadata positif yang sudah ada: executable dengan shebang, mode executable, ESM, `files` allowlist, `engines`, lisensi MIT, dan lockfile dependency. Jangan membangun ulang bagian ini tanpa alasan.

Belum dilakukan: profiling I/O project pengguna, pengujian PTY lintas terminal, instalasi bersih dari tarball, audit advisory dependency dari registry, pemeriksaan kepemilikan npm, atau login/publish. Persentase disk 100% belum dapat diatribusikan ke satu penyebab berdasarkan audit ini.

## 3. Temuan dan prioritas

P0 = berpotensi salah menulis, kehilangan data, melanggar pengecualian, atau mengklaim transaksi sukses secara keliru. P1 = menghambat penggunaan andal, performa, atau rilis. P2 = pengembangan sesudah fondasi dan rilis awal terbukti.

| ID | Prioritas | Temuan dan lokasi | Dampak / bukti |
|---|---|---|---|
| A01 | P0 | `gitText().trim()` pada `src/cli.js:127`, lalu parser posisi tetap di `:391–399` | Direproduksi: modifikasi `app.txt` dibaca sebagai `pp.txt`. Spasi status Git awal hilang. Quoting, newline, Unicode, dan rename juga belum ditangani benar. |
| A02 | P0 | `/sync`, `src/cli.js:389–411`, hanya menyalin `.aimpignore`; tidak memfilter daftar perubahan dengannya | Direproduksi: `secret.local` yang dikecualikan tetap ditimpa di original. Ini pelanggaran kontrak utama. |
| A03 | P0 | Pemeriksaan path di `:398` dan penulisan di `:411` hanya memeriksa leaf source | Direproduksi: symlink target mengarahkan copy keluar original. Ancestor symlink, hardlink target, pathspec Git, dan canonical path juga perlu pengamanan. |
| A04 | P0 | `allowFailure: true` pada commit AI, `:415` | Direproduksi dengan hook fixture yang exit 1: HEAD tetap sama tetapi history mencatat sukses dan backup dihapus. |
| A05 | P0 | Deteksi pending hanya `git status`, `:215–218`, `/sync :391` | Direproduksi: commit AI yang belum tersinkron dianggap clean dan ditolak oleh sync karena tidak ada working-tree changes. Refresh dapat menimpa pekerjaan tersebut. |
| A06 | P0 | `/recover :420–437` masih memakai tahap lama dan menjalankan `git reset` original | Direproduksi: staging original berubah setelah recovery. Tahap `original-committed` tidak cocok dengan jalur sync baru; checkpoint yang terlanjur dibuat belum ditangani aman. |
| A07 | P0 | `/sync :405–418` belum memeriksa transaksi sebelumnya, belum membekukan payload, dan tidak memvalidasi ulang persetujuan | Journal lama bisa tertimpa. Edit AI saat copy/commit atau edit original saat prompt dapat membuat isi yang disetujui berbeda dari isi yang diterapkan/checkpoint. Temuan statis. |
| A08 | P0 | `/reinit :506–519` menolak descendant original tetapi menerima ancestor original | Konfirmasi `y` dapat menghapus folder yang mencakup original. Target dihapus sebelum replacement berhasil dibuat. Temuan statis; penghapusan ancestor tidak dicoba. |
| A09 | P0 | Ink `src/ui.js:55` selalu memanggil handler original; `/serialize` hanya di `mirrorMain`, `src/cli.js:477` yang tidak dipanggil `main` | Routing mode mirror belum benar. `findMirrorState :446` memilih pair pertama berdasarkan folder, bukan branch aktif. Baseline branch yang salah dapat dipakai. |
| A10 | P0 | Lock `src/cli.js:143–156`; state dimuat sebelum lock; mirror serializer tidak dikunci di jalur lamanya | Lock aktif dianggap stale setelah 6 jam; owner belum ditulis dapat disangka stale; PID reused/EPERM belum dibedakan; perubahan state paralel bisa hilang. |
| A11 | P1 | `originalSnapshot` masih dipakai init, reinit, serialize, refresh; snapshot/secret ada di jalur lama | Sanitasi masih aktif di beberapa command walau keputusan produk telah berubah. `compactState` menghapus baseline sementara fungsi lama masih bergantung padanya. |
| A12 | P1 | `walk` dan `aimpIgnored :103–173`, `materialize :219` | Enumerasi recursive, subprocess ignore per path, pembacaan base64 seluruh isi, dan rewrite seluruh snapshot pada refresh. Kandidat beban I/O; belum diprofilkan di project pengguna. |
| A13 | P1 | `status :321` dan `showDiff :325` memanggil `refreshAimpIgnore` | Direproduksi: `/status` menciptakan `.aimpignore` di mirror. Command inspeksi ternyata memutasi filesystem. Config yang dihapus di original juga tidak menghapus salinan config lama. |
| A14 | P1 | Git adapter `:118–125` mengabaikan global config tetapi mewarisi env Git dan local config | `GIT_DIR`/`GIT_INDEX_FILE`, hook, filter, signing, nested repo, dan `.gitattributes` belum memiliki kebijakan. Original file `.gitattributes` bisa terbawa ke mirror. |
| A15 | P1 | UI `:32, :61–89, :96–124, :131–147` | Branch header menebak pair pertama; lebar kiri tetap 58/62% tanpa monitor; scroll menghitung logical line bukan wrapped row; mouse chunk terpisah belum terurai; Ctrl+C tidak mengoordinasi transaksi; log dibatasi 199 baris. |
| A16 | P1 | README, help, template, execution prompt | Masih menjanjikan sanitasi, merge tiga arah, commit pasangan dan `/resolve`; implementasi baru tidak mengikuti semuanya. `/doctor` baru informasi versi/root, bukan pemeriksaan kesiapan. |
| A17 | P1 | `package.json`, test, tidak ada CI/source repository | Tidak ada release verification, metadata repository/bugs/homepage, pengujian tarball, changelog, migrasi state teruji, dan suite integrasi utama. |

Tujuh reproduksi: A01, A02, A03, A04, A05, A06, A13. Temuan lain adalah hasil pembacaan kode, belum klaim eksploit atau kegagalan yang diuji.

## 4. Desain sync yang menjadi acuan implementasi

### 4.1 Sumber perubahan Git

Pisahkan sumber kebenaran menjadi tiga hal: HEAD branch mirror, baseline mirror terakhir yang sudah diterapkan/diadopsi, dan isi working tree saat ini.

Kandidat AI → original berasal dari gabungan:

1. Path pada perubahan commit `baselineAi → HEAD`.
2. Perubahan staged dan unstaged.
3. File baru non-ignored.

Gabungkan berdasarkan path literal, kemudian bandingkan versi akhir kandidat terhadap baseline agar file yang dikembalikan ke semula tidak dianggap pending. Apply mengambil versi akhir working tree; perubahan hanya di index yang bertentangan dengan working tree harus dijelaskan, tidak disinkron diam-diam. Tentukan aturan eksplisit untuk partial staging.

Gunakan output `--porcelain=v1 -z` atau v2 `-z` secara konsisten; adapter mengembalikan Buffer tanpa `trim()`. NUL memisahkan nama file sehingga spasi/newline tidak menjadi delimiter. Git merekomendasikan bentuk ini untuk parser mesin. [Dokumentasi git-status](https://git-scm.com/docs/git-status#_porcelain_format_version_1)

Jangan hanya memperbaiki A01 dengan `trimEnd()`. Buat satu parser yang dipakai status, diff, sync, dan branch guard. Gunakan literal pathspec dan daftar NUL melalui stdin/file agar nama seperti `:(glob)*`, `-file`, serta puluhan ribu argumen tidak mengubah cakupan operasi. Kebijakan v1: path UTF-8 didukung; nama byte yang tidak dapat direpresentasikan ditolak sebelum mutasi dengan error jelas.

Rename diperlakukan sebagai delete + add pada transport file, tetap dikelompokkan sebagai rename pada preview bila tersedia. Terapkan kebijakan ignore ke kedua path secara terpisah. Mode executable, file kosong, binary, deletion, dan type change masuk dalam change model.

### 4.2 Kebijakan file yang tunggal

Urutan keputusan:

1. Path di luar root, metadata Git, state AIMP, jenis file berbahaya/tidak didukung: selalu ditolak.
2. File internal AIMP: dipisahkan sebagai metadata; tidak ikut sync kode.
3. `.aimpignore`: mengecualikan path tracked maupun untracked di kedua arah.
4. `.gitignore` bertingkat dan exclude Git: menentukan penemuan file untracked, sesuai semantik Git. File tracked tetap kandidat kecuali `.aimpignore` mengecualikannya.

Evaluator `.aimpignore` tidak boleh tanpa sengaja menggabungkan seluruh aturan `.gitignore` sebagai pengecualian tracked. Pilih parser pola Git yang teruji atau evaluator Git terisolasi; buktikan negation, anchored pattern, directory pattern, dan precedence menggunakan fixtures sebelum memilih dependency.

Batch evaluasi; jangan spawn `git check-ignore` sekali per file. Cache berdasarkan hash/version policy untuk satu operasi, bukan TTL yang bisa mempertahankan keputusan usang. Policy authoritative berada pada konfigurasi original/registry tepercaya; edit policy di mirror tidak otomatis memperluas path yang boleh ditulis ke original.

Mengubah policy harus menampilkan dampak re-include/exclude. Jangan menghapus file yang menjadi excluded. File yang sebelumnya dikecualikan lalu dimasukkan kembali perlu preview/rebaseline; baseline global tidak boleh membuatnya dianggap sudah tersinkron.

### 4.3 Transaksi dan invariants

State machine yang diusulkan:

```text
LOCKED → PLANNED → APPROVED → PREPARED → APPLYING
       → ORIGINAL_APPLIED → AI_CHECKPOINTED → FINALIZED → CLEANED
```

- Muat state terbaru setelah memperoleh lock; tolak mutasi baru bila ada journal yang belum selesai.
- Plan memuat root canonical, pair/branch, expected HEAD/index, policy version, operasi, ukuran, mode, checksum before/after, dan laporan yang disetujui.
- Setelah user menyetujui preview, validasi kembali hanya file kandidat, HEAD, index dan policy. Perubahan setelah preview membatalkan plan dan meminta review ulang.
- Siapkan payload immutable hanya untuk file yang berubah. Checkpoint AI harus dibentuk dari payload yang sama dengan yang disalin ke original, bukan membaca ulang working tree yang mungkin sudah berubah.
- Backup menyimpan isi, keberadaan, dan mode target kandidat. Tulis journal durable sebelum menimpa file pertama.
- Salin ke temporary sibling lalu rename untuk tiap file; validasi ancestor dan target. Penghapusan tercatat sebagai operasi tersendiri. Tidak ada atomic transaction lintas repo; journal menangani keadaan parsial.
- Gunakan isolated Git index untuk membangun tree checkpoint terbatas. `commit-tree`/`update-ref` dengan expected HEAD adalah kandidat implementasi agar commit tidak tergantung hook atau staging lain. Simpan identitas checkpoint yang direncanakan di journal sebelum update ref.
- Rekonsiliasi index mirror hanya untuk path transaksi dan hanya jika fingerprint belum berubah. Staging lain tidak boleh masuk commit atau hilang. Langkah ini harus diuji, termasuk crash setelah update ref.
- Jangan menjalankan `git add`, `reset`, `commit`, atau operasi penulisan index pada original. Semua staging original harus tetap identik.
- State/baseline/report maju hanya setelah checkpoint terbukti sesuai payload. Error commit tidak pernah dikonversi menjadi sukses.
- Cleanup backup dilakukan setelah journal/state finalized durable. Kegagalan cleanup dilaporkan sebagai pekerjaan cleanup, bukan rollback transaksi sukses.
- Ctrl+C sebelum apply membatalkan plan; ketika apply, hentikan di titik aman dengan journal tetap tersedia. Tunggu child process/operasi I/O yang sedang aktif sebelum teardown.

Recovery harus idempotent pada setiap tahap, termasuk crash tepat setelah write namun sebelum pencatatan berikutnya. Cocokkan hash dan ref aktual dengan plan; jangan mengandalkan nama tahap saja. Rollback tidak boleh menimpa edit baru setelah crash tanpa konflik/konfirmasi spesifik. State unknown/corrupt masuk `RECOVERY_REQUIRED`, bukan clean.

### 4.4 Boundary filesystem dan reinit

- Canonicalize original, mirror, state, dan ancestor target yang sudah ada. Tolak overlap di kedua arah, root filesystem, home directory, state root, dan mirror milik project lain.
- Validasi semua ancestor serta leaf source/target. Tolak symlink aktif dan dangling, hardlink file dengan link count > 1, device/FIFO/socket, submodule/gitlink dan nested repo pada rilis pertama.
- Cegah penulisan metadata `.git` dan path internal AIMP, termasuk alias/case yang relevan pada filesystem yang didukung.
- Reinit membangun repo pengganti di staging directory sebelum menyentuh target lama. Setelah valid, tampilkan isi yang akan diganti dan jalankan swap yang dapat dipulihkan. Folder lama disimpan sampai replacement dan state tervalidasi.
- Karena modelnya satu mirror banyak branch, relokasi/reinit harus memperlakukan semua pasangan yang menunjuk folder tersebut sebagai satu unit. Jangan mengganti satu pair lalu meninggalkan pair lain menunjuk repo yang telah dihapus.
- Tidak mengklaim tahan terhadap proses jahat pada akun OS yang sama. Validasi path dan pemeriksaan ulang mengurangi kesalahan dan traversal, tetapi bukan pengganti sandbox; platform yang belum mendukung primitive filesystem yang dibutuhkan ditolak/dibatasi.

### 4.5 Branch, registry, dan baseline

- Identitas project menggunakan canonical original root dan ID random mirror yang disimpan di metadata lokal, diverifikasi terhadap registry. Report hanya input pekerjaan, bukan authority untuk menemukan/mengubah original.
- Pemilihan pair harus memakai branch mirror aktual, bukan pair pertama yang foldernya cocok.
- `BRANCH_MISMATCH` muncul jika branch original dan mirror tidak cocok. `/status` tetap dapat dibaca; sync diblokir sampai `/use` selesai.
- `/use` mengecek pending work branch mirror yang sedang aktif, termasuk commit belum disinkron. Tidak membuat stash/reset diam-diam.
- Baseline per branch mencatat checkpoint mirror, referensi original, versi policy, dan hash target terakhir yang diterapkan. HEAD original saja tidak cukup karena `/sync` sengaja meninggalkan perubahan uncommitted.
- `/serialize` mengadopsi hanya pilihan user sebagai baseline. Jangan sekaligus menandai seluruh commit AI lain sebagai tersinkron. Jika hanya sebagian diadopsi, gunakan baseline tree/per-path acknowledgement; jangan sekadar memajukan satu `baselineAi` ke HEAD.
- Tolak ancestry yang tidak valid, missing baseline, merge/rebase in-progress, atau detached HEAD dengan langkah perbaikan jelas. Tidak mengarang pemetaan ulang branch.

## 5. Struktur kode yang dituju

Tidak perlu mengganti Ink atau melakukan rewrite besar sekaligus. Ekstrak modul sambil menjaga command lama melalui adapter sementara:

```text
src/
  cli/              command registry, argument parsing, dispatch per mode
  core/             project identity, branch pairing, change plan, policy
  git/              process adapter, NUL parser, index/tree/checkpoint
  fs/               containment, safe copy, payload, backup
  state/            schema, migration, registry, lock, journal, recovery
  commands/         init, reinit, use, status, diff, sync, serialize, doctor
  ui/               Ink app, viewport, input, prompts, output events
  i18n/             en, id, formatter
test/
  unit/             parser, policy, schemas, pure planning
  integration/      repo fixtures, branches, transactions, recovery
  terminal/         PTY interaction, resize, mouse, exit
  package/          installed-tarball smoke tests
bench/              fixture generation and stage timings
```

Gunakan JavaScript ESM yang ada dengan JSDoc dan `checkJs` pada tahap awal; strict types terutama untuk plan, transaction, state, dan command result. Migrasi TypeScript penuh opsional sesudah kontrak stabil, bukan syarat yang menunda perbaikan P0.

Hapus jalur snapshot/merge lama setelah jalur baru diuji. `/resolve` jangan terus menawarkan perilaku yang tidak digunakan `/sync`; tampilkan pesan deprecation dan arahkan ke review/edit manual sampai dihapus pada versi yang diumumkan. Hindari global `promptProvider`/`console` interception sebagai API domain; gunakan event/output sink dan prompt interface dengan cancellation.

## 6. Rencana pengerjaan berurutan

Estimasi di bawah adalah rentang usaha satu engineer, belum termasuk waktu menunggu CI, keputusan akun npm, atau pengujian lapangan. Ini bukan janji tanggal rilis. Beberapa langkah dapat tumpang tindih sesudah dependency-nya selesai.

| Tahap | Usaha | Pekerjaan dan deliverable | Kriteria selesai |
|---|---|---|---|
| 0. Baseline audit | 0,5–1 hari | Jadikan source repo Git setelah memastikan lokasi yang benar; arsipkan spesifikasi lama; buat fixture suite untuk tujuh reproduksi; catat compatibility matrix | Bug dapat direproduksi otomatis tanpa state/project nyata |
| 1. Git dan policy | 2–4 hari | Parser NUL, path literal, filter `.aimpignore` bersama, committed + staged + unstaged + untracked, read-only status, dispatcher per mode | A01/A02/A05/A09/A13 teratasi; daftar kandidat konsisten di status/diff/sync |
| 2. File safety | 2–3 hari | Canonical roots, containment, ancestor/leaf link validation, backup mode, reinit staging/swap | A03/A08 teratasi; tidak ada write keluar root atau ancestor deletion dalam test |
| 3. Transaction engine | 3–5 hari | Isolated payload/index, checkpoint terverifikasi, lock benar, journaling semua tahap, cancellation, recovery | A04/A06/A07/A10 teratasi; semua fault-injection lolos; index original identik |
| 4. Branch dan migrasi | 2–4 hari | Pair aktual, partial baseline adoption, versioned schema, migrasi legacy, shared-mirror reinit, hapus jalur sanitize/merge lama | Pergantian branch tidak mencampur pekerjaan; migrasi recoverable; `/serialize` berfungsi sesuai kontrak |
| 5. Performa | 2–3 hari | Telemetry lokal per tahap, benchmark, batch ignore, incremental reverse-sync, compact metadata, bounded copy | Target I/O terukur; tidak membaca/menulis isi file unchanged pada warm sync melalui kode AIMP |
| 6. TUI dan CLI | 2–3 hari | Viewport wrapped rows, resize, mouse decoder tunggal, tab cycling, prompt path, status snapshot tunggal, i18n menyeluruh, doctor, plain mode | PTY matrix lolos; tidak ada input tersembunyi, hasil hilang, terminal mode tertinggal |
| 7. Packaging dan beta | 1–2 hari | CI, metadata npm, tarball smoke, dependency audit, README/runbook/changelog, release workflow | Semua P0 ditutup; artifact beta teruji dari instalasi bersih |
| 8. Kandidat stabil | 1–2 minggu pemakaian, di luar usaha di atas | Pilot beberapa jenis repo, recovery drill, evaluasi latency dan laporan beta | Tidak ada masalah data loss yang belum terselesaikan; syarat rilis stabil seluruhnya lulus |

Perkiraan total implementasi: sekitar 15–25 hari kerja ditambah pilot. Jika hanya ingin beta dengan Linux/WSL dan scope yang sempit, batasi fitur baru; jangan mengurangi file safety atau recovery.

## 7. Performa dan masalah disk 100%

Optimasi `git add` ke daftar path adalah satu perbaikan, belum bukti bahwa bottleneck utama selesai. `/sync` masih menjalankan status original dan AI, Git dapat refresh index atau membaca isi tertentu, state lama perlu diparse, dan commit dapat memicu perilaku Git lokal. Arah original → AI masih memproses snapshot penuh.

### Pengukuran dahulu

Tambahkan `--profile`/opsi diagnostik lokal yang mencatat durasi `load-state`, `git-discovery`, `policy`, `preview`, `backup`, `copy`, `checkpoint`, `save-state`, `cleanup`; jumlah child process; byte payload/backup; dan peak RSS. Waktu user membaca prompt dipisahkan dari waktu mesin. Log tidak memuat isi file/credential dan tidak dikirim ke jaringan.

Ukur baseline di fixture 1k, 10k, dan 100k tracked files; 1, 10, dan 1k perubahan; direktori dependency ignored besar; untracked tree besar; binary 10 MB dan 100 MB. Bedakan warm/cold cache, Linux/WSL, filesystem, dan perangkat. Cold-cache test tidak boleh mengubah cache sistem pengguna secara global.

Saat profil nyata diperlukan, minta pengguna menjalankan command diagnostik atau lakukan pada salinan benchmark dengan persetujuan. Gunakan statistik per-process I/O bila tersedia; persentase aktivitas disk dari seluruh mesin tidak membuktikan bahwa semua beban berasal dari AIMP.

### Optimasi yang direncanakan

- Satu hasil inspeksi per command untuk status/panel; hilangkan pemanggilan status AI berulang dalam `monitorInfo`.
- Query Git menjadi sumber kandidat; jangan recursive scan isi project untuk incremental sync.
- Baca policy sekali, evaluasi batch, gunakan Git `cat-file --batch` atau ekuivalen bila banyak blob baseline diperlukan.
- Baca/hash/copy hanya file kandidat, stream file besar, batasi concurrency copy default 2 dengan penyesuaian berdasarkan hasil benchmark.
- Simpan metadata/checksum/ref, bukan konten seluruh repo base64 dalam state JSON; archive history terpisah agar state tidak tumbuh tanpa batas.
- Hindari `changes.find()` pada setiap file; gunakan Map agar lookup O(1).
- Gunakan staged payload sebagai satu sumber checkpoint dan copy; jangan membentuk snapshot isi repo berkali-kali.
- Untuk reverse-sync, gunakan delta Git original terhadap baseline dan hash kandidat; saat baseline/policy tidak valid lakukan rebuild eksplisit dengan preview.
- Git optional-lock/untracked-cache/fsmonitor atau pengaturan maintenance hanya dievaluasi setelah profil membuktikan manfaat; jangan mengubah config global Git sebagai optimasi otomatis.

Target awal untuk benchmark warm pada filesystem Linux lokal, 10k tracked files, 10 changed files total ≤1 MB: waktu mesin `/sync` p95 ≤2 detik dan `/status` p95 ≤1 detik. Kalibrasi dan dokumentasikan mesin referensi sebelum menjadikan ini gate CI. Target lain: saat idle tidak ada polling Git; byte copy/backup AIMP proporsional dengan perubahan; tidak ada write isi file unchanged. Jangan menjanjikan disk active selalu <100% atau performa konstan lintas disk/WSL.

## 8. Pengujian yang wajib sebelum npm beta

| Kelompok | Skenario wajib | Assertion utama |
|---|---|---|
| Dasar | init → edit → report → sync; sync ulang tanpa edit | Original berubah satu kali; HEAD/index original tetap; satu checkpoint AI; no-op tidak commit |
| Jenis perubahan | tambah, edit, hapus, rename, binary, executable, kosong, delete/recreate | Isi, mode, dan keberadaan sesuai preview |
| Nama file | spasi, Unicode, newline, leading dash, `a..b`, nama mengandung `AGENTS.md`, pathspec magic | Nama tidak dipotong, over-filter, atau memperluas staging |
| Git states | staged, unstaged, partial staged, committed pending, reverted, merge conflict | Pending akurat; pilihan sumber isi jelas; state unsupported ditolak sebelum write |
| Ignore | tracked/untracked, nested `.gitignore`, `.aimpignore`, negation, config edit/delete, re-include | Excluded tidak disalin/dihapus; policy sama pada semua command |
| Original dirty | path overlap, path lain, staging terpisah, original edit saat prompt | Konfirmasi tepat; path lain dan original index tetap identik |
| Branch | main → feature → main, AI pending commit, mismatch, deleted/recreated branch | Tidak ada pencampuran baseline atau silent discard |
| Mirror mode | `/serialize`, `/status`, `/language`, startup dari subfolder | Handler dan branch benar; command original tidak dijalankan tanpa mode yang benar |
| File safety | leaf/ancestor/dangling symlink, hardlink, nested repo, target parent original, root/home | Tidak ada write di luar cakupan; destructive target ditolak |
| Git behavior | local hook/filter/signing, inherited Git env, pathspec, no Git installed | Tidak mengeksekusi hook/filter tidak diizinkan; error actionable; tidak salah repo |
| Transaction | ENOSPC, EACCES, copy failure ke-N, checkpoint failure, state-write failure | Tidak ada false success; backup/journal cukup untuk recover |
| Crash/recovery | terminate pada setiap boundary sebelum/sesudah write/ref/state, recover dua kali | Recover idempotent; tidak reset index original; edit baru terlindungi |
| Lock | dua proses, owner write race, stale owner, live >6 jam, EPERM/PID reuse | Satu mutator; state dimuat setelah lock; owner aktif tidak direbut |
| Migration | state v2 besar/corrupt/unknown, legacy secrets, unfinished transaction, missing mirror | Backup migration utuh; tidak silently mengadopsi atau menghapus pekerjaan |
| TUI | 80×24, 60×15, 120×40, resize saat prompt, long path/output, mouse split chunks, Ctrl+C | Output bisa dicapai dengan scroll; prompt terlihat; terminal dipulihkan |
| Bahasa | en/id sebelum dan sesudah init, mirror mode, semua error/confirm/help | Tidak ada null-state crash atau teks penting campuran |
| Distribusi | install tarball ke prefix sementara, executable di luar source dir, npx, unsupported Node | Tidak bergantung source symlink atau dev dependency |

Coverage angka tidak menggantikan assertion integritas. Setiap defect P0 wajib punya regression test dan setiap tahap mutasi wajib punya test crash/recovery yang memeriksa isi file, index, HEAD, state, dan journal.

## 9. Migrasi pengguna existing

1. Tambahkan schema version baru dengan validator. Baca dan tampilkan versi lama; tolak unknown future schema.
2. Periksa journal aktif terlebih dahulu. Jangan memadatkan atau menghapus state yang masih dibutuhkan recovery lama.
3. Buat backup state/journal dengan permission terbatas sebelum migrasi; tulis output ke temporary file dan replace setelah tervalidasi.
4. Hapus ketergantungan runtime pada `baselineSnapshot` dan `secrets` melalui migrasi eksplisit. Jangan mendeteksi credential dengan memindai seluruh project lagi.
5. Verifikasi original/mirror/branch/HEAD. Jika baseline tidak dapat dibuktikan, tampilkan `BASELINE_UNKNOWN` dan pilihan review/rebaseline; jangan menganggap semua commit sudah synced.
6. Arsip legacy dapat tetap mengandung secret. Jelaskan lokasi, izin, dan retention; sediakan cleanup eksplisit setelah recovery/migrasi berhasil, tanpa menghapus backup lama secara tersembunyi.
7. `/doctor` menjelaskan lokasi mirror, branch kedua sisi, policy, pending working changes dan committed changes secara terpisah, versi state, recovery, dan alasan command diblokir. Tidak menampilkan nilai credential.

## 10. Kesiapan rilis npm

### Source, package, dan dokumentasi

- Pastikan repo Git kanonis dan URL GitHub/GitLab dari pemilik. Tambahkan `.gitignore` untuk dependency, artifacts, fixture, local state; jangan commit state project nyata.
- Isi `repository`, `bugs`, `homepage`, description sesuai workflow manual, dan metadata maintainer dari pemilik. Pertahankan `files` allowlist, MIT, bin, dan minimum runtime yang telah diuji.
- Baca versi dari satu sumber `package.json`; jangan hardcode versi pada CLI.
- Tambahkan `lint`, `typecheck`, suite integrasi, `test:terminal`, `test:package`, `verify`, dan guard release/prepublish. Instalasi pengguna tidak memerlukan build/compiler atau lifecycle script yang memodifikasi environment.
- README Inggris menjelaskan quick start, kedua arah sync, original dirty confirmation, no original commit, `.aimpignore`, `/serialize`, branch workflow, manual rules setup, platform support, dan recovery. Tambahkan dokumentasi Indonesia terpisah, CHANGELOG, CONTRIBUTING, SECURITY, dan runbook rilis.
- Ubah spesifikasi lama menjadi arsip berlabel; command yang tidak tersedia jangan dipromosikan sebagai fitur aktif.

### CI dan artifact

- CI pada setiap PR: clean checkout, `npm ci`, lint/typecheck, unit/integration, package test; Node 22 dan 24 sebagai matrix target yang harus diuji.
- PTY Linux dan smoke WSL terjadwal/manual; dokumentasikan hasil sebelum mengklaim kompatibilitas. Platform di luar matrix ditandai unsupported/experimental.
- Jalankan audit dependency dan triage advisory; jangan otomatis mengubah major dependency melalui `audit fix --force`. Dependency baru harus mempunyai alasan dan lisensi yang jelas.
- Buat tarball sungguhan, review file list, install ke prefix/temp environment baru, jalankan executable dan fixture end-to-end. Instalasi global symlink dari `npm install -g .` saja tidak membuktikan artifact publish berjalan.
- `npm pack --dry-run --json` digunakan untuk inspeksi awal isi paket; selanjutnya uji artifact yang sama dengan yang akan dirilis. [Dokumentasi npm pack](https://docs.npmjs.com/cli/v11/commands/npm-pack/)

### Publishing

- Periksa ulang nama `aimp` dan hak publish akun pada waktu rilis. Hasil “belum ada” sebelumnya bukan reservasi. Jika tidak tersedia, gunakan `@<scope>/aimp` dengan bin tetap `aimp`.
- Rilis pertama yang lolos gate beta menggunakan versi prerelease dan dist-tag `beta`; jangan langsung mempromosikan ke `latest`. Nama/versi final ditentukan berdasarkan versi yang sudah ada di registry.
- Untuk paket baru, siapkan bootstrap publish melalui akun maintainer sesuai aturan registry, lalu konfigurasi CI publisher setelah package tersedia. Authentication/ownership bukan sesuatu yang dapat dibuktikan oleh dry-run.
- Rencanakan trusted publishing OIDC pada GitHub-hosted Actions. Dokumentasi npm mensyaratkan npm ≥11.5.1 dan Node ≥22.14.0; npm lokal audit 10.9.7 belum memenuhi syarat publisher OIDC. Gunakan `id-token: write`, `contents: read`, dan workflow/repository yang cocok. Provenance otomatis berlaku pada kombinasi public repository, public package, dan trusted publishing yang didukung. [Dokumentasi trusted publishing npm](https://docs.npmjs.com/trusted-publishers/)
- Pisahkan verifikasi dan publikasi; pin action/dependency sesuai policy rilis, verifikasi tag terhadap version dan commit, dan jangan memberi publish credentials kepada job PR yang menjalankan kode kontribusi.
- Uji artifact beta dari registry setelah publish, termasuk `npx` dan install global, lalu pilot. Rilis stabil hanya setelah semua gate terpenuhi.
- Runbook insiden mencakup deprecate versi bermasalah, arahkan dist-tag ke versi sehat, dan rilis patch. Versi yang sudah diterbitkan tidak dapat digunakan ulang. [Dokumentasi npm publish](https://docs.npmjs.com/cli/v10/commands/npm-publish/)

Tidak ada publikasi, login akun, perubahan registry, atau pembuatan remote yang dilakukan pada audit ini.

## 11. Release gates

**Gate beta:** seluruh P0 ditutup dan diuji; operasi kedua arah, branch, serialize, policy, serta recovery bekerja sesuai kontrak; tidak ada known data-loss bug; migrasi pengguna lama teruji; tarball terinstal bersih; README tidak membuat klaim yang belum terbukti; baseline benchmark tersedia; keterbatasan platform disebutkan.

**Gate stabil:** seluruh P1 yang termasuk scope dukungan selesai; pilot pada beberapa jenis repo lolos; benchmark memenuhi target yang disepakati; terminal/resize/scroll diuji pada lingkungan yang diklaim; recovery drill dan release rollback drill lolos; provenance/publishing dan akses maintainer telah diverifikasi; dokumentasi dan changelog cocok dengan artifact.

P2 setelah stabil: macOS/Windows native, dukungan worktree/submodule/LFS, fsmonitor opsional, plugin system, shell installer, dan integrasi harness. Tidak perlu menambah fitur-fitur ini untuk membuat rilis pertama andal.

**Langkah implementasi pertama:** jadikan tujuh reproduksi audit sebagai regression suite, kemudian kerjakan parser Git dan policy path bersama perbaikan routing mirror. Setelah kandidat perubahan dapat dipercaya, bangun file safety dan transaksi sebelum optimasi UI atau publikasi beta.
