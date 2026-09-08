# 诗游中国 · 全国山水诗词地图

以青绿山水三维地图浏览省份和景点，进入景点后以水上莲花灯阅读诗文。当前网站读取 `work/poetry-db/poetry-wenyan-attractions-v2.sqlite3` 的正式关系：3,100 条关系、3,093 篇去重文本（古诗2,619篇、文言散文474篇），涉及206个景区。没有正式关系的景区不进入地图和景区目录。

本仓库公开发布，任何人均可查看、克隆并在本地运行。项目源码采用 [MIT License](./LICENSE)；诗文语料、景区名录、地图、地形及其他第三方资料仍遵循各自来源的许可与署名要求，详见 `public/data/poetry/DATABASE.md`、`public/data/poetry/CATALOG.md` 和各数据目录中的许可说明。

## 范围与证据

- 20 个省级地区有正式关联景区；34 个省级地区的地图地形保留。
- 115 个正式关联景区有高德点位，91个暂无可靠坐标，保留目录和阅读入口，不使用市中心代替景点坐标。
- 评级及保留范围来自分省筛选名录，含官方快照和二级汇编，日期各异，不宣称为实时统一官方名录。自然山水与历史遗址优先，遗址型博物馆等按原始名录备注保留。
- 只导出 effective_relations 中已完成批次的 curated-confirmed 关系，保留核验理由、引文、批次与证据来源。不额外合并旧版18篇独立作品或候选关系，避免重复和绕过新版核验。
- 上游诗词正文和出处逐分片保持原样，允许原语料中的异文及同题作品；来源记录序号包含表头，不保证等同于文件物理行号。

## 使用

### 本地使用（无需登录）

在 `web` 目录运行 `npm run dev -- --host 127.0.0.1`，然后打开 <http://localhost:3000/>。也可双击本目录的 `start-local.cmd`；使用期间保留启动窗口，关闭窗口即停止本地服务。首次安装依赖需要 Node >= 22.13 并执行 `npm ci`，已有 `node_modules` 时不必重复安装。

地图、34省地形与青绿纹理、城市点位、景点目录及诗词正文都从本机 `public/data` 读取。日常地图浏览、星河和正文阅读无需 Sites 登录或高德联网查询；只有刷新官方坐标、首次安装依赖、访问外部出处链接等操作需要网络。本地运行不依赖已发布的线上站点，也不需要为阅读配置 API Key。

本地 `npm run dev` 使用 Node 运行时，不加载 Cloudflare Worker 模拟器；`npm run build` 仍保留 Sites/Cloudflare 发布构建。开发监听排除 `.wrangler`、`dist`、日志、TypeScript 构建缓存和批量诗词数据，防止生成文件引起重载循环；更新数据后刷新页面即可读取。若旧预览出现 `als-registry.js` / `Maximum call stack size exceeded`，停止旧服务后重新运行 `start-local.cmd`，再刷新浏览器。端口固定为 3000，已占用时明确报错，不自动改到其他端口。

`https://…chatgpt.site/` 是与 GitHub 仓库分离的站点副本，其访问权限由 Sites 单独管理；本地入口不需要登录。

### 地图与诗词

全国视野选择省份，查看 5A 优先的景点名录；放大地图逐步出现更多 4A 景点，临近点聚合、标签避让。6 倍以上高亮跟随鼠标，选中省份整体抬升，地形与省界遵循深度遮挡。滚轮连续缩放，左键拖动平移，缩小退出高亮时保持当前比例尺。

点击景点标签或名录进入月夜荷塘。每一篇正式关联诗文对应一盏点亮的莲花灯；不足50篇时补足熄灭的装饰灯，作品本身不重复、不截断。左键拖动水面，按住滚轮旋转，滚轮连续缩放；点击点亮的莲灯后镜头靠近、周围灯自动散开，花瓣逐层展开，标题、作者和朝代显示在花心，全文以水中倒影呈现并可独立滚动。

场景包含明月、繁星、远山、月影、星影、荷叶和游鱼。游鱼产生的波纹会轻推附近莲灯，同时保留灯体碰撞间距；选中的阅读灯保持稳定。暂停荷塘动画会一并暂停水波、鱼群、荷叶、灯体漂移和火焰摇曳，系统减少动态偏好同样有效。

右侧目录每页12篇，可按题名、作者或朝代查找，并在全部、古诗和文言散文之间筛选。点击目录作品与直接点击莲灯进入同一阅读状态；正文、语料出处、正式关系批次、核验理由和地理证据按需加载，失败时可以重试。

## 数据结构与维护

网页资产位于 `public/data/poetry`：

- `attractions.index.json.gz`：全国景点、分省编码、评级出处、关系数、已有点位。
- `manifest.json.gz`：覆盖范围、关系统计和原始正文分片 SHA-256。
- `places/{scenicId}.json.gz`：单景点正式关系、文体与核验依据；无全站全文预加载。
- `poems/{00..ff}.json.gz`：仅正式关系引用的去重文本分片，保留正文、文体、出处及许可字段。
- `CATALOG.md`、`DATABASE.md`、`LICENSE.txt`：原始名录、数据库说明和 MIT 许可。DATABASE.md 描述的是源数据库，其 relations/search 目录不属于网页资产布局。

在项目根目录上级保留原数据库、筛选名录与 `work/scenic-research/filtered.json`，执行：

```sh
node --experimental-strip-types scripts/geocode-national-poetry.mjs
npm run data:import
```

第一步仅维护坐标时需要，读取本地忽略文件 `.env.local` 中的 `AMAP_WEB_SERVICE_KEY`。官方查询缓存与待核验列表写入 `web/work/national-geocoding`，便于断点继续，不发布 API 密钥或查询缓存。第二步只读导入最新数据库的正式关系，不删改源数据库的诗词与关系，并严格校验3,100条关系、3,093篇去重文本和206个景区。

为满足 Sites 256 MiB 解包体积上限，全部诗词 JSON 以 gzip 分片发布，浏览器使用标准 DecompressionStream 按需解压；解压后字节与源数据库逐分片核验。需要支持此标准的现代浏览器（Chrome/Edge、Firefox、Safari 新版）。网页 JSON 缓存最多 16 个资源，地形缓存最多 6 省；退场标签释放，隐藏场景暂停帧循环。地图采用艺术化垂直夸张，非等比例测绘模型；Natural Earth 河湖为概化数据。

## 开发与验证

Node >= 22.13，React、TypeScript、Three.js、React Three Fiber、vinext 和 Sites。

```sh
npm ci
npm run dev
```

发布前执行 `npm run test:map`、`npx tsc --noEmit --incremental false`、`npm run build`。测试逐项核对源数据库全部景点、关系和正文，验证坐标归属、正文懒加载及重试、星河标签避让、地图聚合和 DEM 地形。源数据库不随 GitHub 仓库重复发布；全量数据一致性测试需使用此工作区的上级源数据库。

GitHub 仓库公开发布，源码不含本地密钥；Sites 站点权限独立配置。完整评级来源逐景点保留；[诗词语料](https://github.com/Werneror/Poetry) 采用 MIT 许可，[兰亭集序](https://www.guwendao.net/shiwenv_af279f0cdd95.aspx) 保留古典原文来源。
