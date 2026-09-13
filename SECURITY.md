# Security policy

AIMP is a local review and file synchronization tool. It is not a sandbox. An AI process running under the same OS account may access any file that account can access. Run untrusted agents in a separate OS account, container, VM, or other sandbox.

Do not put real credentials in the AI mirror. Keep them in files excluded by `.aimpignore` and use placeholders in tracked files. AIMP does not promise to discover every secret.

Report security issues privately through the repository security contact or a private GitHub security advisory. Do not publish credentials, private project content, or an unpatched exploit in an issue.
