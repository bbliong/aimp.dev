# aimp

**Never trust AI with your codebase. Let it touch only the mirror.**

AIMP (AI Mirror Project) is a local CLI for working with AI in a separate mirror repository. The AI edits the mirror, the user reviews the report and changes, and AIMP applies the approved batch to the original project. AIMP does not call a model, run the application, create commits in the original project, or push to a remote.

## Install

```bash
npm install -g @bbliong/aimp@beta
cd /path/to/original-project
aimp
```

Node.js 22.14+ and Git 2.34+ are required. Linux and WSL2 on a Linux filesystem are supported in this beta. For terminals without the TUI, use `aimp --plain status --json`.

## Commands

Run `aimp` inside an original Git project to open the interactive terminal UI. The same commands can be run in plain mode with `aimp --plain <command>`.

| Command | Where | What it does |
| --- | --- | --- |
| `/init` | Original | Create or select the mirror for the current branch. |
| `/reinit` | Original | Replace or relocate the mirror after confirmation; retain the old contents in a backup. |
| `/use` | Original | Switch the mirror to the current original branch after checking for pending mirror work. |
| `/status` | Both | Show the original path, mirror path, branches, dirty state, pending AI changes, and tracked paths. |
| `/diff` | Both | List changed paths and show text diffs without writing files. |
| `/sync` | Original | Review AI changes, apply them to the original, and create a local `(synced)` checkpoint in the mirror. The original is never committed by AIMP. |
| `/sync-original-to-ai` | Original | Refresh the mirror from committed original changes. The original must be clean and the mirror must have no pending work. |
| `/serialize` | Mirror | Adopt selected mirror changes as the local mirror baseline without applying them to the original. |
| `/get-summary` | Both | Read the approved summary from `AIMP_REPORT.md`. |
| `/get-commit-message` | Both | Read the proposed commit subject from `AIMP_REPORT.md`. |
| `/recover` | Original | Resume an interrupted transaction. Use `/recover rollback` to restore its backup. |
| `/doctor` | Original | Check Git, repository shape, state, branch pairing, and recovery readiness. |
| `/migrate` | Original | Back up and migrate legacy AIMP state. Review it with `/adopt-baseline`. |
| `/adopt-baseline` | Original | Confirm a reviewed legacy baseline and enable synchronization. |
| `/adopt-policy` | Original | Review and accept a changed `.aimpignore` policy. |
| `/list` | Original | List registered branch pairs and mirror locations. |
| `/log` | Original | Show local transaction receipts. |
| `/language en\|id` | Both | Change the interface language. New projects default to English. |
| `/help` | Both | Show commands available in the current mode. |
| `/exit` | Both | Exit the UI and restore the previous terminal screen. |

Useful non-interactive forms are `aimp --version`, `aimp --help`, `aimp --plain status --json`, and `aimp --plain sync --dry-run`. Add `--profile` to the interactive command to print Git call and timing metrics.

## Example: review an AI change safely

This example uses a Django project at `~/projects/shop-api`, a feature branch named `feature/checkout-tax`, and a mirror at `~/ai-mirrors/shop-api-ai`.

### 1. Prepare the original project

```bash
cd ~/projects/shop-api
git switch -c feature/checkout-tax
cat > .aimpignore <<'EOF'
.env
*.local
config/production.yml
EOF
git status --short
```

Keep real credentials in the original project. Put safe placeholders such as `.env.example` in the repository yourself; AIMP does not guess or sanitize credentials.

### 2. Create the mirror

```text
$ aimp
$ /init
Mirror folder [/home/alice/projects/shop-api-ai]: /home/alice/ai-mirrors/shop-api-ai
Mirror: /home/alice/ai-mirrors/shop-api-ai
```

AIMP creates an independent Git repository for `feature/checkout-tax`, copies only allowed files, and writes `AGENTS-AIMP.md` and `AIMP_REPORT.md`. The rules file tells the harness that this folder is the AI workspace and must not read the original project or credential stores.

### 3. Let any AI edit only the mirror

Open the mirror with the harness of your choice:

```bash
cd ~/ai-mirrors/shop-api-ai
codex              # or another harness/AI tool
```

For example, ask the AI to add tax calculation to `checkout/tax.py` and its tests. The AI edits the mirror only. Before leaving the mirror, it fills `AIMP_REPORT.md` and preserves the generated identity fields:

```markdown
Mirror-ID: 7d8f17e5-4f2b-4e6a-8c10-5a1c3d7f9b21
Branch: feature/checkout-tax
Batch-ID: 2c41a9b8-0d6e-4f70-9c33-7b2e1a8d5f44
Status: ready

## Summary
Added an 11% tax calculation for taxable checkout items and covered it with unit tests.

## Commit Message
Add checkout tax calculation

## Tests
pytest checkout/tests/test_tax.py

## Notes
Tax is applied only to taxable items; shipping remains exempt.
```

The IDs above are examples. Keep the exact generated `Mirror-ID`, `Branch`, and `Batch-ID` values in your own report. `Status: ready` and all four sections are required before `/sync` can proceed.

### 4. Review and apply the batch

Return to the original project:

```text
$ cd ~/projects/shop-api
$ aimp
$ /status
Original: clean
Branch: feature/checkout-tax
AI copy: /home/alice/ai-mirrors/shop-api-ai
AI pending: true

$ /diff
modified  "checkout/tax.py"
added     "checkout/tests/test_tax.py"

$ /sync
Apply these files and create a local AI checkpoint? Original remains uncommitted. [y/N] y
Checkpoint AI: 4f2a...
```

AIMP copies the reviewed files to the original, leaves the original Git index and HEAD under your control, and creates one local mirror checkpoint whose message ends in `(synced)`. Review and test the original, then commit it with the project's normal workflow:

```bash
git diff
pytest checkout/tests/test_tax.py
git add checkout/tax.py checkout/tests/test_tax.py
git commit -m "Add checkout tax calculation"
```

### 5. Refresh the mirror after an original commit

After you commit another change in the original, refresh the mirror manually:

```text
$ aimp
$ /sync-original-to-ai
Apply these files and create a local AI checkpoint? Original remains uncommitted. [y/N] y
```

This command requires a clean original and no pending mirror work. If you switch to another original branch, run `/use` (or initialize it with `/init`) so the mirror branch remains paired explicitly.

### 6. Recover an interrupted operation

If the terminal or process stops during `/sync`, do not delete AIMP state or reset Git. Return to the original and run:

```text
$ aimp
$ /doctor
$ /recover
```

Use `/recover rollback` when you want to restore the transaction backup instead of resuming it.

## Ignore policy and safety

`.aimpignore` lives at the original project root and defines exclusions in both directions, including for files already tracked by Git. Patterns follow Git's ignore syntax:

```gitignore
*.env
private/
!private/example.env
```

Excluded files are not copied, deleted, or applied. Use your own placeholders for AI configuration; AIMP does not automatically sanitize credentials. `AGENTS-AIMP.md` provides harness instructions, not an OS sandbox. An AI process running as the same user can still read other files allowed by the operating system. Detailed contracts, platform limits, and the release plan are in `docs/`.

## Development

```bash
npm ci
npm run verify
npm pack --dry-run --json
```

Report bugs at <https://github.com/bbliong/aimp.dev/issues>. For security reports, see `SECURITY.md`.
