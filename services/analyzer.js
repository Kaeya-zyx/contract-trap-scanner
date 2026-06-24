/**
 * 合同陷阱分析引擎
 * 内置规则引擎 + 可选 AI API 分析（DeepSeek 等）
 */

const { analyzeWithDeepSeek, normalizeAIResult } = require('./ai-service');

// ========== 陷阱规则库 ==========
const TRAP_RULES = [
  // ===== 高风险 =====
  {
    id: 'one-sided-termination',
    name: '单方面解约权',
    severity: 'high',
    category: 'unfair',
    keywords: ['单方面解除', '无需承担', '无需通知', '随时解除', '无条件解除', '有权解除本合同', '甲方有权解除'],
    description: '甲方拥有无条件的单方面解约权，乙方无权索赔。',
    suggestion: '建议：要求增加甲方解约需提前30天书面通知，并支付N+1经济补偿的条款。',
    legalBasis: '《劳动合同法》第39/40条，用人单位解除劳动合同需有法定理由并依法支付经济补偿。'
  },
  {
    id: 'vague-penalty',
    name: '模糊违约金',
    severity: 'high',
    category: 'financial',
    keywords: ['违约金', '赔偿金', '相应违约', '承担违约责任', '支付违约', '违约赔偿'],
    description: '违约金金额或计算方式不明确，可能被解释为高额赔偿。',
    suggestion: '建议：要求明确违约金具体金额或计算方式，且不超过合同总额的20%。',
    legalBasis: '《民法典》第585条，违约金不得过分高于实际损失的30%。'
  },
  {
    id: 'broad-non-compete',
    name: '竞业限制过宽',
    severity: 'high',
    category: 'restriction',
    keywords: ['竞业限制', '不得从事', '不得入职', '相关行业', '同行业', '竞争关系'],
    description: '竞业限制范围过宽，可能严重影响未来就业自由。',
    suggestion: '建议：明确竞业限制的具体行业范围和地域范围，并要求支付竞业限制补偿金（不低于月薪30%）。',
    legalBasis: '《劳动合同法》第24条，竞业限制期限不得超过2年，且需支付经济补偿。'
  },
  {
    id: 'deposit-no-return',
    name: '押金不退条款',
    severity: 'high',
    category: 'financial',
    keywords: ['押金不予退还', '押金不退', '不予退还押金', '没收押金', '押金归甲方所有'],
    description: '押金不予退还或设置苛刻的退还条件。',
    suggestion: '建议：要求明确押金退还条件和时限，正常退租后7个工作日内全额退还。',
    legalBasis: '《民法典》第586条，定金的数额不得超过主合同标的额的20%。'
  },
  {
    id: 'waive-social-insurance',
    name: '社保缴纳缺失',
    severity: 'high',
    category: 'legal',
    keywords: ['自愿放弃社保', '放弃缴纳', '自行缴纳社保', '社保补贴', '不缴纳社保', '以补贴代替'],
    description: '合同约定放弃社保或以补贴代替，这是违法的。',
    suggestion: '建议：拒绝此类条款，用人单位必须为劳动者缴纳社会保险，即使签署了放弃声明也无效。',
    legalBasis: '《社会保险法》第58条，用人单位应当自用工之日起30日内为职工办理社保登记。'
  },
  {
    id: 'no-refund',
    name: '预付费不退',
    severity: 'high',
    category: 'financial',
    keywords: ['一经售出概不退款', '不予退款', '不退不换', '概不退还', '不可退款'],
    description: '预付费后不予退款，排除消费者合法权益。',
    suggestion: '建议：要求明确退款条件和退款比例，"概不退款"属于无效格式条款。',
    legalBasis: '《消费者权益保护法》第26条，经营者不得以格式条款排除消费者权利。'
  },

  // ===== 中风险 =====
  {
    id: 'arbitration-clause',
    name: '仲裁条款限制',
    severity: 'medium',
    category: 'dispute',
    keywords: ['仲裁委员会', '提交仲裁', '仲裁解决', '甲方所在地仲裁'],
    description: '争议解决方式限定为仲裁，且地点在甲方所在地，可能限制你的诉讼权利。',
    suggestion: '建议：改为"协商不成的，可向合同履行地人民法院提起诉讼"。',
    legalBasis: '《民事诉讼法》第24条，因合同纠纷提起的诉讼，由被告住所地或合同履行地法院管辖。'
  },
  {
    id: 'auto-renewal',
    name: '自动续费陷阱',
    severity: 'medium',
    category: 'financial',
    keywords: ['自动续费', '自动续期', '自动扣费', '自动续订', '到期自动续'],
    description: '免费试用或服务到期后自动续费，取消流程可能复杂隐蔽。',
    suggestion: '建议：关注自动续费条款，确认取消方式和提前通知期限，要求明确告知续费时间和金额。',
    legalBasis: '《网络交易监督管理办法》第18条，自动续费需提前5日以显著方式提醒消费者。'
  },
  {
    id: 'unilateral-rent-increase',
    name: '单方面涨租权',
    severity: 'medium',
    category: 'financial',
    keywords: ['随时调整租金', '涨租', '调整租金', '提高租金', '租金调整'],
    description: '房东保留随时涨租的权利，且涨幅不受限制。',
    suggestion: '建议：要求写入"涨租需提前60天书面通知，年度涨幅不超过5%"。',
    legalBasis: '《民法典》第721条，租赁期限届满可续租，但需双方协商一致。'
  },
  {
    id: 'maintenance-transfer',
    name: '维修责任转嫁',
    severity: 'medium',
    category: 'unfair',
    keywords: ['维修费用由乙方承担', '乙方负责维修', '维修责任由租客', '房屋维修由乙方'],
    description: '将房屋维修责任全部转嫁给乙方，包括结构性损坏和自然老化。',
    suggestion: '建议：明确维修责任划分，房东负责结构和家电，租客负责日常消耗。',
    legalBasis: '《民法典》第712条，出租人应当履行租赁物的维修义务，另有约定除外。'
  },
  {
    id: 'overlong-probation',
    name: '试用期过长',
    severity: 'medium',
    category: 'legal',
    keywords: ['试用期', '试用期限', '试用期为'],
    description: '试用期可能超过法定期限。',
    suggestion: '建议：确认试用期长度符合法律规定：合同不满1年不超过1个月，1-3年不超过2个月，3年以上不超过6个月。',
    legalBasis: '《劳动合同法》第19条，试用期包含在劳动合同期限内，不得超过法定上限。'
  },
  {
    id: 'broad-liability-waiver',
    name: '免责条款过宽',
    severity: 'medium',
    category: 'unfair',
    keywords: ['概不负责', '不承担任何责任', '免责', '免除责任', '不承担赔偿'],
    description: '服务方对自身过失概不负责，消费者维权无门。',
    suggestion: '建议：要求删除或限制免责条款范围，服务方应对故意或重大过失承担责任。',
    legalBasis: '《民法典》第506条，合同中的免责条款无效情形包括造成对方人身损害或因故意/重大过失造成财产损失。'
  },
  {
    id: 'privacy-abuse',
    name: '个人信息滥用',
    severity: 'medium',
    category: 'privacy',
    keywords: ['收集个人信息', '使用个人信息', '转让个人信息', '共享个人信息', '授权使用'],
    description: '授权收集、使用、转让个人信息的范围过宽。',
    suggestion: '建议：个人信息授权应遵循最小必要原则，拒绝过度收集，明确信息用途和保留期限。',
    legalBasis: '《个人信息保护法》第6条，收集个人信息应当限于实现处理目的的最小范围。'
  },
  {
    id: 'ip-ownership',
    name: '知识产权全归公司',
    severity: 'medium',
    category: 'legal',
    keywords: ['知识产权归公司', '所有成果归', '职务作品', '知识产权归属', '成果所有权'],
    description: '所有创作成果无条件归公司所有，包括非工作时间。',
    suggestion: '建议：知识产权条款应限定在工作职责范围内，保留个人作品的权利。',
    legalBasis: '《著作权法》第18条，公民为完成法人工作任务所创作的作品是职务作品，但另有约定除外。'
  },

  // ===== 低风险 =====
  {
    id: 'vague-term',
    name: '模糊表述',
    severity: 'low',
    category: 'ambiguous',
    keywords: ['视情况而定', '相关费用', '合理期限', '适当', '必要时', '根据实际情况', '酌情处理', '另行通知'],
    description: '合同中存在模糊用语，可能导致理解偏差和权益受损。',
    suggestion: '建议：要求对方明确模糊条款的具体含义、标准和执行细则。',
    legalBasis: '《民法典》第142条，有相对人的意思表示的解释，应当按照所使用的词句，结合相关条款、行为的性质和目的、习惯以及诚信原则。'
  },
  {
    id: 'governing-law',
    name: '管辖法院不利',
    severity: 'low',
    category: 'dispute',
    keywords: ['甲方所在地法院', '甲方管辖', '甲方住所地'],
    description: '争议管辖地约定在甲方所在地，增加维权成本。',
    suggestion: '建议：争取约定为"合同履行地或被告所在地法院管辖"。',
    legalBasis: '《民事诉讼法》第35条，协议管辖不得违反级别管辖和专属管辖的规定。'
  }
];

