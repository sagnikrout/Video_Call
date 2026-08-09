# Workspace Rules & Token Optimization Guidelines

These rules govern agent behavior in this project to maximize performance, maintain code quality, and minimize token context consumption.

---

## 1. Token & Context Window Optimization

- **Targeted Reading**: Avoid reading full files over 200 lines at once. Use `grep_search` to locate specific symbols or `view_file` with precise `StartLine` and `EndLine` parameters.
- **Targeted Editing**: Always use `replace_file_content` or `multi_replace_file_content` to edit specific blocks of code. Never rewrite an entire file to change a few lines.
- **Progressive Disclosure via Skills**: Place complex procedures and runbooks inside `.agents/skills/<skill-name>/SKILL.md` (and reference documents in `references/`). Skills load context on demand rather than bloating initial prompt context.
- **Subagent Delegation**: Delegate context-heavy tasks (e.g., broad web searches, multi-file code exploration, log analysis) to the `research` subagent via `invoke_subagent`. This keeps the primary agent context window lean and token-efficient.
- **Concise Responses**: Provide direct, actionable responses. Do not re-summarize code changes or print large snippets of unmodified code unless requested.

---

## 2. High-Precision Code Engineering

- **Empirical Diagnostics**: Inspect error tracebacks and full log outputs before making bug fix hypotheses. Do not make blind guesses.
- **Contract & Signature Verification**: Inspect component prop definitions, API schemas, and function signatures before invocation to avoid runtime type or key errors.
- **Preserve Existing Structure**: Retain existing docstrings, code formatting, and non-overlapping functionality when editing existing files.

---

## 3. Verification & Task Execution

- **Empirical Verification**: Always verify code edits by running build, lint, or test commands before marking a task as complete.
