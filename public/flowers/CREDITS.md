# Botanical assets

Models and texture maps: [Poly Haven](https://polyhaven.com), [CC0](https://polyhaven.com/license). Rendered posters and thumbnails derive from these models. Assets reduced to one specimen and embedded WebP textures for this website.

- [Planter Pot Clay](https://polyhaven.com/a/planter_pot_clay)
- [Flower Gazania](https://polyhaven.com/a/flower_gazania)
- [Flower Ursinia](https://polyhaven.com/a/flower_ursinia)
- [Flower Heliophila](https://polyhaven.com/a/flower_heliophila)
- [Periwinkle Plant](https://polyhaven.com/a/periwinkle_plant)
- [Flower Empodium](https://polyhaven.com/a/flower_empodium)
- [Rock Moss Set 01](https://polyhaven.com/a/rock_moss_set_01)

## Carousel interaction

Arc positioning adapted from [Circular Carousel by nexus-ui on 21st.dev](https://21st.dev/@nexus-ui/components/circular-carousel) (demo 21951). Responsive radius, 15-degree spacing, cream botanical tiles, continuous autoplay after pointer selection, and keyboard-focus pause replace the original visual treatment. Uses the existing Framer Motion dependency.


Loop reset reviewed against [Infinite Slider by ibelick](https://21st.dev/@ibelick/components/infinite-slider) (demo 1664). Reset-at-boundary becomes a new card cycle key with offscreen entry; no react-use-measure dependency or duplicated carousel track. Botanical background shadows reuse the CC0 rendered thumbnails above.

## Landing composition

Sticky media alongside scrolling chapters adapts [Scroll 01 by felipemenezes098](https://21st.dev/@felipemenezes098/components/scroll-01) (demo 18041). Its mobile/desktop split and sticky composition use the existing Framer Motion and local SVG cutaway, without additional dependencies. Source retrieved through MCP `21st_5`, after `21st_4` search, with a 2.5-second gap.

Compact brand and footer layout references [Minimal Two-Column Footer by ln-dev7](https://21st.dev/@ln-dev7/components/footer-17) (demo 26908), discovered via `21st_6`. Catalog metadata informed composition; footer source was not retrieved.

## Scroll story components

Source retrieved via 21st.dev MCP and adapted to typed props, moss/cream tokens, local SVG visuals, real scenario data, and keyboard/reduced-motion behavior:

- [Sticky Scroll Reveal by manuarora700](https://21st.dev/@manuarora700/components/sticky-scroll-reveal), demo 952, `21st_8`. Uses page scroll and three scenes rather than a nested scrolling container.
- [Animated Tabs by preetsuthar17](https://21st.dev/@preetsuthar17/components/animated-tabs), demo 1962, `21st_9`. Controlled sensor/scenario buttons with native semantics and arrow-key selection.
- [Reading Text Reveal by waleedkibhen](https://21st.dev/@waleedkibhen/components/reading-text-reveal), demo 9386, `21st_10`. Readable muted words become cream; full text remains accessible.

Fetches were sequential, separated by 2.5 seconds. Existing Lenis smooths page scroll; existing Framer Motion handles reveal and scene transitions. No new dependencies.

## Popular component refinement

Popularity checked on 21st.dev's live **Popular** collection on 2026-10-01, rather than treating relevance-ranked MCP search as a popularity ranking.

[Spotlight Card by jahed](https://21st.dev/@jahed/components/spotlight-card), demo 2487, appeared in the homepage Popular row with 8.2k saves. Source retrieved through `21st_4`. Landing experiment and dashboard metric cards reuse its pointer-following radial border, adapted to local pointer coordinates, solid moss/sage surfaces, native touch scrolling and reduced motion. No document-level listener, blur or color-changing glow.

[Container Scroll Animation by manuarora700](https://21st.dev/@manuarora700/components/container-scroll-animation), demo 1081, appeared in the Popular row with 9.8k saves. Source retrieved through `21st_6` after `21st_5` reached its daily retrieval limit. Adapted in `src/components/ui/container-scroll.tsx` for the experiment workbench; the root story now uses a continuous, unframed stage. Existing Framer Motion maps page scroll to a 16-degree entrance tilt that flattens to zero, plus scale and translation. Real content replaces the demo dashboard; mobile/reduced motion remain static.

[Progress Indicator by anurag-mishra22](https://21st.dev/@anurag-mishra22/components/progress-indicator), demo 20, appeared in the full Popular listing. Source retrieved through `21st_1` after `21st_10` reached its daily retrieval limit. Its active-step concept is adapted in `sticky-scroll-reveal.tsx`: the active marker follows the actual story chapter and links to it; the continuous stage uses a quiet underline. No artificial Back/Continue/Finish demo state is used.

Requests stayed sequential with 2.5-second delays and round-robin server rotation. No dependency added.


## Compact dashboard and controls

[HeroUI Disclosure by hero_ui](https://21st.dev/@hero_ui/components/heroui-disclosure), demo 14029, source retrieved through `21st_4`. Dashboard adapts its progressive disclosure and indicator rotation with native `details/summary` and CSS. Four numeric cards, histogram, quality and daily ranges remain available in one initially closed panel. Native keyboard/focus behavior replaces the source context and ResizeObserver.

[Button by originui](https://21st.dev/@originui/components/button), demo 247 (Show more button), source retrieved through `21st_6`. Existing controls adapt its consistent radius, non-shrinking icons, focus and quiet hover feedback. Existing Radix/shadcn wrappers remain in use; no Slot/CVA dependency added.

Search and source requests rotated through `21st_3` to `21st_7`, with sequential source retrieval and 2.5-second gaps. Botanical hero candidates were reviewed but not integrated because they did not fit this page. Dribbble's plant-dashboard search required human verification; no Dribbble design was retrieved or used.


## Product typography and FAQ

[Nunito Sans](https://fonts.google.com/specimen/Nunito+Sans), Nunito Sans Project Authors, SIL Open Font License 1.1. Latin variable WOFF2 (400–700) sourced from Google Fonts and served locally at public/fonts/nunito-sans-latin.woff2. License preserved at public/fonts/OFL.txt. No external font requests from the application.

[Feature Accordion Section by ruixen.ui](https://21st.dev/@ruixen.ui/components/feature-accordion-section), demo 5553. Search through 21st_8; source retrieved through 21st_9. Its question/detail structure is adapted beside the simulator invitation. Real scope explanations replace demo AI, integration, counts and image claims. Native details/summary supplies keyboard behavior and single-open grouping without adding Next.js or an accordion dependency. Browsers without named-group support still expose every answer.

AgroMark (pot, leaves and roots) and matching favicon are original project SVG drawings, not copied from 21st.dev. They identify the same product across landing and simulator.

## Site navigation transition

[Page Transition](https://21st.dev/@su2491251/components/page-transition), su2491251, demo 29262. Retrieved through 21st_2 after the 21st_1 daily quota was exhausted, with a 2.5-second fetch gap. Adapted the fade pattern with native View Transition snapshots; omitted stairs, waves, full-screen demo controls, and artificial timers. Landing stays mounted until the real app module finishes loading. A delayed status chip reports slow requests without replacing the page. Unsupported browsers use a short CSS opacity fade; reduced motion disables decorative transitions.

## Dashboard care annotations

[Activity Timeline](https://21st.dev/@olewandowski1/components/timeline-3), olewandowski1, demo 28340. Metadata through 21st_3; source retrieved through 21st_7 after 21st_4, 21st_5 and 21st_6 reported exhausted quota. Consecutive code requests were spaced by 2.5 seconds. Adapted its ordered activity/time rows to real planting, watering and fertilizer records next to chart markers. Native details/summary and existing Lucide icons replace avatars, badges, registry utilities and team demo data. No new dependencies or remote assets are used by the app. Source snapshot is in .tmp/dashboard-assistance/activity-timeline-source.tsx.
## Continuous narrative (2026-10-02)

[Corn Revolution, RESN / Pioneer](https://cornrevolution.resn.global/#), supplied by the user. Playwright captured ten main scroll checkpoints and 45 intermediate transition screenshots after loading, at 1440 × 900. Observed structure: hero specimen, genetic foundation, selection, seedling, field testing, and result. Object continuity, progressive camera focus, concise contextual text, and restrained progress navigation inform the Smart Agro root story. Its single local SVG pot opens to reveal roots and probes; the camera zooms with page scroll. Existing 21st.dev Sticky Scroll Reveal and Progress Indicator are adapted, without another source fetch or dependency. No reference branding, proprietary text, models, textures, audio, scripts, or claimed farming results are reused.
