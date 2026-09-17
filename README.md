# Paper Radar（论文雷达）

> Zotero 插件：自动盯梢期刊更新，AI 帮你筛论文，高相关的直接进文献库。支持 Zotero 7 / 8 / 9。

<p align="center">
  <img src="doc/settings-top.png" width="49%" alt="设置面板（上半）" />
  <img src="doc/settings-bottom.png" width="49%" alt="设置面板（下半）" />
</p>

## 这是什么

Paper Radar 把"每周手动翻期刊找论文"变成一条全自动流水线：

1. **抓取**：并发监控你订阅的期刊 RSS（默认内置 14 个土木/桥梁期刊，覆盖万方、ASCE、Elsevier、Taylor & Francis，可自由增删）；
2. **评估**：逐篇调用大模型，按你的研究方向研判相关度（高/中/低），并生成 2 句中文解读；
3. **入库**：高、中相关论文自动存入 Zotero 专属分类，带完整元数据（Crossref 补全 DOI、期刊、卷期、页码）、`相关度：高/中` 标签，以及一条**「AI 研判解读」子笔记**；
4. **去重**：低相关论文本地记录跳过，不占文献库；已处理的论文永不重复评估、重复入库。

```
期刊 RSS ──▶ 时间过滤 + 去重 ──▶ 大模型评估 ──▶ 高/中相关入库（标签 + AI 笔记）
                                              └─▶ Zotero 账号同步自动上传云端
```

**主要特性**：

- 🔌 任意 OpenAI 兼容接口：火山方舟 / DeepSeek / 硅基流动 / 本地 Ollama 均可
- ✍️ 研究方向自由填写，评估提示词可一键「AI 生成」

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
4. **RSS 订阅源**：每行一个 URL，按需增删。默认内置 14 个订阅源：

   | 期刊                                            | 订阅 URL                                                               |
   | ----------------------------------------------- | ---------------------------------------------------------------------- |
   | 工程力学（万方）                                | `https://apps.wanfangdata.com.cn/perios/rss/gclx`                      |
   | 公路交通科技（万方）                            | `https://apps.wanfangdata.com.cn/perios/rss/gljtkj`                    |
   | 国外桥梁（万方）                                | `https://apps.wanfangdata.com.cn/perios/rss/gwql`                      |
   | 土木工程学报（万方）                            | `https://apps.wanfangdata.com.cn/perios/rss/tmgcxb`                    |
   | 振动与冲击（万方）                              | `https://apps.wanfangdata.com.cn/perios/rss/zdycj`                     |
   | 中国公路学报（万方）                            | `https://apps.wanfangdata.com.cn/perios/rss/zgglxb`                    |
   | 中国铁道科学（万方）                            | `https://apps.wanfangdata.com.cn/perios/rss/zgtdkx`                    |
   | J. Bridge Engineering（ASCE）                   | `https://ascelibrary.org/action/showFeed?type=etoc&feed=rss&jc=jbenf2` |
   | J. Structural Engineering（ASCE）               | `https://ascelibrary.org/action/showFeed?type=etoc&feed=rss&jc=jsendh` |
   | Engineering Structures（Elsevier）              | `https://rss.sciencedirect.com/publication/science/01410296`           |
   | Structures（Elsevier）                          | `https://rss.sciencedirect.com/publication/science/23520124`           |
   | Thin-Walled Structures（Elsevier）              | `https://rss.sciencedirect.com/publication/science/02638231`           |
   | J. Sound and Vibration（Elsevier）              | `https://rss.sciencedirect.com/publication/science/0022460X`           |
   | Structure and Infrastructure Engineering（T&F） | `https://www.tandfonline.com/feed/rss/nsie20`                          |

   新增其他期刊：万方期刊主页的 RSS 链接替换期刊代码即可；Elsevier 把期刊 ISSN 去掉横线拼入 `https://rss.sciencedirect.com/publication/science/<ISSN>`；ASCE / T&F 在期刊页面找 RSS 图标复制链接。

## 常见问题

<a id="rss"></a>

### 什么是 RSS 订阅源？如何添加期刊？

**什么是 RSS 订阅源？**

RSS（Really Simple Syndication）/ Atom 是期刊官网或数据库提供的「新文章自动通知」链接。只要期刊更新了最新论文，这个链接就会自动列出最新的条目。Paper Radar 的「RSS 订阅源」就是你告诉程序「盯哪些期刊」的清单——每个网址代表一个要持续监控的期刊。

**本插件默认内置这些订阅源**（覆盖土木/桥梁方向，含中文刊与英文刊）：

