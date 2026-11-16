# Starter work

Each proposal has a bounded outcome, suggested code entry points and acceptance checks. Check the current implementation and open pull requests before choosing one. The [contribution guide](../CONTRIBUTING.md) covers setup and validation.

## Show platform-specific keyboard hints

The live target picker currently displays a Command-key hint on every platform. Its keyboard handler accepts both Command+K and Ctrl+K.

Start with the live target hint, its controller and the inspector browser tests. [shell.html](../packages/web/assets/shell.html) · [app.js](../packages/web/assets/app.js) · [inspector.spec.ts](../tests/web/inspector.spec.ts)

* Show the Command key on macOS and Ctrl on Windows and Linux.
* Keep target selection usable with the existing keyboard handlers.
* Verify the visible hint under each emulated platform and check target-field focus after the shortcut.
* Check live and standalone reports, including the existing hidden target shortcut in standalone reports.

## Keep clipboard success feedback inside the open dialog

The shared clipboard helper writes its success message to the page-level toast. Finding and setting copy actions can run inside a modal dialog, whose backdrop covers the page-level message.

Start with `toast()`, `copy()` and the existing clipboard browser cases. [app.js](../packages/web/assets/app.js) · [shell.html](../packages/web/assets/shell.html) · [inspector.spec.ts](../tests/web/inspector.spec.ts)

* Show and announce successful copying within the active dialog.
* Keep page-level copy feedback visible when a dialog is closed.
* Exercise repeated copying, Escape and close actions, and the selected-text fallback when clipboard access is denied.
* Check desktop, phone and offline report behavior with visible keyboard focus and accessible status feedback.

## Add a Japanese quick start

Use the English and Chinese quick starts as the content sources for `README.ja.md`. [English](../README.md) · [简体中文](../README.zh-CN.md)

* Include the current public install command, bundled demo, common inspection commands, privacy scope and experimental-client status.
* State the current language of the application interface and diagnostic prose.
* Reuse the captured product screenshots with translated alternative text.
* Add language navigation and extend the README command check in `tests/web/website.spec.ts`.
* Verify relative documentation links and run the documented commands with a synthetic repository.

## Larger increments

* Localized terminal descriptions with stable rule IDs and JSON fields.
* File-based Claude model and context-size inputs for exact on-demand character truncation.
* Broader native-client conformance and explicit plugin/managed-policy provenance.
