# Reverse engineering notes

Verified 2026-07-30 by static analysis of both sites' production JS bundles
(chunk hashes change per deploy; localStorage contracts are the stable interface).

## MapleScouter (`maplescouter.com/en/input`)

All state is client-side Zustand `persist` stores in `localStorage`. There is no
preset cloud API; the site's own "load preset" flow writes the store and calls
`window.location.reload()`.

| localStorage key | Envelope | Contents |
|---|---|---|
| `character-store` | `{"state":{...},"version":0}` | `state.searchResult.userStat` = the **live input state** of `/input`. `searchResult` may be `null`; loading a preset produces `{userStat}` only, so writing a bare `{userStat}` object is site-equivalent behavior. |
| `preset` | `{"state":{"preset":{"1":{data,label},...}},"version":0}` | Preset slots. `data` is a full `userStat` object, `label` is `"Lv <level> <localized class>"`. Slots start at `"1"`; the site initializes 3 slots whose `data` is the default template. |
| `region` | zustand persist | `kms \| gms \| tms \| jms \| msea`. On mount the input page force-syncs `userStat.isGMS/isTMS/isJMS/isMSEA` from this store. |

Preset UI mechanics (from `page-*.js`, module 77576):

- Save: `updatePreset(slot, userStat, "Lv "+level+" "+t(myClass))` where
  `userStat = searchResult.userStat`. "Slot is occupied" check =
  `parseInt(data.stat.mainStatBase) > 0`.
- Load: enabled when `data.stat.level !== "0"`; `setUserStat(preset[slot].data)`
  then `location.reload()`.

### `userStat` shape (default template extracted verbatim from the bundle)

Top-level groups: `doping`, `linkSkill`, `special`, `stat`, `hexa`, `seedRing`,
`entireStat`, `isGMS/isTMS/isJMS/isMSEA`, `power`, `huntSkill`.
Almost all leaf values are **strings**.

Key fields for the sync (group `stat`): `myClass` (Korean, e.g. `"메르세데스"`),
`level`, `mainStatBase/Per/Abs`, `subStatBase/Per/Abs`, `ssubStatBase/Per/Abs`
(third stat, e.g. Xenon), `atkBase`, `atkPercent`, `atkAbs`, `dmg`, `bossDmg`,
`ignoreDef` (percent 0–100), `critical`, `criticalDmg`, `arcaneForce`,
`authenticForce`. Total-stat formula: `base * (1 + per/100) + abs`.

Group `hexa`: `skillCore1..6`, `masteryCore1..4`, `reinCore1..4`,
`generalCore2..4`, `hexaStat` (number). Group `huntSkill`: `solJanus`,
`erdaShower`. (`generalCore1` does not exist — Sol Janus is stored in
`huntSkill.solJanus`.)

Class identity is Korean internally in every region; the `아란(GMS)`/`은월(GMS)`
strings exist only in the i18n dictionaries, not in store data. The
Korean→English map was extracted from the bundled `en/common.json` chunk
(webpack lazy chunk 2415).

## GMS Upgrade Tracker (`gms-upgrade-tracker.vercel.app`)

Next.js/Turbopack, Zustand persist stores:

| localStorage key | Version | Contents |
|---|---|---|
| `maplestory-gear-storage` | 3 | **Live working state**: `gear` (24 slots), `characterStats`, `selectedClass` (English), `characterName`, `characterLevel` (number\|null), `arcanePower` (number\|null), `sacredPower` (number\|null), `hexaProgress`, `hexaAssumptionMode` (`"estimated"\|"explicit"`), `ozRingState`, `wildcardSpares`, `lastSavedAt`. Has `migrate`/`merge` repair on rehydrate, so partial/merged writes are tolerated. |
| `maplestory-profiles-storage` | 3 | Saved profiles (id, name, selectedClass, characterStats, gear, ...). Not touched by the sync. |
| `maplestory-settings-storage` | 2 | Economy settings, `serverType` (`interactive\|heroic`), `nexonRegion`. Not touched. |
| `maplestory-planner-storage`, `maplestory-boss-income-storage` | | Planner state. Not touched. |

### `characterStats` (empty-state factory extracted verbatim)

`primaryStat`, `secondaryStat`, `totalATT`, `totalPercentStat`,
`totalPercentSecondaryStat`, `totalPercentATT`, `additionalPrimaryStat`,
`additionalSecondaryStat`, `damagePercent`, `bossDamagePercent`, `ied`
(**fraction 0–1**, normalized to 4 dp), `critRatePercent` (default 100 with
`critRateAssumed:true`), `critDamagePercent`, `finalDamagePercent`,
`weaponMultiplier`, `statModel` (`"normal"|"hp"|"tri-equal"`). Tri-stat classes
additionally use `tertiaryStat`, `totalPercentTertiaryStat`,
`additionalTertiaryStat`. Numbers, not strings.

Effective-stat formula (identical semantics to MapleScouter):
`primaryStat * (1 + totalPercentStat/100) + additionalPrimaryStat`, ATT =
`totalATT * (1 + totalPercentATT/100)` (no flat-ATT field — see mapping note).

