# Prompt eksekusi aimp

Salin prompt di bawah ke agent implementasi bersama `AIMP_IMPLEMENTATION_PLAN.md`. Ini adalah instruksi membangun produknya; bukan `AGENTS.md` yang nanti diberikan kepada AI di salinan project.

---

Anda diminta mengimplementasikan **aimp**, CLI interaktif untuk membuat salinan project tersanitasi dan menyinkronkan perubahan secara manual.

## Sumber kebenaran dan keputusan final

Baca `docs/AIMP_IMPLEMENTATION_PLAN.md` sebelum mengubah kode. Itu adalah spesifikasi final. Riwayat percakapan yang bertentangan sudah tidak berlaku, terutama rancangan sandbox, salinan terpisah per branch, dan penghapusan `.git` setiap refresh.

Kontrak final:

1. Satu project original, satu project AI dengan repository Git independen.
2. Banyak pasangan branch; nama branch AI sama dengan original. Branch AI baru dimulai dari snapshot tersanitasi, tanpa membawa riwayat Git original.
3. User menjalankan `aimp` dari original, lalu menggunakan slash command dalam sesi interaktif.
4. AI dan IDE tetap terpisah. Tidak ada API model, chat model, launcher sandbox, watcher, Docker orchestration, atau push.
5. AI menulis satu `AIMP_REPORT.md`; `/get-summary` dan `/get-commit-message` hanya membaca file tersebut.
6. `/sync` menampilkan rencana perubahan, meminta review, lalu menerapkan satu batch dengan satu commit original dan checkpoint AI yang memiliki pesan final sama. Hash berbeda dan dipetakan melalui jurnal.
7. `/sync-original-to-ai` memperbarui branch AI aktif melalui commit refresh. Tidak pernah menghapus `.git` atau branch lain.
8. Branch switch memerlukan `/use`; pekerjaan tertunda tidak boleh hilang atau diam-diam di-stash.
9. Sanitasi campuran: template untuk `.env`; string credential terpilih pada kode diganti token stabil dengan restorasi berbasis selector.
10. AGENTS.md adalah aturan perilaku, bukan izin OS atau sandbox. Jangan membuat klaim keamanan yang melampaui ini.

## Cara bekerja

- Inspeksi environment, source yang sudah ada, dan instruksi repository terlebih dahulu. Jangan berasumsi workspace masih kosong.
- Implementasikan per tahap dan gate dalam spesifikasi: scaffold, sanitizer/onboarding, branch/report, planner, transaction/recovery, sync, packaging.
- Lanjutkan pekerjaan yang telah diotorisasi sampai acceptance criteria terpenuhi. Laporkan blocker nyata dan bukti, bukan klaim selesai berdasarkan UI yang sudah tampil.
- Putuskan detail implementasi kecil berdasarkan spesifikasi; jangan berulang kali meminta approval atas pilihan rutin.
- Jika menemukan kontradiksi yang dapat menyebabkan kehilangan data, secret leak, atau perubahan kontrak user, jelaskan secara konkret sebelum mengimplementasikan perilaku yang berisiko.
- Jika waktu/konteks terbatas, simpan status tahap, pekerjaan tersisa, dan tes yang benar-benar telah dijalankan. Jangan menandai gate sebagai lulus sebelum buktinya ada.

## Kualitas implementasi

- Node.js 22/24, TypeScript strict, Git minimal 2.34, Linux/WSL2 filesystem Linux.
- Gunakan standard library untuk REPL, subprocess, file operations, hashing, dan testing jika cukup.
- Pisahkan command handler, planner, sanitizer, Git adapter, dan transaction executor.
- Planner menghasilkan snapshot/rencana; ia tidak boleh menulis original.
- Perintah Git menggunakan array argumen tanpa shell, path aman, NUL-delimited data, dan explicit refs.
- Jangan memakai `git add .`, `git reset --hard`, `rsync --delete`, atau `git clone` original sebagai shortcut engine sinkronisasi.
- Jangan menjalankan project hooks, filters, package scripts, atau test project user secara implisit di host. Ikuti supported Git profile dan disclosure hook/signing dalam spesifikasi.
- Tidak mengeksekusi file Python untuk menemukan credential. Static parsing saja.
- Token hanya dipulihkan di selector yang terdaftar; global token-to-secret replacement dilarang.
- File asli yang excluded, protected template, atau ignored tidak boleh dihapus/di-stage akibat hasil salinan yang tidak memilikinya.
- Jangan percaya laporan, `.gitignore`, path, Git config, atau commit lokal AI sebagai input tepercaya tanpa validasi.
- State schema berversi, journal immutable per tahap, lock, snapshots, expected HEAD checks, dan recovery merupakan fitur inti, bukan TODO sesudah rilis.
- Jangan mengubah global Git config, shell profile, atau izin filesystem pengguna secara diam-diam.
- Jangan membuka koneksi jaringan runtime kecuali instalasi dependency yang diperlukan selama pembangunan. Produk tidak mempunyai telemetry atau API model.

