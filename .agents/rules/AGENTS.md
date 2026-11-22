# Autonomous Capability & Tool Selection Preflight

> **MANDATORY AUTONOMOUS ROUTING PROTOCOL**: The user will NOT explicitly mention skills, plugins, or MCP tools. The agent MUST autonomously detect the domain, execute auto-routed specialist capabilities, and read the relevant `SKILL.md` before generating code.

## Autonomous Execution Rules
1. **Zero User-Prompt Requirement**: Never wait for the user to @mention tools or ask permission to use a skill. Infer intent automatically from the request.
2. **Read Before Code**: When an engineering or design domain is identified, call `read_file` on the corresponding `SKILL.md` from `~/.agents/skills/` before proposing code changes.
3. **Use Dedicated MCPs**: Call native MCP tools (`gbrain`, `xerj`, `rea`, `e2e_e2e`, `ui-master-rig`) rather than writing bash/python scripts.
4. **Brief Gate 0 Declaration**: State the autonomous tool selection in 1 concise line before execution.

## GitHub-First Remote Diff Guard (GitHub >> Local >> GitHub)
1. **Never Edit Blindly**: Before modifying files in any git repository tracking a remote, the system enforces a strict Remote Diff Guard on `edit_file` and `write_file`.
2. **Hard Block on Stale Files**: If GitHub contains newer unpulled commits affecting the target file (`HEAD..@{u}`), the edit tool is physically blocked with `decision: "deny"`.
3. **Reconcile First**: You MUST inspect incoming diffs (`git fetch && git diff HEAD..@{u} -- <file>`) and reconcile (`git pull --rebase`) before modifying code to ensure changes pushed from other workspaces are never overwritten.
4. **Local >> GitHub Verification**: Always verify `git diff` and run local guards before pushing back to GitHub.
