# Paper Radar（论文雷达）

> Zotero 插件：自动盯梢期刊更新，AI 帮你筛论文，高相关的直接进文献库。支持 Zotero 7 / 8 / 9。

<p align="center">
  <img src="doc/settings-top.png" width="49%" alt="设置面板（上半）" />
  <img src="doc/settings-bottom.png" width="49%" alt="设置面板（下半）" />
</p>

## 这是什么

Paper Radar 把"每周手动翻期刊找论文"变成一条全自动流水线：

1. **抓取**：并发监控你订阅的期刊 RSS，并按 ISSN 从 Crossref 扫描期刊最新文章（两者互补，可同时启用，可自由增删）；
2. **评估**：逐篇调用大模型，按你的研究方向研判相关度（高/中/低），并生成 2 句中文解读；
3. **入库**：高、中相关论文自动存入 Zotero 专属分类，带完整元数据（Crossref 补全 DOI、作者、期刊、卷期、页码）、`相关度：高/中` 标签，以及一条**「AI 研判解读」子笔记**；
4. **去重**：两类来源按 DOI 合并去重；低相关论文本地记录跳过，不占文献库；已处理的论文永不重复评估、重复入库。

```
期刊 RSS  ──┐
            ├──▶ 时间过滤 + DOI 去重 ──▶ 大模型评估 ──▶ 高/中相关入库（标签 + AI 笔记）
Crossref ──┘                                          └─▶ Zotero 账号同步自动上传云端
（按 ISSN）
```

**主要特性**：

- 🔌 任意 OpenAI 兼容接口：火山方舟 / DeepSeek / 硅基流动 / 本地 Ollama 均可
- 📡 双数据源：RSS 订阅 + Crossref 按 ISSN 扫描，互补覆盖中英文期刊
- ⏰ 自动运行：可设定抓取间隔（默认 7 天），后台按周期自动跑
- ✍️ 研究方向自由填写，评估提示词可一键「AI 生成」
- 🧪 内置自检：「测试连接」验证大模型、「测试所有期刊是否有效」校验 Crossref 的 ISSN
- 🧹 跨来源 DOI 去重、时间窗口过滤，不重复评估、不重复入库

## 安装

