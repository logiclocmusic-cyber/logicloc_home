// ── 默认配置 ────────────────────────────────────────────────────────────────
export const DEFAULT_CATS = [
  '交通出行','餐饮美食','日用百货','购物消费','数码电器','通讯费用','水电煤气',
  '生活服务','家居家装','文化休闲','母婴亲子','医疗健康','美容美发','宠物','保险',
  '工商税务','商业服务','转账','红包奖励','闲置转让','代拍代购','乐极客收入',
  '人情往来','房产交易','投资理财','探店置换','直播收入','衣服鞋帽','工资收入',
  '其他收入','其他'
];

import { iconRef } from './cat-icons.js';

/** 旧版 emoji 默认（用于迁移到卡通图标） */
export const LEGACY_DEFAULT_EMOJIS = {
  '交通出行':'🚇','餐饮美食':'🍜','日用百货':'🛒','购物消费':'🛍️','数码电器':'💻',
  '通讯费用':'📱','水电煤气':'💡','生活服务':'🔧','家居家装':'🏠','文化休闲':'🎭',
  '母婴亲子':'👶','医疗健康':'🏥','美容美发':'💇','宠物':'🐾','保险':'🛡️',
  '工商税务':'🏛️','商业服务':'💼','转账':'💸','红包奖励':'🧧','闲置转让':'♻️',
  '代拍代购':'🛒','乐极客收入':'🎮','直播收入':'📹','房产交易':'🏘️','投资理财':'📈',
  '衣服鞋帽':'👗','探店置换':'📸','人情往来':'🤝','工资收入':'💼','其他收入':'💰','其他':'📌'
};

/** 默认卡通图标（Iconify / fluent-emoji-flat） */
export const DEFAULT_EMOJIS = {
  '交通出行': iconRef('1F682'),
  '餐饮美食': iconRef('1F374'),
  '日用百货': iconRef('1F9FB'),
  '购物消费': iconRef('1F6CD'),
  '数码电器': iconRef('1F4BB'),
  '通讯费用': iconRef('1F4F1'),
  '水电煤气': iconRef('1F4A1'),
  '生活服务': iconRef('1F527'),
  '家居家装': iconRef('1F3E0'),
  '文化休闲': iconRef('1F3AD'),
  '母婴亲子': iconRef('1F476'),
  '医疗健康': iconRef('1F3E5'),
  '美容美发': iconRef('1F486'),
  '宠物': iconRef('1F43E'),
  '保险': iconRef('1F6E1'),
  '工商税务': iconRef('1F3DB'),
  '商业服务': iconRef('1F4BC'),
  '转账': iconRef('1F4B8'),
  '红包奖励': iconRef('1F9E7'),
  '闲置转让': iconRef('267B'),
  '代拍代购': iconRef('1F6D2'),
  '乐极客收入': iconRef('1F3AE'),
  '直播收入': iconRef('1F4F9'),
  '房产交易': iconRef('1F3D8'),
  '投资理财': iconRef('1F4C8'),
  '衣服鞋帽': iconRef('1F455'),
  '探店置换': iconRef('1F4F8'),
  '人情往来': iconRef('1F91D'),
  '工资收入': iconRef('1F4B0'),
  '其他收入': iconRef('1F4B5'),
  '其他': iconRef('1F4CC'),
};

/** 用户重命名分类时，回退到默认图标 */
export const CAT_ICON_NAME_ALIASES = {
  '公司服务': '商业服务',
  '存款理财': '投资理财',
  '乐极客': '乐极客收入',
};

/** 各主分类下的默认子分类（可在「编辑分类」中修改） */
export const DEFAULT_SUBCATS = {
  '交通出行': ['地铁', '公交', '打车', '停车', '加油', '高铁/火车'],
  '餐饮美食': ['外卖', '堂食', '咖啡奶茶', '食材'],
  '日用百货': ['日用品', '超市'],
  '购物消费': ['网购', '线下'],
  '转账': ['亲友', '公司内部', '其他'],
  '水电煤气': ['电费', '水费', '燃气', '物业'],
  '通讯费用': ['话费', '宽带'],
  '母婴亲子': ['奶粉', '纸尿裤', '母婴装备', '其他'],
  '医疗健康': ['药品', '体检', '其他'],
  '文化休闲': ['电影', '运动', '其他'],
  '工资收入': ['工资', '奖金', '其他'],
  '其他收入': ['退款', '其他'],
  '人情往来': []
};

export const CAT_COLORS = [
  '#2e90fa','#12b76a','#f79009','#f04438','#6941c6','#0e9384','#ee46bc','#16b364',
  '#dc6803','#e31b54','#4e5ba6','#099250','#d444f1','#1570ef','#0d9488','#7a5af8',
  '#ba24d5','#667085','#a6ef67','#fdb022','#98a2b3'
];

export const MONITOR_CATS = ['餐饮美食','水电煤气','通讯费用','交通出行','母婴亲子','保险','医疗健康','工商税务'];

/** 收入数据页默认监视的分类 */
export const DEFAULT_INCOME_DATA_CATS = ['闲置转让', '乐极客收入', '红包奖励', '工资收入'];
/** @deprecated 使用 DEFAULT_INCOME_DATA_CATS */
export const INCOME_DATA_CATS = DEFAULT_INCOME_DATA_CATS;
export const EXCLUDE_CATS = new Set(['转账']);
/** 默认对冲分类：统计时该分类收支相抵，只计净额 */
export const DEFAULT_OFFSET_CATS = ['代拍代购', '闲置转让', '餐饮美食', '探店置换', '乐极客收入'];
/** @deprecated 使用 DEFAULT_OFFSET_CATS */
export const OFFSET_CATS = new Set(DEFAULT_OFFSET_CATS);
/** 默认不计入首页总收支统计的分类（可在「编辑分类」中调整） */
export const DEFAULT_CAT_STATS_EXCLUDE = new Set(['人情往来']);
export const MONITOR_EMOJIS = {
  '餐饮美食': iconRef('1F374'),
  '水电煤气': iconRef('1F4A1'),
  '通讯费用': iconRef('1F4F1'),
  '交通出行': iconRef('1F682'),
  '母婴亲子': iconRef('1F476'),
  '保险': iconRef('1F6E1'),
  '医疗健康': iconRef('1F3E5'),
  '工商税务': iconRef('1F3DB'),
};

export const DEFAULT_SOURCES = [
  { name:'微信-胡晗', color:'#07c160' },
  { name:'支付宝-胡晗', color:'#1677ff' },
  { name:'京东-胡晗', color:'#e53935' },
  { name:'微信-陈橙', color:'#ff6d00' },
  { name:'支付宝-陈橙', color:'#9c27b0' },
  { name:'建行-陈橙', color:'#0066b3' },
  { name:'小河帮公司', color:'#795548' },
  { name:'乐极客公司', color:'#0097a7' },
  { name:'银行-储蓄卡', color:'#795548' },
  { name:'银行-信用卡', color:'#0097a7' }
];

export const DEFAULT_IMPORT_SOURCE = '建行-陈橙';

export const STORAGE_KEYS = {
  data: 'family_ledger_data',
  changed: 'family_ledger_changed',
  refunded: 'family_ledger_refunded',
  cats: 'family_ledger_cats',
  sources: 'family_ledger_sources',
  rules: 'family_ledger_rules',
  nextId: 'family_ledger_next_id',
  importHistory: 'family_ledger_import_history'
};
