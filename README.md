# 诗游中国 · 全国山水诗词地图

以青绿山水三维地图浏览省份和景点，进入景点后以诗词星河阅读作品。当前网站来自项目上级 `work/poetry-db` 数据库，保留全部 2,388 个景点、124,385 首不同诗词及 1,649,973 条景点—作品候选关系；另保留原有 18 篇已核对诗文。

## 范围与证据

- 31 个大陆省级地区有景点记录；34 个省级地区均有独立真实 DEM 网格、青绿纹理和城市标注。港澳台暂无指定数据库中的景点记录，不套用大陆 A 级景区等级。
- 1,283 个景点有高德 POI 点位及可追溯来源。未定位的 1,105 个景点保留名录、搜索和星河入口，不使用市中心代替景点坐标。已核验的花鸟岛及太湖溇港点位可能落在概化省界之外，保留原坐标。
- 评级及保留范围来自分省筛选名录，含官方快照和二级汇编，日期各异，不宣称为实时统一官方名录。自然山水与历史遗址优先，遗址型博物馆等按原始名录备注保留。
- 数据库关系是候选。65,530 条为名称、历史别名等景点线索；1,584,443 条为同城／古地名区域线索，不等同于作品题咏该景点。界面分层筛选并显示证据状态，不能将检索命中当作学术考证。
- 上游诗词正文和出处逐分片保持原样，允许原语料中的异文及同题作品；来源记录序号包含表头，不保证等同于文件物理行号。

## 使用

全国视野选择省份，查看 5A 优先的景点名录；放大地图逐步出现更多 4A 景点，临近点聚合、标签避让。6 倍以上高亮跟随鼠标，选中省份整体抬升，地形与省界遵循深度遮挡。滚轮连续缩放，左键拖动平移，缩小退出高亮时保持当前比例尺。

点击景点标签或名录进入星河；每页 12 篇，可按题名、作者、朝代搜索，按景点线索／同城诗词／已核对筛选。每颗亮星对应本页一篇作品，背景微尘为装饰；放不下的星点题名仍可从右侧列表点击。正文仅在阅读时加载，失败可重试。手机保留完整列表和原文阅读。

## 数据结构与维护

网页资产位于 `public/data/poetry`：

- `attractions.index.json.gz`：全国景点、分省编码、评级出处、关系数、已有点位。
- `manifest.json.gz`：覆盖范围、关系统计和原始正文分片 SHA-256。
- `places/{scenicId}.json.gz`：单景点全部候选关系和诗词元数据、已有核对作品；无全站全文预加载。
- `poems/{00..ff}.json.gz`：256 个去重正文分片，无损压缩来源数据库；解压后单片约 0.3 MB。
- `CATALOG.md`、`DATABASE.md`、`LICENSE.txt`：原始名录、数据库说明和 MIT 许可。DATABASE.md 描述的是源数据库，其 relations/search 目录不属于网页资产布局。

在项目根目录上级保留原数据库、筛选名录与 `work/scenic-research/filtered.json`，执行：

```sh
node --experimental-strip-types scripts/geocode-national-poetry.mjs
node --experimental-strip-types scripts/build-national-poetry.mjs
```

第一步仅维护坐标时需要，读取本地忽略文件 `.env.local` 中的 `AMAP_WEB_SERVICE_KEY`。官方查询缓存与待核验列表写入 `web/work/national-geocoding`，便于断点继续，不发布 API 密钥或查询缓存。第二步只重组数据读取方式，不删改源数据库的诗词与关系，且校验原有 18 篇作品全部保留。

为满足 Sites 256 MiB 解包体积上限，全部诗词 JSON 以 gzip 分片发布，浏览器使用标准 DecompressionStream 按需解压；解压后字节与源数据库逐分片核验。需要支持此标准的现代浏览器（Chrome/Edge、Firefox、Safari 新版）。网页 JSON 缓存最多 16 个资源，地形缓存最多 6 省；退场标签释放，隐藏场景暂停帧循环。地图采用艺术化垂直夸张，非等比例测绘模型；Natural Earth 河湖为概化数据。

## 开发与验证

Node >= 22.13，React、TypeScript、Three.js、React Three Fiber、vinext 和 Sites。

```sh
npm ci
npm run dev
```

发布前执行 `npm run test:map`、`npx tsc --noEmit --incremental false`、`npm run build`。测试逐项核对源数据库全部景点、关系和正文，验证坐标归属、正文懒加载及重试、星河标签避让、地图聚合和 DEM 地形。源数据库不随 GitHub 仓库重复发布；全量数据一致性测试需使用此工作区的上级源数据库。

使用同一 Sites 项目私有发布。GitHub 和网站源码不含本地密钥，网站访问仅限所有者。完整评级来源逐景点保留；[诗词语料](https://github.com/Werneror/Poetry) 采用 MIT 许可，[兰亭集序](https://www.guwendao.net/shiwenv_af279f0cdd95.aspx) 保留古典原文来源。