`statModel` rule (from `resolveStatModel`): `"hp"` iff class primary stat is hp
(Demon Avenger), `"tri-equal"` iff Xenon, else `"normal"`.
`weaponMultiplier` comes from `CLASS_CONFIGS` (52 classes, extracted into the
userscript verbatim).

### `hexaProgress`

`{skillNodes: [6 × (number|null)], mastery: {"0".."3": level}, boost:
{"0".."3": level}, common: {"0".."3": level}}`. Node order matches
MapleScouter's per-class hexa tables (verified via shared Korean skill names in
both bundles):

| tracker | scouter |
|---|---|
| `skillNodes[i]` | `hexa.skillCore{i+1}` |
| `mastery[String(i)]` | `hexa.masteryCore{i+1}` |
| `boost[String(i)]` | `hexa.reinCore{i+1}` |
| `common["0"]` (Sol Janus) | `huntSkill.solJanus` |
| `common["1".."3"]` (Sol Hekate, class common VI, unreleased) | `hexa.generalCore2..4` |

## Field mapping (sync contract)

| tracker (`characterStats` unless noted) | scouter (`userStat.stat` unless noted) | note |
|---|---|---|
| `selectedClass` (EN) | `myClass` (KO) | explicit 52-entry table; scouter `레테` (Lethe) has no tracker class → not importable |
| `characterLevel` | `level` | string↔number |
| `primaryStat` / `totalPercentStat` / `additionalPrimaryStat` | `mainStatBase` / `mainStatPer` / `mainStatAbs` | 1:1 |
| `secondaryStat` / `totalPercentSecondaryStat` / `additionalSecondaryStat` | `subStatBase` / `subStatPer` / `subStatAbs` | 1:1 |
| `tertiaryStat` / `totalPercentTertiaryStat` / `additionalTertiaryStat` | `ssubStatBase` / `ssubStatPer` / `ssubStatAbs` | tri-stat classes |
| `totalATT` / `totalPercentATT` | `atkBase` / `atkPercent` (+ `atkAbs`) | tracker has no flat-ATT field; importing folds `atkAbs/(1+atkPercent/100)` into `totalATT` so effective ATT is preserved; exporting sets `atkAbs="0"` |
| `damagePercent` / `bossDamagePercent` | `dmg` / `bossDmg` | 1:1 |
| `ied` (0–1) | `ignoreDef` (0–100) | ×100 / ÷100, clamp |
| `critRatePercent` (+`critRateAssumed`) | `critical` | import sets `critRateAssumed:false` when `critical>0`; export keeps the scouter value when the tracker's rate is *assumed* (its placeholder-100 state) |
| `critDamagePercent` | `criticalDmg` | 1:1 |
| `arcanePower` / `sacredPower` | `arcaneForce` / `authenticForce` | number\|null ↔ string |
| `abnormalStatusDamage` | `statusAdditionalDmg` | 1:1 |
| `buffDuration` | `buffDuration` | 1:1 |
| `ignoreElementalResistance` | `ignoreElementalResist` | 1:1 |
| `summonDuration` | `summonPersistTime` | 1:1 |
| settings-store `serverType` | `special.isReboot` | one-way tracker→scouter (`heroic`→true, `interactive`→false); the sync never writes the tracker's settings store |
| `hexaProgress` (+`hexaAssumptionMode:"explicit"`) | `hexa.*` + `huntSkill.solJanus` | table above; a `null` tracker skill node (the tracker only models 2 origin skills; indices 2–5 are always null) keeps the scouter's own `skillCore3+` value instead of zeroing it; a class change without a hexa payload clears the tracker's old-class `hexaProgress` (mirroring the tracker's own class-change flow) |
| `weaponMultiplier`, `statModel` | — | recomputed from embedded `CLASS_CONFIGS` on import; left untouched when the scouter class has no tracker equivalent |
| `finalDamagePercent`, `gear`, `characterName`, `wildcardSpares`, `ozRingState` | `doping`, `linkSkill`, `special`, `seedRing`, `entireStat`, `power`, remaining `stat` fields | **never overwritten** — each side keeps its own; exports merge on top of the last-mirrored other-side state (or the verbatim default template) |

Region flags: exported presets set `isGMS:true` (this tracker is GMS-only);
the scouter input page re-syncs the flags from its own `region` store on mount.

Level: a tracker export falls back to the base preset's `level` when the
tracker's `characterLevel` is unset, and the tracker-side save flow requires a
set level — the scouter UI treats `level:"0"` presets as unloadable (its Load
button is `disabled` for them).

## Sync mechanics (userscript)

Pending payloads in GM storage carry **raw source snapshots**, not converted
data; conversion runs at *apply* time against the target site's live state, so
unmapped fields always merge onto fresh data rather than a stale mirror. The
apply flow re-reads the pending after the confirm dialog and compares
`createdAt` before consuming it (guards against another tab applying it first
or a newer payload superseding a parked dialog). Cancelling a confirm marks the
payload `dismissedAt` — it stops auto-prompting and stays available behind the
panel's Apply/Discard buttons. Live-apply via `GM_addValueChangeListener` only
prompts in visible tabs. All localStorage writers distinguish a missing
envelope (recreated) from a *corrupt* one (abort with a toast, never
overwritten).
