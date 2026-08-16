# Paper Radar（论文雷达）

> Zotero 插件：自动盯梢期刊更新，AI 帮你筛论文，高相关的直接进文献库。支持 Zotero 7 / 8 / 9。

![设置面板](doc/settings.png)

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
- 🧪 内置「测试连接」按钮，配置是否可用即刻验证
- ⏱ 支持菜单手动触发与定时自动运行
- 🔒 API Key 只存本机，分享插件、上传仓库都不含密钥
- 🚫 无需 Zotero API Key：插件在 Zotero 内部直接写本地文献库，云同步由 Zotero 自带机制完成

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
4. **RSS 订阅源**：每行一个 URL，按需增删。

### 日常运行

- **手动**：菜单 `工具 → 论文雷达 → 立即抓取评估`。进度窗口实时显示评估进度，结束汇总"评估 N 篇，入库 X 篇（高 a / 中 b）"；
- **自动**：设置面板勾选「启用自动抓取评估」并设间隔小时数（默认 168 = 每周），Zotero 运行期间到点自动执行；
- **看结果**：左侧文献库出现 `AI精选前沿论文` 分类；点 `相关度：高` 标签可快速筛出最值得精读的论文；每篇论文下挂有「AI 研判解读」子笔记，浏览时先看笔记再决定是否精读。

### 使用建议

- 每周至少运行一次；抓取窗口建议设为 **14 天**（默认 9）——RSS 是"最新 N 条"的滑动窗口，更大的窗口配合本地去重可以避免高产出刊和目录型时间戳造成的边缘漏抓，几乎没有额外代价；
- 评估失败的论文下次运行会自动重试，中途关闭 Zotero 无副作用；
- 国外源（ASCE / Elsevier / T&F）如频繁失败，在 Zotero 首选项中配置代理后由插件自动复用。

## 常见问题

**Q: 分享插件会泄露我的 API Key 吗？**
不会。Key 只存于你本机 Zotero 配置目录，插件文件（xpi）与仓库源码中均不含密钥。

**Q: 为什么不需要 Zotero 的 User ID / API Key？**
插件运行在 Zotero 内部，直接调用程序接口写本地文献库；上传云端由 Zotero 自带的账号同步完成，与手动添加文献的路径完全一致。

**Q: 中文期刊支持如何？**
万方源正常抓取评估；Crossref 元数据补全对中文期刊有限，标题、摘要、链接正常入库。

**Q: 可以离线用吗？**
入库可以（本地写库），抓取与评估需要网络。

## 开发

基于 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 构建（TypeScript + esbuild + zotero-plugin-scaffold）。

```bash
npm run build       # 打包 xpi + 类型检查
npm run lint:fix    # 格式化与 lint 修复
npm start           # 热重载开发实例（需先配置 .env）
```

## 许可

AGPL-3.0-or-later（继承自 zotero-plugin-template）