1. 从 [Releases](https://github.com/xiaoxuan353/zotero-paper-radar/releases) 下载最新的 `paper-radar.xpi`；
2. Zotero 菜单 `工具 → 插件`，点右上角齿轮，选 **Install Plugin From File…**，选中下载的 xpi；
3. 按提示重启 Zotero 即可。

<details>
<summary>从源码构建（开发者）</summary>

```bash
git clone https://github.com/xiaoxuan353/zotero-paper-radar.git
cd zotero-paper-radar
npm install
npm run build
# 产物位于 .scaffold/build/paper-radar.xpi
# 开发调试：复制 .env.example 为 .env 并填入 Zotero 路径后 npm start（热重载）
```

</details>

## 使用

### 首次配置（约 2 分钟）

打开 Zotero 设置，左侧最下方找到 **「论文雷达 Paper Radar」** 面板（见上方截图）：

1. **大模型（OpenAI 兼容接口）**：填写 API Key、接口地址和模型名，点 **「测试连接」**，看到 ✅ 即通。接口地址填 `/chat/completions` 之前的 Base URL 即可，程序自动补全：
   | 平台 | 接口地址（Base URL） | 模型示例 |
   |---|---|---|
   | 火山方舟 Coding Plan | `https://ark.cn-beijing.volces.com/api/coding/v3` | `deepseek-v4-flash` |
   | 火山方舟 按量付费 | `https://ark.cn-beijing.volces.com/api/v3` | 接入点 `ep-…` |
   | DeepSeek 官方 | `https://api.deepseek.com/v1` | `deepseek-chat` |
   | 本地 Ollama | `http://localhost:11434/v1` | `qwen3:8b` 等 |
2. **研究方向**：自由描述你的研究领域与关注点（出厂默认为桥梁承载能力评估方向，换成你自己的）；
3. 点 **「AI 生成评估要求」**：调用你的大模型，自动生成与研究方向匹配的高/中/低分档判定标准（也可手工修改，但第 1 条输出格式规则为程序解析所需，勿动）；
4. **期刊来源**：配置 RSS 订阅源和 Crossref 期刊扫描，两者可同时启用，至少配一种。详见下方 [RSS 订阅源](#rss) 与 [Crossref 期刊扫描](#crossref)；
5. **抓取与入库设置**：抓取时间窗口（默认 9 天）、评估并发数（1~10）、目标分类名称、研究方向标签；
6. **自动运行**（可选）：勾选「启用自动抓取评估」并设定间隔小时数（默认 168 小时 = 7 天）。

配置完成后，点面板底部的 **「立即抓取评估」**（或菜单 `工具 → 论文雷达 → 立即抓取评估`）即可跑一次，进度与结果会以弹窗提示。

### RSS 订阅源

<a id="rss"></a>

RSS / Atom 是期刊官网或数据库提供的「新文章自动通知」链接，**每行填一个 URL**。默认内置 18 个订阅源（覆盖土木/桥梁方向，中文刊走万方）：

| 期刊                                            | 订阅 URL                                                               |
| ----------------------------------------------- | ---------------------------------------------------------------------- |
| 工程力学（万方）                                | `https://apps.wanfangdata.com.cn/perios/rss/gclx`                      |
| 公路交通科技（万方）                            | `https://apps.wanfangdata.com.cn/perios/rss/gljtkj`                    |
| 国外桥梁（万方）                                | `https://apps.wanfangdata.com.cn/perios/rss/gwql`                      |
| 土木工程学报（万方）                            | `https://apps.wanfangdata.com.cn/perios/rss/tmgcxb`                    |
| 振动与冲击（万方）                              | `https://apps.wanfangdata.com.cn/perios/rss/zdycj`                     |
| 中国公路学报（万方）                            | `https://apps.wanfangdata.com.cn/perios/rss/zgglxb`                    |
| 中国铁道科学（万方）                            | `https://apps.wanfangdata.com.cn/perios/rss/zgtdkx`                    |
| 铁道学报（万方）                                | `https://apps.wanfangdata.com.cn/perios/rss/tdxb`                      |
| 振动工程学报（万方）                            | `https://apps.wanfangdata.com.cn/perios/rss/zdgcxb`                    |
| 建筑结构学报（万方）                            | `https://apps.wanfangdata.com.cn/perios/rss/jzjgxb`                    |
| 中国公路学报（官网）                            | `https://zgglxb.chd.edu.cn/CN/rss_zxly.xml`                            |
| J. Bridge Engineering（ASCE）                   | `https://ascelibrary.org/action/showFeed?type=etoc&feed=rss&jc=jbenf2` |
| J. Structural Engineering（ASCE）               | `https://ascelibrary.org/action/showFeed?type=etoc&feed=rss&jc=jsendh` |
| Engineering Structures（Elsevier）              | `https://rss.sciencedirect.com/publication/science/01410296`           |
| Structures（Elsevier）                          | `https://rss.sciencedirect.com/publication/science/23520124`           |
| Thin-Walled Structures（Elsevier）              | `https://rss.sciencedirect.com/publication/science/02638231`           |
| J. Sound and Vibration（Elsevier）              | `https://rss.sciencedirect.com/publication/science/0022460X`           |
| Structure and Infrastructure Engineering（T&F） | `https://www.tandfonline.com/feed/rss/nsie20`                          |

新增其他期刊：万方期刊主页的 RSS 链接替换期刊代码即可；Elsevier 把期刊 ISSN 去掉横线拼入 `https://rss.sciencedirect.com/publication/science/<ISSN>`；ASCE / T&F 在期刊页面找 RSS 图标复制链接。

> 中文期刊建议用万方 RSS（更新更及时、格式更统一）。若某刊根本不提供 RSS，请改用下方的 Crossref 期刊扫描来覆盖。

### Crossref 期刊扫描

<a id="crossref"></a>

Crossref 是一个开放的学术论文元数据数据库，收录了几乎所有国际期刊的文献信息，**不依赖期刊是否提供 RSS**。启用后，插件会按期刊的 **ISSN** 从 Crossref 拉取该刊最新文章，作用有两个：

- **兜底没有 RSS 的期刊**：有些期刊不公开 RSS（如 _Structural Control and Health Monitoring_），仍能被 Crossref 扫到；
- **抢先版更早到手**：很多文章先在线出版（Ahead-of-Print），稍后才进 RSS——Crossref 能提前抓到，并直接给出作者、卷期、页码等元数据。

默认内置 18 本土木/桥梁方向的国外刊。要添加期刊，在列表里加一行 `ISSN|刊名`（刊名仅用于显示，可填中文）：

```
1545-2263|结构监测与健康维护
```

设置区还有三个相关项：

- **启用 Crossref 按 ISSN 扫描**：不想用时取消勾选，只跑 RSS；
- **每刊返回条数上限**（默认 200）：安全上限，真正的「近 N 天」过滤由 Crossref 服务端按日期完成，所以窗口调大也不会漏抓；
- **测试所有期刊是否有效**：一键校验列表里每个 ISSN 是否有效，无效的会红字列出具体刊名（`404` 表示 ISSN 有误，`429` 只是请求限流、稍后再点一次即可）。

> Crossref 基本不收录中文期刊（测试会显示 404），中文刊请继续用上方万方 RSS。

## 开发

基于 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 构建（TypeScript + esbuild + zotero-plugin-scaffold）。

```
src/modules/
  config.ts     读取偏好设置
  rss.ts        RSS/Atom 抓取与解析
  crossref.ts   Crossref 按 ISSN 扫描、元数据补全
  llm.ts        大模型评估与连接测试
  pipeline.ts   抓取 → 去重 → 评估 → 入库 主流程
  writer.ts     写入 Zotero 条目与笔记
  dedup.ts      已处理记录持久化
  scheduler.ts  自动运行调度
  prefsPane.ts  设置面板逻辑
```

## 许可

AGPL-3.0-or-later（继承自 zotero-plugin-template）
