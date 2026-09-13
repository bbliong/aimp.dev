# Panduan singkat Bahasa Indonesia

`aimp` membuat repo mirror lokal terpisah agar AI bekerja tanpa menyentuh file project original secara langsung. Jalankan dari original, gunakan `/init`, lalu buka folder mirror dengan AI pilihan Anda. Setelah pekerjaan selesai, AI mengisi `AIMP_REPORT.md` dan mengubah statusnya menjadi `ready`.

Jalankan `/diff` untuk meninjau path, kemudian `/sync` untuk menyalin batch yang disetujui ke original. AIMP tidak membuat commit di original. Commit checkpoint hanya dibuat di mirror dan diberi akhiran `(synced)`. Gunakan `/recover` jika proses terputus.

Buat `.aimpignore` di original untuk file yang tidak boleh masuk mirror atau sync, misalnya `.env`, database lokal, dan credential. File ini berlaku untuk tracked maupun untracked.
