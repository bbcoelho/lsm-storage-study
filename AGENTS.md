# Project Context

This repository is a TypeScript study project for learning log-structured storage concepts incrementally. The user wants the project to prioritize learning clarity over production-grade database completeness.

## Demo Design

Demos must be guided and interactive, not raw JSON dumps. Each lesson should present the concept, show the next operation, ask the learner to predict the result, wait for Enter, then render the state with readable tables and short takeaways.

The preferred style is concise and practical. Avoid long textbook explanations unless the user explicitly asks for deeper theory.

The original scripted demos printed precomputed JSON snapshots. The user rejected that approach because concepts were not being presented along the interaction.

Do not regress demos back to passive JSON dumps. Keep state output table-based and concept-driven.

## User Learning Preferences

When the user asks why a demo value appears, update the lesson itself with the explanation, not only the chat response. Explanations should appear near the interaction where the confusion happens.

Examples from this session:

- Lesson 01 now explains that offsets are byte positions, not row numbers.
- Lesson 01 now explains that `kind: "put"` stores a value and `kind: "delete"` later represents a tombstone.
- Lesson 02 now explains restart as durable log on disk plus empty in-memory hash index that must be rebuilt.

## Verification

Interactive demos should also support non-interactive execution for verification. Keep the existing non-TTY fallback behavior so commands like `npm run demo`, `npm run demo:01`, and `npm run demo:06` can complete in automated runs without hanging on `readline` prompts.

## Commit Workflow

The user prefers highly granular commits. For demo or learning-content changes, commit small focused steps separately, such as one lesson conversion, one explanation addition, one README update, or one verification fix.

Do not squash these learning-step commits unless explicitly requested.

## GitHub Publishing

The repository was created as `bbcoelho/lsm-storage-study` on GitHub. Push only when the user explicitly asks; local commits should not be automatically pushed after every change.
