# MapleScouter ⇄ GMS Upgrade Tracker Sync

A [Tampermonkey](https://www.tampermonkey.net/) userscript that syncs character
inputs between [maplescouter.com/en/input](https://maplescouter.com/en/input)
and [gms-upgrade-tracker.vercel.app](https://gms-upgrade-tracker.vercel.app),
adding sync buttons directly on both sites:

- **On the GMS Upgrade Tracker** — *Save → MapleScouter preset* (writes your
  tracker character stats into a MapleScouter preset slot, like the site's own
  preset-save) and *Load ← MapleScouter preset* (imports a MapleScouter preset
  or its live inputs into the tracker's character stats).
- **On MapleScouter** — *Save → GMS Tracker* (sends the current `/input` values
  to the tracker) and *Load ← GMS Tracker* (fills `/input` from the tracker).

## Install

1. Install Tampermonkey.
2. Open the raw script:
   [`maplescouter-gms-tracker-sync.user.js`](https://raw.githubusercontent.com/tomerh2001/maplescouter-gms-tracker-sync/main/maplescouter-gms-tracker-sync.user.js)
   — Tampermonkey offers to install it. Updates are picked up automatically via
   `@updateURL`.
3. Visit both sites once. A floating **⇄ Sync** button appears bottom-right on
   each.

## How it works

Both sites are client-side apps whose inputs live in Zustand `persist`
localStorage stores, rehydrated on page load — each site's *own* import flow is
"write localStorage, reload". This script does exactly that, and bridges the
two origins with Tampermonkey's script-scoped `GM_setValue`/`GM_getValue`
storage (shared across both `@match` domains):

- Each site **mirrors** its state into GM storage while you browse it.
- A **Save** button converts the current site's state and queues a pending
  payload for the other site.
- The other site **applies** the payload on its next load — or instantly via
  `GM_addValueChangeListener` if a tab is already open — after a confirmation,
  then reloads (mirroring both sites' native import behavior).

Because the bridge is the userscript's storage, no server, account, or
extension is involved, and nothing leaves your browser.

### What is synced

Character stats (main/sub/third stat base–%–flat, ATT base/%, damage, boss
damage, IED, crit rate/damage), level, class, Arcane/Sacred force, and HEXA
progress (skill/mastery/boost/common cores incl. Sol Janus). Class names are
translated between the tracker's English names and MapleScouter's internal
Korean identifiers; `weaponMultiplier`/`statModel` are recomputed for the
tracker on import.

### What is not synced

Each side keeps its own site-specific inputs: the tracker's **gear/equipment
slots**, profiles, wildcard spares and Oz-ring state; MapleScouter's doping,
link skills, seed rings, legion/artifact and other calculator toggles (these
are preserved from your latest values, or sensible defaults on first sync).
MapleScouter's KMS-only class **Lethe (레테)** has no tracker equivalent.

The full storage contracts and field mapping are documented in
[docs/REVERSE_ENGINEERING.md](docs/REVERSE_ENGINEERING.md).

## Caveats

- Both sites are third-party apps; a redesign of their localStorage schemas can
  break the sync until this script is updated. The script validates envelopes
  and fails with a toast rather than corrupting data.
- ATT nuance: the tracker has no flat-ATT field, so MapleScouter's `atkAbs` is
  folded into the tracker's base ATT preserving the *effective* total.
- "Load" replaces the target site's character stats after an explicit
  confirmation. Gear and site-specific toggles are never overwritten.

## License

MIT
