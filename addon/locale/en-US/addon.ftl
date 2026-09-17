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
progress-running = A fetch task is already running, please wait
