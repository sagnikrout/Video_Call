---
name: token-efficient-dev
description: Use this skill when planning large refactors, searching complex codebases, or optimizing Antigravity token usage and execution performance.
---

# Token-Efficient Development Workflow

This skill outlines best practices for keeping Antigravity context windows lean, avoiding context degradation, and maximizing speed and token efficiency.

## 1. Targeted Code Navigation
- **`grep_search`**: Search for exact function names, imports, or class definitions instead of opening entire directories.
- **Line-bounded `view_file`**: Read only relevant line slices (e.g. lines 40-120) instead of fetching full files.
- **Reference Docs**: Store large specs or API documentations in sub-files (e.g. `references/api-spec.md`) so they are read only when specifically needed.

## 2. Subagent Offloading Pattern
When facing tasks that require searching 10+ files, reading long logs, or researching external libraries:
1. Call `invoke_subagent` with the `research` subagent.
2. Formulate a clear, specific research prompt for the subagent.
3. The subagent executes all tool calls in its own isolated context window and returns a synthesized response.
4. Main context window stays compact and focused on writing clean code.

## 3. Atomic File Modifications
- Use `replace_file_content` for single contiguous edits.
- Use `multi_replace_file_content` for non-contiguous edits in the same file.
- Avoid overwriting whole files or printing whole file outputs in response.

## 4. Model Selection Guidance
- Use **Gemini 3.6 Flash / Flash Lite** for fast research, routine edits, linter fixes, and log inspection.
- Switch to **Pro models** for complex multi-file architectural planning and heavy logical reasoning.