| 期刊 | 订阅 URL |
|---|---|
| 工程力学（万方） | `https://apps.wanfangdata.com.cn/perios/rss/gclx` |
| 公路交通科技（万方） | `https://apps.wanfangdata.com.cn/perios/rss/gljtkj` |
| 国外桥梁（万方） | `https://apps.wanfangdata.com.cn/perios/rss/gwql` |
| 土木工程学报（万方） | `https://apps.wanfangdata.com.cn/perios/rss/tmgcxb` |
| 振动与冲击（万方） | `https://apps.wanfangdata.com.cn/perios/rss/zdycj` |
| 中国公路学报（万方） | `https://apps.wanfangdata.com.cn/perios/rss/zgglxb` |
| 中国铁道科学（万方） | `https://apps.wanfangdata.com.cn/perios/rss/zgtdkx` |
| 铁道学报（万方） | `https://apps.wanfangdata.com.cn/perios/rss/tdxb` |
| 振动工程学报（万方） | `https://apps.wanfangdata.com.cn/perios/rss/zdgcxb` |
| 建筑结构学报（万方） | `https://apps.wanfangdata.com.cn/perios/rss/jzjgxb` |
| 中国公路学报（官网） | `https://zgglxb.chd.edu.cn/CN/rss_zxly.xml` |
| J. Bridge Engineering（ASCE） | `https://ascelibrary.org/action/showFeed?type=etoc&feed=rss&jc=jbenf2` |
| J. Structural Engineering（ASCE） | `https://ascelibrary.org/action/showFeed?type=etoc&feed=rss&jc=jsendh` |
| Engineering Structures（Elsevier） | `https://rss.sciencedirect.com/publication/science/01410296` |
| Structures（Elsevier） | `https://rss.sciencedirect.com/publication/science/23520124` |
| Thin-Walled Structures（Elsevier） | `https://rss.sciencedirect.com/publication/science/02638231` |
| J. Sound and Vibration（Elsevier） | `https://rss.sciencedirect.com/publication/science/0022460X` |
| Structure and Infrastructure Engineering（T&F） | `https://www.tandfonline.com/feed/rss/nsie20` |

**如何添加你自己的期刊？**

1. 到目标期刊官网或数据库（万方、ScienceDirect、ASCE、Taylor & Francis 等），找到 **RSS / Atom / Feed / 订阅** 图标或按钮，右键复制链接；
2. 把复制到的 `http(s)://` 开头地址粘贴到插件设置 → **RSS 订阅源** 输入框，每行一个 URL；
3. 保存即可，下次「立即抓取评估」就会监控新加入的期刊。

提示：中文期刊优先用万方 RSS（示例见上表，替换期刊代码即可）；若某刊不提供 RSS，可改用下文的 **Crossref 期刊扫描** 来覆盖。

<a id="crossref"></a>

### 什么是 Crossref 期刊扫描？如何添加期刊？

**什么是 Crossref？**

[Crossref](https://www.crossref.org) 是一个开放的学术论文元数据数据库，收录了几乎所有国际期刊的文献信息（标题、作者、DOI、期刊、出版日期等），**不依赖期刊是否提供 RSS**。Paper Radar 的「Crossref 期刊扫描」就是按期刊的 **ISSN** 去 Crossref 定时拉取该刊最新文章。

**它有什么用？**

- **兜底无 RSS 的期刊**：有些期刊没有公开 RSS，仍然能被 Crossref 用 ISSN 扫到；
- **抢先版更早到手**：很多文章先在线出版（Ahead-of-Print / online-first）、稍后才进 RSS——Crossref 能提前抓到这些文章。

**如何添加期刊？**

1. 查到你目标期刊的 **ISSN**（8 位数字，如 `1545-2263`）——可从期刊官网、Google Scholar 或 [api.crossref.org](https://api.crossref.org) 查到，ISSN 不带连字符；
2. 在插件设置 → **Crossref 期刊列表** 输入框**另起一行**填写 `ISSN|期刊名称`（刊名仅用于显示，可填中文，例如 `1545-2263|工程结构监测与健康维护`）；
3. 保存即可。

**内置默认期刊**：插件已内置 18 本土木/桥梁方向的国外刊（含 SCHM、ASCE 两本、性能设施、J. Constructional Steel Research 等），见插件设置里的列表。

**调试验证**：设置面板上有一个 **「测试所有期刊是否有效」** 按钮，点击后会逐一检查你填写的每个 ISSN 在 Crossref 是否真实存在，无效的会红字标出——建议添加期刊后点一下确认无误。

**注意**：Crossref 主要收录国际期刊；中文期刊大多不在其中（会显示失效），请继续用上方万方 RSS。

## 开发

基于 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 构建（TypeScript + esbuild + zotero-plugin-scaffold）。

## 许可

AGPL-3.0-or-later（继承自 zotero-plugin-template）
