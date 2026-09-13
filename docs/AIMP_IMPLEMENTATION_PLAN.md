# aimp: spesifikasi implementasi dan audit technical debt

Tanggal validasi: 11 September 2026. Status: desain untuk implementasi; aplikasi belum dibuat.

Dokumen ini menggantikan seluruh rancangan sebelumnya yang bertentangan. Keputusan terakhir adalah **satu repo asli, satu repo AI independen, banyak pasangan branch, dan sesi CLI interaktif**. Tidak ada reset seluruh `.git`, folder AI per branch, sandbox, atau integrasi API model.

## 1. Hasil validasi

Konsep layak dibangun sebagai alat pengelolaan salinan dan review semi-manual. Ia bukan batas keamanan terhadap AI yang sengaja mengabaikan instruksi. Bagian yang sederhana bagi user tetap membutuhkan implementasi Git, sanitasi, dan transaksi yang teliti.

| Temuan pada rencana/prompt sebelumnya | Keputusan final | Alasan |
|---|---|---|
| Menghapus `.git` setiap refresh, tetapi juga ingin banyak branch AI | Jangan hapus `.git`; refresh menjadi commit baru pada branch aktif | Menghapus `.git` menghilangkan seluruh branch dan jejak AI |
| “Clone” dapat berarti `git clone` dengan seluruh sejarah | Salin snapshot tersanitasi, lalu inisialisasi repo independen | Riwayat asli dapat berisi credential |
| `AGENTS.md` dianggap mencegah akses folder lain | Nyatakan sebagai instruksi perilaku | Tidak mengubah izin filesystem; pembacaannya bergantung harness |
| Dua Git harus memiliki hash commit sama | Pesan checkpoint sama, hash berbeda, pasangan dicatat | Isi dan parent kedua repo berbeda |
| “Setiap update” belum jelas | Satu `/sync` yang diterima = satu batch dan satu commit asli | Batas pekerjaan eksplisit; tidak ada autosave watcher |
| “Clean” belum jelas | Working tree selaras dengan HEAD; tidak ada pekerjaan belum diterapkan; laporan belum siap untuk batch berikutnya | Working tree bersih saja tidak membuktikan commit AI telah tersinkron |
| Laporan AI menjadi dasar otomatis penerapan | Laporan adalah input pesan; diff dan snapshot aktual menjadi sumber kebenaran | Laporan dapat tidak lengkap atau keliru |
| Original dan AI sama-sama berubah membuat jalan buntu | Gunakan baseline tersanitasi dan merge tiga arah; konflik diselesaikan sebelum penerapan | Menghindari overwrite dan reset paksa |
| Git push “tidak mungkin terjadi” | CLI tidak melakukan push, AI diperintahkan tidak push | Tanpa sandbox, AI masih bisa menambah remote atau mengunggah file |
| Dua repo dan banyak file dianggap bisa diperbarui atomik | Jurnal, backup, pemeriksaan HEAD, dan recovery wajib | Tidak ada satu transaksi filesystem/Git yang meliputi seluruhnya |
| `/sync-master-to-ai` ambigu | Nama kanonis `/sync-original-to-ai` | Arah menunjuk repo asli pada branch aktif, bukan branch master |

**Makna trace final:** trace per batch/transaksi, bukan replikasi satu-per-satu seluruh commit asli. `/sync` menghasilkan commit pasangan. Refresh dari beberapa commit asli boleh menjadi satu commit AI dengan rentang sumber dicatat dalam jurnal.

### Bukti yang sudah diperiksa

