# Cashflow UI Lab — foundation 0.1 (BIT-198)

Standalone React + Mantine component catalog. No financial engine, actual persistence or deployment changes. All fixtures synthetic. Run from this directory with Node 24: `npm install`, `npm run dev`, `npm test`, `npm run build`. Commit the generated package-lock after resolving dependencies; use npm ci thereafter. Catalog is a review surface, not production.

## Direction: technical editorial
Figma/Framer-like density, dark neutral-blue surfaces, restrained semantic color, crisp borders; light and high contrast are first-class. Preserve current Cashflow palette and Noto Sans/Mono preference (system fallback until local font assets are configured). 4 px radius, 8 px rhythm (4 px subdivisions). No permanent glow, noisy gradient, or animated board background.

## API and ownership
- `src/ui/tokens.css`: semantic colors ported from existing CSS, typography, spacing, radius, motion.
- `theme.js`: Mantine provider defaults. Use Mantine directly for basic accessible controls; compose only when recurring behavior warrants it.
- `components.jsx`: shared buttons, surfaces, money, financial cards, anchored editor, status, empty state.
- `index.js`: public internal export surface; no feature imports vendor internals for these shared patterns.
- `main.jsx`: isolated playground. No duplicate product feature implementations.
- Preserve source domain modules and existing data migrations in production. A component renders state and emits intent; it never calculates or persists financial state.

## Motion
120 ms hover/press, 180 ms focus/overlay/value feedback, 240 ms for larger transitions when justified. Transform/opacity where possible; no perpetual animation, no animation during graph pan/drag or simulation recomputation. Reduced motion must include Mantine transitions and any imported effects. Never animate obscured amounts or expose them through accessible names or hidden DOM. Use stable layout and no color-only status.

## React Bits adoption
Verified upstream README and LICENSE.md (MIT + Commons Clause): app usage allowed, standalone redistribution of components restricted. The generic library remains independent of React Bits. Selectively integrate app-specific copies only after license and accessibility review, record upstream commit and copyright/notice in third-party notices. Do not repackage vendor components. Candidates: StatusMark, WarmTooltip, SpringCheck, GlideSelect, RubberSegment, CountUp (demo only until privacy and precision verified), ScrubField (only with keyboard alternative and explicit commit). No copied React Bits code yet; CSS motion currently original and functional. Avoid WebGL backgrounds, continuous effects, flashy cards. Prefer Mantine for semantics and focus behavior. See https://github.com/DavidHDev/react-bits and https://github.com/DavidHDev/react-bits/blob/main/LICENSE.md.

## Acceptance before product migration
Review dark/light/contrast, 390px and 1440px widths, keyboard/focus/escape, reduced motion, text/non-text contrast, privacy DOM, overlay near edges. Add component tests and visual regression before promoting to production. Test cursor-based virtual anchors separately. Add canvas handles, edge labels, multi-selection and simulation patterns only after primitives are accepted and React Flow spike is complete. Existing PDF layout is binding for product, not for the catalog. No merge/deploy until approval. No new standalone npm package until actual cross-project reuse exists.
