/** 《英雄祭坛》试玩版 — 集中配置（建议值·待测）
 * 节奏目标：前 20~30 秒存钱建首祭坛；整局打满约 5~6 分钟，很少提前占满。
 */
window.HA_CONFIG = {
  VIEW_W: 393,
  VIEW_H: 852,
  SAFE_TOP: 47,
  SAFE_BOTTOM: 28,

  MATCH_SECONDS: 330,          // 5 分 30 秒
  DIVINE_LAST_SECONDS: 60,
  DIVINE_PROD_MULT: 2,
  BEHIND_STEP_PCT: 0.10,
  BEHIND_BONUS_PER_STEP: 0.05,
  BEHIND_BONUS_CAP: 0.25,

  HEX_COLS: 7,
  HEX_ROWS: 12,
  HEX_SIZE: 24,
  // 单英雄清中立格约 3~5 秒：HP / (tileDmg/atkInterval)
  TILE_HP_NEUTRAL: 68,
  TILE_HP_OWNED: 260,

  // 床产金放慢；升级更贵
  BED_GOLD_PER_SEC: [0, 1.0, 1.3, 1.7, 2.3, 3.0, 3.8],
  BED_UPGRADE_COST: [0, 0, 80, 160, 280, 450, 700],
  BED_MAX_LV: 6,

  CAT_MAX: 3,
  CAT_BUILD_COST: 90,
  CAT_GOLD_PER_SEC: 0.45,
  GEN_MAX: 2,
  GEN_BUILD_COST: 110,
  GEN_FAITH_PER_SEC: 0.45,
  BUILD_SLOTS: 9,

  // 开局金币不够立刻建祭坛，需攒约 20~30 秒
  START_GOLD: 22,
  START_FAITH: 0,
  SPAWN_CD: 0.6,

  // 祭坛建造费（同种仅一座）
  ALTAR_BUILD_COST: {
    berserker: 45,
    paladin: 50,
    mage: 48
  },

  ALTARS: {
    berserker: {
      id: 'berserker', name: '狂战士', emoji: '⚔️', classId: 'berserker', color: '#e74c3c',
      spawnGold: 42, spawnFaith: 0, upgradeCost: [0, 120, 220, 380], maxLv: 3,
      // 移速/攻速约减半；对格伤害配合 52 HP ≈ 4s
      hero: { hp: 100, atk: 12, atkInterval: 1.4, speed: 24, tileDmg: 12, range: 10, rangeTile: 8 }
    },
    paladin: {
      id: 'paladin', name: '圣骑士', emoji: '🛡️', classId: 'paladin', color: '#f1c40f',
      spawnGold: 48, spawnFaith: 7, upgradeCost: [0, 120, 220, 380], maxLv: 3,
      hero: { hp: 180, atk: 7, atkInterval: 1.85, speed: 18, tileDmg: 7, range: 10, rangeTile: 8 }
    },
    mage: {
      id: 'mage', name: '法师', emoji: '🔮', classId: 'mage', color: '#9b59b6',
      spawnGold: 40, spawnFaith: 10, upgradeCost: [0, 120, 220, 380], maxLv: 3,
      hero: { hp: 75, atk: 11, atkInterval: 1.65, speed: 21, tileDmg: 9, range: 14, rangeTile: 10 }
    }
  },
  COUNTERS: { berserker: { paladin: 1.20 }, mage: { berserker: 1.20 } },
  COUNTERED: { paladin: { berserker: 0.85 }, berserker: { mage: 0.85 } },
  ALTAR_LV_ATK: 0.10, ALTAR_LV_HP: 0.10, ALTAR_LV_TILE: 0.08,

  SKILLS: {
    thunder: { id: 'thunder', name: '神罚雷击', emoji: '⚡', faithCost: 50, cd: 32, dmg: 45, radius: 70 },
    drum: { id: 'drum', name: '蛮荒鼓点', emoji: '🥁', faithCost: 55, cd: 40, duration: 7, atkSpeedMult: 1.25, tileDmgMult: 1.3 }
  },
  AI_THINK_INTERVAL: 1.2,
  AI_SPAWN_PRIORITY: ['berserker', 'paladin', 'mage']
};
