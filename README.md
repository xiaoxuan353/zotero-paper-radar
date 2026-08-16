# Paper Radar（论文雷达）

Zotero 插件：定时抓取期刊 RSS 订阅源，用大模型（OpenAI 兼容接口）评估论文与研究方向的相关度，把高/中相关论文自动存入 Zotero，并附「AI 研判解读」子笔记。

基于 [zotero-plugin-template](https://github.com/windingwind/zotero-plugin-template) 开发，支持 Zotero 7 / 8 / 9。

## 功能

- 工具菜单 `论文雷达 → 立即抓取评估` 手动触发，也可启用自动定时运行
- 14 个默认期刊订阅源（万方 / ASCE / Elsevier / Taylor & Francis），可在设置中增删
- 相关度分级（高/中/低），仅高、中相关入库；低相关本地记录跳过
- 自动通过 Crossref 补全 DOI、期刊、卷期、页码
- 标签：`AI精选`、研究方向标签、`相关度：高/中`
- 本地去重（profile 目录 JSON，保留 90 天）+ 本地文献库查重
- 失败自动重试语义：评估失败的论文下次运行自动重试

## 开发

```bash
npm install
npm start    # 启动带热重载的 Zotero 开发实例（需先配置 .env，见 .env.example）
npm run build  # 构建 xpi + TypeScript 类型检查
```

修改 `package.json` 的 `config` 块（addonName / addonID / addonRef / addonInstance / prefsPrefix）即插件身份，勿在发布后变更 addonID。

## 许可

AGPL-3.0-or-later（继承自模板）
