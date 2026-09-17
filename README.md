# Paper Radar（论文雷达）

> Zotero 插件：自动盯梢期刊更新，AI 帮你筛论文，高相关的直接进文献库。支持 Zotero 7 / 8 / 9。

<p align="center">
  <img src="doc/settings-top.png" width="49%" alt="设置面板（上半）" />
  <img src="doc/settings-bottom.png" width="49%" alt="设置面板（下半）" />
</p>

## 功能

把「手动翻期刊找论文」变成一条自动流水线：

1. **抓取**：监控期刊 RSS，并按 ISSN 从 Crossref 扫描（覆盖没有 RSS 的期刊，提前拿到在线抢先版）；
2. **评估**：调用大模型按你的研究方向研判相关度（高/中/低），并生成 2 句中文解读；
3. **入库**：高、中相关自动存入 Zotero 分类，带 DOI、作者、卷期页码等元数据、`相关度：高/中` 标签，以及一条「AI 研判解读」子笔记；
4. **去重**：两类来源按 DOI 合并去重；低相关仅本地记录，不重复评估、不重复入库。

大模型支持任意 OpenAI 兼容接口（火山方舟 / DeepSeek / 硅基流动 / 本地 Ollama）。

## 安装

1. 从 [Releases](https://github.com/xiaoxuan353/zotero-paper-radar/releases) 下载 `paper-radar.xpi`；
2. Zotero 菜单 `工具 → 插件`，点右上角齿轮，选 **Install Plugin From File…**，选中该 xpi；
3. 重启 Zotero。

<details>
<summary>从源码构建（开发者）</summary>

```bash
git clone https://github.com/xiaoxuan353/zotero-paper-radar.git
cd zotero-paper-radar
npm install
npm run build
# 产物：.scaffold/build/paper-radar.xpi
```

</details>

## 配置

打开 Zotero 设置，左侧最下方 **「论文雷达 Paper Radar」**：

1. **大模型**：填 API Key、接口地址、模型名，点「测试连接」看到 ✅ 即通。接口地址填 `/chat/completions` 之前的 Base URL 即可：

   | 平台        | 接口地址                                          | 模型示例            |
   | ----------- | ------------------------------------------------- | ------------------- |
   | 火山方舟    | `https://ark.cn-beijing.volces.com/api/coding/v3` | `deepseek-v4-flash` |
   | DeepSeek    | `https://api.deepseek.com/v1`                     | `deepseek-chat`     |
   | 本地 Ollama | `http://localhost:11434/v1`                       | `qwen3:8b`          |

2. **研究方向**：描述你的领域，点「AI 生成评估要求」自动生成高/中/低判定标准（第 1 条格式规则勿改）；
3. **数据源**：至少配置一种，见下方 [数据源](#数据源)；
4. **抓取 / 入库**：时间窗口（默认 9 天）、评估并发数、目标分类名、研究方向标签；
5. **自动运行**（可选）：勾选并设定间隔小时数（默认 168 = 7 天）。

配置好后点「立即抓取评估」，或用菜单 `工具 → 论文雷达 → 立即抓取评估`。

## 数据源

<a id="rss"></a>

### RSS 订阅源

期刊官网或数据库提供的「新文章自动通知」链接（RSS / Atom 格式），**每行填一个 URL**。

默认内置 18 个，覆盖土木/桥梁方向的中文刊（走万方）与英文刊（Elsevier / ASCE / T&F）。

要添加自己的期刊，到期刊官网或数据库找到 **RSS / 订阅** 图标，复制链接粘贴即可：

- 万方：`https://apps.wanfangdata.com.cn/perios/rss/<期刊代码>`
- Elsevier：`https://rss.sciencedirect.com/publication/science/<ISSN 去掉横线>`
- ASCE、Taylor & Francis：期刊页面上的 RSS 图标

> 中文期刊请用万方 RSS（更新更稳、格式统一）。

<a id="crossref"></a>

### Crossref 期刊扫描

按期刊 **ISSN** 从 [Crossref](https://www.crossref.org) 拉取最新论文。它的价值在于**不依赖期刊有没有 RSS**，并且能提前抓到在线抢先版（Ahead-of-Print）文章。

默认内置 18 本国外刊。要添加期刊，在列表里加一行 `ISSN|刊名`（刊名仅用于显示，可填中文）：

```
1545-2263|结构监测与健康维护
```

填好后点设置里的 **「测试所有期刊是否有效」** 校验 ISSN：

- ✅ 全部有效 → 绿色提示；
- ❌ 有无效的 → 红字列出具体刊名，`404` 表示 ISSN 有误，`429` 只是请求限流、稍后再点一次即可。

> Crossref 基本不收录中文期刊，中文刊请用万方 RSS。

## 说明

- **去重**：RSS 与 Crossref 结果按 DOI 合并，同一篇只评估、只入库一次。
- **入库判断**：仅高、中相关写入 Zotero；低相关本地记录后跳过。
- **自动重试**：大模型限流、Crossref 网络抖动均会自动退避重试，单刊失败不影响其他刊。
- **时间窗口**：只处理最近 N 天的新文章，Crossref 由服务端按日期过滤，窗口调大也不会漏抓。

## 开发

基于 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template)（TypeScript + esbuild + zotero-plugin-scaffold）。

```
src/modules/
  rss.ts        RSS/Atom 抓取解析        crossref.ts  Crossref 扫描与元数据补全
  llm.ts        大模型评估              pipeline.ts  抓取→去重→评估→入库主流程
  writer.ts     写入 Zotero 条目与笔记   scheduler.ts 自动运行调度
  dedup.ts      已处理记录持久化        prefsPane.ts 设置面板逻辑
```

## 许可

AGPL-3.0-or-later（继承自 zotero-plugin-template）