- Workspace saat pemeriksaan belum memiliki kode aplikasi atau `package.json`; tidak ditemukan `AGENTS.md` pada jalur ancestor yang diperiksa.
- Tool lokal: Git 2.34.1, Node.js 22.22.2, npm 10.9.7.
- Eksperimen terisolasi di direktori sementara berhasil membuat commit dengan `commit-tree`, menolak perubahan ref dengan expected HEAD yang sudah usang, menggabungkan edit terpisah dengan `merge-file`, dan mendeteksi konflik edit pada lokasi sama.
- Eksperimen tersebut **bukan** pengujian implementasi aimp, sanitizer Python, crash recovery, atau kompatibilitas IDE. Semua itu masih harus dibuktikan pada tahap implementasi.
- `git worktree` memang berbagi repository, sehingga tidak digunakan untuk salinan AI. [Dokumentasi Git](https://git-scm.com/docs/git-worktree)

## 2. Tujuan, batas kepercayaan, dan non-goal

### Tujuan produk

1. User cukup menjalankan `aimp` dari repo asli dan menggunakan slash command.
2. AI bekerja pada salinan tersanitasi, menggunakan IDE/harness pilihannya.
3. User menjalankan aplikasi asli dengan terminal, Docker, IDE, atau runtime lain.
4. Error dibagikan secara manual oleh user; script tidak mengumpulkan log aplikasi.
5. Credential yang dikonfigurasi tidak terbawa dalam salinan awal dan hasil refresh.
6. Perubahan hanya diterapkan setelah preview, konfirmasi, dan validasi keadaan terbaru.
7. Pekerjaan lintas branch tidak tercampur, meskipun folder AI hanya satu.
8. Pesan commit berasal dari laporan AI yang diperiksa user.

### Batas keamanan yang wajib dijelaskan

- User dan CLI host dipercaya. File, laporan, konfigurasi project, dan perubahan dari AI diperlakukan sebagai data yang perlu divalidasi.
- AI memiliki izin OS sesuai akun yang menjalankannya. State di luar salinan dengan permission terbatas mengurangi penyalinan tidak sengaja, tetapi bukan perlindungan dari proses AI pada akun yang sama.
- Sanitasi tidak membuktikan seluruh secret ditemukan. Encoding, enkripsi, data pribadi, dan credential yang tidak didaftarkan dapat terlewat.
- Kode yang disetujui dapat membaca credential ketika dijalankan pada aplikasi asli. Review dan tes tetap merupakan tanggung jawab user.
- Tidak menjalankan `git push` bukan berarti jaringan AI dibatasi.
- Dokumen `AGENTS.md` mungkin tidak dibaca otomatis oleh semua harness. Sediakan teks aturan untuk dipasang manual; jangan mengklaim kompatibilitas otomatis dengan semuanya.

### Di luar v1

Sandbox/VM/container AI, API model, chat dengan model di dalam CLI, watcher, streaming log, debugger, Docker orchestration, automatic push, deploy, migration, GUI desktop, IDE extension, sync lintas mesin, Windows native, multi-agent paralel dalam satu folder, automatic stash, force reset, serta automatic rebase.

## 3. Bentuk aplikasi dan teknologi

### Runtime dan paket

- Node.js 22 dan 24 LTS; CI menguji keduanya. Git minimal 2.34. Linux menjadi platform pertama; WSL2 diuji pada filesystem Linux `/home/...`.
- TypeScript strict, ESM, hasil build JavaScript biasa dengan executable `aimp`.
- Nama paket publik `aimp` masih sementara; sebelum publishing, periksa ketersediaan npm. Jika tidak tersedia, gunakan paket scoped dengan nama executable tetap. Publishing bukan bagian otomatis implementasi.
- Instalasi utama npm global atau `npx`; tidak memerlukan Python, Docker, rsync, atau compiler pada mesin pengguna.
- Installer shell adalah wrapper instalasi npm untuk versi eksplisit, memeriksa Node/npm, tidak memakai sudo, dan tidak mengubah shell profile secara otomatis.
- Node 22 dan 24 tercatat sebagai LTS ketika desain diperiksa. [Daftar rilis Node.js](https://nodejs.org/en/about/previous-releases)

### Dependency dan modul

- REPL: `node:readline/promises`, bukan framework chat atau terminal layar penuh.
- Subprocess: `spawn`/`execFile` dengan array argumen dan `shell: false`. Jangan menyusun shell command dari nama branch, path, atau pesan commit. [Dokumentasi Node.js](https://nodejs.org/api/child_process.html)
- Git adapter memanggil executable Git lokal; jangan memakai shell wrapper Git sebagai sumber perilaku tersembunyi.
- Parser Python: `web-tree-sitter` dengan grammar Python WASM yang dibundel saat release. Pengguna tidak mengunduh grammar saat runtime. Bundle parser, grammar, lisensi, dan versi yang kompatibel dalam lockfile; pilih versi stabil saat implementasi. WASM dipakai untuk menghindari native build pada instalasi, dengan biaya parsing yang harus diukur. [Web Tree-sitter](https://github.com/tree-sitter/tree-sitter/tree/master/lib/binding_web)
- Pengujian: `node:test`, fixture Git sementara, dan build TypeScript. Jangan menambah framework test kedua tanpa kebutuhan.
- State: file JSON berversi dengan atomic replacement dan jurnal transaksi. Tidak ada service database.
- Modul domain: session/commands, project registry, branch manager, manifest/filesystem, sanitizer, report parser, merge planner, Git adapter, transaction/recovery, renderer.
- Command handler hanya mengorkestrasi domain; sanitizer dan merge planner berupa fungsi yang dapat diuji tanpa REPL.

Tidak membangun sistem plugin umum pada v1. Interface sanitizer dibuat kecil agar format baru bisa ditambahkan tanpa mengubah mesin sync.

## 4. Pengalaman pengguna dan kontrak command

```text
$ aimp

aimp
Original branch : feature/login
AI branch       : feature/login
AI workspace    : ../toko-ai
Status          : AI_PENDING

aimp> /status
aimp> /diff
aimp> /get-summary
aimp> /get-commit-message
aimp> /sync
aimp> /exit
```

Saat direktori awal berada di subfolder asli, temukan root repo. Jika dijalankan dalam salinan AI, tampilkan bahwa session harus dibuka dari asli; jangan otomatis mengakses asli berdasarkan file dari AI. Startup memerlukan TTY; mode automation noninteraktif ditunda.

| Command | Input dan output | Mutasi |
|---|---|---|
| `/help` | Daftar command dan arah sinkronisasi | Tidak |
| `/doctor` | Versi, repository shape, state, filter/hook policy, filesystem | Tidak |
| `/init` | Questionnaire untuk pasangan project pertama | Ya, setelah preview |
| `/use` | Deteksi branch asli aktif; pilih/buat branch AI pasangannya | Ya jika switch/create |
| `/status` | HEAD kedua sisi, status batch/laporan, pending changes | Tidak |
| `/list` | Pasangan branch di project ini dan status terakhir terverifikasi | Tidak |
| `/diff` | Preview default AI ke asli; menerima `--from original` | Tidak |
| `/get-summary` | Baca Summary, Tests, Notes dari laporan valid | Tidak |
| `/get-commit-message` | Baca usulan commit message tanpa commit/push | Tidak |
| `/sync` | Terapkan satu batch AI ke asli melalui review | Ya |
| `/sync-original-to-ai` | Update branch AI dari commit asli saat AI tidak pending | Ya |
| `/resolve` | Pilih konflik, simpan resolusi kandidat, tanpa menyentuh asli | Hanya data kandidat |
| `/log` | Transaksi, arah, branch, hash, pesan, status recovery | Tidak |
| `/recover` | Lanjutkan/rollback transaksi sesuai kondisi aktual | Ya, dengan preview |
| `/prune` | Preview dan hapus backup transaksi selesai yang tidak lagi dibutuhkan | Ya, konfirmasi |
| `/exit` | Keluar, tidak auto-sync atau discard | Tidak |

- Tidak menyediakan alias `/sync-master-to-ai`: jika diketik, jelaskan nama command yang benar tanpa mengeksekusi.
- Teks selain command tidak dikirim ke AI atau shell. Tampilkan bantuan singkat.
- Ctrl+C saat prompt membatalkan input; saat review membatalkan rencana. Saat transaksi berjalan, selesaikan pencatatan tahap aman sebelum keluar.
- Semua confirm default `No`. Penghapusan menampilkan jumlah dan path, kemudian membutuhkan konfirmasi terpisah. Tidak ada `--yes` pada command mutasi v1.
- Laporan dan nama file diperlakukan sebagai teks terminal: escape karakter kontrol/ANSI, jangan merender escape sequence dari project.
- `/get-*` tidak membuat laporan atau pesan melalui model; jika belum valid, tampilkan bagian yang perlu dilengkapi AI.
- Semua output `/get-*`, diff, error, dan journal melewati penyamaran known-secret dan terminal escaping. Jika isi laporan mengandung secret terdaftar, blokir penggunaannya untuk sync dan jangan mencetak nilai mentahnya.

## 5. Model satu salinan, banyak branch

```text
project-original/                 project-ai/
  main                             main
  feature/login                    feature/login
  feature/payment                  feature/payment
```

1. Folder AI adalah repo mandiri. Tidak ada shared object store, alternates, worktree, remote, atau tautan `.git` ke asli.
2. Nama branch AI sama dengan branch asli; identitas pasangan tetap berupa ID state, bukan hanya nama string.
3. Branch AI baru dibuat dengan **root commit independen/orphan** dari snapshot branch asli tersanitasi. Tidak perlu menyalin ancestry asli atau branch AI lain.
4. Branch AI yang sudah ada digunakan kembali; tidak dibuat ulang dan tidak di-reset paksa.
5. `/use` mengikuti branch asli yang telah user checkout. CLI tidak mengubah branch asli.
6. Setiap command memeriksa branch asli dan AI; perubahan eksternal membuat status `BRANCH_MISMATCH` dan membatasi command ke inspeksi, `/use`, recovery, atau exit.
7. Sebelum switch AI, index/worktree harus bersih pada file relevan dan tidak ada delta terhadap baseline sync terakhir. Commit AI yang sudah dibuat tetapi belum diterapkan tetap dianggap pending.
8. Jika asli sudah berpindah saat AI masih pending pada branch lama, instruksikan user kembali ke branch asli lama, selesaikan `/sync`, lalu pindah lagi. Tidak membuat stash tersembunyi.
9. Template laporan kosong boleh dipindahkan. Laporan berisi pekerjaan yang tidak memiliki delta kode perlu ditinjau dan diarsipkan dengan konfirmasi sebelum switch; jangan membuangnya diam-diam.
10. Saat kembali ke branch lama, verifikasi HEAD asli masih descendant baseline tersimpan. Jika valid, gunakan baseline lama dan tawarkan refresh bila asli maju.
11. Branch rename, penghapusan, atau pembuatan ulang branch dengan ancestry berbeda diblokir. Tidak menebak pemetaan baru.
12. Untuk v1, tolak original yang memiliki linked worktree aktif, repo bare, operasi merge/rebase/cherry-pick sedang berjalan, atau `.git` yang bukan direktori repo biasa. Dukungan tambahan memerlukan identitas dan lock yang berbeda.

**Prompt konteks branch:** setiap `/use` menampilkan pesan agar user menghentikan edit AI dan membuka percakapan baru atau menginformasikan perubahan branch. CLI tidak bisa menghapus ingatan percakapan IDE.

## 6. Onboarding dan pemilihan file

### Prasyarat

- Original harus memiliki commit awal, branch valid, index bersih, dan tidak ada edit tracked/untracked non-ignored yang belum diselesaikan.
- File ignored seperti `.env` boleh ada untuk diproses oleh aturan khusus; script tidak melakukan commit otomatis atasnya.
- Jika file credential tracked berubah di original, tetap dianggap original dirty dan harus user commit/bereskan sendiri. Hanya file ignored yang dipilih policy boleh dibaca tanpa memaksanya masuk commit.
- Resolve root dengan `realpath`. Original, mirror, dan direktori state tidak boleh bertumpuk atau saling berada di dalamnya.
- Mirror default folder saudara `<project>-ai`. Jika berisi sesuatu, minta lokasi lain; jangan menganggap boleh menghapus.
- Tolak symlink, hardlink file dengan link count lebih dari satu, socket, FIFO, device, nested repository, gitlink/submodule pada path yang dipilih. Pengecualian file boleh dipilih user.
- Setiap materialisasi ulang memeriksa relative path, parent directories, realpath root, dan identitas root sebelum menulis. Jangan hanya memvalidasi path saat onboarding; file atau parent dapat berubah kemudian. Hindari mengikuti symlink saat open dan batalkan bila identitas path berubah.

### Questionnaire

1. Tampilkan lokasi asli, branch, lokasi AI, dan konsekuensi aturan tanpa sandbox.
2. Inventory tracked files, untracked non-ignored, serta kandidat credential ignored yang umum. Jangan memindai seluruh home.
3. Default salin tracked source files; hard-exclude metadata `.git`, runtime/cache/dependency besar, private key dan database lokal. Excluded tracked files tetap utuh di asli.
4. User memilih mode tiap file: `copy`, `exclude`, `template`, `sanitize`.
5. Untuk `sanitize`, tampilkan kandidat selector dan preview nilai tersamarkan; secret input tidak disimpan dalam history prompt atau terminal log.
6. Perlihatkan inventory akhir, aturan yang digunakan, serta daftar file yang tidak hadir di AI. Ini bukan penghapusan file asli.
7. Siapkan snapshot tersanitasi dalam staging. Scan sebelum memasukkan isi ke Git AI.
8. Buat repo AI, baseline, state awal, managed `AGENTS.md`, dan template laporan.
9. Catat hash aturan. Jika schema, path, atau selector credential tidak lagi cocok pada branch lain, questionnaire hanya meminta bagian yang belum dapat ditentukan, tanpa default menyalin mentah.

Default batas v1: file teks maksimal 5 MiB untuk parsing/merge otomatis; binary biasa maksimal 20 MiB per file dan wajib preview metadata. File lebih besar diblokir sampai dikecualikan. Manifest dihitung streaming dengan concurrency terbatas empat file.

Perubahan `.gitignore` dari AI tidak boleh menyembunyikan file yang sudah dikelola: inventory adalah gabungan manifest baseline, tree Git, dan kandidat file baru. Jika `.gitignore` berubah, file baru yang terdampak ikut ditampilkan sebelum pengecualian dikonfirmasi.

Inventory refresh juga memeriksa benturan reserved paths pada branch baru. File runtime ignored yang dibuat user/AI tidak dibuang saat branch switch; jika akan bertabrakan dengan file tracked branch tujuan, switch diblokir. Dependency/cache yang tersisa bisa tidak sesuai branch baru, sehingga CLI tidak mengklaim lingkungan runtime ikut diselaraskan.

## 7. Kontrak sanitasi

### Mode file

| Mode | Original ke AI | AI ke original |
|---|---|---|
| `copy` | Salin byte dan executable bit yang didukung | Terapkan hasil review |
| `exclude` | Tidak ditampilkan | Jangan membuat/menghapus file asli tersebut |
| `template` | Template dummy tersimpan dalam policy | Tidak pernah menimpa file asli |
| `sanitize` | Ganti literal terdaftar dengan token stabil | Validasi token, pulihkan nilai asli di selector terdaftar |

Perubahan AI pada managed rules atau template terlindungi bukan sekadar diabaikan: tampilkan dan blokir mutasi sampai user memulihkannya. Ini mencegah user mengira perubahan penting telah masuk ke asli.

### Format v1

- `.env` secara default adalah template terlindungi. Pertahankan nama variabel; nilai dummy tidak perlu valid untuk mengakses layanan nyata. Jangan mengeksekusi interpolation atau shell expansion.
- Python: static string literal pada assignment atau jalur dictionary dengan key statis, misalnya `SECRET_KEY` dan `DATABASES['default']['PASSWORD']`. Tree-sitter dipakai untuk mencari node dan rentang byte, bukan menjalankan Python.
- String prefix/escape harus dipahami parser. Ekspresi dinamis, f-string, concatenation, import untuk menemukan secret, dan selector ambigu diblokir; pilih template/exclude.
- JSON: string pada JSON Pointer yang unik. Jangan parse lalu serialize seluruh file bila hanya satu nilai yang berubah; pertahankan formatting di luar rentang literal.
- Teks lain: replacement literal tepat yang dipilih user dan memiliki konteks unik. Tidak ada regex arbitrary buatan AI yang dijalankan untuk menemukan credential.
- Token pada v1 hanya untuk secret bertipe string. Nilai non-string menggunakan template/exclude sampai adapter tipe terkait tersedia.

### Aturan token

- Token dibuat CSPRNG minimal 128 bit, misalnya `AIMP_SECRET_<random-hex>`. Stabil per project/branch/rule; bukan setiap pemanggilan sync.
- Token mewakili lokasi credential, bukan permission atau bukti autentikasi.
- Simpan pemetaan di state lokal `0700` dengan file `0600`. Jangan taruh path host atau nilai asli dalam repo AI, report, atau commit message.
- Saat rotasi credential asli pada selector yang sama, token tetap sama dan nilai untuk restorasi berasal dari snapshot asli terbaru yang sudah diverifikasi.
- Sebelum round-trip, token harus berada persis pada selector yang diizinkan, dengan multiplicity yang diharapkan. Tolak pemindahan, penggandaan, penghapusan, atau token asing.
- Menyalin token ke file baru tidak berarti menyalin credential ke file itu.
- Perubahan nama key/struktur rahasia harus dilakukan user di asli lalu memperbarui policy lewat onboarding ulang terbatas. V1 tidak menebak refactor credential.
- Perubahan policy hanya boleh diterapkan ketika tidak ada pekerjaan AI tertunda. Regenerasi baseline branch terkait secara transaksional, naikkan policy version dan Batch-ID, lalu batalkan rencana/resolusi lama. Branch lain divalidasi ulang saat `/use`, bukan diam-diam menggunakan selector baru pada baseline lama.
- Known-secret scan mencakup file lain dan laporan untuk mendeteksi credential terdaftar yang terduplikasi. Temuan pada lokasi tanpa aturan harus dikecualikan atau diberi aturan, bukan hanya dilewati.
- Scanner heuristik menandai kandidat tambahan. User dapat mengklasifikasikan false positive secara eksplisit dengan alasan yang dicatat tanpa nilai secret.
- Tidak menjanjikan deteksi representasi base64, hash, pecahan string, secret tidak terdaftar, atau seluruh data pribadi.

Invariant utama: setelah restorasi hasil merge menjadi `R`, sanitasi ulang `R` harus sama dengan hasil merge tersanitasi untuk seluruh file syncable. Jika tidak sama, transaksi ditolak sebelum penulisan asli.

## 8. Managed AGENTS.md dan laporan satu file

### Managed rules

- Root `AGENTS.md` salinan adalah overlay: managed block aimp ditambah instruksi asli yang relevan setelah sanitasi.
- Jika asli memiliki `AGENTS.md`, jangan menghapusnya; simpan baseline sumber di state dan regenerasi overlay saat refresh.
- Seluruh path instruction files yang diketahui bersifat khusus, termasuk nested `AGENTS.md`, direview saat onboarding. AI tidak boleh mengubahnya melalui sync v1; user mengubah di asli.
- Jangan otomatis menciptakan file aturan spesifik setiap IDE. Tampilkan instruksi manual bagi harness yang memakai format lain.
- Jika original sudah memiliki path reserved `AIMP_REPORT.md` atau `.aimp/`, onboarding berhenti dan menjelaskan benturan; tidak overwrite.

### Format laporan final

```markdown
AIMP-ID: <opaque-project-id>
Branch: feature/login
Batch-ID: <opaque-batch-id>
Status: draft

## Summary
<!-- AI: jelaskan perubahan pada batch ini -->

## Commit Message
<!-- AI: satu baris subject, body opsional setelah baris kosong -->

## Tests
<!-- AI: tes yang dijalankan dan hasilnya, atau Not run beserta alasan -->

## Notes
<!-- AI: keterbatasan, perubahan perilaku, atau None -->
```

AI mengisi isi dan mengganti `Status: draft` menjadi `Status: ready`. Field identitas dibuat CLI dan harus dipertahankan.

- Summary dan Commit Message wajib nonempty dan bukan placeholder.
- Tests wajib diisi, tetapi `Not run: <alasan>` valid. Jangan mengubahnya menjadi klaim tes lulus.
- Notes wajib `None` atau penjelasan singkat.
- Tolak duplicate headers/metadata, control characters berbahaya, Batch-ID salah, branch salah, dan laporan di atas 64 KiB.
- Subject commit maksimal 120 karakter, tanpa newline di subject. Conventional Commits disarankan, tidak diwajibkan. Body opsional.
- `/get-*` hanya membaca. Tampilkan bahwa laporan ready belum berarti telah direview.
- Report diabaikan oleh Git melalui local exclude milik repo AI. Ia tidak membuat dirty code state dan tidak pernah di-copy ke original.
- Managed runtime metadata dan conflict candidates berada di `.aimp/`, juga local-only dan excluded. Tidak berisi credential asli atau path original.
- Laporan bukan kode: tidak dieksekusi, tidak dipakai sebagai shell argumen mentah, tidak dianggap instruksi ke CLI.
- `/sync` mengikat report hash dan candidate manifest hash pada review. Bila salah satu berubah setelah approval, approval gugur.
- Tidak ada jaminan otomatis bahwa uraian laporan sesuai semua edit terakhir. Preview aktual dan user review adalah pengendali semantic staleness.
- Setelah batch berhasil, arsipkan laporan, buat Batch-ID baru, dan template draft baru. Refresh serta switch juga memakai ID baru. Identitas lama tidak diterima.
- Jika tidak ada delta kode tetapi laporan ready, `/sync` adalah no-op dan tidak menciptakan commit. Tawarkan arsip laporan dan template baru dengan konfirmasi.

## 9. State dan interface domain

Lokasi default: `${XDG_STATE_HOME:-~/.local/state}/aimp/`, dengan root state tidak berada di project. Jangan menaruh konfigurasi mutable otoritatif di salinan AI.

### State berversi

| Entitas | Field penting |
|---|---|
| Project | schemaVersion, projectId, realpath original/mirror/gitDir, identitas filesystem, policyVersion, installedToolVersion |
| BranchPair | pairId, nama ref original/AI, generation, baselineOriginalOid, baselineAiOid, baselineSanitizedManifestId, batchId, lastTransactionId |
| Policy | mode per path, selector per secret, dummy/template, reserved paths, scan exceptions, capability profile Git |
| Manifest | relative path, jenis file, executable bit, ukuran, SHA-256 byte, penyimpanan konten snapshot |
| ReportArchive | pairId, batchId, reportHash, candidateHash, originalOid, aiCheckpointOid, timestamp |
| Transaction | id, pairId, direction, stage, before/after refs, file manifests, hashes persetujuan, resolutions, backup references |
| SecretMap | opaque ruleId, token, selector terdaftar, metadata nilai per branch; nilai rahasia bila diperlukan tetap host-only |

Tipe OID Git adalah string opaque yang divalidasi sesuai object format repo; jangan hardcode SHA-1 40 karakter. Hash file CLI memakai SHA-256 terpisah.

### Interface minimum

```typescript
interface Snapshot { manifestId: string; entries: ReadonlyMap<string, FileEntry>; }
interface Sanitizer {
  sanitize(source: Snapshot, policy: Policy): SanitizedSnapshot;
  restore(candidate: SanitizedSnapshot, original: Snapshot, policy: Policy): Snapshot;
}
interface SyncPlan {
  id: string;
  pairId: string;
  direction: 'ai-to-original' | 'original-to-ai';
  expectedOriginalOid: string;
  expectedAiOid: string;
  beforeManifestIds: string[];
  candidateManifestId: string;
  reportHash?: string;
  changes: FileChange[];
  conflicts: Conflict[];
}
```

Jenis file, konflik, error, dan transaction stage berupa discriminated union. Renderer tidak mengubah state. Planner tidak menulis original. Executor hanya menerima rencana yang sudah diverifikasi beserta approval hash.

Unknown schema yang lebih baru diblokir. Migration state harus backup dan atomik; v1 tidak mempunyai kebutuhan migrasi data dari implementasi lama karena belum ada aplikasi.

## 10. Algoritma sinkronisasi tiga arah

Definisi:

- `B`: snapshot syncable tersanitasi pada titik terakhir kedua sisi selaras.
- `O`: snapshot branch original sekarang setelah sanitasi.
- `A`: snapshot branch AI sekarang, termasuk perubahan belum di-commit.
- `M`: hasil penggabungan perubahan terhadap `B`.

Bandingkan isi dan file mode, bukan timestamp. Snapshot tidak memasukkan `.git`, report, managed overlay, file excluded, atau template terlindungi sebagai kandidat perubahan balik.

| Kondisi | Hasil |
|---|---|
| `O == B`, `A != B` | Ambil perubahan AI |
| `A == B`, `O != B` | Pertahankan perubahan original |
| `O == A` | Tidak ada konflik |
| Kedua sisi mengubah file berbeda | Gabungkan keduanya |
| Kedua sisi mengubah teks pada bagian terpisah | Merge tiga arah; tampilkan hasil untuk review |
| Hunk sama berubah berbeda | Konflik |
| Delete vs edit | Konflik |
| Add path sama dengan isi berbeda | Konflik |
| Binary/mode change berbeda di kedua sisi | Konflik; tidak ada merge isi otomatis |

Pakai `git merge-file -p` pada salinan temporary tersanitasi untuk file teks yang memenuhi batas. Konflik berarti belum ada penulisan original. Operasi tiga arah merupakan fungsi Git yang terdokumentasi; keberhasilan merge teks tidak berarti kebenaran semantik kode. [Dokumentasi merge-file](https://git-scm.com/docs/git-merge-file)

Rename pada v1 diperlakukan sebagai delete+add untuk menentukan hasil, dengan label rename hanya sebagai bantuan tampilan. Jangan mengandalkan heuristic rename untuk pemulihan credential; rename file sanitized memerlukan perubahan policy dari sisi original.

### Resolusi konflik

- `/sync` membuat conflict bundle tersanitasi dan tetap berstatus belum diterapkan.
- `/resolve` menampilkan path dan pilihan keep original, keep AI, atau edit candidate.
- Candidate manual ditaruh dalam `.aimp/conflicts/<plan-id>/` di AI sehingga dapat dibantu AI; semuanya tersanitasi.
- Simpan pilihan/resolusi beserta hash B/O/A. Perubahan input membatalkan resolusi lama.
- Setelah semua konflik selesai, user memastikan AI memperbarui laporan, lalu menjalankan `/sync` lagi untuk review penuh.
- Resolusi tidak boleh membawa token baru, mengubah selector credential, atau menyisakan marker konflik.
- Pilihan keep-original yang menghilangkan edit AI harus terlihat eksplisit pada review, bukan dianggap perubahan AI berhasil diterapkan.

## 11. `/sync`: satu batch ke original

1. Ambil lock project. Verifikasi pair aktif, tidak ada pending recovery, original index/worktree bersih, dan kedua repo sesuai capability profile.
2. Original boleh mempunyai commit baru yang merupakan descendant baseline. Riwayat baru dengan merge commit diblokir pada v1; existing history sebelum baseline boleh berisi merge.
3. Validasi report ready dan Batch-ID. Scan snapshot AI, laporan, serta commit AI baru yang akan dicatat. Commit lokal AI yang sudah dibuat tidak otomatis dipercaya.
4. Ambil B/O/A dan compute M. Jika konflik, ekspor kandidat dan hentikan sebelum penulisan.
5. Validasi token, round-trip restorasi, policy path, file mode, serta known-secret leak.
6. Simpan rencana dan input hashes pada journal PREPARED tanpa mengubah original. Preview delta **O → M**, perubahan original yang dipertahankan, penghapusan, laporan, dan commit message. Delta B → A tersedia sebagai konteks kontribusi AI.
7. User menerima batch penuh; partial hunk staging ditunda. User boleh mengoreksi pesan dalam prompt; teks final yang disetujui dipakai identik pada kedua checkpoint dan diarsipkan terpisah dari laporan usulan.
8. Revalidate HEAD, branch, manifest, policy, report, dan conflict-resolution hashes. Perubahan apa pun membatalkan approval.
9. Catat APPROVED beserta approval hashes, lalu siapkan before backups kedua sisi yang akan berubah, candidate original R, tree/commit objects, dan candidate AI tersanitasi. Flush persiapan sebelum mutasi original. Commit object yang belum memiliki ref bukan commit yang sudah diterapkan.
10. Terapkan R hanya pada path original yang telah disetujui; file excluded/template/untracked ignored tetap utuh.
11. Buat satu commit original dari tree penuh yang memakai parent HEAD original terbaru. Index asli hanya diselaraskan ketika diketahui bersih dan tanpa perubahan eksternal.
12. Rekonsiliasi working tree AI ke M dan buat checkpoint AI dengan pesan final yang sama. Jika AI sudah membuat commit lokal, parent checkpoint adalah HEAD AI terakhir; commit anchor kosong boleh dipakai demi pasangan yang jelas.
13. Catat source AI range, source original range yang dipertahankan, kedua checkpoint, report, dan hasil review dalam jurnal. Tidak perlu memasukkan hash silang dalam commit message.
14. Update B menjadi sanitized original final, advance refs state, archive report, dan buat Batch-ID/template baru. Status menjadi CLEAN.

Jika M sama dengan O sehingga tidak ada kontribusi yang perlu di-commit ke original, jangan membuat commit original kosong. Bila AI perlu direkonsiliasi ke O, lakukan transaksi reconcile setelah konfirmasi dan catat sebagai refresh/no-op-contribution, bukan commit fitur yang sukses. Laporan tetap diarsipkan untuk menjelaskan kontribusi yang sudah ada atau dibatalkan.

Commit identity original memakai identitas Git user yang dikonfigurasi secara eksplisit. AI memakai identitas lokal `aimp <aimp@local.invalid>` kecuali user menentukan identitas lain. Tidak meniru author asli secara diam-diam.

## 12. `/sync-original-to-ai`: refresh tanpa kehilangan branch

1. Verifikasi branch aktif, original bersih, dan original HEAD descendant baseline.
2. Tidak boleh ada AI_PENDING, termasuk delta yang sudah di-commit lokal. Bila kedua sisi berubah, arahkan ke `/sync` dengan merge tiga arah, bukan reset.
3. Sanitasi snapshot original terbaru, validasi policy, dan preview perubahan salinan.
4. Minta konfirmasi terpisah atas file yang hilang di salinan.
5. Terapkan snapshot melalui transaction engine ke branch AI aktif saja; regenerasi overlay rules dan report draft.
6. Tambahkan commit AI `chore(aimp): refresh <branch>` bila tree berubah. Source original range ada di jurnal, bukan keseluruhan pesan commit asli yang mungkin berisi secret.
7. Jika hanya nilai secret asli berubah dan hasil tersanitasi identik, update mapping/baseline secara transaksional tanpa empty commit AI yang tidak perlu.
8. Update baseline pasangan dan batch. Branch AI lain beserta riwayatnya tetap utuh.

Tidak ada reset `.git`, force checkout, prune branch otomatis, atau pembuatan archive Git penuh setiap refresh. Riwayat Git yang tetap ada dan jurnal sudah menjadi arsip utama; export bundle bisa ditambahkan nanti.

## 13. Git adapter dan batas compatibility

### Mencegah eksekusi project yang tidak diminta

Git mempunyai clean/smudge filters, attributes, hooks, external diff, fsmonitor, dan konfigurasi yang dapat menjalankan program. Karena itu tidak cukup hanya berkata “CLI tidak menjalankan shell”. Transformasi attributes dapat memengaruhi blob dan working tree. [Dokumentasi gitattributes](https://git-scm.com/docs/gitattributes)

- Jangan memakai `git add .` sebagai engine snapshot. Bangun inventory eksplisit dan raw blob dengan `hash-object --no-filters`, temporary index, `write-tree`, serta `commit-tree`.
- `hash-object --no-filters` menghindari filter saat pembentukan blob; penggunaannya dan pembentukan commit dari tree didokumentasikan Git. [hash-object](https://git-scm.com/docs/git-hash-object), [commit-tree](https://git-scm.com/docs/git-commit-tree)
- Nonaktifkan external diff, textconv, fsmonitor, optional index refresh, signing otomatis, dan hooks untuk operasi internal. Abaikan Git config global/system untuk subprocess internal, lalu suplai identitas dan setting yang memang dibutuhkan secara eksplisit.
- Bersihkan inherited `GIT_*` yang dapat mengalihkan repository, index, config, object directory, atau executable. Pasang kembali hanya environment Git yang dibuat adapter. Gunakan Git executable yang di-resolve dan dicatat oleh doctor, bukan executable dari working directory project.
- Baca config dan attributes sebagai data. Tolak path yang membutuhkan LFS/filter/custom merge/working-tree-encoding atau transformasi line ending yang tidak didukung.
- Supported profile v1: byte file Git dan working tree konsisten, `core.autocrlf=false`, tanpa custom clean/smudge atau encoding transform pada managed files. LF dan CRLF mentah boleh jika tidak ditransformasi; merge berbeda line ending diperlakukan konservatif sebagai konflik.
- Jangan menjalankan checkout pada data AI yang mengaktifkan filter; materialisasikan file dari snapshot melalui filesystem adapter.
- Nama path dikirim NUL-delimited; `--` dipakai saat command mendukungnya. Nama ref divalidasi dengan Git, tidak disisipkan ke shell.
- Gunakan plumbing dan refs explicit. Jangan menebak SHA-1 length atau branch default `master`.

### Hook dan signing bukan fitur tersembunyi

Commit terkelola v1 tidak menjalankan project hooks dan tidak menandatangani commit. Tampilkan kebijakan ini pada onboarding. Jika repository mempunyai executable hooks yang aktif atau `commit.gpgSign=true`, minta user menerima profil tersebut secara eksplisit atau batalkan setup. Jangan mengubah konfigurasi repo user untuk memaksakannya. Repo yang wajib menjalankan hook/signing organisasi berada di luar dukungan v1 sampai adapter yang aman tersedia.

### Perubahan ref

Gunakan `update-ref` dengan expected old OID untuk menolak perubahan ref eksternal. Conditional ref update tidak membuat kedua repo atau working tree menjadi satu transaksi; jurnal tetap diperlukan. [Dokumentasi update-ref](https://git-scm.com/docs/git-update-ref)

Simpan ref journal/backup di namespace internal yang tidak dijadikan remote. V1 tidak menjalankan auto-GC saat transaction/recovery agar objek yang diperlukan tidak dibuang.

## 14. Transaksi, concurrency, dan recovery

### State machine

```text
IDLE
  → PREPARED
  → APPROVED
  → ORIGINAL_FILES_WRITTEN
  → ORIGINAL_REF_ADVANCED
  → AI_FILES_WRITTEN
  → AI_REF_ADVANCED
  → STATE_SAVED
  → DONE

Tahap apa pun yang gagal setelah mutasi → RECOVERY_REQUIRED
```

Refresh dan branch switch memakai subset tahap yang tidak mengubah original. Detail index state, batch template, dan file manifest tetap dicatat sebagai substep journal agar recovery tidak menebak.

### Penyimpanan dan lock

- Satu lock writer per project original/mirror; read-only command boleh membaca journal committed terakhir dan menandai transaksi aktif.
- Lock menggunakan pembuatan direktori atomik dengan PID, process-start identifier, host boot identifier, dan nonce. Jangan menghapus lock hanya berdasarkan timeout atau PID saja.
- State/journal ditulis ke temporary file dalam filesystem yang sama, flush, lalu rename. Flush parent directory pada batas transaksi yang diperlukan; ukur overhead.
- Backup raw hanya untuk file original yang berubah, bukan seluruh repo. Backup dapat mengandung credential sehingga tetap host-only dengan permission terbatas.
- Backup setelah transaksi selesai dipertahankan sampai `/prune` yang dikonfirmasi user. `/status` menunjukkan ukuran backup; tidak ada cleanup daemon.
- `/prune` default menawarkan backup transaksi selesai yang lebih tua dari 30 hari, tetapi tidak pernah menghapus baseline aktif, pending recovery, file yang masih direferensikan, atau catatan ringkas audit. User melihat daftar sebelum penghapusan.

### Recovery deterministik

- Journal berisi before/after file hashes, before/after refs, proposed commit OIDs, original index snapshot, candidate trees, serta report dan policy hashes.
- Jika semua sumber masih sesuai expected-before/after, `/recover` dapat melanjutkan tahap tersisa tanpa membuat commit baru.
- Bila user memilih rollback sebelum ref commit asli berubah, pulihkan hanya file yang masih cocok dengan output transaksi. Jangan menimpa file yang telah diedit user setelah crash.
- Setelah ref asli sudah maju, prefer roll-forward. Reversal berikutnya dilakukan sebagai perubahan/commit kompensasi yang direview, bukan `git reset --hard` otomatis.
- Jika ada perubahan eksternal, hentikan recovery otomatis, pertahankan backup, dan tampilkan path/refs yang berbeda beserta langkah manual. Jangan hapus state untuk menghilangkan pesan error.
- Setiap tahap dapat dijalankan ulang berdasarkan journal tanpa menggandakan checkpoint.
- Startup dengan transaksi incomplete memblokir mutasi lain sampai recovery selesai.

### Batas concurrency yang tidak boleh disembunyikan

Lock CLI tidak menghentikan editor, agent, Git eksternal, atau autoreloader aplikasi. User diminta menghentikan edit saat apply/switch. Revalidation memperkecil race tetapi tidak memberikan jaminan atomic terhadap proses asing yang menulis pada saat yang sama.

Penulisan banyak file tidak atomik bagi aplikasi yang sedang berjalan. Auto-reloader mungkin melihat keadaan sementara. CLI tidak menghentikan aplikasi/Docker; user melakukan restart/reload setelah transaksi selesai dan tidak menganggap aplikasi bisa terus melayani dengan konsistensi snapshot selama apply.

## 15. Status dan pesan error

| Status/error | Arti | Tindakan user |
|---|---|---|
| UNINITIALIZED | Belum ada pasangan | `/init` |
| CLEAN | Konten kedua sisi selaras pada baseline | Mulai pekerjaan AI atau lanjut di asli |
| AI_PENDING | Ada delta AI, termasuk committed delta | Lengkapi laporan dan `/sync` |
| ORIGINAL_AHEAD | Asli maju, AI belum berubah | `/sync-original-to-ai` |
| BOTH_CHANGED | Kedua sisi berubah | `/sync` untuk merge dan review |
| BRANCH_MISMATCH | Branch sesi/asli/AI berbeda | Hentikan AI, jalankan `/use` |
| REPORT_REQUIRED | Laporan hilang/draft/invalid | Minta AI melengkapi |
| REPORT_STALE | Identitas laporan salah atau hash berubah setelah review | Gunakan template batch aktif dan review ulang |
| ORIGINAL_DIRTY | Ada pekerjaan asli belum di-commit | Commit/bereskan sendiri |
| CONFLICT | Merge tidak dapat diputuskan otomatis | `/resolve`, perbarui laporan, `/sync` |
| TOKEN_INVALID | Selector/token tidak cocok | Perbaiki AI atau ubah policy dari asli |
| UNSUPPORTED_GIT_PROFILE | Filter, shape repo, signing/hook policy tidak didukung | Ubah setup secara sadar atau gunakan workflow lain |
| HISTORY_DIVERGED | Baseline bukan ancestor / rewrite | Hentikan sync; migrasi/rebind manual terencana |
| RECOVERY_REQUIRED | Transaksi belum selesai | `/recover` |

Pesan menyebut file dan alasan, tanpa credential. Jangan menyarankan reset destruktif sebagai perbaikan default.

## 16. Skenario penerimaan end-to-end

### A. Fitur biasa

Original di `feature/login`; `/init`; user membuka salinan; AI mengedit dan menulis laporan ready; `/diff`; `/sync`. Original mendapat satu commit, AI satu checkpoint pasangan, credential asli tetap utuh, report diarsipkan, dan template batch baru dibuat.

### B. Debug Docker manual

User menjalankan Docker sendiri, menyalin traceback secara manual, AI memperbaiki salinan, lalu `/sync`. Script tidak membaca socket, log, database, atau environment container. User rebuild/reload sendiri. Refresh Git tidak diperlukan untuk setiap putaran bug fix.

### C. Edit asli tanpa edit AI

User commit di asli. `/status` menunjukkan ORIGINAL_AHEAD. `/sync-original-to-ai` memperbarui branch AI dengan commit refresh tanpa menghapus branch lain.

### D. Edit asli dan AI pada file berbeda

Asli sudah commit perbaikan README, AI mengedit login. `/sync` menghasilkan kandidat yang mempertahankan README dan memasukkan login. Commit asli hanya delta dari HEAD asli terbaru. Snapshot AI akhir mencakup kedua perubahan, baseline kembali selaras.

### E. Konflik lokasi sama

Kedua sisi mengubah fungsi sama secara bertentangan. Tidak ada file original diubah. `/resolve` menghasilkan kandidat, user/AI memperbaiki, report diperbarui, lalu preview `/sync` dijalankan ulang.

### F. Pergantian branch dengan pekerjaan tertunda

Original sudah berpindah ke payment tetapi AI login belum diterapkan. `/use` menolak switch. User kembali ke original login dan menyelesaikan sync. Setelah itu switch ke payment diperbolehkan, menggunakan branch AI existing atau baseline baru.

### G. Rotasi credential

User mengubah credential asli pada selector terdaftar. Token AI tetap sama. Refresh memperbarui mapping dan baseline tanpa memasukkan credential ke file, report, atau Git AI. Jika credential adalah ignored `.env`, perubahan tetap tidak dipaksa menjadi commit original.

### H. AI salah memperlakukan token

AI menyalin token PASSWORD ke file baru atau menghapus assignment terdaftar. Sync diblokir; tidak pernah mengganti semua kemunculan token secara global dengan secret.

### I. Laporan tidak valid

Laporan dari branch/batch lama, status draft, atau duplicate heading ditolak. File asli dan refs tetap sama. Laporan valid tidak membuat sync lolos jika diff berbahaya atau input berubah setelah review.

### J. Crash sesudah commit original

Checkpoint original sudah ada tetapi AI/state belum selesai. Startup menawarkan recovery. Roll-forward menghasilkan checkpoint AI yang telah dipersiapkan dan catatan selesai tanpa commit original kedua.

### K. AI membuat commit sendiri

Worktree AI bersih tetapi tree berbeda dari baseline. Status tetap AI_PENDING. CLI memeriksa commit baru, membaca laporan, dan membuat checkpoint anchor final agar mapping ke satu commit original jelas.

### L. Tidak ada perubahan

`/sync` pada delta kosong tidak membuat commit dan tidak push. Jika report ready tanpa perubahan, user dapat mengarsipkannya dengan alasan no-op.

## 17. Rencana pengujian

### Unit/domain tests yang penting

- Round-trip sanitizer: Python/JSON, escaping, Unicode, CRLF, multiline literal yang didukung, ambiguity, dynamic expression, token relocation/duplication, rotasi secret.
- Manifest: path traversal, absolute path, control characters, symlink, hardlink, binary, executable mode, file limit, ignored/tracked precedence.
- Report parser: valid, missing, duplicate fields, wrong IDs, placeholder, stale hash, shell/ANSI content.
- Merge planner: tiap baris tabel B/O/A, delete/edit, add/add, mode conflict, binary, line endings, no-op, resolusi invalid.
- State validators dan transition invariants; newer schema harus ditolak.

### Integrasi Git/filesystem

- Gunakan repo temporary asli/AI nyata, bukan mock seluruh Git.
- Buktikan tidak ada object/remote/alternate asli yang disalin ke AI.
- Buktikan branch lain tetap sama setelah refresh dan `/use`.
- Buktikan identical approved message dan journal mapping benar, termasuk empty AI anchor.
- Fixture executable Git hooks/filter/fsmonitor/external diff membuat sentinel jika dieksekusi; sentinel tidak boleh muncul pada operasi terkelola.
- Original staged/unstaged/untracked serta changed HEAD setelah approval tidak boleh terserap commit.
- `.env` ignored asli tidak di-stage, tidak terhapus, dan tidak tertimpa dummy.
- Secret fixture tidak ditemukan dalam seluruh refs AI yang dibuat CLI, report archive tersanitasi, stdout/stderr log CLI, atau conflict bundles.
- Ekspektasi terakhir tidak mencakup secret baru tak dikenal yang AI tulis sendiri sebelum CLI bisa memeriksanya; tes tidak boleh mengubah batas klaim.

### Fault injection

- Matikan proses setelah setiap tahap journal dan setiap perubahan file/index/ref penting.
- Simulasikan disk penuh, permission denied, rename gagal, backup gagal, state corruption, lock stale, PID reuse, external edit, dan ref compare-and-swap gagal.
- Pastikan failed archive/backup tidak diikuti mutasi original.
- Recovery idempotent; rollback tidak menimpa edit baru; cleanup tidak menghapus snapshot yang masih diperlukan.

### REPL, packaging, dan performa

- Uji input melalui pseudo-terminal: `/use`, invalid command, Ctrl+C, Ctrl+D, multiline message, default No, dan konfirmasi deletion.
- `npm pack` → install tarball dalam prefix temporary → jalankan executable tanpa source checkout atau build tool.
- Uji package tanpa postinstall script, grammar WASM terbundel, dan tidak ada permintaan jaringan runtime dari CLI.
- CI Linux pada Node 22/24 dan Git minimum/modern; smoke test manual/terotomasi pada WSL2 `/home` sebelum menyatakan dukungan.
- Benchmark fixture 10.000 file dengan total 100 MiB, maksimal empat pembacaan paralel. Catat CPU/RAM/perintah pertama dan refresh; gate awal tambahan memory CLI <256 MiB pada fixture ini, idle tidak melakukan polling filesystem. Jika tidak tercapai, ukur bottleneck sebelum menaikkan batas.

## 18. Technical debt register

| ID | Risiko/debt | Prioritas | Keputusan v1 dan cara mengurangi | Trigger pengerjaan lanjut |
|---|---|---|---|---|
| TD-01 | AGENTS bukan isolasi | Batas produk | Dokumentasi jujur, tidak mengklaim anti-exfiltration | User meminta enforcement OS |
| TD-02 | Sanitizer semua bahasa terlalu luas | Tinggi | Python/JSON string + env template; format lain fail closed atau exclude | Kebutuhan format nyata berikutnya |
| TD-03 | False negative scanner | Tinggi | Known-secret scan, selector eksplisit, preview; tanpa klaim lengkap | Corpus fixture dan kasus bocor yang terukur |
| TD-04 | Transaksi dua Git tidak atomik | Kritis | Jurnal, before/after hashes, CAS refs, fault injection wajib sebelum release | Tidak boleh ditunda |
| TD-05 | Edit eksternal saat apply | Tinggi | Revalidate, lock CLI, instruksi pause AI; dokumentasikan race residual | Kebutuhan multi-agent atau filesystem locking kuat |
| TD-06 | Git filters/hooks/signing | Tinggi | Supported profile terbatas, plumbing, disclosure dan blokir setup incompatible | Repo pengguna wajib hook/signing/LFS |
| TD-07 | Branch rebase/rename/worktree | Sedang | Blokir eksplisit, tidak auto-rebind | Setelah linear workflow stabil |
| TD-08 | Partial sync/hunk selection | Sedang | Batch penuh, conflict resolution tetap tersedia | Batch besar menghambat review berulang |
| TD-09 | Report semantic staleness | Sedang | Batch ID + hash review + diff aktual; tidak percaya prose saja | Integrasi agent/protokol snapshot tambahan |
| TD-10 | Parsing WASM lambat | Sedang | Parse hanya file policy yang berubah, streaming manifest, benchmark | Melewati budget performa |
| TD-11 | JSON state bertambah besar | Sedang | Manifest/content-addressed snapshots dan journal per transaksi; jangan satu JSON raksasa | Profiling lookup/maintenance nyata |
| TD-12 | Backup memakan disk dan dapat mengandung secret | Tinggi | Permission, ukuran terlihat, `/prune` manual, raw backup hanya changed paths | Kebutuhan encryption-at-rest/export |
| TD-13 | Pengetahuan framework terbatas | Batas produk | Tidak mengatur runtime, dependency, Docker, atau debugger | User meminta environment uji terkelola |
| TD-14 | Satu folder tidak cocok kerja paralel | Batas produk | Satu branch aktif, switch diblokir saat pending | User memang membutuhkan paralelisme |
| TD-15 | Nama paket belum tersedia | Rendah | Verifikasi saat rilis; scoped package dengan executable sama | Publishing |
| TD-16 | Git history AI dapat menyimpan kesalahan lama | Tinggi | Scan sebelum commit CLI; tidak menduplikasi riwayat asli; edukasi tidak menaruh secret di AI | Alat scrub/export history |
| TD-17 | Compatibility Windows/macOS | Sedang | Linux/WSL2 ext4 dulu; tolak path/platform tak diuji | Permintaan pengguna dan CI tersedia |
| TD-18 | Merge teks berhasil tetapi kode salah | Tinggi | Review hasil merge dan tes user, report Tests wajib jujur | Test runner terisolasi opsional |

TD-04, restorasi credential, perlindungan file asli, serta penanganan branch salah adalah syarat rilis, bukan backlog yang boleh dikorbankan demi UI cepat selesai.

## 19. Tahapan implementasi dan gate

### Tahap 0 — kunci kontrak dan scaffold

Deliverable: package/build/test setup, dokumen keputusan, tipe domain, REPL skeleton, error model. Belum ada command yang menulis original. Gate: executable tarball dapat dibuka dan ditutup, command parser tidak mengeksekusi shell.

### Tahap 1 — onboarding dan snapshot tersanitasi

Deliverable: inventory, policy, sanitizer v1, state, repo AI independent, AGENTS/report generator, `/init`, `/doctor`, `/status`. Gate: fixture credential tidak bocor pada copy atau baseline Git, original byte-for-byte tidak berubah.

### Tahap 2 — branch dan pembacaan laporan

Deliverable: `/use`, `/list`, `/get-summary`, `/get-commit-message`, branch mapping dan batch lifecycle. Gate: switch menjaga branch lain, pending commit AI terdeteksi, laporan branch salah diblokir.

### Tahap 3 — planner dan review tanpa apply

Deliverable: `/diff`, B/O/A merge planner, `/resolve`, source fingerprints, preview deletion dan policy violations. Gate: semua tabel merge diuji dan planner tidak menulis original.

### Tahap 4 — transaction engine dan refresh satu arah

Deliverable: lock, backups, journal, CAS ref adapter, `/recover`, `/sync-original-to-ai`. Gate: fault injection lulus untuk transaksi AI-only sebelum membolehkan penulisan original.

### Tahap 5 — sync AI ke original

Deliverable: `/sync`, restorasi credential, commit original dan anchor AI, report archive, no-op handling. Gate: E2E dan fault injection dua repo lulus; external changes tidak diserap/ditimpa.

### Tahap 6 — hardening dan paket siap distribusi

Deliverable: `/log`, `/prune`, shell installer, README penggunaan, contoh Django/Node, compatibility checks, benchmark, npm tarball smoke test. Gate: test Linux/WSL2, audit package contents, dan batas produk terdokumentasi.

Tidak perlu estimasi kalender sebelum spike parser dan transaction engine. Progress dinilai dari gate yang lulus, bukan jumlah slash command yang sudah terlihat.

## 20. Definition of done dan acceptance akhir

Implementasi dianggap siap dipakai pada profile yang didukung hanya bila:

1. User bisa membuka sesi dengan satu `aimp`, menyiapkan salinan dan memilih branch tanpa command panjang.
2. Workflow fitur → laporan → review → commit original → debug manual → perbaikan berikutnya berjalan.
3. Original credentials tetap benar setelah beberapa sync dan rotasi.
4. Satu folder AI mendukung minimal dua branch tanpa kehilangan history atau pekerjaan.
5. Perubahan kedua sisi yang tidak konflik dapat digabung; konflik tidak menulis original.
6. Delete, wrong branch, stale approval, invalid report, invalid token, dirty original, dan unsupported Git behavior ditangani sesuai kontrak.
7. Recovery lulus crash tests dan tidak menduplikasi commit.
8. CLI tidak menghubungi API model, menjalankan codebase, atau push.
9. Paket installable dari tarball; tidak membutuhkan VM, Docker, rsync, atau Python.
10. README dan UI tidak menyebut AGENTS sebagai sandbox atau menjanjikan semua secret/harness dijamin aman.

## 21. Prompt AGENTS.md yang akan digenerate

Template berikut adalah aturan produk untuk AI yang mengerjakan **project salinan**, bukan instruksi untuk agent yang mengimplementasikan aimp.

```markdown
# aimp workspace rules

This is a sanitized copy for the branch shown in AIMP_REPORT.md.
The original application is operated separately by the user.

## Workspace boundary
- Read and modify files only inside this workspace.
- Do not access parent directories, other projects, host credential stores,
  or symlinks pointing outside this workspace.
- Do not search for the original project or original secret values.
- These are workflow instructions; do not assume an OS sandbox exists.

## Protected content
- Preserve AIMP_SECRET_* tokens exactly and at their existing locations.
- Do not copy tokens to other fields/files or replace them with real values.
- Do not edit aimp managed rules or protected template files.
- If a change requires protected configuration, explain it to the user.

## Git and synchronization
- Do not push, add remotes, switch branches, reset/rebase history, or run
  aimp synchronization commands. The user controls these operations.
- Do not create commits unless the user explicitly asks; aimp creates
  the approved checkpoint during synchronization.
- Stop editing when the user is reviewing, synchronizing, or changing branch.

## Debugging and tests
- The user provides errors from the original application manually.
- You may run tests in this workspace with dummy data if dependencies exist.
- Do not connect to real services or request production credentials.
- State exactly which tests ran; if none ran, say why.

## Required completion report
- After completing a requested batch, update AIMP_REPORT.md.
- Keep AIMP-ID, Branch, and Batch-ID unchanged.
- Fill Summary, Commit Message, Tests, and Notes, then set Status: ready.
- Describe the current batch, not unrelated history or work not performed.
- Never include credentials, private data, or original host paths.
- If the report template is missing or identifies a different branch,
  ask the user to refresh the aimp session; do not invent identifiers.
```

Managed block harus tetap cocok dengan policy yang benar-benar diterapkan CLI. Instruksi tidak boleh menyuruh AI mengubah file dalam state asli atau menganggap dirinya berwenang menyetujui sync.

## 22. Prompt eksekusi implementasi

Gunakan dokumen pendamping `AIMP_EXECUTION_PROMPT.md` bersama spesifikasi ini. Prompt tersebut menetapkan prioritas versi rancangan, urutan pengerjaan, larangan shortcut yang merusak data, dan bukti pengujian yang harus diserahkan implementer.
