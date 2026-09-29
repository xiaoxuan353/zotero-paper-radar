startup-begin = Paper Radar is loading
startup-finish = Paper Radar is ready
prefs-title = Paper Radar
menu-tools-radar = Paper Radar
menu-tools-runnow = Fetch & Evaluate Now
menu-tools-openprefs = Settings…

# Dynamic (JS getString) strings. These must live here because getString()
# resolves against the addon.ftl bundle, not the preference-pane ftl.
pref-llm-test-waiting = Testing…
pref-llm-test-ok = ✅ Connected
pref-llm-test-fail = ❌ Failed
pref-research-generate-waiting = Generating…
pref-research-generate-ok = ✅ Generated and filled in above
pref-research-generate-fail = ❌ Generation failed. Check the API settings or retry later.
pref-research-generate-needdir = Please fill in the research direction first
pref-crossref-test-empty = No journals entered yet. Please fill the Crossref list first.
pref-crossref-test-waiting = Checking journals, please wait…
pref-crossref-test-ok = ✅ All { $ok } journals valid
pref-crossref-test-fail = ❌ { $count } invalid: { $names }

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
progress-batch-done = Batch evaluation complete! Processed { $done } (High { $high } / Mid { $mid } / Low { $low }), skipped { $skipped }
progress-batch-all-evaluated = All { $count } selected items have already been evaluated (Hold Shift to force re-evaluation)
progress-batch-no-items = No regular items found to evaluate

menu-import-filter = Import & AI Filter File (.ris / .enw / .bib)…
menu-collection-import-filter = Import & AI Filter into Collection…
filepicker-title = Select Bibliographic File (.ris / .enw / .bib)
progress-import-filter-start = Performing in-memory AI screening on { $total } items from file…
progress-import-filter-evaluating = Screening ({ $done }/{ $total }): { $title }
progress-import-filter-done = In-memory screening done! Saved { $saved } items (High { $high } / Mid { $mid }), discarded { $discarded } irrelevant items. Zero library pollution!
progress-import-filter-nofile = No file selected
progress-import-filter-empty = File is empty or no valid bibliographic records found