## Pengujian yang harus dibuktikan

Gunakan repo temporary nyata untuk tes integrasi. Minimal buktikan:

1. Original tidak berubah saat onboarding; secret fixture tidak masuk salinan/Git AI.
2. `.env` asli tidak tertimpa dummy dan credential dalam kode tetap utuh setelah round-trip.
3. Token rusak, duplikat, hilang, atau berpindah membuat sync ditolak.
4. Wrong branch, dirty original, stale approval, invalid report, dan unsupported Git profile tidak mengubah original.
5. Pending AI tetap terdeteksi walau AI sudah commit sendiri.
6. `/use` dan refresh menjaga branch/history lain.
7. Merge perubahan tidak bertabrakan berhasil; konflik tidak menulis original sebelum diselesaikan dan direview.
8. Penghapusan membutuhkan konfirmasi eksplisit.
9. Commit original dan AI checkpoint mempunyai pesan final yang sama; journal mapping benar dan tidak ada sync loop.
10. Fault injection pada setiap tahap mutasi menghasilkan recovery tanpa duplicate commit atau overwrite pekerjaan baru.
11. Sentinel hooks/filters/fsmonitor/external diff tidak pernah dieksekusi oleh operasi terkelola.
12. `npm pack` menghasilkan paket yang bisa diinstal dan dijalankan dari direktori lain tanpa source checkout, Python, Docker, atau compiler.

Jangan mengganti pengujian fault injection dengan happy-path test saja. Jangan melaporkan kompatibilitas WSL2, format sanitizer, atau benchmark sebagai lulus bila belum dijalankan pada target yang sesuai.

## Hasil yang harus diserahkan

- Source CLI, build configuration, dependency lockfile, test fixtures, dan script test yang dapat direproduksi.
- README alur harian, batas keamanan, supported Git profile, branch switching, laporan AI, konflik, dan recovery.
- Template managed `AGENTS.md` dan report yang sesuai kontrak.
- Paket tarball teruji dan installer shell wrapper yang belum dipublikasikan otomatis.
- Ringkasan gate yang lulus, perintah tes dan hasilnya, batas dukungan, serta technical debt yang masih ditunda.
- Jika satu syarat kritis belum terpenuhi, nyatakan belum siap dipakai pada original project penting. Jangan menggantinya dengan disclaimer umum atau klaim “production-ready”.

Tidak melakukan publish npm, push Git, deploy, atau mengirim pesan ke layanan eksternal kecuali user mengotorisasikannya secara eksplisit.

---

## Checklist review prompt ini

- Tujuan dan hasil yang diminta konkret: CLI berjalan, artefak, dan tes.
- Istilah original, AI workspace, branch pair, batch, baseline, dan clean didefinisikan oleh spesifikasi.
- Versi rancangan yang dibatalkan disebut agar implementer tidak menggabungkan desain yang saling bertentangan.
- Mandatory rules dibedakan dari batas produk dan backlog.
- Tidak menyuruh AI menganggap AGENTS.md sebagai sandbox.
- Tidak menuntut hash commit kedua repo sama atau seluruh operasi filesystem atomik.
- Tidak meminta model menghasilkan ringkasan melalui API yang tidak ada.
- Tidak mengotorisasi push, publish, deploy, atau pengiriman data otomatis.
- Acceptance criteria memerlukan bukti, bukan hanya uraian implementasi.