/**
 * 分析合同文本，识别潜在陷阱
 * 支持三种模式：
 *   - builtin: 仅使用内置规则引擎
 *   - deepseek: 仅使用 DeepSeek AI 分析
 *   - hybrid: 规则引擎 + AI 增强分析（默认推荐）
 * @param {string} text - 合同文本
 * @returns {Promise<Object>} 分析结果
 */
async function analyzeContract(text) {
  const provider = (process.env.AI_PROVIDER || 'builtin').toLowerCase();
  const results = [];
  let aiSummary = '';

  // 预处理：去除 OCR 产生的字间空格（如 "签 订" -> "签订"）
  // 保留正常的空格分隔（英文单词间、段落间）
  const cleanedText = text
    .replace(/([\u4e00-\u9fff\u3000-\u303f])\s+([\u4e00-\u9fff\u3000-\u303f])/g, '$1$2')  // 中文字符间去空格
    .replace(/([\u4e00-\u9fff])\s+([\u4e00-\u9fff])/g, '$1$2');  // 再次处理混合情况

  // 检测合同类型
  const contractType = detectContractType(cleanedText);

  // 第一步：规则引擎分析（builtin 和 hybrid 模式都执行）
  if (provider === 'builtin' || provider === 'hybrid') {
    const ruleResults = analyzeWithRules(cleanedText);
    results.push(...ruleResults);

    // 检测缺失的重要条款
    const missingClauses = detectMissingClauses(cleanedText, contractType);
    results.push(...missingClauses);
  }

  // 第二步：AI 增强分析（deepseek 和 hybrid 模式执行）
  if (provider === 'deepseek' || provider === 'hybrid') {
    try {
      console.log(`[AI] 使用 DeepSeek 进行合同分析 (模式: ${provider})...`);
      const aiResult = await analyzeWithDeepSeek(cleanedText, contractType);
      const normalized = normalizeAIResult(aiResult, contractType);

      // hybrid 模式下，合并 AI 结果（去重）
      if (provider === 'hybrid') {
        const existingNames = new Set(results.map(r => r.name));
        for (const trap of normalized.traps) {
          // 如果规则引擎已发现同名风险，则用 AI 结果增强描述
          const existing = results.find(r => r.name === trap.name);
          if (existing) {
            // AI 发现了额外信息，补充到现有结果
            if (trap.matchedClauses.length > 0 && !existing.matchedClauses.includes(trap.matchedClauses[0])) {
              existing.matchedClauses.push(...trap.matchedClauses);
            }
            existing.source = 'hybrid'; // 标记为双引擎确认
          } else {
            // AI 发现了规则引擎未覆盖的新风险
            results.push(trap);
          }
        }
        aiSummary = normalized.summary;
      } else {
        // deepseek 模式：直接使用 AI 结果
        results.push(...normalized.traps);
        aiSummary = normalized.summary;
      }

      console.log(`[AI] DeepSeek 分析完成，发现 ${normalized.traps.length} 个风险点`);
    } catch (aiError) {
      console.error('[AI] DeepSeek 分析失败:', aiError.message);
      // hybrid 模式下 AI 失败不阻断，继续使用规则引擎结果
      if (provider === 'hybrid') {
        console.log('[AI] 降级为纯规则引擎模式');
      } else {
        // deepseek 模式下 AI 失败则报错
        throw new Error('AI 分析失败: ' + aiError.message);
      }
    }
  }

  // 按风险等级排序
  const severityOrder = { high: 0, medium: 1, low: 2 };
  results.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // 统计
  const stats = {
    total: results.length,
    high: results.filter(r => r.severity === 'high').length,
    medium: results.filter(r => r.severity === 'medium').length,
    low: results.filter(r => r.severity === 'low').length
  };

  // 生成摘要
  const summary = aiSummary || generateSummary(stats, contractType);

  // 生成原文高亮信息
  const highlightedText = generateHighlightedText(cleanedText, results);

  return {
    contractType,
    stats,
    traps: results,
    summary,
    highlightedText,
    analysisMode: provider,
    timestamp: new Date().toISOString()
  };
}

