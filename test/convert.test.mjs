// Converter unit tests. Run: node --test test/
// (The userscript exposes its pure pieces when __MS_SYNC_TEST__ is set.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

globalThis.location = { hostname: 'maplescouter.com' };
globalThis.__MS_SYNC_TEST__ = {};
const src = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'maplescouter-gms-tracker-sync.user.js'),
  'utf-8');
(0, eval)(src);
const S = globalThis.__MS_SYNC_TEST__;

const KO = { mercedes: '메르세데스', sia: '시아', da: '데몬어벤져', xenon: '제논' };

function sampleTrackerState() {
  return {
    selectedClass: 'Sia',
    characterName: 'Astelle',
    characterLevel: 285,
    arcanePower: 1350,
    sacredPower: 470,
    characterStats: {
      ...S.TRACKER_EMPTY_STATS,
      primaryStat: 41234, secondaryStat: 3210,
      totalATT: 4321, totalPercentStat: 412, totalPercentSecondaryStat: 78,
      totalPercentATT: 103, additionalPrimaryStat: 12000, additionalSecondaryStat: 400,
      damagePercent: 95, bossDamagePercent: 388, ied: 0.9712,
      critRatePercent: 88, critRateAssumed: false, critDamagePercent: 101.5,
      finalDamagePercent: 46.2, weaponMultiplier: 1.2, statModel: 'normal',
      abnormalStatusDamage: 12, buffDuration: 40,
      ignoreElementalResistance: 10, summonDuration: 20,
    },
    serverType: 'heroic',
    // mastery/boost/common are keyed by per-class node id (slug_tier_index),
    // matching the live tracker's storage; skillNodes is a plain array.
    hexaProgress: {
      skillNodes: [30, 30, 1, null, null, null],
      mastery: { sia_mastery_0: 30, sia_mastery_1: 10 },
      boost: { sia_boost_0: 21, sia_boost_3: 7 },
      common: { sia_common_0: 25, sia_common_1: 3 },
    },
  };
}

test('class maps are inverse and cover all tracker classes', () => {
  assert.equal(Object.keys(S.CLASS_EN_TO_KO).length, 52);
  for (const [en, ko] of Object.entries(S.CLASS_EN_TO_KO)) {
    assert.equal(S.CLASS_KO_TO_EN[ko], en);
    assert.ok(S.TRACKER_CLASS_CONFIGS[en], `class config missing for ${en}`);
  }
});

test('num handles strings, commas, garbage', () => {
  assert.equal(S.num('1,234,567'), 1234567);
  assert.equal(S.num(''), 0);
  assert.equal(S.num('abc'), 0);
  assert.equal(S.num(null), 0);
  assert.equal(S.num(12.5), 12.5);
  assert.equal(S.num(NaN), 0);
});

test('tracker -> scouter maps stats correctly', () => {
  const state = sampleTrackerState();
  const out = S.trackerToScouter(state, null);
  assert.equal(out.stat.myClass, KO.sia);
  assert.equal(out.stat.level, '285');
  assert.equal(out.stat.mainStatBase, '41234');
  assert.equal(out.stat.mainStatPer, '412');
  assert.equal(out.stat.mainStatAbs, '12000');
  assert.equal(out.stat.subStatBase, '3210');
  assert.equal(out.stat.atkBase, '4321');
  assert.equal(out.stat.atkPercent, '103');
  assert.equal(out.stat.atkAbs, '0');
  assert.equal(out.stat.dmg, '95');
  assert.equal(out.stat.bossDmg, '388');
  assert.equal(out.stat.ignoreDef, '97.12');
  assert.equal(out.stat.critical, '88');
  assert.equal(out.stat.criticalDmg, '101.5');
  assert.equal(out.stat.arcaneForce, '1350');
  assert.equal(out.stat.authenticForce, '470');
  assert.equal(out.isGMS, true);
  // hexa
  assert.equal(out.hexa.skillCore1, '30');
  assert.equal(out.hexa.skillCore3, '1');
  assert.equal(out.hexa.skillCore4, '0');
  assert.equal(out.hexa.masteryCore1, '30');
  assert.equal(out.hexa.masteryCore2, '10');
  assert.equal(out.hexa.reinCore1, '21');
  assert.equal(out.hexa.reinCore4, '7');
  assert.equal(out.huntSkill.solJanus, '25');
  assert.equal(out.hexa.generalCore2, '3');
  // untouched groups keep defaults
  assert.deepEqual(out.doping, S.SCOUTER_DEFAULT_USERSTAT.doping);
  assert.deepEqual(out.seedRing, S.SCOUTER_DEFAULT_USERSTAT.seedRing);
});

