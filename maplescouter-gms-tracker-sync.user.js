// ==UserScript==
// @name         MapleScouter ⇄ GMS Upgrade Tracker Sync
// @namespace    https://github.com/tomerh2001/maplescouter-gms-tracker-sync
// @version      1.1.0
// @description  Sync character inputs between maplescouter.com/en/input and gms-upgrade-tracker.vercel.app using Tampermonkey storage as a cross-site bridge.
// @author       tomerh2001
// @homepageURL  https://github.com/tomerh2001/maplescouter-gms-tracker-sync
// @downloadURL  https://raw.githubusercontent.com/tomerh2001/maplescouter-gms-tracker-sync/main/maplescouter-gms-tracker-sync.user.js
// @updateURL    https://raw.githubusercontent.com/tomerh2001/maplescouter-gms-tracker-sync/main/maplescouter-gms-tracker-sync.user.js
// @match        https://maplescouter.com/*
// @match        https://gms-upgrade-tracker.vercel.app/*
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @run-at       document-idle
// @noframes
// ==/UserScript==

/*
 * Both sites keep all input state in Zustand `persist` localStorage stores and
 * rehydrate them on page load; both sites' own import flows are "write
 * localStorage, then location.reload()". This script does the same, using
 * Tampermonkey's script-scoped GM storage (shared across both @match origins)
 * as the bridge:
 *
 *   - Each site mirrors its relevant state into GM storage on load/focus.
 *   - "Save" buttons queue a raw snapshot of the current site's state for the
 *     other site.
 *   - The other site converts and applies the snapshot against its own live
 *     state at apply time — on its next load, or instantly via
 *     GM_addValueChangeListener if a visible tab is already open — after a
 *     confirm, then reloads.
 *
 * Storage contracts are documented in docs/REVERSE_ENGINEERING.md.
 */