/**
 * 使用内置规则引擎分析合同
 */
function analyzeWithRules(text) {
  const results = [];

  for (const rule of TRAP_RULES) {
    const matchedClauses = [];

    for (const keyword of rule.keywords) {
      const regex = new RegExp(`[^。？！；\n]{0,30}${keyword}[^。？！；\n]{0,50}`, 'gi');
      let match;
      while ((match = regex.exec(text)) !== null) {
        const clause = match[0].trim();
        if (!matchedClauses.includes(clause)) {
          matchedClauses.push(clause);
        }
      }
    }

    if (matchedClauses.length > 0) {
      results.push({
        id: rule.id,
        name: rule.name,
        severity: rule.severity,
        category: rule.category,
        description: rule.description,
        suggestion: rule.suggestion,
        legalBasis: rule.legalBasis,
        matchedClauses: matchedClauses.slice(0, 3), // 最多返回3条匹配
        matchCount: matchedClauses.length
      });
    }
  }

  return results;
}

/**
 * 检测合同类型
 */
function detectContractType(text) {
  const typeKeywords = {
    rent: ['租赁合同', '租房合同', '出租方', '承租方', '租金', '押金', '房屋租赁', '出租人', '承租人', '租赁期'],
    labor: ['劳动合同', '用人单位', '劳动者', '工资', '试用期', '社保', '竞业限制', '甲方（用人单位）', '乙方（劳动者）'],
    intern: ['实习协议', '实习合同', '实习期', '实习补贴', '实习生', '实习单位'],
    service: ['服务合同', '服务协议', '服务方', '客户', '会员', '订阅', '自动续费', '消费者']
  };

  let bestMatch = 'unknown';
  let bestScore = 0;

  for (const [type, keywords] of Object.entries(typeKeywords)) {
    let score = 0;
    for (const kw of keywords) {
      const regex = new RegExp(kw, 'gi');
      const matches = text.match(regex);
      if (matches) score += matches.length;
    }
    if (score > bestScore) {
      bestScore = score;
      bestMatch = type;
    }
  }

  const typeNames = {
    rent: '租房合同',
    labor: '劳动合同',
    intern: '实习协议',
    service: '服务合同',
    unknown: '通用合同'
  };

  return { type: bestMatch, name: typeNames[bestMatch] };
}

