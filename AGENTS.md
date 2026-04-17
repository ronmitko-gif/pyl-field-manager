# AGENTS.md

Guide for which Claude Code agents, skills, and plugins to use when working on PYL Field Manager. Think of this as the "right tool for the job" reference — read it once per session and invoke proactively, don't wait to be told.

---

## Quick reference table

| Task | Use |
|---|---|
| Building any UI (page, component, layout) | `frontend-design` skill |
| Creating or modifying SQL migrations | `code-review` plugin after writing |
| Writing auth flow code | `code-review` plugin after writing |
| Writing ingestor / parsing / sync code | `code-review` plugin after writing |
| Polishing code at end of session | `code-simplifier` plugin |
| Any branded/styled UI starting Session 2+ | `poweryourleague-brand` skill |
| Generating a Word doc (`.docx`) | `docx` skill |
| Generating a PDF | `pdf` skill |
| Generating a spreadsheet (`.xlsx`) | `xlsx` skill |
| Generating a slide deck (`.pptx`) | `pptx` skill |
| Reading a PDF someone uploaded | `pdf-reading` skill |
| Reading any uploaded file you don't yet have content for | `file-reading` skill |
| Anything involving Anthropic products, Claude Code, API pricing | `product-self-knowledge` skill |
| Creating or modifying a Claude skill | `skill-creator` skill |

---

## Skills — when and how

### `frontend-design`
**Invoke:** Before writing the first line of any page, component, or layout. Not just at Session 2+ — even Session 1's bare admin page benefits from the design tokens so styling stays consistent.

**Why:** This skill loads the CSS variable system, typography scale, spacing rules, and component patterns used across Anthropic's frontend work. Without it, you'll end up with inconsistent colors, ad-hoc spacing, and the generic AI-tool look we're explicitly avoiding for PYL.

**How:** Read `/mnt/skills/public/frontend-design/SKILL.md` at the start of any session that touches UI. Follow its guidance on tokens, layout, and component composition.

---

### `poweryourleague-brand`
**Invoke:** Starting Session 2, when we begin building real UI (the calendar grid, coach portal, admin panels).

**Do NOT invoke:** In Session 1, where the admin page is deliberately bare-bones ("doesn't look broken" is the bar).

**Why:** This is PYL's visual identity skill — brand colors, typography, voice, logo usage. Applied too early it creates polish we then have to rework. Applied at the right time it ensures the test environment already looks like a PYL product, which matters when Meesh shows it to potential PYL customers as a reference.

**How:** Read `/mnt/skills/user/poweryourleague-brand/SKILL.md`. Apply brand tokens on top of frontend-design's base tokens.

---

### Document creation skills (`docx`, `pdf`, `pptx`, `xlsx`)
**Invoke:** When Meesh asks for a document, presentation, or spreadsheet related to the project — user guides for coaches, onboarding PDFs for new organizations, pitch decks about the Field Manager module, etc.

**Do NOT invoke:** For in-app content (database records, API responses, UI copy). Those are code, not documents.

**How:** Read the relevant `/mnt/skills/public/{format}/SKILL.md` before generating. Each skill has specific best practices and helper scripts.

---

### `file-reading` and `pdf-reading`
**Invoke:** When Meesh uploads a file you haven't read yet. `file-reading` is the router that tells you which tool to use; `pdf-reading` is for PDFs specifically.

**How:** If a file path at `/mnt/user-data/uploads/` is mentioned and content isn't already in context, read `/mnt/skills/public/file-reading/SKILL.md` first.

---

### `product-self-knowledge`
**Invoke:** Any time you're about to state a fact about Anthropic's products — Claude Code installation, MCP servers, API pricing, model names, plan tiers, feature limits.

**Why:** Your training data may be out of date. This skill ensures you quote the current state of Anthropic's products, not last year's.

**How:** Read `/mnt/skills/public/product-self-knowledge/SKILL.md` before committing to a product claim.

---

### `skill-creator`
**Invoke:** Only when explicitly creating or modifying a Claude skill. This is rare on this project.

---

## Plugins — when and how

### `code-review`
**Invoke after writing:**
- Any SQL migration (schema mistakes are the most expensive to fix)
- Any auth flow (login, callback, middleware, RLS policies)
- Any external integration (iCal ingestor, Twilio client, Vercel Cron endpoint)
- Any code that handles money or credentials (not yet relevant in this project, but listed for completeness)

**Invoke before shipping:**
- End of every session, run against all changed files as a final check

**Why:** This plugin catches the class of bugs humans are bad at spotting — missing indexes, missing RLS policies, off-by-one errors in date handling, unvalidated inputs in API routes. Cheaper than finding them in production.

---

### `code-simplifier`
**Invoke:** At the end of every session, after the code works and tests pass.

**Why:** LLM-written code has a tendency toward verbose patterns — over-abstracted helper functions, unnecessary intermediate variables, defensive checks that Tailwind or TypeScript already handle. The simplifier trims the fat without changing behavior.

**Rules for accepting its suggestions:** If the simplifier's change reduces clarity, reject it. Brevity isn't a goal; clarity is. A 3-line version of a 5-line function that requires a comment to understand is worse than the 5-line version.

---

### `superpowers`
**Invoke:** Leave enabled by default. General-purpose utility across sessions.

---

## Agent orchestration patterns

### Pattern 1: New feature, fresh file
1. Read `CLAUDE.md` and the relevant session brief
2. Read `frontend-design` if UI is involved (and `poweryourleague-brand` from Session 2+)
3. Write the feature
4. Run `code-review` if it's schema/auth/integration code
5. Test locally
6. Commit and push
7. At end of session: `code-simplifier` on the changed files

### Pattern 2: Modifying existing code
1. Read the current implementation
2. Read the session brief to understand the intent of the change
3. Make the change
4. Run tests and lint
5. Run `code-review` only if the change touches schema/auth/integration
6. Commit and push

### Pattern 3: Debugging a production issue
1. Don't reach for a skill — first read the logs, the error message, the failing code
2. Form a hypothesis, write a minimal reproduction
3. Only after the bug is understood: decide if a refactor is warranted (if yes, `code-review` the refactor)
4. Commit the fix with a descriptive message and a reference to the symptom

### Pattern 4: Document generation for Meesh
1. Read the relevant document skill (`docx`, `pdf`, `pptx`, `xlsx`)
2. Follow its template and best practices
3. Place the output in `/mnt/user-data/outputs/`
4. Use `present_files` to make it accessible

---

## Things NOT to do

- **Don't invoke every skill every session.** Skills have a cost in tokens and focus. Invoke them when the task matches, not preventively.
- **Don't wrap everything in agents.** This is a solo-developer project with clear session scopes. Orchestration complexity adds friction without adding value.
- **Don't skip `code-review` on the expensive-to-fix code.** Schema, auth, integrations. These three categories should never be committed without review.
- **Don't use `code-simplifier` mid-session.** It can churn code that you're about to change anyway. End of session only.
- **Don't apply `poweryourleague-brand` in Session 1.** Explicit per `CLAUDE.md` — bare-bones is correct for Session 1.

---

## If you're unsure which skill to use

Default behavior: skip the skill, use your own judgment, and note in the session handoff "did not invoke {skill} because {reason}." Over time this file will accumulate clearer rules. Starting with fewer skills and adding them when obviously needed is safer than over-invoking and creating noise.
