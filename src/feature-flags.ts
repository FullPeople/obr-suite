// Feature visibility for stable / dev channel split.
//
// Set STABLE_HIDES = true before building the stable channel (`/suite/`)
// to hide features that aren't ready for the public listing yet:
//   - global search module + settings tab
//   - status-tracker module + settings tab
//   - panel-layout editor entry in basics settings
//   - initiative invisibility marking (right-click + overlay sync)
//
// Set STABLE_HIDES = false before building the dev channel
// (`/suite-dev/`) so the full feature set shows up for ongoing
// iteration / testing.
//
// The hides are AT THE FEATURE LEVEL (settings UI hidden + setup
// skipped). Existing scene metadata that previously enabled these
// modules is harmlessly ignored — re-enabling them is a single rebuild.
export const STABLE_HIDES = false;
