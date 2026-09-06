// 说说分类规则（与 scripts/import-qq-shuoshuo.mjs 的 RULES 保持一致）
// 用于给 Turso 数据库里的说说自动归类（随笔栏目 / 首页最新随笔共用）。
export const CATEGORY_RULES: ReadonlyArray<readonly [string, RegExp]> = [
  ['读书观影', /《|电影|电视剧|小说|读书|看书|读后|观影|影评|编剧|追剧|纪录片/],
  ['校园青春', /学校|考试|作业|同学|开学|老师|高考|考研|上学|大学|高中|初中|小学|复习|上课|毕业|图书馆|校园|学习|成绩|青春|学长/],
  ['梦想奋斗', /梦想|理想|奋斗|努力|加油|坚持|成功|失败|改变|勇气|勇敢|拼搏|信念|强者|改变自己/],
  ['亲情爱情', /奶奶|外婆|妈妈|母亲|爸爸|父亲|父母|爱情|恋爱|喜欢|表白|情书|玫瑰|婚姻|结婚|相亲|分手|暗恋|想念|想你|温柔/],
  ['生活日常', /吃饭|回家|放假|旅游|天气|下雨|好冷|好热|累|睡觉|晚安|过年|中秋|国庆|节日|生病|拉肚子|吃|喝|玩/],
];

/** 未命中任何规则的兜底分类 */
export const FALLBACK_CATEGORY = '心情随笔';

/** 按关键词规则给一段文本归类，返回分类名（命中即停，保证每条仅一个主分类） */
export function classifyText(text: string): string {
  const t = text || '';
  for (const [cat, re] of CATEGORY_RULES) {
    if (re.test(t)) return cat;
  }
  return FALLBACK_CATEGORY;
}