(() => {
  'use strict';

  // ---------------------------------------------------------------- constants

  const SITE =
    location.hostname === 'maplescouter.com' ? 'scouter' :
    location.hostname === 'gms-upgrade-tracker.vercel.app' ? 'tracker' : null;
  if (!SITE) return;

  const GM_KEYS = {
    scouterMirror: 'mirror:scouter',
    trackerMirror: 'mirror:tracker',
    pendingToScouter: 'pending:toScouter',
    pendingToTracker: 'pending:toTracker',
  };
  const PENDING_KEY = SITE === 'scouter' ? GM_KEYS.pendingToScouter : GM_KEYS.pendingToTracker;

  const LS = {
    scouterCharacter: 'character-store',
    scouterPreset: 'preset',
    trackerGear: 'maplestory-gear-storage',
    trackerSettings: 'maplestory-settings-storage',
  };

  // Tracker class name -> MapleScouter internal (Korean) class name.
  // Tracker names from its CLASS_CONFIGS; Korean keys are what MapleScouter
  // stores in userStat.stat.myClass in every region.
  const CLASS_EN_TO_KO = {
    'Hero': '히어로', 'Paladin': '팔라딘', 'Dark Knight': '다크나이트',
    'Dawn Warrior': '소울마스터', 'Mihile': '미하일', 'Aran': '아란',
    'Kaiser': '카이저', 'Adele': '아델', 'Zero': '제로', 'Hayato': '하야토',
    'Ren': '렌', 'Bowmaster': '보우마스터', 'Marksman': '신궁',
    'Pathfinder': '패스파인더', 'Wind Archer': '윈드브레이커',
    'Wild Hunter': '와일드헌터', 'Mercedes': '메르세데스', 'Kain': '카인',
    'Night Lord': '나이트로드', 'Shadower': '섀도어', 'Dual Blade': '듀얼블레이드',
    'Night Walker': '나이트워커', 'Phantom': '팬텀', 'Cadena': '카데나',
    'Hoyoung': '호영', 'Khali': '칼리', 'Buccaneer': '바이퍼',
    'Cannoneer': '캐논슈터', 'Shade': '은월', 'Thunder Breaker': '스트라이커',
    'Ark': '아크', 'Blaster': '블래스터', 'Corsair': '캡틴', 'Mechanic': '메카닉',
    'Angelic Buster': '엔젤릭버스터', 'Fire/Poison': '아크메이지(불,독)',
    'Ice/Lightning': '아크메이지(썬,콜)', 'Bishop': '비숍', 'Luminous': '루미너스',
    'Evan': '에반', 'Battle Mage': '배틀메이지', 'Blaze Wizard': '플레임위자드',
    'Kinesis': '키네시스', 'Illium': '일리움', 'Lara': '라라', 'Kanna': '칸나',
    'Lynn': '린', 'Mo Xuan': '묵현', 'Sia': '시아', 'Demon Slayer': '데몬슬레이어',
    'Demon Avenger': '데몬어벤져', 'Xenon': '제논',
  };
  const CLASS_KO_TO_EN = Object.fromEntries(
    Object.entries(CLASS_EN_TO_KO).map(([en, ko]) => [ko, en]));

  // Tracker CLASS_CONFIGS (weaponMultiplier + which classes are hp/tri-stat),
  // extracted verbatim so imports can recompute weaponMultiplier/statModel the
  // same way the tracker's own setSelectedClass does.
  const TRACKER_CLASS_CONFIGS = {
    'Hero': { wm: 1.2 }, 'Paladin': { wm: 1.2 }, 'Dark Knight': { wm: 1.49 },
    'Dawn Warrior': { wm: 1.2 }, 'Mihile': { wm: 1.2 }, 'Aran': { wm: 1.49 },
    'Kaiser': { wm: 1.34 }, 'Adele': { wm: 1.3 }, 'Zero': { wm: 1.2 },
    'Hayato': { wm: 1.25 }, 'Ren': { wm: 1.3 }, 'Bowmaster': { wm: 1.3 },
    'Marksman': { wm: 1.35 }, 'Pathfinder': { wm: 1.3 },
    'Wind Archer': { wm: 1.3 }, 'Wild Hunter': { wm: 1.35 },
    'Mercedes': { wm: 1.3 }, 'Kain': { wm: 1.3 }, 'Night Lord': { wm: 1.75 },
    'Shadower': { wm: 1.3, tertiary: true }, 'Dual Blade': { wm: 1.3, tertiary: true },
    'Night Walker': { wm: 1.75 }, 'Phantom': { wm: 1.3 },
    'Cadena': { wm: 1.3, tertiary: true }, 'Hoyoung': { wm: 1.3 },
    'Khali': { wm: 1.3 }, 'Buccaneer': { wm: 1.7 }, 'Cannoneer': { wm: 1.5 },
    'Shade': { wm: 1.7 }, 'Thunder Breaker': { wm: 1.7 }, 'Ark': { wm: 1.7 },
    'Blaster': { wm: 1.7 }, 'Corsair': { wm: 1.5 }, 'Mechanic': { wm: 1.5 },
    'Angelic Buster': { wm: 1.7 }, 'Fire/Poison': { wm: 1.2 },
    'Ice/Lightning': { wm: 1.2 }, 'Bishop': { wm: 1.2 }, 'Luminous': { wm: 1.2 },
    'Evan': { wm: 1.2 }, 'Battle Mage': { wm: 1.2 }, 'Blaze Wizard': { wm: 1.2 },
    'Kinesis': { wm: 1.2 }, 'Illium': { wm: 1.2 }, 'Lara': { wm: 1.2 },
    'Kanna': { wm: 1.35 }, 'Lynn': { wm: 1.2 }, 'Mo Xuan': { wm: 1.3 },
    'Sia': { wm: 1.2 }, 'Demon Slayer': { wm: 1.2 },
    'Demon Avenger': { wm: 1.3, hp: true }, 'Xenon': { wm: 1.3, triEqual: true, tertiary: true },
  };

  // MapleScouter default userStat template, extracted verbatim from the input
  // page bundle. Used as the base when the user has never opened /input (so we
  // have no mirrored userStat to merge onto).
  const SCOUTER_DEFAULT_USERSTAT = {
    doping: {
      bigHero: true, greatIgnoreGuard: false, dragonsMeal: false, extreme: true,
      fish: true, guildBlessing: true, jangBi: false, legendHero: false,
      legendHp: false, rebootAtkPotion: false, shiningRed: true,
      shiningBlue: false, statPotion: true, stat: '30', superPower: true,
      unionsPower: true, urus: true, heroesHawl: true, noblessBoss: true,
      noblessDmg: true, noblessCriDmg: true, noblessIgnore: false,
      nobless: ['15', '15', '15', '0'], sayram: true, collector: true,
      buff275: false, additional1: true, additional2: false, championAll: '0',
      championAtk: '0', championBoss: '0', championIgnore: '0',
      championCriDmg: '0', authenticDmg: false, moonshine: false, cake: false,
      apple: false, tengu: false, candy: false, house: false, wedding: false,
      specialWedding: false, whiteBear: false, ultraVip: false, superVip: false,
      truffle: false, medal: false, hyperRainbow: false, rainbow: false,
      thanks: false, genePass: false,
    },
    linkSkill: {
      ark: '2', illium: '2', kadena: '2', kain: '2', magician: '6', thief: '6',
      angel: '2', hoyoung: '0', mukhyun: '0', mihile: '0', kaiser: '0',
      hayato: '0', kanna: '0',
    },
    special: {
      isReboot: false, combat: true, epiSoul: '0', mugongSoul: '0',
      genesis: false, oneHandSword: false, useRuinForceShild: false,
      useContinuousRingAsMainRing: false, restraintRing: '0', weaponRing: '0',
      ringOfSum: '0', riskTaker: '0', statThird: '0', statFourth: '0',
      continuosRing: '0', challenge: false, is30min: false,
      destiny2ndSkill: false, famPassiveUp: false,
    },
    stat: {
      myClass: '메르세데스', level: '0', mainStatBase: '0', mainStatPer: '0',
      mainStatAbs: '0', subStatBase: '0', subStatPer: '0', subStatAbs: '0',
      ssubStatBase: '0', ssubStatPer: '0', ssubStatAbs: '0', arcaneForce: '0',
      authenticForce: '0', classForce: '0', atkBase: '0', atkAbs: '0',
      dmg: '0', bossDmg: '0', normalDmg: '123', ignoreDef: '0',
      buffDuration: '0', critical: '0', criticalDmg: '0', weaponAtk: '0',
      atkPercent: '0', coolTimeReducePercent: '0', coolTimeReduce: '0',
      wildhunterUnion: '0', resetCoolDown: '0', statusAdditionalDmg: '0',
      passiveSkillLevelUp: false, increaseTarget: false, summonPersistTime: '0',
      artifact_increaseTarget: true, artifact_finalAttack: '0',
      subStat_hyper: '', subStat_ability: '', subStat_union: '',
      subStat_doping: '', subStat_afterDoping: '', ssubStat_hyper: '',
      ssubStat_ability: '', ssubStat_union: '', ssubStat_doping: '',
      ssubStat_afterDoping: '', ignoreElementalResist: '0',
      maple_combatPower: '', tms_fd: '0',
    },
    hexa: {
      skillCore1: '0', skillCore2: '0', skillCore3: '0', skillCore4: '0',
      skillCore5: '0', skillCore6: '0', masteryCore1: '0', masteryCore2: '0',
      masteryCore3: '0', masteryCore4: '0', reinCore1: '0', reinCore2: '0',
      reinCore3: '0', reinCore4: '0', generalCore2: '0', generalCore3: '0',
      generalCore4: '0', hexaStat: 0,
    },
    seedRing: {
      restraintRing: { level: '0', efficiency: 0 },
      weaponRing: { level: '0', efficiency: 0 },
      ringOfSum: { level: '0', efficiency: 0 },
      riskTakerRing: { level: '0', efficiency: 0 },
      criDamageRing: { level: '0', efficiency: 0 },
      levelRing: { level: '0', efficiency: 0 },
      continuosRing: { level: '0', efficiency: 0 },
      ultiRing: { level: '0', efficiency: 0 },
      durabilityRing: { level: '0', efficiency: 0 },
    },
    entireStat: { str: '0', dex: '0', int: '0', luk: '0' },
    isGMS: false, isTMS: false, isJMS: false, isMSEA: false,
    power: {
      mainStatBase: 0, mainStatPer: 0, mainStatAbs: 0, subStatBase: 0,
      subStatPer: 0, subStatAbs: 0, ssubStatBase: 0, ssubStatPer: 0,
      ssubStatAbs: 0, atk: 0, atkPer: 0, bossDmg: 0, criDmg: 0,
    },
    huntSkill: { solJanus: '30', erdaShower: '25' },
  };

  // Tracker empty characterStats (mirrors the tracker's own factory).
  const TRACKER_EMPTY_STATS = {
    primaryStat: 0, secondaryStat: 0, totalATT: 0, totalPercentStat: 0,
    totalPercentSecondaryStat: 0, totalPercentATT: 0, additionalPrimaryStat: 0,
    additionalSecondaryStat: 0, damagePercent: 0, bossDamagePercent: 0, ied: 0,
    critRatePercent: 100, critRateAssumed: true, critDamagePercent: 0,
    finalDamagePercent: 0, weaponMultiplier: 1.3, statModel: 'normal',
  };

  // ---------------------------------------------------------------- utilities

  const clone = (o) => JSON.parse(JSON.stringify(o));

  const num = (v) => {
    if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
    if (typeof v !== 'string') return 0;
    const n = parseFloat(v.replace(/[,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const str = (v) => String(Number.isFinite(v) ? v : 0);
  const round = (v, dp = 0) => {
    const f = 10 ** dp;
    return Math.round(v * f) / f;
  };

  // Reads a JSON localStorage value. Distinguishes "absent" (env:null) from
  // "present but unparseable" (corrupt:true) so writers never destroy a
  // corrupt-but-recoverable blob.
  const lsGetEnv = (key) => {
    const raw = localStorage.getItem(key);
    if (raw == null) return { env: null };
    try {
      return { env: JSON.parse(raw) };
    } catch {
      return { env: null, corrupt: true };
    }
  };
  const lsGetJson = (key) => lsGetEnv(key).env;

  const timeAgo = (ts) => {
    if (!ts) return 'never';
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  };

  // --------------------------------------------------- site state read/write

  function readScouterUserStat() {
    const env = lsGetJson(LS.scouterCharacter);
    return env?.state?.searchResult?.userStat ?? null;
  }

  function writeScouterUserStat(userStat) {
    const { env: existing, corrupt } = lsGetEnv(LS.scouterCharacter);
    if (corrupt) return false;
    let env = existing;
    if (!env || typeof env !== 'object') env = { state: {}, version: 0 };
    if (!env.state || typeof env.state !== 'object') env.state = {};
    const prev = env.state.searchResult;
    env.state.searchResult =
      prev && typeof prev === 'object' ? { ...prev, userStat } : { userStat };
    localStorage.setItem(LS.scouterCharacter, JSON.stringify(env));
    return true;
  }

  function readScouterPresets() {
    const env = lsGetJson(LS.scouterPreset);
    const slots = env?.state?.preset;
    return slots && typeof slots === 'object' ? slots : null;
  }

  function writeScouterPresetSlot(slot, entry) {
    const { env: existing, corrupt } = lsGetEnv(LS.scouterPreset);
    if (corrupt) return false;
    let env = existing;
    if (!env?.state?.preset || typeof env.state.preset !== 'object') {
      // Never-initialized store: recreate the site's default 3 slots so the
      // page's preset UI keeps its expected shape after rehydration.
      env = {
        state: {
          preset: {
            1: { data: clone(SCOUTER_DEFAULT_USERSTAT), label: '' },
            2: { data: clone(SCOUTER_DEFAULT_USERSTAT), label: '' },
            3: { data: clone(SCOUTER_DEFAULT_USERSTAT), label: '' },
          },
        },
        version: 0,
      };
    }
    env.state.preset[String(slot)] = entry;
    localStorage.setItem(LS.scouterPreset, JSON.stringify(env));
    return true;
  }

  function readTrackerState() {
    const env = lsGetJson(LS.trackerGear);
    return env?.state && typeof env.state === 'object' ? env.state : null;
  }

  function readTrackerServerType() {
    const env = lsGetJson(LS.trackerSettings);
    const st = env?.state?.settings?.serverType;
    return st === 'heroic' || st === 'interactive' ? st : null;
  }

  // The subset of tracker state the sync needs (mirrors + pending payloads).
  function readTrackerSnapshot() {
    const state = readTrackerState();
    if (!state) return null;
    return {
      characterStats: state.characterStats ?? null,
      selectedClass: state.selectedClass ?? null,
      characterName: state.characterName ?? '',
      characterLevel: state.characterLevel ?? null,
      arcanePower: state.arcanePower ?? null,
      sacredPower: state.sacredPower ?? null,
      hexaProgress: state.hexaProgress ?? null,
      serverType: readTrackerServerType(),
    };
  }

  function writeTrackerPatch(patch) {
    const { env: existing, corrupt } = lsGetEnv(LS.trackerGear);
    if (corrupt) return false;
    let env = existing;
    if (!env || typeof env !== 'object' || !env.state) {
      env = { state: {}, version: 3 };
    }
    env.state = { ...env.state, ...patch };
    localStorage.setItem(LS.trackerGear, JSON.stringify(env));
    return true;
  }

  // ---------------------------------------------------------------- converters

  const HEXA_EMPTY = () => ({
    skillNodes: [null, null, null, null, null, null],
    mastery: {}, boost: {}, common: {},
  });

  const clampLevel = (n, max) => Math.max(0, Math.min(max, Math.round(n)));

  // The tracker keys hexaProgress.mastery/boost/common by per-class node id
  // ("shade_mastery_0", "dark_knight_common_1", ...); only skillNodes is a
  // plain index array. The id prefix is the class name slugified like this
  // (verified against all 52 ids in the live bundle: fire_poison, mo_xuan...).
  const trackerClassSlug = (en) =>
    typeof en === 'string' ? en.toLowerCase().replace(/[^a-z0-9]+/g, '_') : null;

  // tracker hexaProgress -> scouter {hexa, solJanus}; classEn is the tracker's
  // selectedClass, needed to reconstruct the node-id keys.
  function hexaTrackerToScouter(hp, baseHexa, baseSolJanus, classEn) {
    const hexa = { ...baseHexa };
    let solJanus = baseSolJanus;
    if (!hp || typeof hp !== 'object') return { hexa, solJanus };
    const slug = trackerClassSlug(classEn);
    // Legacy numeric keys are accepted as a fallback for old mirrored data.
    const nodeLevel = (tier, i) =>
      (slug ? hp[tier]?.[`${slug}_${tier}_${i}`] : undefined) ?? hp[tier]?.[String(i)] ?? 0;
    const nodes = Array.isArray(hp.skillNodes) ? hp.skillNodes : [];
    for (let i = 0; i < 6; i++) {
      // The tracker only models 2 origin-type skill nodes per class; a null
      // node is "not representable there", so keep the scouter's own value.
      if (nodes[i] != null) {
        hexa[`skillCore${i + 1}`] = str(clampLevel(num(nodes[i]), 30));
      }
    }
    for (let i = 0; i < 4; i++) {
      hexa[`masteryCore${i + 1}`] = str(clampLevel(num(nodeLevel('mastery', i)), 30));
      hexa[`reinCore${i + 1}`] = str(clampLevel(num(nodeLevel('boost', i)), 30));
    }
    for (let i = 1; i < 4; i++) {
      hexa[`generalCore${i + 1}`] = str(clampLevel(num(nodeLevel('common', i)), 30));
    }
    const sj = clampLevel(num(nodeLevel('common', 0)), 30);
    if (sj > 0) solJanus = str(sj);
    return { hexa, solJanus };
  }

  // scouter {hexa, huntSkill} -> tracker hexaProgress (or null if all empty /
  // no class to key the node ids on).
  function hexaScouterToTracker(hexa, huntSkill, classEn) {
    if (!hexa || typeof hexa !== 'object') return null;
    const slug = trackerClassSlug(classEn);
    if (!slug) return null;
    const hp = HEXA_EMPTY();
    let any = false;
    for (let i = 0; i < 6; i++) {
      const lv = clampLevel(num(hexa[`skillCore${i + 1}`]), 30);
      if (lv > 0) { hp.skillNodes[i] = lv; any = true; }
    }
    for (let i = 0; i < 4; i++) {
      const m = clampLevel(num(hexa[`masteryCore${i + 1}`]), 30);
      if (m > 0) { hp.mastery[`${slug}_mastery_${i}`] = m; any = true; }
      const b = clampLevel(num(hexa[`reinCore${i + 1}`]), 30);
      if (b > 0) { hp.boost[`${slug}_boost_${i}`] = b; any = true; }
    }
    for (let i = 1; i < 4; i++) {
      const g = clampLevel(num(hexa[`generalCore${i + 1}`]), 30);
      if (g > 0) { hp.common[`${slug}_common_${i}`] = g; any = true; }
    }
    // solJanus is "30" in scouter's *default* template, so it only counts as
    // real progress when some actual hexa core is set.
    if (any) {
      const sj = clampLevel(num(huntSkill?.solJanus), 30);
      if (sj > 0) hp.common[`${slug}_common_0`] = sj;
    }
    return any ? hp : null;
  }

  // Tracker snapshot -> scouter userStat (merged over base userStat).
  function trackerToScouter(trackerState, baseUserStat) {
    const cs = trackerState.characterStats ?? {};
    const base = clone(baseUserStat ?? SCOUTER_DEFAULT_USERSTAT);
    const ko = CLASS_EN_TO_KO[trackerState.selectedClass];
    const { hexa, solJanus } = hexaTrackerToScouter(
      trackerState.hexaProgress, base.hexa, base.huntSkill?.solJanus ?? '0',
      trackerState.selectedClass);

    const level = num(trackerState.characterLevel);
    const stat = {
      ...base.stat,
      ...(ko ? { myClass: ko } : {}),
      // A "0" level makes the scouter preset unloadable (its Load button is
      // disabled for level==="0"), so fall back to the base value.
      level: level > 0 ? str(level) : base.stat.level,
      mainStatBase: str(num(cs.primaryStat)),
      mainStatPer: str(num(cs.totalPercentStat)),
      mainStatAbs: str(num(cs.additionalPrimaryStat)),
      subStatBase: str(num(cs.secondaryStat)),
      subStatPer: str(num(cs.totalPercentSecondaryStat)),
      subStatAbs: str(num(cs.additionalSecondaryStat)),
      ssubStatBase: str(num(cs.tertiaryStat)),
      ssubStatPer: str(num(cs.totalPercentTertiaryStat)),
      ssubStatAbs: str(num(cs.additionalTertiaryStat)),
      atkBase: str(num(cs.totalATT)),
      atkPercent: str(num(cs.totalPercentATT)),
      atkAbs: '0',
      dmg: str(num(cs.damagePercent)),
      bossDmg: str(num(cs.bossDamagePercent)),
      ignoreDef: str(round(num(cs.ied) * 100, 2)),
      // The tracker's crit rate defaults to an *assumed* 100%; only a real,
      // user-entered value is exported.
      critical: cs.critRateAssumed === true
        ? base.stat.critical
        : str(num(cs.critRatePercent)),
      criticalDmg: str(num(cs.critDamagePercent)),
      arcaneForce: str(num(trackerState.arcanePower)),
      authenticForce: str(num(trackerState.sacredPower)),
      statusAdditionalDmg: str(num(cs.abnormalStatusDamage)),
      buffDuration: str(num(cs.buffDuration)),
      ignoreElementalResist: str(num(cs.ignoreElementalResistance)),
      summonPersistTime: str(num(cs.summonDuration)),
    };

    const special = { ...base.special };
    if (trackerState.serverType === 'heroic') special.isReboot = true;
    else if (trackerState.serverType === 'interactive') special.isReboot = false;

    return {
      ...base,
      stat,
      special,
      hexa,
      huntSkill: { ...base.huntSkill, solJanus },
      isGMS: true, isTMS: false, isJMS: false, isMSEA: false,
    };
  }

  // Scouter userStat -> tracker gear-store patch (merged over current state).
  function scouterToTracker(userStat, currentTrackerState) {
    const s = userStat.stat ?? {};
    const cur = currentTrackerState ?? {};
    const en = CLASS_KO_TO_EN[s.myClass];
    const cfg = en ? TRACKER_CLASS_CONFIGS[en] : null;
    // When the scouter class has no tracker equivalent, the tracker keeps its
    // current class — so tertiary handling must follow the *current* class.
    const effCfg = cfg ?? (cur.selectedClass ? TRACKER_CLASS_CONFIGS[cur.selectedClass] : null);

    const stats = {
      ...TRACKER_EMPTY_STATS,
      ...(cur.characterStats ?? {}),
      primaryStat: num(s.mainStatBase),
      totalPercentStat: num(s.mainStatPer),
      additionalPrimaryStat: num(s.mainStatAbs),
      secondaryStat: num(s.subStatBase),
      totalPercentSecondaryStat: num(s.subStatPer),
      additionalSecondaryStat: num(s.subStatAbs),
      // Tracker has no flat-ATT field; fold atkAbs into totalATT so the
      // effective total (totalATT * (1 + %ATT/100)) matches scouter's
      // atkBase * (1 + atkPercent/100) + atkAbs.
      totalATT: round(num(s.atkBase) + num(s.atkAbs) / (1 + num(s.atkPercent) / 100)),
      totalPercentATT: num(s.atkPercent),
      damagePercent: num(s.dmg),
      bossDamagePercent: num(s.bossDmg),
      ied: round(Math.max(0, Math.min(100, num(s.ignoreDef))) / 100, 4),
      critDamagePercent: round(num(s.criticalDmg), 2),
      abnormalStatusDamage: num(s.statusAdditionalDmg),
      buffDuration: num(s.buffDuration),
      ignoreElementalResistance: num(s.ignoreElementalResist),
      summonDuration: num(s.summonPersistTime),
    };
    if (num(s.critical) > 0) {
      stats.critRatePercent = round(Math.min(100, num(s.critical)), 1);
      stats.critRateAssumed = false;
    }
    if (cfg) {
      stats.weaponMultiplier = cfg.wm;
      stats.statModel = cfg.hp ? 'hp' : cfg.triEqual ? 'tri-equal' : 'normal';
    }
    if (effCfg && !effCfg.tertiary) {
      stats.tertiaryStat = 0;
      stats.totalPercentTertiaryStat = 0;
      stats.additionalTertiaryStat = 0;
    } else {
      // Tertiary-capable (or unknown) class: scouter's values are
      // authoritative — "0" means 0, not "keep whatever was there".
      stats.tertiaryStat = num(s.ssubStatBase);
      stats.totalPercentTertiaryStat = num(s.ssubStatPer);
      stats.additionalTertiaryStat = num(s.ssubStatAbs);
    }

    const level = Math.round(num(s.level));
    const arcane = Math.round(num(s.arcaneForce));
    const sacred = Math.round(num(s.authenticForce));
    const hexaProgress = hexaScouterToTracker(userStat.hexa, userStat.huntSkill, en);

    const patch = {
      characterStats: stats,
      ...(en ? { selectedClass: en } : {}),
      characterLevel: level > 0 ? level : null,
      arcanePower: arcane > 0 ? arcane : null,
      sacredPower: sacred > 0 ? sacred : null,
    };
    if (hexaProgress) {
      patch.hexaProgress = hexaProgress;
      patch.hexaAssumptionMode = 'explicit';
    } else if (en && cur.selectedClass && en !== cur.selectedClass) {
      // Class changed with no hexa payload: the old class's hexa progress must
      // not survive attributed to the new class (the tracker's own class-change
      // flow clears it the same way).
      patch.hexaProgress = null;
      patch.hexaAssumptionMode = 'estimated';
    }
    return { patch, mappedClass: en ?? null };
  }

  // ------------------------------------------------------------------ mirrors

  let lastMirrorJson = null;

  function updateMirror() {
    try {
      if (SITE === 'scouter') {
        const userStat = readScouterUserStat();
        const presets = readScouterPresets();
        if (!userStat && !presets) return;
        const payload = { userStat, presets };
        const json = JSON.stringify(payload);
        if (json === lastMirrorJson) return;
        lastMirrorJson = json;
        GM_setValue(GM_KEYS.scouterMirror, { updatedAt: Date.now(), ...payload });
      } else {
        const snapshot = readTrackerSnapshot();
        if (!snapshot) return;
        const json = JSON.stringify(snapshot);
        if (json === lastMirrorJson) return;
        lastMirrorJson = json;
        GM_setValue(GM_KEYS.trackerMirror, { updatedAt: Date.now(), ...snapshot });
      }
    } catch (e) {
      console.error('[ms-sync] mirror update failed', e);
    }
  }

  // ---------------------------------------------------------------- pendings

  // Post-confirm: re-read the pending and take it only if it is still the same
  // payload (not applied by another tab, not superseded while the confirm sat
  // open). Returns false when the payload is gone/stale.
  function takePending(key, expected) {
    const cur = GM_getValue(key, null);
    if (!cur || cur.createdAt !== expected.createdAt) {
      toast('This sync was already applied elsewhere or superseded — ignoring.');
      return false;
    }
    GM_deleteValue(key);
    return true;
  }

  function dismissPending(key, pending) {
    GM_setValue(key, { ...pending, dismissedAt: Date.now() });
  }

  // Applies a queued tracker snapshot into a scouter preset slot. Conversion
  // happens here, at apply time, against the *live* scouter state.
  function applyPendingToScouter(pending, { interactive }) {
    if (!pending?.tracker) return false;
    const slot = String(pending.slot ?? '1');
    const presets = readScouterPresets();
    const current = presets?.[slot];
    const occupied = num(current?.data?.stat?.mainStatBase) > 0;
    const occupant = occupied ? ` — currently "${current.label || 'occupied'}", it will be overwritten` : '';
    if (interactive &&
        !window.confirm(`[Tracker ⇄ Scouter Sync]\nSave GMS Upgrade Tracker data (Lv ${num(pending.tracker.characterLevel)} ${pending.tracker.selectedClass}) to MapleScouter preset slot ${slot}${occupant}, then reload?`)) {
      dismissPending(GM_KEYS.pendingToScouter, pending);
      return false;
    }
    if (!takePending(GM_KEYS.pendingToScouter, pending)) return false;
    const base = (occupied ? current.data : null) ?? readScouterUserStat() ?? null;
    const data = trackerToScouter(pending.tracker, base);
    const label = `Lv ${data.stat.level} ${pending.tracker.selectedClass}`;
    if (!writeScouterPresetSlot(slot, { data, label })) {
      toast('MapleScouter preset storage is unparseable — aborted without touching it.');
      return false;
    }
    location.reload();
    return true;
  }

  // Applies a queued scouter userStat into the tracker's character stats.
  // Conversion happens here, at apply time, against the *live* tracker state.
  function applyPendingToTracker(pending, { interactive }) {
    if (!pending?.userStat) return false;
    const meta = pending.sourceMeta
      ? ` (Lv ${pending.sourceMeta.level} ${pending.sourceMeta.className})`
      : '';
    if (interactive &&
        !window.confirm(`[Tracker ⇄ Scouter Sync]\nApply MapleScouter data${meta} to the tracker's character stats and reload?\nGear/equipment inputs are not touched.`)) {
      dismissPending(GM_KEYS.pendingToTracker, pending);
      return false;
    }
    if (!takePending(GM_KEYS.pendingToTracker, pending)) return false;
    const { patch } = scouterToTracker(pending.userStat, readTrackerState());
    if (!writeTrackerPatch(patch)) {
      toast('The tracker\'s storage is unparseable — aborted without touching it.');
      return false;
    }
    location.reload();
    return true;
  }

  function applyPendingHere(pending, opts) {
    return SITE === 'scouter'
      ? applyPendingToScouter(pending, opts)
      : applyPendingToTracker(pending, opts);
  }

  // ------------------------------------------------------------------- UI

  let toastBox = null;

  function toast(msg, ms = 4000) {
    if (!toastBox || !toastBox.isConnected) {
      toastBox = document.createElement('div');
      Object.assign(toastBox.style, {
        position: 'fixed', bottom: '86px', right: '16px', zIndex: 100001,
        display: 'flex', flexDirection: 'column-reverse', gap: '8px',
        pointerEvents: 'none', maxWidth: '320px',
      });
      document.body.appendChild(toastBox);
    }
    const el = document.createElement('div');
    el.textContent = msg;
    Object.assign(el.style, {
      background: '#1f2937', color: '#f9fafb', padding: '10px 14px',
      borderRadius: '8px', font: '13px/1.4 system-ui, sans-serif',
      boxShadow: '0 4px 12px rgba(0,0,0,.4)', whiteSpace: 'pre-line',
    });
    toastBox.appendChild(el);
    setTimeout(() => el.remove(), ms);
  }

  let panelHost = null;
  let panelRoot = null;

  function buildPanel() {
    if (panelHost?.isConnected) return panelRoot;
    const existing = document.getElementById('ms-gms-sync-host');
    if (existing) existing.remove();
    const host = document.createElement('div');
    host.id = 'ms-gms-sync-host';
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .panel {
          position: fixed; bottom: 16px; right: 16px; z-index: 100000;
          font: 12px/1.4 system-ui, sans-serif; color: #e5e7eb;
        }
        .toggle {
          background: #111827ee; border: 1px solid #374151; color: #e5e7eb;
          border-radius: 999px; padding: 8px 14px; cursor: pointer;
          font: 600 12px system-ui, sans-serif;
          box-shadow: 0 2px 10px rgba(0,0,0,.45);
        }
        .toggle:hover { border-color: #6b7280; }
        .toggle .badge { color: #fbbf24; }
        .body {
          display: none; position: absolute; bottom: 40px; right: 0;
          width: 260px; background: #111827f5; border: 1px solid #374151;
          border-radius: 10px; padding: 12px;
          box-shadow: 0 6px 18px rgba(0,0,0,.5);
        }
        .panel.open .body { display: block; }
        .title { font-weight: 700; margin-bottom: 2px; }
        .sub { color: #9ca3af; margin-bottom: 10px; }
        .queued {
          margin: 8px 0; padding: 8px; border: 1px solid #92400e;
          border-radius: 8px; background: #78350f33; color: #fcd34d;
        }
        .queued .row { display: flex; gap: 6px; margin-top: 6px; }
        .queued button {
          flex: 1; padding: 5px 8px; background: #1f2937; color: #f3f4f6;
          border: 1px solid #4b5563; border-radius: 6px; cursor: pointer;
          font: 600 11px system-ui;
        }
        button.action {
          display: block; width: 100%; margin-top: 8px; padding: 8px 10px;
          background: #1f2937; color: #f3f4f6; border: 1px solid #4b5563;
          border-radius: 8px; cursor: pointer; font: 600 12px system-ui;
          text-align: left;
        }
        button.action:hover:not(:disabled) { border-color: #9ca3af; }
        button.action:disabled { opacity: .45; cursor: not-allowed; }
        .hint { color: #9ca3af; margin-top: 8px; }
        .slots { margin-top: 8px; }
        .slots button {
          display: block; width: 100%; margin-top: 6px; padding: 6px 8px;
          background: #0f172a; color: #e2e8f0; border: 1px solid #334155;
          border-radius: 6px; cursor: pointer; font: 12px system-ui;
          text-align: left;
        }
        .slots button:hover { border-color: #94a3b8; }
      </style>
      <div class="panel">
        <button class="toggle">⇄ Sync</button>
        <div class="body">
          <div class="title">${SITE === 'scouter' ? 'MapleScouter ⇄ GMS Tracker' : 'GMS Tracker ⇄ MapleScouter'}</div>
          <div class="sub" data-role="status"></div>
          <div data-role="queued"></div>
          <div data-role="actions"></div>
          <div class="hint" data-role="hint"></div>
        </div>
      </div>`;
    document.body.appendChild(host);
    panelHost = host;
    panelRoot = root;
    const panel = root.querySelector('.panel');
    root.querySelector('.toggle').addEventListener('click', () => {
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) renderPanelBody(root);
    });
    renderToggleBadge(root);
    return root;
  }

  function renderToggleBadge(root) {
    const toggle = root.querySelector('.toggle');
    const pending = GM_getValue(PENDING_KEY, null);
    toggle.innerHTML = pending ? '⇄ Sync <span class="badge">●</span>' : '⇄ Sync';
  }

  function refreshPanel() {
    if (!panelRoot) return;
    renderToggleBadge(panelRoot);
    const panel = panelRoot.querySelector('.panel');
    if (panel.classList.contains('open')) renderPanelBody(panelRoot);
  }

  function makeButton(label, { disabled, title } = {}) {
    const b = document.createElement('button');
    b.className = 'action';
    b.textContent = label;
    if (disabled) b.disabled = true;
    if (title) b.title = title;
    return b;
  }

  function renderPanelBody(root) {
    const actions = root.querySelector('[data-role=actions]');
    const status = root.querySelector('[data-role=status]');
    const hint = root.querySelector('[data-role=hint]');
    const queued = root.querySelector('[data-role=queued]');
    actions.textContent = '';
    hint.textContent = '';
    queued.textContent = '';
    renderToggleBadge(root);

    const pending = GM_getValue(PENDING_KEY, null);
    if (pending) {
      const box = document.createElement('div');
      box.className = 'queued';
      const from = SITE === 'scouter' ? 'GMS Tracker' : 'MapleScouter';
      box.textContent = `Queued sync from ${from} (${timeAgo(pending.createdAt)})`;
      const row = document.createElement('div');
      row.className = 'row';
      const apply = document.createElement('button');
      apply.textContent = 'Apply';
      apply.addEventListener('click', () => {
        const cur = GM_getValue(PENDING_KEY, null);
        if (cur) applyPendingHere(cur, { interactive: true });
        refreshPanel();
      });
      const discard = document.createElement('button');
      discard.textContent = 'Discard';
      discard.addEventListener('click', () => {
        GM_deleteValue(PENDING_KEY);
        toast('Queued sync discarded.');
        refreshPanel();
      });
      row.append(apply, discard);
      box.appendChild(row);
      queued.appendChild(box);
    }

    if (SITE === 'tracker') renderTrackerActions(actions, status, hint);
    else renderScouterActions(actions, status, hint);
  }

  // ------------------------------------------------- pickers

  function showPicker(actions, owner, options, onPick) {
    const existing = actions.querySelector('.slots');
    if (existing) {
      const sameOwner = existing.dataset.owner === owner;
      existing.remove();
      if (sameOwner) return; // toggle-close
    }
    const wrap = document.createElement('div');
    wrap.className = 'slots';
    wrap.dataset.owner = owner;
    for (const opt of options) {
      const b = document.createElement('button');
      b.textContent = opt.label;
      b.addEventListener('click', () => { wrap.remove(); onPick(opt); });
      wrap.appendChild(b);
    }
    actions.appendChild(wrap);
  }

  // ------------------------------------------------- tracker-side actions

  function renderTrackerActions(actions, status, hint) {
    const mirror = GM_getValue(GM_KEYS.scouterMirror, null);
    status.textContent = `MapleScouter data: ${timeAgo(mirror?.updatedAt)}`;

    const save = makeButton('💾 Save → MapleScouter preset', {
      disabled: !readTrackerState()?.characterStats,
      title: 'Convert the tracker\'s character stats into a MapleScouter preset slot',
    });
    save.addEventListener('click', () => {
      const snapshot = readTrackerSnapshot();
      if (!snapshot?.characterStats) return;
      if (!(num(snapshot.characterStats.primaryStat) > 0)) {
        toast('Tracker stats look empty (main stat is 0) — enter your stats first.');
        return;
      }
      if (!CLASS_EN_TO_KO[snapshot.selectedClass]) {
        toast(`Class "${snapshot.selectedClass}" has no MapleScouter equivalent.`);
        return;
      }
      if (!(num(snapshot.characterLevel) > 0)) {
        toast('Set your character level in the tracker first — MapleScouter cannot load a level-0 preset.');
        return;
      }
      // Fresh mirror read at click time for slot labels.
      const m = GM_getValue(GM_KEYS.scouterMirror, null);
      const knownKeys = Object.keys(m?.presets ?? { 1: 0, 2: 0, 3: 0 })
        .map(Number).filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);
      const keys = knownKeys.length ? knownKeys : [1, 2, 3];
      const options = keys.map((slot) => {
        const entry = m?.presets?.[String(slot)];
        const occupied = num(entry?.data?.stat?.mainStatBase) > 0;
        return {
          slot: String(slot),
          label: `Slot ${slot}${occupied ? ` — ${entry.label || 'occupied'} (overwrite)` : ' — empty'}`,
        };
      });
      // Fresh slot: smallest positive integer not in use (the site's own "+"
      // button adds length+1, so gaps would collide with it later).
      let freshSlot = 1;
      const used = new Set(keys);
      while (used.has(freshSlot)) freshSlot++;
      options.push({ slot: String(freshSlot), label: `Slot ${freshSlot} — new` });
      showPicker(actions, 'save', options, (opt) => {
        const fresh = readTrackerSnapshot();
        if (!fresh?.characterStats) return;
        GM_setValue(GM_KEYS.pendingToScouter, {
          createdAt: Date.now(), slot: opt.slot,
          tracker: fresh,
          sourceUrl: location.origin,
        });
        toast(`Queued for MapleScouter preset slot ${opt.slot}.\nOpen/reload maplescouter.com to apply (applies instantly if a tab is open).`);
        refreshPanel();
      });
    });
    actions.appendChild(save);

    const canLoad = !!(mirror?.presets || mirror?.userStat);
    const load = makeButton('📥 Load ← MapleScouter preset', {
      disabled: !canLoad,
      title: canLoad ? 'Import a MapleScouter preset into the tracker\'s character stats'
        : 'Visit maplescouter.com/en/input once so its data can be mirrored',
    });
    load.addEventListener('click', () => {
      const m = GM_getValue(GM_KEYS.scouterMirror, null);
      if (!m) return;
      const options = [];
      if (m.userStat && num(m.userStat.stat?.mainStatBase) > 0) {
        options.push({ label: `Live inputs (Lv ${num(m.userStat.stat.level)} ${CLASS_KO_TO_EN[m.userStat.stat.myClass] ?? m.userStat.stat.myClass})`, data: m.userStat });
      }
      for (const [slot, entry] of Object.entries(m.presets ?? {})) {
        if (num(entry?.data?.stat?.mainStatBase) > 0) {
          options.push({ label: `Preset ${slot}${entry.label ? ` — ${entry.label}` : ''}`, data: entry.data });
        }
      }
      if (!options.length) {
        toast('No non-empty MapleScouter presets mirrored yet.');
        return;
      }
      showPicker(actions, 'load', options, (opt) => {
        const { patch, mappedClass } = scouterToTracker(opt.data, readTrackerState());
        if (!mappedClass) {
          toast(`Class "${opt.data.stat?.myClass}" has no tracker equivalent — importing stats only, keeping current class.`);
        }
        if (!window.confirm(`[Tracker ⇄ Scouter Sync]\nApply "${opt.label}" to the tracker's character stats and reload?\nGear/equipment inputs are not touched.`)) return;
        if (!writeTrackerPatch(patch)) {
          toast('The tracker\'s storage is unparseable — aborted without touching it.');
          return;
        }
        location.reload();
      });
    });
    actions.appendChild(load);

    if (!canLoad) hint.textContent = 'Open maplescouter.com/en/input once to mirror its presets here.';
  }

  // ------------------------------------------------- scouter-side actions

  function renderScouterActions(actions, status, hint) {
    const mirror = GM_getValue(GM_KEYS.trackerMirror, null);
    status.textContent = `GMS Tracker data: ${timeAgo(mirror?.updatedAt)}`;

    const save = makeButton('💾 Save → GMS Tracker', {
      disabled: !readScouterUserStat(),
      title: 'Send the current MapleScouter inputs to the tracker\'s character stats',
    });
    save.addEventListener('click', () => {
      const us = readScouterUserStat();
      if (!us) {
        toast('Enter your character on /input first.');
        return;
      }
      if (!(num(us.stat?.mainStatBase) > 0)) {
        toast('MapleScouter inputs look empty (main stat is 0).');
        return;
      }
      const en = CLASS_KO_TO_EN[us.stat?.myClass];
      if (!en) {
        toast(`Class "${us.stat?.myClass}" has no tracker equivalent — the tracker will keep its current class; only stats will be imported.`);
      }
      GM_setValue(GM_KEYS.pendingToTracker, {
        createdAt: Date.now(),
        userStat: clone(us),
        sourceMeta: { level: num(us.stat?.level), className: en ?? us.stat?.myClass },
        sourceUrl: location.origin,
      });
      toast('Queued for the GMS Upgrade Tracker.\nOpen/reload gms-upgrade-tracker.vercel.app to apply (applies instantly if a tab is open).');
      refreshPanel();
    });
    actions.appendChild(save);

    const load = makeButton('📥 Load ← GMS Tracker', {
      disabled: !mirror?.characterStats,
      title: mirror?.characterStats ? 'Import the tracker\'s character stats into MapleScouter\'s live inputs'
        : 'Visit gms-upgrade-tracker.vercel.app once so its data can be mirrored',
    });
    load.addEventListener('click', () => {
      const m = GM_getValue(GM_KEYS.trackerMirror, null);
      if (!m?.characterStats) return;
      if (!(num(m.characterStats.primaryStat) > 0)) {
        toast('Mirrored tracker stats look empty (main stat is 0).');
        return;
      }
      if (!CLASS_EN_TO_KO[m.selectedClass]) {
        toast(`Class "${m.selectedClass}" has no MapleScouter equivalent.`);
        return;
      }
      const data = trackerToScouter(m, readScouterUserStat());
      const label = `Lv ${data.stat.level} ${m.selectedClass}`;
      if (!window.confirm(`[Tracker ⇄ Scouter Sync]\nReplace MapleScouter's live inputs with "${label}" from the tracker and reload?\nDoping/link-skill/ring settings are kept.`)) return;
      if (!writeScouterUserStat(data)) {
        toast('MapleScouter\'s storage is unparseable — aborted without touching it.');
        return;
      }
      location.reload();
    });
    actions.appendChild(load);

    if (!mirror) hint.textContent = 'Open gms-upgrade-tracker.vercel.app once to mirror its data here.';
  }

  // ------------------------------------------------------------------- boot

  function boot() {
    updateMirror();

    // Auto-prompt for a queued payload targeted at this site — once; when the
    // user cancels it is marked dismissed and only reachable from the panel.
    const pending = GM_getValue(PENDING_KEY, null);
    if (pending && !pending.dismissedAt) applyPendingHere(pending, { interactive: true });

    // Live apply when the other site queues a payload while this tab is open
    // and visible (background tabs would otherwise all pop dialogs).
    if (typeof GM_addValueChangeListener === 'function') {
      GM_addValueChangeListener(PENDING_KEY, (_name, _old, value, remote) => {
        if (!remote) return;
        refreshPanel();
        if (!value || value.dismissedAt) return;
        if (document.visibilityState !== 'visible') return;
        applyPendingHere(value, { interactive: true });
      });
    }

    buildPanel();

    setInterval(() => {
      updateMirror();
      if (panelHost && !panelHost.isConnected) {
        // React client-render fallbacks can replace <body> children; re-attach.
        panelHost = null;
        panelRoot = null;
        buildPanel();
      } else {
        refreshPanel();
      }
    }, 4000);
    window.addEventListener('focus', () => {
      updateMirror();
      refreshPanel();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') updateMirror();
    });
  }

  // Test hook: expose pure pieces and skip browser boot (no-op under Tampermonkey).
  if (globalThis.__MS_SYNC_TEST__) {
    Object.assign(globalThis.__MS_SYNC_TEST__, {
      num, str, round, clampLevel, trackerClassSlug,
      trackerToScouter, scouterToTracker,
      hexaTrackerToScouter, hexaScouterToTracker,
      CLASS_EN_TO_KO, CLASS_KO_TO_EN, TRACKER_CLASS_CONFIGS,
      SCOUTER_DEFAULT_USERSTAT, TRACKER_EMPTY_STATS,
    });
    return;
  }

  if (document.body) boot();
  else window.addEventListener('DOMContentLoaded', boot);
})();