test('tracker -> scouter preserves base userStat site-specific groups', () => {
  const base = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  base.doping.bigHero = false;
  base.linkSkill.ark = '5';
  base.stat.coolTimeReducePercent = '5';
  base.huntSkill.erdaShower = '30';
  const out = S.trackerToScouter(sampleTrackerState(), base);
  assert.equal(out.doping.bigHero, false);
  assert.equal(out.linkSkill.ark, '5');
  assert.equal(out.stat.coolTimeReducePercent, '5');
  assert.equal(out.huntSkill.erdaShower, '30');
});

test('scouter -> tracker maps stats correctly', () => {
  const us = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  Object.assign(us.stat, {
    myClass: KO.sia, level: '285',
    mainStatBase: '41,234', mainStatPer: '412', mainStatAbs: '12000',
    subStatBase: '3210', subStatPer: '78', subStatAbs: '400',
    atkBase: '4000', atkPercent: '100', atkAbs: '642',
    dmg: '95', bossDmg: '388', ignoreDef: '97.12',
    critical: '88', criticalDmg: '101.5',
    arcaneForce: '1350', authenticForce: '470',
  });
  Object.assign(us.hexa, { skillCore1: '30', masteryCore2: '10', reinCore4: '7', generalCore2: '3' });
  us.huntSkill.solJanus = '25';

  const { patch, mappedClass } = S.scouterToTracker(us, null);
  assert.equal(mappedClass, 'Sia');
  assert.equal(patch.selectedClass, 'Sia');
  assert.equal(patch.characterLevel, 285);
  assert.equal(patch.arcanePower, 1350);
  assert.equal(patch.sacredPower, 470);
  const cs = patch.characterStats;
  assert.equal(cs.primaryStat, 41234);
  assert.equal(cs.totalPercentStat, 412);
  assert.equal(cs.additionalPrimaryStat, 12000);
  // atkAbs folded: 4000 + 642/(1+100/100) = 4321
  assert.equal(cs.totalATT, 4321);
  assert.equal(cs.totalPercentATT, 100);
  assert.equal(cs.ied, 0.9712);
  assert.equal(cs.critRatePercent, 88);
  assert.equal(cs.critRateAssumed, false);
  assert.equal(cs.critDamagePercent, 101.5);
  assert.equal(cs.weaponMultiplier, S.TRACKER_CLASS_CONFIGS['Sia'].wm);
  assert.equal(cs.statModel, 'normal');
  // hexa — keyed by the target class's node ids
  assert.deepEqual(patch.hexaProgress.skillNodes, [30, null, null, null, null, null]);
  assert.deepEqual(patch.hexaProgress.mastery, { sia_mastery_1: 10 });
  assert.deepEqual(patch.hexaProgress.boost, { sia_boost_3: 7 });
  assert.deepEqual(patch.hexaProgress.common, { sia_common_0: 25, sia_common_1: 3 });
  assert.equal(patch.hexaAssumptionMode, 'explicit');
});

test('round-trip preserves mapped stat fields', () => {
  const state = sampleTrackerState();
  const us = S.trackerToScouter(state, null);
  const { patch } = S.scouterToTracker(us, state);
  const a = state.characterStats, b = patch.characterStats;
  for (const k of ['primaryStat', 'secondaryStat', 'totalATT', 'totalPercentStat',
    'totalPercentSecondaryStat', 'totalPercentATT', 'additionalPrimaryStat',
    'additionalSecondaryStat', 'damagePercent', 'bossDamagePercent', 'ied',
    'critRatePercent', 'critDamagePercent']) {
    assert.equal(b[k], a[k], k);
  }
  assert.equal(patch.characterLevel, state.characterLevel);
  assert.equal(patch.arcanePower, state.arcanePower);
  assert.equal(patch.sacredPower, state.sacredPower);
  assert.deepEqual(patch.hexaProgress.skillNodes, state.hexaProgress.skillNodes);
  assert.deepEqual(patch.hexaProgress.mastery, state.hexaProgress.mastery);
  assert.deepEqual(patch.hexaProgress.boost, state.hexaProgress.boost);
  assert.deepEqual(patch.hexaProgress.common, state.hexaProgress.common);
  // finalDamagePercent must be preserved from current state, not zeroed
  assert.equal(b.finalDamagePercent, a.finalDamagePercent);
});

