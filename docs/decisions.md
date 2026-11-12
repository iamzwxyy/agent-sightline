# v0.1.0 decisions

See what your coding agent actually sees. A local configuration inspector with file-scoped explanations and proof, not semantic guesses.

* TypeScript + Node 22; one npm distribution, small internal packages, no framework or desktop runtime.
* Adapters own discovery, resolution, precedence and validation. Shared IR records loading decisions, per-setting provenance, extensions and stable findings.
* Default scan reads repository configuration and only documented user configuration locations. It never runs client or hook commands. `doctor --probe` explicitly opts into stdio MCP initialization; it does not invoke tools.
* The target directory models a fresh session launched there, and (for path rules) opening the target file. Trust-dependent sources are conditional unless trust is known or explicitly assumed. Session toggles, CLI overrides, managed cloud state and model-selected rules are not inferred.
* Natural-language instructions accumulate. Later placement is not proof of semantic replacement. Only file selection, structured overrides and other deterministic rules are diagnosed.
* Reports are redacted at the public API boundary and again at every renderer. Environment values are never returned.
* Codex, Claude and Copilot are the priority; experimental adapters describe their partial scope explicitly.
* Working name Agent X-Ray conflicts with existing session viewers and a PyPI package. Agent Sightline is the selected compound name after registry/search checks.
