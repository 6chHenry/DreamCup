/**
 * 从梦境角色「关系」长句中抽取短标签用关键词（长词优先子串去重在提取逻辑中处理）。
 * 以包含匹配为主，避免过度分词；可按需要扩充。
 */
const RELATIONSHIP_KEYWORDS: string[] = [
  "相亲对象",
  "大学室友",
  "高中同学",
  "初中同学",
  "小学同学",
  "同班同学",
  "前男友",
  "前女友",
  "男朋友",
  "女朋友",
  "未婚妻",
  "未婚夫",
  "前同事",
  "陌生人",
  "神秘人",
  "黑衣人",
  "过路人",
  "讲述者",
  "梦者",
  "梦见者",
  "叙述者",
  "堂兄弟",
  "堂姐妹",
  "外祖父",
  "外祖母",
  "外孙女",
  "外孙子",
  "亲家母",
  "亲家公",
  "另一半",
  "孩子爸",
  "孩子妈",
  "班主任",
  "辅导员",
  "实习生",
  "领导",
  "客户",
  "网友",
  "教练",
  "医生",
  "护士",
  "警察",
  "老板",
  "同事",
  "室友",
  "邻居",
  "前任",
  "初恋",
  "爱人",
  "丈夫",
  "妻子",
  "老公",
  "老婆",
  "男友",
  "女友",
  "恋人",
  "对象",
  "母亲",
  "父亲",
  "妈妈",
  "爸爸",
  "爷爷",
  "奶奶",
  "哥哥",
  "姐姐",
  "弟弟",
  "妹妹",
  "堂哥",
  "堂姐",
  "表哥",
  "表姐",
  "儿子",
  "女儿",
  "孙子",
  "孙女",
  "外公",
  "外婆",
  "舅舅",
  "阿姨",
  "叔叔",
  "姑姑",
  "导师",
  "老师",
  "学生",
  "同学",
  "朋友",
  "家人",
  "亲戚",
  "堂兄",
  "表妹",
  "自己",
].sort((a, b) => b.length - a.length);

const TAG_KEY_RE = /[a-z]/i;
function tagDedupeKey(s: string): string {
  const t = s.trim();
  if (TAG_KEY_RE.test(t)) return t.toLowerCase();
  return t;
}

export function extractShortTagsFromText(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const kw of RELATIONSHIP_KEYWORDS) {
    if (t.includes(kw)) {
      const k = tagDedupeKey(kw);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(kw);
    }
  }
  return out;
}

export function mergeUniqueTags(existing: string[], incoming: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of [...existing, ...incoming]) {
    const t = s.trim();
    if (!t) continue;
    const k = tagDedupeKey(t);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}

export function appendUniqueNote(notes: string[], line: string | undefined): string[] {
  const s = line?.trim();
  if (!s) return notes;
  if (notes.some((n) => n === s)) return notes;
  return [...notes, s];
}
