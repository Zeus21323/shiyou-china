export function scenicName(name: string, province = '', city = '') {
  let s = name.normalize('NFKC');
  for (const part of [province, city, city.replace(/[市区县]$/, '')].filter(
    Boolean,
  ))
    s = s.replaceAll(part, '');
  return s
    .replace(/^浙江省/, '')
    .replace(/^[\u4e00-\u9fff]{2,5}市(?=.{3})/, '')
    .replace(/\([^)]*\)/g, '')
    .replace(/[·\s—－\-“”「」]/g, '')
    .replace(/国家级|国家|AAAAA|AAAA|5A|4A/g, '')
    .replace(
      /(风景名胜区|风景旅游区|文化旅游区|旅游度假区|旅游景区|风景区|旅游区|景区|公园)$/,
      '',
    );
}

/** 保守名称匹配，仅用于已给定省份的候选地点比较。 */
export function scenicNameScore(
  expected: string,
  actual: string,
  province = '',
  city = '',
) {
  const a = scenicName(expected, province, city),
    b = scenicName(actual, province, city);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (Math.min(a.length, b.length) >= 4 && (a.endsWith(b) || b.endsWith(a)))
    return (
      0.85 + (0.1 * Math.min(a.length, b.length)) / Math.max(a.length, b.length)
    );
  return 0;
}