/**
 * 检测缺失的重要条款
 */
function detectMissingClauses(text, contractType) {
  const missing = [];
  const textLower = text.toLowerCase();

  // 根据合同类型检测缺失条款
  if (contractType.type === 'labor' || contractType.type === 'intern') {
    if (!text.includes('社会保险') && !text.includes('社保')) {
      missing.push({
        id: 'missing-social-insurance',
        name: '缺失社保条款',
        severity: 'high',
        category: 'missing',
        description: '合同中未提及社会保险缴纳事宜。',
        suggestion: '建议：要求明确社保缴纳基数、比例和起缴时间。',
        legalBasis: '《社会保险法》第58条',
        matchedClauses: [],
        matchCount: 0
      });
    }
    if (!text.includes('工资') && !text.includes('薪资') && !text.includes('报酬') && !text.includes('补贴')) {
      missing.push({
        id: 'missing-salary',
        name: '缺失薪资条款',
        severity: 'high',
        category: 'missing',
        description: '合同中未明确约定薪资待遇。',
        suggestion: '建议：要求明确基本工资、绩效工资、发放时间和方式。',
        legalBasis: '《劳动合同法》第17条',
        matchedClauses: [],
        matchCount: 0
      });
    }
    if (!text.includes('工作时间') && !text.includes('工作制度')) {
      missing.push({
        id: 'missing-work-hours',
        name: '缺失工作时间条款',
        severity: 'medium',
        category: 'missing',
        description: '合同中未明确约定工作时间和休息休假安排。',
        suggestion: '建议：要求明确每日工作时长、每周休息日和法定节假日安排。',
        legalBasis: '《劳动法》第36条',
        matchedClauses: [],
        matchCount: 0
      });
    }
  }

  if (contractType.type === 'rent') {
    if (!text.includes('退还') && !text.includes('退押')) {
      missing.push({
        id: 'missing-deposit-return',
        name: '缺失押金退还条款',
        severity: 'high',
        category: 'missing',
        description: '合同中未明确押金退还条件和时限。',
        suggestion: '建议：要求明确押金退还条件、退还时限和扣除项目。',
        legalBasis: '《民法典》相关规定',
        matchedClauses: [],
        matchCount: 0
      });
    }
    if (!text.includes('维修') && !text.includes('修缮')) {
      missing.push({
        id: 'missing-maintenance',
        name: '缺失维修责任条款',
        severity: 'medium',
        category: 'missing',
        description: '合同中未明确房屋维修责任划分。',
        suggestion: '建议：明确维修责任划分，房东负责结构和家电，租客负责日常消耗。',
        legalBasis: '《民法典》第712条',
        matchedClauses: [],
        matchCount: 0
      });
    }
  }

  // 通用缺失条款检测
  if (!text.includes('争议') && !text.includes('纠纷') && !text.includes('仲裁') && !text.includes('诉讼')) {
    missing.push({
      id: 'missing-dispute',
      name: '缺失争议解决条款',
      severity: 'low',
      category: 'missing',
      description: '合同中未约定争议解决方式。',
      suggestion: '建议：增加争议解决条款，明确协商、调解、仲裁或诉讼的顺序和管辖地。',
      legalBasis: '《民事诉讼法》相关规定',
      matchedClauses: [],
      matchCount: 0
    });
  }

  return missing;
}