test('tracker class slug matches live node-id prefixes', () => {
  assert.equal(S.trackerClassSlug('Shade'), 'shade');
  assert.equal(S.trackerClassSlug('Dark Knight'), 'dark_knight');
  assert.equal(S.trackerClassSlug('Fire/Poison'), 'fire_poison');
  assert.equal(S.trackerClassSlug('Ice/Lightning'), 'ice_lightning');
  assert.equal(S.trackerClassSlug('Mo Xuan'), 'mo_xuan');
  assert.equal(S.trackerClassSlug('Angelic Buster'), 'angelic_buster');
  assert.equal(S.trackerClassSlug(null), null);
});

test('legacy numeric hexa keys still export (old mirrored data)', () => {
  const state = sampleTrackerState();
  state.hexaProgress = {
    skillNodes: [30, null, null, null, null, null],
    mastery: { 0: 12 }, boost: {}, common: { 0: 19 },
  };
  const out = S.trackerToScouter(state, null);
  assert.equal(out.hexa.masteryCore1, '12');
  assert.equal(out.huntSkill.solJanus, '19');
});

test('demon avenger and xenon class metadata', () => {
  const us = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  us.stat.myClass = KO.da;
  us.stat.mainStatBase = '99999';
  let r = S.scouterToTracker(us, null);
  assert.equal(r.patch.characterStats.statModel, 'hp');

  us.stat.myClass = KO.xenon;
  Object.assign(us.stat, { ssubStatBase: '5000', ssubStatPer: '300', ssubStatAbs: '100' });
  r = S.scouterToTracker(us, null);
  assert.equal(r.patch.characterStats.statModel, 'tri-equal');
  assert.equal(r.patch.characterStats.tertiaryStat, 5000);
  assert.equal(r.patch.characterStats.totalPercentTertiaryStat, 300);
  assert.equal(r.patch.characterStats.additionalTertiaryStat, 100);
});

test('non-tertiary class zeroes stale tertiary stats', () => {
  const us = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  us.stat.myClass = KO.mercedes;
  us.stat.mainStatBase = '10000';
  const cur = { characterStats: { ...S.TRACKER_EMPTY_STATS, tertiaryStat: 777, totalPercentTertiaryStat: 10, additionalTertiaryStat: 5 } };
  const { patch } = S.scouterToTracker(us, cur);
  assert.equal(patch.characterStats.tertiaryStat, 0);
  assert.equal(patch.characterStats.totalPercentTertiaryStat, 0);
  assert.equal(patch.characterStats.additionalTertiaryStat, 0);
});

test('unknown class: stats imported, class untouched', () => {
  const us = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  us.stat.myClass = '레테';
  us.stat.mainStatBase = '12345';
  us.hexa.skillCore1 = '30'; // Lethe hexa must not be attributed to another class
  const { patch, mappedClass } = S.scouterToTracker(us, null);
  assert.equal(mappedClass, null);
  assert.ok(!('selectedClass' in patch));
  assert.equal(patch.characterStats.primaryStat, 12345);
  assert.ok(!('hexaProgress' in patch));
});

test('clamps: ignoreDef > 100, hexa above cap, crit above 100', () => {
  const us = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  Object.assign(us.stat, { myClass: KO.sia, mainStatBase: '1', ignoreDef: '250', critical: '150' });
  us.hexa.skillCore1 = '99';
  const { patch } = S.scouterToTracker(us, null);
  assert.equal(patch.characterStats.ied, 1);
  assert.equal(patch.characterStats.critRatePercent, 100);
  assert.equal(patch.hexaProgress.skillNodes[0], 30);
});

test('zero/empty scouter values produce null level/arcane/sacred and no hexa', () => {
  const us = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  us.stat.myClass = KO.sia;
  const { patch } = S.scouterToTracker(us, null);
  assert.equal(patch.characterLevel, null);
  assert.equal(patch.arcanePower, null);
  assert.equal(patch.sacredPower, null);
  assert.ok(!('hexaProgress' in patch));
  assert.ok(!('hexaAssumptionMode' in patch));
});

test('critical=0 keeps assumed crit from current tracker state', () => {
  const us = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  Object.assign(us.stat, { myClass: KO.sia, mainStatBase: '10', critical: '0' });
  const cur = { characterStats: { ...S.TRACKER_EMPTY_STATS, critRatePercent: 100, critRateAssumed: true } };
  const { patch } = S.scouterToTracker(us, cur);
  assert.equal(patch.characterStats.critRatePercent, 100);
  assert.equal(patch.characterStats.critRateAssumed, true);
});

test('tracker -> scouter with empty hexa leaves base hexa untouched', () => {
  const state = sampleTrackerState();
  state.hexaProgress = null;
  const base = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  base.hexa.skillCore1 = '17';
  const out = S.trackerToScouter(state, base);
  assert.equal(out.hexa.skillCore1, '17');
});

