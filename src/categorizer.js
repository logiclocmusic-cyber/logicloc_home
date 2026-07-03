// ── 自动分类引擎 ─────────────────────────────────────────────────────────────
export const Categorizer = (() => {
  const KEYWORD_RULES = [
    { cat: '交通出行', keys: ['地铁', '公交', '滴滴', '出租', '高铁', '12306', '铁路', '停车', 'ETC', '加油', '中石油', '中石化', '天府通', '智泊', '通行费', '航空', '机票', '共享单车', '哈啰出行'] },
    { cat: '餐饮美食', keys: ['餐饮', '外卖', '美团', '饿了么', '肯德基', 'KFC', '麦当劳', '星巴克', '咖啡', '奶茶', '火锅', '烧烤', '超市', '永辉', '盒马', '全家', '便利店', '食堂', '餐厅', '小吃', '蜜雪冰城', '瑞幸', '必胜客', '满彭', '菜场'] },
    { cat: '通讯费用', keys: ['移动', '联通', '电信', '话费', '流量', '充值', '宽带', '手机充值'] },
    { cat: '水电煤气', keys: ['电费', '水费', '燃气', '煤气', '供电', '供水', '物业'] },
    { cat: '医疗健康', keys: ['医院', '卫生', '药房', '药店', '体检', '诊所', '医保', '大药房', '泉源堂'] },
    { cat: '母婴亲子', keys: ['奶粉', '纸尿裤', '婴儿', '母婴', '孩子王', 'babycare', '好奇', '启赋', '嫚熙', '儿童'] },
    { cat: '数码电器', keys: ['苹果', '华为', '小米', '电脑', '手机', '数码', '电器', '耳机', '充电', '图拉斯', '飞利浦'] },
    { cat: '衣服鞋帽', keys: ['服装', '服饰', '鞋', '优衣库', 'ZARA', 'H&M', '连衣裙', '童装'] },
    { cat: '家居家装', keys: ['宜家', '家居', '家具', '装修', '建材', '床', '沙发', '窗帘'] },
    { cat: '文化休闲', keys: ['电影', '影院', '图书', '游戏', 'Steam', '健身', '游泳', '门票', '展览'] },
    { cat: '美容美发', keys: ['美容', '美发', '理发', '护肤', '化妆品', '美甲'] },
    { cat: '宠物', keys: ['宠物', '猫粮', '狗粮', '兽医'] },
    { cat: '保险', keys: ['保险', '保费', '人寿', '平安险', '车险'] },
    { cat: '工商税务', keys: ['税务', '工商', '社保', '公积金', '税', '证书服务费', '代收税', '数字证书', '待报解预算'] },
    { cat: '商业服务', keys: ['软件服务', '服务费', '会员', '订阅', '阿里云', '腾讯云', '短信服务费', '网银年服务费', '网银服务费', '财务服务费', '财务管理服务'] },
    { cat: '生活服务', keys: ['快递', '顺丰', '京东快递', '菜鸟', '洗衣', '保洁', '维修', '寄件', '跑腿'] },
    { cat: '红包奖励', keys: ['红包', '天天领红包', '奖励', '签到', '提现'] },
    { cat: '闲置转让', keys: ['闲鱼', '转转', '二手', '闲置'] },
    { cat: '转账', keys: ['微信转账', '转账备注', '二维码收款', '个人经营', '往来款'] },
    { cat: '人情往来', keys: ['礼金', '份子', '红包-'] },
    { cat: '工资收入', keys: ['工资', '薪资', '代发'] },
    { cat: '投资理财', keys: ['基金', '理财', '股票', '证券', '余额宝收益', '利息', '结息', '入息'] },
    { cat: '探店置换', keys: ['探店', '置换', '暖羊', '暖暖洋'] },
    { cat: '日用百货', keys: ['淘宝', '天猫', '京东', '拼多多', '百货', '日用品', '超市'] }
  ];

  const ALIPAY_CAT_MAP = {
    '餐饮': '餐饮美食', '购物': '购物消费', '交通': '交通出行', '通讯': '通讯费用',
    '日用百货': '日用百货', '医疗健康': '医疗健康', '教育': '文化休闲',
    '休闲娱乐': '文化休闲', '母婴': '母婴亲子', '住房': '家居家装',
    '生活服务': '生活服务', '保险': '保险', '转账': '转账', '红包': '红包奖励',
    '投资理财': '投资理财', '商业服务': '商业服务', '美容': '美容美发',
    '数码电器': '数码电器', '文化': '文化休闲', '宠物': '宠物',
    '酒店旅游': '文化休闲', '公益': '其他', '信用借还': '转账',
    '充值缴费': '通讯费用', '其他': '其他'
  };

  const WECHAT_TYPE_MAP = {
    '商户消费': '购物消费', '扫二维码付款': '转账', '微信红包': '红包奖励',
    '微信红包（群红包）': '红包奖励', '转账': '转账', '群收款': '人情往来',
    '二维码收款': '转账', '退款': '其他', '其他': '其他',
    '充值': '通讯费用', '提现': '其他', '信用卡还款': '转账',
    '有退款': '其他', '亲属卡': '人情往来', '零钱通': '投资理财'
  };

  let peerRules = {};
  let keywordRules = [];
  let rulesChangeCb = null;

  function applyRules(saved) {
    Object.keys(peerRules).forEach(k => delete peerRules[k]);
    Object.assign(peerRules, saved?.peerRules || {});
    keywordRules.length = 0;
    keywordRules.push(...(saved?.keywordRules || []));
  }

  function onRulesChange(cb) {
    rulesChangeCb = cb;
  }

  function loadRules() {
    /* 规则由 app 从 SQLite 加载后调用 applyRules */
  }

  function saveRules() {
    if (rulesChangeCb) rulesChangeCb({ peerRules, keywordRules });
  }

  function textOf(row) {
    return [row['交易对方'], row['商品说明'], row['备注'], row['原始分类']].join(' ').toLowerCase();
  }

  function matchKeyword(text, cats) {
    for (const rule of keywordRules) {
      if (cats.includes(rule.cat) && text.includes(rule.keyword.toLowerCase())) {
        return { cat: rule.cat, conf: 'high', reason: 'learned' };
      }
    }
    for (const rule of KEYWORD_RULES) {
      if (!cats.includes(rule.cat)) continue;
      for (const k of rule.keys) {
        if (text.includes(k.toLowerCase())) {
          return { cat: rule.cat, conf: 'high', reason: 'keyword' };
        }
      }
    }
    return null;
  }

  const COMPANY_SOURCE_RULES = [
    { cat: '投资理财', keys: ['结息', '入息', '存款利息'] },
    { cat: '工商税务', keys: ['代收税', '待报解预算', '数字证书', '证书认证', '证书服务费'] },
    { cat: '商业服务', keys: ['短信服务费', '网银年服务费', '网银服务费', '签约代扣', '财务服务费', '财务管理服务', '智中智'] },
    { cat: '转账', keys: ['往来款', '其他合法款项'] }
  ];

  function classifyCompanyRow(row, cats) {
    const source = row['来源'] || '';
    if (!/公司$/.test(source)) return null;

    const peer = (row['交易对方'] || '').trim();
    const note = row['备注'] || '';
    const desc = row['商品说明'] || '';
    const text = textOf(row);
    const type = row['收支'];

    if (type === '收入' && /支付.+服务|热浪|橘丽丝/.test(`${note} ${desc}`)) {
      if (cats.includes('其他收入')) return { cat: '其他收入', conf: 'high', reason: 'company', auto: true };
    }
    if (type === '收入' && /文化传播|传媒/.test(peer) && /转账|服务/.test(text)) {
      if (cats.includes('其他收入')) return { cat: '其他收入', conf: 'high', reason: 'company', auto: true };
    }
    if (/胡晗/.test(peer) && type === '支出') {
      if (cats.includes('转账')) return { cat: '转账', conf: 'high', reason: 'company', auto: true };
    }

    for (const rule of COMPANY_SOURCE_RULES) {
      if (!cats.includes(rule.cat)) continue;
      for (const k of rule.keys) {
        if (!text.includes(k.toLowerCase())) continue;
        if (rule.cat === '商业服务' && type === '收入' && /支付.+服务/.test(`${note} ${desc}`)) continue;
        return { cat: rule.cat, conf: 'high', reason: 'company', auto: true };
      }
    }
    return null;
  }

  function matchCompanySourceRules(row, cats) {
    return classifyCompanyRow(row, cats);
  }

  function classify(row, cats) {
    const peer = (row['交易对方'] || '').trim();
    const text = textOf(row);

    const companyRule = matchCompanySourceRules(row, cats);
    if (companyRule) return companyRule;

    if (peer && peerRules[peer] && cats.includes(peerRules[peer])) {
      return { cat: peerRules[peer], conf: 'high', reason: 'peer', auto: true };
    }

    const kw = matchKeyword(text, cats);
    if (kw) return { ...kw, auto: true };

    const raw = row['原始分类'] || '';
    if (raw) {
      for (const [k, v] of Object.entries(ALIPAY_CAT_MAP)) {
        if (raw.includes(k) && cats.includes(v)) {
          return { cat: v, conf: 'high', reason: 'alipay', auto: true };
        }
      }
      for (const [k, v] of Object.entries(WECHAT_TYPE_MAP)) {
        if (raw.includes(k) && cats.includes(v)) {
          return { cat: v, conf: 'medium', reason: 'wechat', auto: true };
        }
      }
    }

    if (row['收支'] === '收入') {
      if (/退款|退货/.test(text)) return { cat: '其他', conf: 'low', reason: 'default', auto: true };
      return { cat: cats.includes('其他收入') ? '其他收入' : '其他', conf: 'low', reason: 'default', auto: true };
    }

    return { cat: '其他', conf: 'low', reason: 'default', auto: true };
  }

  function classifyAll(records, cats) {
    return records.map(r => {
      const result = classify(r, cats);
      return {
        ...r,
        分类: result.cat,
        _autoCat: result.auto,
        _catConf: result.conf,
        _catReason: result.reason
      };
    });
  }

  function learn(peer, category, desc) {
    if (peer) peerRules[peer] = category;
    const token = (desc || peer || '').trim();
    if (token && token.length >= 2) {
      const exists = keywordRules.find(r => r.keyword === token && r.cat === category);
      if (!exists) keywordRules.unshift({ keyword: token.slice(0, 20), cat: category });
      if (keywordRules.length > 500) keywordRules = keywordRules.slice(0, 500);
    }
    saveRules();
  }

  function isPending(row) {
    return row._autoCat && (row._catConf === 'low' || row['分类'] === '其他');
  }

  return { classify, classifyAll, learn, isPending, loadRules, applyRules, onRulesChange, peerRules, keywordRules };
})();