/**
 * 生成原文高亮标注数据
 * 将合同原文分段，标记每个风险对应的位置
 * @param {string} text - 合同原文
 * @param {Array} traps - 风险列表
 * @returns {Array} 带高亮标记的段落数组
 */
function generateHighlightedText(text, traps) {
  // 按句子分割原文
  const sentences = text.split(/([。；！？\n]+)/);
  const segments = [];

  // 合并句子和分隔符
  for (let i = 0; i < sentences.length; i += 2) {
    const content = sentences[i];
    const delimiter = sentences[i + 1] || '';
    if (content.trim()) {
      segments.push({
        text: content + delimiter,
        traps: []
      });
    }
  }

  // 为每个段落标记风险
  for (const trap of traps) {
    if (!trap.matchedClauses || trap.matchedClauses.length === 0) continue;

    for (const clause of trap.matchedClauses) {
      for (const segment of segments) {
        if (segment.text.includes(clause)) {
          if (!segment.traps.find(t => t.id === trap.id)) {
            segment.traps.push({
              id: trap.id,
              name: trap.name,
              severity: trap.severity
            });
          }
        }
      }
    }
  }

  return segments;
}

/**
 * 生成分析摘要
 */
function generateSummary(stats, contractType) {
  let riskLevel = '低风险';
  if (stats.high > 0) riskLevel = '高风险';
  else if (stats.medium > 2) riskLevel = '中风险';

  return `该${contractType.name}共发现 ${stats.total} 个潜在问题（高风险 ${stats.high} 处，中风险 ${stats.medium} 处，低风险 ${stats.low} 处），整体风险等级为「${riskLevel}」。建议重点关注高风险条款，必要时咨询专业律师。`;
}

module.exports = { analyzeContract };
