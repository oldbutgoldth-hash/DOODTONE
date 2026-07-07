# LUMIXA AI — Handoff Package

This is a **drop-in replacement** for your original `PresetForge AI` static site — not a mockup. All 30 analysis engines in `core/` are byte-for-byte unchanged from your codebase (verified via diff — Stage 2.4.2B.1); `ui/app.js` and `ui/ui-engine.js` are your original controller logic with only the styling mechanism swapped (inline CSS custom properties instead of `styles.css`); every canvas renderer (`ui/*-renderer.js`) is untouched.

## How to use it
1. Copy `index.html`, `ui/`, `core/` into your repo, replacing the existing ones. (`styles.css` is no longer used/needed — the new design is inline.)
2. `vercel.json` / `netlify.toml` / `.gitignore` are copied over unchanged — no deploy config changes needed.
3. Push and deploy exactly as before (static site, ES module entrypoint at `ui/app.js`).

## What changed (visual redesign)
- Warm graphite/espresso surfaces, antique-brass accent, Cormorant Garamond (display) + Public Sans (UI) + JetBrains Mono (data) instead of the old "Lumina Precision" purple dark theme.
- Dark/light theme, language switch, tabs, drag-drop, and modal open/close now toggle inline styles directly instead of CSS classes (since there's no external stylesheet). Behavior is identical to before.
- All content, copy, upload flow, sliders, tone-curve editor, AI pipeline, and .xmp export are unchanged.

## Fixes applied during review/QA (this pass)
The original hand-off had **zero `@media` rules** — verified with Playwright at 390px/768px/1440px viewports before and after:

| Issue found | Root cause | Fix |
|---|---|---|
| Topbar overflowed ~57px on mobile | Logo + 4 nav links + plan badge + 2 icon buttons in one un-wrapped flex row, no breakpoint | `.lx-topbar-nav`/`.lx-plan-badge` hidden, gaps reduced under 680px |
| Two `1fr 1fr` content grids overflowed | Unconstrained `1fr` tracks let intrinsic content width win over the fraction (the standard CSS Grid gotcha — needs `minmax(0,1fr)` to truly shrink) | `.lx-2col-grid` forced to a single column under 680px |
| Left (272px) + right (288px) sidebars caused ~614px of unavoidable overflow on any screen under ~900px | The main layout is a permanent 3-column flex row with fixed-width asides and no responsive fallback at all | `.lx-sidebar-left`/`.lx-sidebar-right` hidden and `.lx-main-layout` stacks to a single column under 900px — the upload/analyze/slider/download flow (the core function) lives entirely in the main column and is unaffected |

All fixes are pure additive CSS (`@media` block + a handful of `class="..."` attributes added alongside existing inline `style="..."` — no `id`, no JS hook, no inline style was removed or altered), so `ui/app.js`/`ui/ui-engine.js` behaviour is provably unaffected. Verified end-to-end after the fix: 390px/768px/1440px all scroll within ~6px of their viewport width (normal scrollbar allowance, not overflow), full analyze→export pipeline still produces a valid .xmp with no console errors at any size.

## Note
This export strips the `style-hover` micro-interactions used in the interactive design-tool preview (hover color shifts on nav links, buttons, cards) since plain HTML doesn't support that shorthand. If you want hover states preserved 1:1, add a small `<style>` block with `:hover` rules for `.nav-item:hover`, `.tab-btn:hover`, etc., or ask for a version with `onmouseover`/`onmouseout` wired in.
