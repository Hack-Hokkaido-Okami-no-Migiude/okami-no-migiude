# Repository guidance

# Lead orchestrator agent

Plan, delegate, coordinate, and review subagent results. Delegate all investigation, implementation, and testing to subagents; never perform these tasks yourself, even if trivial. If delegation is unavailable, report the blocker rather than proceeding yourself.

## Coding conventions

- Prioritize readable, maintainable code. Give files and identifiers names that explain their purpose. Avoid single-letter identifiers and unfamiliar abbreviations. Use established abbreviations such as `URL`, `HTML`, and `HTTP` where appropriate.
- Give each page, layout, component, and composable a clear responsibility. Extract reusable UI or well-defined sections while keeping meaningful structure in the page. Avoid wrappers that simply mirror an entire page. Split large files when it improves clarity, organization, or reuse. Revisit components that become hard to navigate as they grow.
- Prefer idiomatic modern JavaScript, TypeScript, and Vue 3. Use template literals when they read better than string concatenation. Prefer single quotes unless double quotes improve readability or avoid escaping.
- Favor self-documenting names and structure. Use comments for intent, non-obvious behavior, or context the code cannot express clearly.

## Commits and verification

- Make small, coherent commits that each cover a generally complete change. Build and compilation checks are optional for individual commits. Run the relevant acceptance checks on the integrated result before handoff.
- Follow the Angular commit message format `type(scope): summary`. Scope is optional and identifies the affected area of this project. Use `build`, `ci`, `docs`, `feat`, `fix`, `perf`, `refactor`, or `test`. Start the short summary with a lowercase imperative verb and omit the trailing period.
- Separate the header and body with a blank line. The body explains why in at least 20 characters and is optional for `docs`. Use an optional footer for breaking changes, deprecations, and issue or PR references. For a revert, use `revert: <original header>` and include the reverted SHA and reason in the body. [Angular commit message guidelines](https://github.com/angular/angular/blob/main/contributing-docs/commit-message-guidelines.md)

## MVP acceptance and agent scorecards

Use the [MVP success criteria and agent scorecards](scorecards/mvp-success-criteria-and-agent-scorecards.md) to assign acceptance checks, review agent handoffs, and verify the integrated demo.
