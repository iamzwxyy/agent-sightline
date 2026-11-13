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

The website opening is an original Three.js shader scene. Its contour ribbons form an optical cross-section of configuration layers, with moving light, grain and pointer parallax. Client selection updates the real bundled-example result and the light. The shaders evaluate curves per vertex, and the renderer caps its backing buffer at 1.2 million pixels and its frame rate at 24 fps. Rendering pauses offscreen, on window blur and while the page is hidden.

A captured raster poster supplies the complete first frame before the scene loads. Reduced motion, unavailable WebGL2 and lost contexts use that poster. The reduced-motion preference removes the canvas and bypasses smooth scrolling. Motion resources, listeners, observers, timelines and the renderer are disposed during page teardown. The reference opening informed hierarchy, atmosphere and pacing. [Anthropic reference](https://www.anthropic.com/claude-fable-and-mythos-5-2)

The visual direction uses frontend-design alongside build-awwwards-quality-sites, with Instrument Sans and a cool paper/steel-blue palette. GSAP composes the opening and two restrained heading transitions. Lenis is the sole smooth-scroll engine and drives ScrollTrigger updates through the GSAP ticker. Locomotive Scroll was evaluated as a broader scroll-effects system. Lenis supplies the wheel and anchor behavior needed here with a smaller integration surface.

Solar interface icons are distributed through @iconify-json/solar 1.2.15 under CC BY 4.0. Their original paths are included in website/public/ui, with attribution. Typeface and motion-library notices are self-hosted alongside the site. GSAP, Lenis and Three.js are development dependencies used by the website build. The installed CLI and portable reports retain their existing offline assets. [Solar source](https://github.com/480-Design/Solar-Icon-Set) [Solar license](https://creativecommons.org/licenses/by/4.0/) [GSAP license](https://gsap.com/standard-license/) [Lenis](https://github.com/darkroomengineering/lenis) [Three.js](https://github.com/mrdoob/three.js)
