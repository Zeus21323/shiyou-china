import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const sourceUrl =
  'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places_simple.geojson';
const source = path.join(root, 'work/cities-source.geojson');
if (!fs.existsSync(source)) {
  const r = await fetch(sourceUrl);
  if (!r.ok) throw Error('城市来源下载失败');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, await r.text());
}
// 中文地名与省级归属人工映射，坐标逐项来自来源原记录。
const mappings = [
  ['Beijing', '北京', 110000],
  ['Tianjin', '天津', 120000],
  ['Shijiazhuang', '石家庄', 130000],
  ['Taiyuan', '太原', 140000],
  ['Hohhot', '呼和浩特', 150000],
  ['Shenyeng', '沈阳', 210000],
  ['Changchun', '长春', 220000],
  ['Harbin', '哈尔滨', 230000],
  ['Shanghai', '上海', 310000],
  ['Nanjing', '南京', 320000],
  ['Hangzhou', '杭州', 330000],
  ['Hefei', '合肥', 340000],
  ['Fuzhou', '福州', 350000],
  ['Nanchang', '南昌', 360000],
  ['Jinan', '济南', 370000],
  ['Zhengzhou', '郑州', 410000],
  ['Wuhan', '武汉', 420000],
  ['Changsha', '长沙', 430000],
  ['Guangzhou', '广州', 440000],
  ['Nanning', '南宁', 450000],
  ['Haikou', '海口', 460000],
  ['Chongqing', '重庆', 500000],
  ['Chengdu', '成都', 510000],
  ['Guiyang', '贵阳', 520000],
  ['Kunming', '昆明', 530000],
  ['Lhasa', '拉萨', 540000],
  ['Xian', '西安', 610000],
  ['Lanzhou', '兰州', 620000],
  ['Xining', '西宁', 630000],
  ['Yinchuan', '银川', 640000],
  ['Ürümqi', '乌鲁木齐', 650000],
  ['Taipei', '台北', 710000],
  ['Hong Kong', '香港', 810000],
  ['Macau', '澳门', 820000],
  ['Shenzhen', '深圳', 440000],
];
const features = JSON.parse(fs.readFileSync(source, 'utf8')).features;
const cities = mappings.map(([sourceName, name, province]) => {
  const matches = features.filter(
    (f) =>
      f.properties.name === sourceName &&
      ['CHN', 'TWN'].includes(f.properties.sov_a3),
  );
  if (matches.length !== 1) throw Error(`城市来源不唯一：${sourceName}`);
  const f = matches[0];
  return {
    id: `city-${f.properties.ne_id}`,
    name,
    province,
    coordinates: f.geometry.coordinates,
    sourceName,
    sourceId: String(f.properties.ne_id),
    kind: [110000, 120000, 310000, 500000].includes(province)
      ? 'municipality'
      : province >= 710000
        ? 'administrative-centre'
        : name === '深圳'
          ? 'city'
          : 'capital',
    firstTier: ['北京', '上海', '广州', '深圳'].includes(name),
  };
});
fs.writeFileSync(
  path.join(root, 'public/data/city-labels.json'),
  JSON.stringify(
    {
      sourceUrl,
      license: 'Natural Earth public domain',
      crs: 'WGS84',
      note: '城市中心概化点，非政府驻地或导航目的地；一线城市采用北上广深口径。',
      cities,
    },
    null,
    2,
  ),
);
console.log(`已生成 ${cities.length} 个去重城市标签`);
