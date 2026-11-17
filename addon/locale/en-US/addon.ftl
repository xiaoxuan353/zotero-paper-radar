startup-begin = Paper Radar is loading
startup-finish = Paper Radar is ready
prefs-title = Paper Radar
menu-tools-radar = Paper Radar
menu-tools-runnow = Fetch & Evaluate Now
menu-tools-openprefs = Settings…

# Dynamic (JS getString) strings. These must live here because getString()
# resolves against the addon.ftl bundle, not the preference-pane ftl.
pref-llm-summary-badge = (Active: { $name } · Click to { $action })
pref-llm-action-expand = expand
pref-llm-action-collapse = collapse
pref-llm-profile-new-default-name = New Model
pref-llm-profile-delete-last-warn = You must keep at least one model configuration.
pref-llm-profile-delete-confirm = Are you sure you want to delete model "{ $name }"?
pref-feeds-count-badge = ({ $count } feed(s) configured)
pref-crossref-count-badge = ({ $count } journal(s) configured)
pref-feeds-reset-confirm = Are you sure you want to reset to the default 18 RSS feeds? Your current list will be overwritten.
pref-crossref-reset-confirm = Are you sure you want to reset to the default 18 Crossref journals? Your current list will be overwritten.
pref-crossref-test-progress = Checking journals ({ $done }/{ $total })…
pref-llm-test-waiting = ⏳ Testing…
pref-llm-test-ok = ✅ Connected
pref-llm-test-fail = ❌ Failed
pref-research-generate-waiting = Generating…
pref-research-generate-ok = ✅ Generated and filled in above
pref-research-generate-fail = ❌ Generation failed. Check the API settings or retry later.
pref-research-generate-needdir = Please fill in the research direction first
pref-crossref-test-empty = No journals entered yet. Please fill the Crossref list first.
pref-crossref-test-waiting = ⏳ Checking journals, please wait…
pref-crossref-test-ok = ✅ All { $ok } journals valid
pref-crossref-test-fail = ❌ { $count } invalid: { $names }
pref-feeds-test-empty = No feeds entered yet. Please fill the RSS list first.
pref-feeds-test-waiting = ⏳ Checking feeds, please wait…
pref-feeds-test-ok = ✅ All { $ok } feeds are working
pref-feeds-test-fail = ❌ { $count } feed(s) failed: { $names }

progress-fetching = Fetching journal RSS feeds…
progress-crossref = Scanning Crossref journals…
progress-crossref-summary = Crossref scan done: { $ok } OK / { $fail } failed
progress-collect = { $count } new papers found, evaluating…
progress-evaluating = Evaluating ({ $done }/{ $total }): { $title }
progress-done = Done: { $evaluated } evaluated, { $saved } saved (high { $high } / mid { $mid }), { $low } low-relevance skipped
progress-none = No unprocessed new papers in the last { $days } days
progress-nokey = LLM API Key is not configured. Please set it in plugin preferences.
progress-running = A fetch/evaluation task is already running, please wait

menu-item-batch-eval = Paper Radar
menu-collection-batch-eval = Paper Radar
progress-batch-start = Starting batch evaluation of { $total } items (skipping { $skipped } evaluated)…
progress-batch-evaluating = Evaluating ({ $done }/{ $total }): { $title }
progress-batch-done = Batch evaluation complete! Processed { $done } (High { $high } / Mid { $mid } / Low { $low }), skipped { $skipped }, failed { $failed }
progress-batch-all-evaluated = All { $count } selected items have already been evaluated (Hold Shift to force re-evaluation)
progress-batch-no-items = No regular items found to evaluate

menu-import-filter = Import & AI Filter File (.ris / .enw / .bib)…
menu-collection-import-filter = Import & AI Filter into Collection…
filepicker-title = Select Bibliographic File (.ris / .enw / .bib)
progress-import-filter-start = Performing in-memory AI screening on { $total } items from file…
progress-import-filter-evaluating = Screening ({ $done }/{ $total }): { $title }
progress-import-filter-done = In-memory screening done! Saved { $saved } items (High { $high } / Mid { $mid }), discarded { $discarded } irrelevant items, skipped { $duplicate } duplicate(s), failed { $failed }. Zero library pollution!
progress-import-filter-nofile = No file selected
progress-import-filter-empty = File is empty or no valid bibliographic records found
