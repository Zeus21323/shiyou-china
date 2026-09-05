import type { ScenicArea } from './content';

// 按本站山水古迹主题逐项筛选，不以“小镇”“文化园”字样一刀切。
// 原始官方评级快照保留；地图、名录和数量统一使用此筛选。
export const excludedScenicGroups: Record<string, string[]> = {
  现代展馆与科普设施: [
    'zj-0032',
    'zj-0033',
    'zj-0042',
    'zj-0118',
    'zj-0120',
    'zj-0128',
    'zj-0129',
    'zj-0136',
    'zj-0151',
    'zj-0289',
    'zj-0291',
    'zj-0300',
    'zj-0394',
    'zj-0552',
    'zj-0564',
    'zj-0758',
    'zj-0883',
  ],
  '主题乐园、影视基地与现代人造游览园': [
    'zj-0005',
    'zj-0035',
    'zj-0036',
    'zj-0039',
    'zj-0040',
    'zj-0117',
    'zj-0121',
    'zj-0124',
    'zj-0133',
    'zj-0137',
    'zj-0140',
    'zj-0141',
    'zj-0148',
    'zj-0209',
    'zj-0220',
    'zj-0290',
    'zj-0295',
    'zj-0301',
    'zj-0307',
    'zj-0393',
    'zj-0476',
    'zj-0477',
    'zj-0550',
    'zj-0563',
    'zj-0567',
    'zj-0645',
    'zj-0763',
  ],
  动物园与海洋馆: [
    'zj-0007',
    'zj-0037',
    'zj-0135',
    'zj-0149',
    'zj-0305',
    'zj-0770',
  ],
  '现代产业、商业与度假设施': [
    'zj-0014',
    'zj-0022',
    'zj-0043',
    'zj-0131',
    'zj-0143',
    'zj-0147',
    'zj-0206',
    'zj-0296',
    'zj-0397',
    'zj-0399',
    'zj-0473',
    'zj-0566',
    'zj-0568',
    'zj-0646',
    'zj-0762',
    'zj-0873',
    'zj-0885',
  ],
};
export const excludedScenicIds = new Set(
  Object.values(excludedScenicGroups).flat(),
);
export function selectScenicAreas<T extends ScenicArea>(areas: T[]): T[] {
  return areas.filter(
    (area) =>
      !excludedScenicIds.has(area.id) &&
      !/湿地|森林公园|实地公园/.test(area.name),
  );
}
