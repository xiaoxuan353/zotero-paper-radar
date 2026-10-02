startup-begin = 论文雷达加载中
startup-finish = 论文雷达已就绪
prefs-title = 论文雷达 Paper Radar
menu-tools-radar = 论文雷达
menu-tools-runnow = 立即抓取评估
menu-tools-openprefs = 设置…

# Dynamic (JS getString) strings. These must live here because getString()
# resolves against the addon.ftl bundle, not the preference-pane ftl.
pref-llm-test-waiting = 正在测试…
pref-llm-test-ok = ✅ 连接成功
pref-llm-test-fail = ❌ 连接失败
pref-research-generate-waiting = 正在生成…
pref-research-generate-ok = ✅ 已生成并填入上方输入框
pref-research-generate-fail = ❌ 生成失败，请检查接口配置或稍后重试
pref-research-generate-needdir = 请先填写研究方向
pref-crossref-test-empty = 尚未输入任何期刊，请先填写 Crossref 期刊列表
pref-crossref-test-waiting = 正在逐一检查期刊，请稍候…
pref-crossref-test-ok = ✅ { $ok } 个期刊均有效
pref-crossref-test-fail = ❌ { $count } 个期刊无效：{ $names }
pref-feeds-test-empty = 尚未输入任何订阅源，请先填写 RSS 列表
pref-feeds-test-waiting = 正在检测订阅源，请稍候…
pref-feeds-test-ok = ✅ { $ok } 个订阅源均正常
pref-feeds-test-fail = ❌ { $count } 个订阅源异常：{ $names }

progress-fetching = 正在抓取期刊订阅源…
progress-crossref = 正在扫描 Crossref 期刊…
progress-crossref-summary = Crossref 扫描完成：成功 { $ok } / { $fail } 失败
progress-collect = 共 { $count } 篇未处理新论文，开始并发评估…
progress-evaluating = 正在评估（{ $done }/{ $total }）：{ $title }
progress-done = 本轮完成：评估 { $evaluated } 篇，入库 { $saved } 篇（高 { $high } / 中 { $mid }），跳过低相关 { $low } 篇
progress-none = 近 { $days } 天没有发现未处理的新论文
progress-nokey = 尚未配置大模型 API Key，请先在插件设置中填写
progress-running = 已有抓取/评估任务在运行中，请稍候

menu-item-batch-eval = 论文雷达
menu-collection-batch-eval = 论文雷达
progress-batch-start = 开始批量研判 { $total } 篇文献（跳过已研判 { $skipped } 篇）…
progress-batch-evaluating = 正在 AI 研判（{ $done }/{ $total }）：{ $title }
progress-batch-done = 批量研判完成！已处理 { $done } 篇（高 { $high } / 中 { $mid } / 低 { $low }），跳过已研判 { $skipped } 篇
progress-batch-all-evaluated = 所选 { $count } 篇文献均已完成研判（按住 Shift 可强制重新研判）
progress-batch-no-items = 未找到可研判的文献条目

menu-import-filter = 导入并 AI 筛选文件 (.ris / .enw / .bib)…
menu-collection-import-filter = 导入并 AI 筛选到此分类…
filepicker-title = 选择文献数据文件 (.ris / .enw / .bib)
progress-import-filter-start = 正在对文件中的 { $total } 篇文献进行内存 AI 预审…
progress-import-filter-evaluating = 内存预审中（{ $done }/{ $total }）：{ $title }
progress-import-filter-done = 内存预审完成！已精选入库 { $saved } 篇（高 { $high } / 中 { $mid }），直接过滤抛弃 { $discarded } 篇无关文献，文库零污染！
progress-import-filter-nofile = 未选择任何文件
progress-import-filter-empty = 文件为空或未解析到有效文献记录