test('tracker null skill node (skillCore3+) preserves scouter value', () => {
  const state = sampleTrackerState();
  state.hexaProgress.skillNodes = [30, 25, null, null, null, null];
  const base = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  base.hexa.skillCore3 = '21'; // real 3rd origin skill entered on scouter
  const out = S.trackerToScouter(state, base);
  assert.equal(out.hexa.skillCore1, '30');
  assert.equal(out.hexa.skillCore2, '25');
  assert.equal(out.hexa.skillCore3, '21'); // not wiped to "0"
});

test('assumed crit rate is not exported as a real value', () => {
  const state = sampleTrackerState();
  state.characterStats.critRatePercent = 100;
  state.characterStats.critRateAssumed = true;
  const base = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  base.stat.critical = '63';
  const out = S.trackerToScouter(state, base);
  assert.equal(out.stat.critical, '63'); // base kept, not "100"
});

test('null tracker level falls back to base preset level', () => {
  const state = sampleTrackerState();
  state.characterLevel = null;
  const base = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  base.stat.level = '287';
  const out = S.trackerToScouter(state, base);
  assert.equal(out.stat.level, '287');
});

test('extra stat fields map in both directions', () => {
  const out = S.trackerToScouter(sampleTrackerState(), null);
  assert.equal(out.stat.statusAdditionalDmg, '12');
  assert.equal(out.stat.buffDuration, '40');
  assert.equal(out.stat.ignoreElementalResist, '10');
  assert.equal(out.stat.summonPersistTime, '20');
  assert.equal(out.special.isReboot, true); // serverType heroic

  const { patch } = S.scouterToTracker(out, null);
  assert.equal(patch.characterStats.abnormalStatusDamage, 12);
  assert.equal(patch.characterStats.buffDuration, 40);
  assert.equal(patch.characterStats.ignoreElementalResistance, 10);
  assert.equal(patch.characterStats.summonDuration, 20);
});

test('class change without hexa payload clears old hexa progress', () => {
  const us = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  us.stat.myClass = KO.mercedes;
  us.stat.mainStatBase = '10000';
  const cur = {
    selectedClass: 'Hero',
    characterStats: { ...S.TRACKER_EMPTY_STATS },
    hexaProgress: { skillNodes: [30, null, null, null, null, null], mastery: {}, boost: {}, common: {} },
  };
  const { patch } = S.scouterToTracker(us, cur);
  assert.equal(patch.selectedClass, 'Mercedes');
  assert.equal(patch.hexaProgress, null);
  assert.equal(patch.hexaAssumptionMode, 'estimated');
});

test('same-class import without hexa payload leaves hexa untouched', () => {
  const us = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  us.stat.myClass = KO.sia;
  us.stat.mainStatBase = '10000';
  const cur = { selectedClass: 'Sia', characterStats: { ...S.TRACKER_EMPTY_STATS } };
  const { patch } = S.scouterToTracker(us, cur);
  assert.ok(!('hexaProgress' in patch));
});

test('unmapped scouter class follows current tracker class for tertiary', () => {
  const us = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  us.stat.myClass = '레테';
  Object.assign(us.stat, { mainStatBase: '10000', ssubStatBase: '500' });
  // current class is non-tertiary -> tertiary zeroed despite scouter values
  let r = S.scouterToTracker(us, { selectedClass: 'Hero', characterStats: { ...S.TRACKER_EMPTY_STATS, weaponMultiplier: 1.2, statModel: 'normal' } });
  assert.equal(r.patch.characterStats.tertiaryStat, 0);
  // weaponMultiplier/statModel kept from current state, not reset
  assert.equal(r.patch.characterStats.weaponMultiplier, 1.2);
  // current class tertiary-capable -> scouter values written
  r = S.scouterToTracker(us, { selectedClass: 'Xenon', characterStats: { ...S.TRACKER_EMPTY_STATS } });
  assert.equal(r.patch.characterStats.tertiaryStat, 500);
});

test('tertiary-capable class: scouter zero overwrites stale tracker tertiary', () => {
  const us = structuredClone(S.SCOUTER_DEFAULT_USERSTAT);
  us.stat.myClass = KO.xenon;
  us.stat.mainStatBase = '10000'; // ssub all "0"
  const cur = { selectedClass: 'Xenon', characterStats: { ...S.TRACKER_EMPTY_STATS, tertiaryStat: 999 } };
  const { patch } = S.scouterToTracker(us, cur);
  assert.equal(patch.characterStats.tertiaryStat, 0);
});
