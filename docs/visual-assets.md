# Visual assets

Client marks identify the compatible tools. Their names and marks belong to their respective owners. The same SVG files are used by the website, local inspector and portable reports. Portable reports embed the marks as data URLs.

| Client | Source | Included asset |
| --- | --- | --- |
| Codex | [Lobe Icons, pinned source](https://github.com/lobehub/lobe-icons/blob/63c800e3db6427b3f156f7b88d426ccb3f7277a1/packages/static-svg/icons/codex.svg) | codex.svg, under the upstream MIT license |
| Claude Code | [Claude's official icon](https://claude.com/icon.svg) | claude.svg, coral Claude mark |
| GitHub Copilot | [GitHub Primer Octicons](https://github.com/primer/octicons/blob/main/icons/copilot-24.svg) | copilot.svg, under the upstream MIT license |
| Gemini CLI | [Official brand kit](https://geminicli.com/brand-kit/) | gemini.svg, full-color icon |
| Cursor | [Official brand assets](https://cursor.com/brand) | cursor.svg, 2D cube for a light background |
| OpenCode | [Official brand assets](https://opencode.ai/brand) | opencode.svg, logo for a light background |

Retrieved on 2026-11-13. The imported SVG bytes retain their supplied geometry, proportions and colors. Codex uses the community-maintained Lobe Icons asset. OpenAI's brand page returned HTTP 403 during direct asset retrieval. Upstream MIT notices are included beside the assets in packages/web/assets/clients.

The website opening is an original WebGL contour field with a moving light, film grain and pointer parallax. Changing the client updates its lighting and the real bundled-example result. Motion pauses outside the viewport and when the page is hidden. A pause control and reduced-motion preference support a static presentation. A CSS composition supplies the opening when WebGL is unavailable. The reference opening informed the visual research. [Anthropic reference](https://www.anthropic.com/claude-fable-and-mythos-5-2)
