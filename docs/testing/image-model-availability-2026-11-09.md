# Image model availability

Only Masterino changes. Keep upstream model IDs and Aihub configuration unchanged.

Image classification is not sufficient for selection: the provider's resolved parameters must pass ModelParamsMetaSchema (including required prompt definition). The same check runs when rendering options and immediately before mutating the image draft. A directory change between render and click returns a failed selection result, preserves the draft, and produces an availability message in the image input.

| Case | Expected | Automated |
|---|---|---|
| Missing/null/empty/malformed schema | Refuse selection, preserve model/provider, prompt/reference inputs and remembered settings | Passed |
| Provider-group and single-model rows | Disabled native menu item, visible reason, mouse/Enter cannot trigger selection or close | Passed |
| All providers unavailable | Disabled group with explanation | Passed |
| Mixed provider readiness | Default group selection chooses a usable provider; unavailable provider remains disabled | Passed for default selection |
| Valid image schema | Existing selection and input preservation behavior continues | Passed |
| Video model without image schema | Existing video selection continues | Passed |

49 focused tests passed: image generation config actions (32), dropdown rows and real outer panel integration (9), existing chat provider rows (2), shared panel handlers (1), and shared Vite renderer config (5). TypeScript checking and ESLint on changed TypeScript files passed.

Electron acceptance steps (test endpoint only, renderer-only directory fixture matching the observed production metadata; no generation):
1. Open image input with a known valid model plus flare/sunburst entries lacking parameters.
2. Verify both unavailable entries are visible, disabled, and explain why.
3. Click an unavailable entry: keep the menu and current selection, no new unhandled rejection.
4. Select the valid model: menu closes and current model/provider change normally.
5. Clear renderer fixture / stop isolated App. Do not deploy or alter provider configuration.

Observed in an isolated Electron development App connected to `https://mlai-test.bielcrystal.com`, with a separate disposable profile:
- The real test catalog did not contain these image aliases. The three-entry fixture was injected only into renderer memory through DevTools; no Aihub or server catalog changes were made. This verifies client behavior, not upstream protocol compatibility or image generation.
- The first real click caught a missing menu context when mixing root-package and base-ui entry points. Generation roots now use the same entry point as generation rows, and both UI entry points are prebundled together so portals retain the application theme context. Reopened menu had the correct surface, anchor position, and disabled appearance.
- Clicking flare kept the menu open. Clicking GPT Image 2 closed it; DevTools read back `model=gpt-image-2`, `provider=newapi`, and zero unhandled Zod errors.
- Calling the real selection callback with the now-invalid flare entry kept GPT Image 2 selected, displayed the availability toast, and still recorded zero unhandled Zod errors.
- Navigated to video and opened its model menu; returned home and opened the populated chat model menu successfully. The test account has no enabled video models, so video selection is covered by the component regression instead. No messages or generation requests were sent.

Impact boundary: shared model-picker rendering, image selection state, translations, and development dependency prebundling. Existing chat rendering remains on its original menu entry point. No changes to upstream model IDs, provider routing, authentication, cluster configuration, deployment, or image/video generation requests. Production was not used for this acceptance run.
