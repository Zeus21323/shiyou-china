# 古诗词—景点静态数据库

本目录由 `work/build-poetry-attractions.py` 从 `Werneror/Poetry` 和项目景区名录生成。当前构建只纳入先秦至清及其历史过渡朝代文件，明确排除文件名含“近现代／民国／当代”的现代诗记录。它采用与诗云相同的“轻量索引 + 正文分片 + 按需读取”思路，但关系入口改为景点：

```text
attractions.index.json        有诗词关联的景点索引
relations/{place-id}.json     一个景点的关联边（按景点懒加载）
poems/{00..ff}.json            诗文正文，按诗 ID 的末两位分片
search/{0..f}.json             标题、作者、朝代轻量搜索索引
manifest.json                  版本、规模和筛选规则
query.py                       本地检索/核验 CLI
```

每条关联边是紧凑数组：

```text
[poemId, matchedAnchor, score, relationType, status, titleOrBody]
```

`relationType` 分为 `direct`（景区正式名称命中）、`historical-alias`（人工维护的历史别名）、`name-stem`（去掉景区通用后缀的名称）和 `regional-context`（现代城市或古代地名线索）。前两类是优先核验对象；后两类保留为 `candidate-low`，不能直接当作已考证的景点题咏。当前规模和各类数量以 `manifest.json` 为准，候选诗词已达到十万量级，但区域线索仍需要后续证据化复核。

正文中的 `source` 记录上游文件和 CSV 行号，便于回溯。景区名录中没有任何候选关联的景区不会写入 `attractions.index.json`，满足“无诗词匹配则删除该景点”的要求；原始名录仍保留在项目根目录用于追溯。

当前生成结果见 `manifest.json`。数据量较大，网站发布时应把 `attractions.index.json` 作为首屏资源，点击景点后读取对应 `relations/{place-id}.json`，最后按 poem ID 请求一个 `poems/{bucket}.json` 分片；标题、作者和朝代检索只读取 `search/` 轻量索引。生产服务器支持 HTTP Range 后，可以再为 poem 分片生成字节偏移 sidecar；首版无需数据库服务。

本次构建结果为 124,385 首候选古诗词、2,388 个有候选关系的景区和 1,649,973 条关系边。关系边中 `candidate` 65,530 条，`candidate-low` 1,584,443 条；后者是现代城市或古代地域线索，应在编辑审核阶段进一步确认。
