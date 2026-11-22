# Failure Lessons & Project Invariants

This directory records engineering failures, architectural mistakes, and unexpected defects by reusable failure class according to the 14-section Gate 0 canonical schema.

> **"Pay for an engineering mistake once. After that, the project remembers it."**

## Canonical 14-Section Schema

Every failure lesson file in `Failure-lessons/<slug>.md` must strictly contain the following 14 sections:
1. **Context**: Background environment, active components, and state before the failure.
2. **What happened**: Concrete sequence of events that occurred.
3. **Observable symptom**: The exact error message, stack trace, broken contract, or user-visible malfunction.
4. **Impact**: Severity, wasted cycles, security or data-loss risks, and downstream fallout.
5. **Incorrect assumption**: The flawed hypothesis, mental model, or design assumption.
6. **Root cause**: Confirmed mechanism explanation (labelled: **Confirmed**, **Strongly Indicated**, or **Hypothesis**).
7. **Why the architecture allowed it**: The structural gap or missing check that permitted the failure to happen.
8. **Fix**: Exact architectural remediation, code changes, and configuration updates.
9. **Verification**: Executable commands or test cases proving the fix works.
10. **Prevention rule**: Brief, actionable invariant rule to prevent recurrence.
11. **Reusable lesson**: Universal engineering wisdom applicable beyond this specific codebase.
12. **Related code**: Exact file and module paths affected.
13. **Related tests**: Exact test suite paths enforcing the invariant.
14. **Status**: `Resolved`, `Partially Mitigated`, or `Unresolved`.

## Registry Index
All failure lessons must be registered in [lessons-index.md](lessons-index.md) and their prevention rules cross-referenced in [AGENTS.md](../AGENTS.md).
