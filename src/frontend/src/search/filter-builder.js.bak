/**
 * filter-builder.js — chip/token DSL filter builder
 *
 * Replaces the free-text <input list="dsl-keys"> with a chip-based UI that
 * makes it impossible to produce an invalid DSL string.
 *
 * Usage (called from each page's inline <script> after DOM ready):
 *
 *   const fb = createFilterBuilder({
 *     container:    document.getElementById("fb-container"),
 *     enabledKeys:  ["league","team","date","month","stake","odds","outcome","bettor","prediction","result"],
 *     initialDsl:   getFilterFromUrl(),         // optional
 *     onChange:     (dsl) => { pushFilterToUrl(dsl); fetchAndRender(dsl); },
 *     hiddenInput:  document.getElementById("filter-input"), // kept for backwards compat
 *   });
 *
 * The builder writes the DSL string to `hiddenInput.value` and calls `onChange`
 * every time chips change, so all existing downstream code keeps working.
 *
 * Public API:
 *   fb.getDsl()           → current DSL string
 *   fb.setDsl(str)        → parse & reconstruct chips from a DSL string (e.g. on URL restore)
 *   fb.clear()            → remove all chips
 *
 * TODO v2:
 *   - Negation: "!draw" — a toggle inside the chip value entry to prefix "!"
 *   - Multi-word quoted team values typed freely (currently only enum-selected)
 *   - Quoted string free-text mode for league/team when endpoint is unavailable
 */

// ── Per-key metadata ────────────────────────────────────────────────────────
const KEY_META = {
  league:     { kind: "enum",    label: "League",     color: "var(--chip-league)",     hint: "Filter by competition (e.g. Premier League)"  },
  team:       { kind: "enum",    label: "Team",       color: "var(--chip-team)",       hint: "Filter by home or away team"                  },
  bettor:     { kind: "enum",    label: "Bettor",     color: "var(--chip-bettor)",     hint: "user or ai"                                   },
  outcome:    { kind: "enum",    label: "Outcome",    color: "var(--chip-outcome)",    hint: "Actual game result (home win / draw / away win)" },
  prediction: { kind: "enum",    label: "Prediction", color: "var(--chip-prediction)", hint: "What you bet on (1 / X / 2)"                  },
  result:     { kind: "enum",    label: "Result",     color: "var(--chip-result)",     hint: "Bet outcome: win / loss / 1 / X / 2"          },
  date:       { kind: "date",    label: "Date",       color: "var(--chip-date)",       hint: "Filter by match date (YYYY-MM-DD)"            },
  month:      { kind: "enum",    label: "Month",      color: "var(--chip-month)",      hint: "Filter by YYYY-MM (e.g. 2026-04)"             },
  stake:      { kind: "numeric", label: "Stake",      color: "var(--chip-stake)",      hint: "NIS wagered per bet (e.g. >=100)"             },
  odds:       { kind: "numeric", label: "Odds",       color: "var(--chip-odds)",       hint: "Decimal multiplier (e.g. >=2.5×)"             },
};

// Static fallback values used when the /api/filter/values endpoint is unavailable
const STATIC_FALLBACKS = {
  bettor:     ["user", "ai"],
  outcome:    ["win", "loss"],
  result:     ["1", "X", "2"],
  prediction: ["1", "X", "2"],
};

// Canonical deduplicated display labels for outcome/prediction/result values.
// The API returns many aliases (home, home_win, 1, draw, tie, x, away, away_win, 2).
// We collapse them into ONE human-readable label per actual value, shown in the
// picker dropdown. The chip still stores the backend DSL alias the user selected.
const _ENUM_CANONICAL_LABELS = {
  // outcome/prediction/result share the same backend aliases
  "1":        "Home win (1)",
  "home_win": "Home win (1)",
  "home":     "Home win (1)",
  "x":        "Draw (X)",
  "draw":     "Draw (X)",
  "tie":      "Draw (X)",
  "2":        "Away win (2)",
  "away_win": "Away win (2)",
  "away":     "Away win (2)",
};

// Canonical value to use in the DSL chip when a deduped label is chosen.
// Maps canonical label back to the preferred DSL token.
const _LABEL_TO_DSL = {
  "Home win (1)": "1",
  "Draw (X)":     "x",
  "Away win (2)": "2",
  "win":          "win",
  "loss":         "loss",
};

/**
 * Deduplicate an enum value list by collapsing aliases to their canonical label.
 * Returns a new array with one entry per distinct canonical label.
 * For keys that have an alias map, values are replaced with canonical labels.
 */
function _dedupeEnumValues(key, values) {
  if (!values || !values.length) return values;
  const isGameEnum = (key === "outcome" || key === "prediction" || key === "result");
  if (!isGameEnum) return values;

  const seen = new Set();
  const out = [];
  values.forEach(v => {
    const label = _ENUM_CANONICAL_LABELS[v.toLowerCase()] || v;
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
  });
  return out;
}

// In-memory cache for /api/filter/values responses (keyed by key name)
const _valuesCache = new Map();

// ── Fetch values for a key ───────────────────────────────────────────────────
async function fetchValues(key) {
  if (_valuesCache.has(key)) return _valuesCache.get(key);

  try {
    const resp = await fetch(`/api/filter/values?key=${encodeURIComponent(key)}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    _valuesCache.set(key, data);
    return data;
  } catch (_e) {
    // Endpoint unavailable — return null; callers handle gracefully
    return null;
  }
}

// ── DSL serialiser ───────────────────────────────────────────────────────────
// Converts the internal chip array → DSL string the backend accepts.
// Each chip: { key, kind, value }
//   For enum:    value = string[] (OR list)
//   For numeric: value = { op: ">" | "<" | ">=" | "<=" | "between", a: string, b?: string }
//   For date:    value = { from: string, to: string }  (either may be empty)

function chipToDsl(chip) {
  const { key, kind, value } = chip;
  if (!key) return "";

  if (kind === "enum") {
    if (!value || value.length === 0) return "";
    // Multi-select values joined with comma → key:val1,val2 (OR semantics)
    // Values that contain spaces get quoted; bare words use hyphen-slug form
    const encoded = value.map(v => {
      if (/\s/.test(v)) return `"${v}"`;
      return v.replace(/\s+/g, "-"); // slug form for bare words
    });
    return `${key}:${encoded.join(",")}`;
  }

  if (kind === "numeric") {
    if (!value || !value.op) return "";
    const { op, a, b } = value;
    if (!a) return "";
    if (op === "between") {
      if (!b) return `${key}:>=${a}`;
      return `${key}:${a}-${b}`;
    }
    return `${key}:${op}${a}`;
  }

  if (kind === "date") {
    if (!value) return "";
    const { from, to } = value;
    const parts = [];
    if (from) parts.push(`date:>=${from}`);
    if (to)   parts.push(`date:<=${to}`);
    return parts.join(" ");
  }

  return "";
}

function chipsToDsl(chips) {
  return chips
    .map(chipToDsl)
    .filter(Boolean)
    .join(" ");
}

// ── DSL parser (client-side, mirrors the Python grammar) ────────────────────
// Converts a DSL string back into chips for URL-restore round-trip.
// Produces a best-effort reconstruction — covers all shapes emitted by chipToDsl.
function parseDslToChips(dsl, enabledKeys) {
  if (!dsl || !dsl.trim()) return [];
  const enabled = new Set(enabledKeys);
  const chips = [];
  const remaining = dsl.trim();
  // Match whitespace-separated key:value tokens
  // key:[^"\s]+ or key:"..."
  const re = /([a-zA-Z]+):((?:"[^"]*"|[^\s]+))/g;
  let m;

  // Accumulate date clauses separately (they produce two DSL tokens for one chip)
  const dateParts = {};

  while ((m = re.exec(remaining)) !== null) {
    const key = m[1].toLowerCase();
    const rawVal = m[2];
    if (!enabled.has(key)) continue;

    const meta = KEY_META[key];
    if (!meta) continue;

    if (key === "date") {
      // Look for >=YYYY-MM-DD (from) or <=YYYY-MM-DD (to) or plain eq
      if (rawVal.startsWith(">=")) {
        dateParts.from = rawVal.slice(2);
      } else if (rawVal.startsWith("<=")) {
        dateParts.to = rawVal.slice(2);
      } else {
        // Exact date: treat as from+to of same day
        const d = rawVal.replace(/^"(.*)"$/, "$1");
        dateParts.from = d;
        dateParts.to   = d;
      }
      continue;
    }

    if (meta.kind === "enum") {
      // Strip quotes; split comma list; expand slugs
      const stripped = rawVal.replace(/^"(.*)"$/, "$1");
      // comma-split — each token may be quoted individually
      const parts = stripped.split(",").map(t => {
        t = t.trim().replace(/^"(.*)"$/, "$1");
        // slug → spaces
        return t.replace(/-/g, " ");
      }).filter(Boolean);
      if (parts.length === 0) continue;

      // Check if we already have a chip for this key (auto-merge)
      const existing = chips.find(c => c.key === key);
      if (existing) {
        // Merge values (OR semantics)
        parts.forEach(p => {
          if (!existing.value.includes(p)) existing.value.push(p);
        });
      } else {
        chips.push({ key, kind: "enum", value: parts });
      }
      continue;
    }

    if (meta.kind === "numeric") {
      let op = "=", a = rawVal, b = undefined;
      if (/^(>=|<=|>|<)/.test(rawVal)) {
        op = rawVal.match(/^(>=|<=|>|<)/)[1];
        a = rawVal.slice(op.length);
      } else if (/^\d[\d.]*-\d/.test(rawVal)) {
        const [lo, hi] = rawVal.split("-");
        op = "between"; a = lo; b = hi;
      }
      // Merge numeric chips for same key (last one wins — simple)
      const existing = chips.find(c => c.key === key);
      if (existing) {
        existing.value = { op, a, b };
      } else {
        chips.push({ key, kind: "numeric", value: { op, a, b } });
      }
      continue;
    }

    // month (enum kind)
    if (key === "month") {
      const stripped = rawVal.replace(/^"(.*)"$/, "$1");
      const existing = chips.find(c => c.key === "month");
      if (existing) {
        if (!existing.value.includes(stripped)) existing.value.push(stripped);
      } else {
        chips.push({ key: "month", kind: "enum", value: [stripped] });
      }
      continue;
    }
  }

  // Add date chip if we collected any parts
  if (dateParts.from || dateParts.to) {
    chips.push({ key: "date", kind: "date", value: { from: dateParts.from || "", to: dateParts.to || "" } });
  }

  return chips;
}

// ── Chip value label for display ─────────────────────────────────────────────
function chipValueLabel(chip) {
  const { kind, value } = chip;
  if (kind === "enum") {
    if (!value || value.length === 0) return "…";
    return value.join(" "); // OR separators handled via DOM in renderChip
  }
  if (kind === "numeric") {
    if (!value || !value.op) return "…";
    const { op, a, b } = value;
    if (op === "between") return b ? `${a}–${b}` : `>=${a}`;
    return `${op}${a}`;
  }
  if (kind === "date") {
    if (!value || (!value.from && !value.to)) return "…";
    if (value.from && value.to) {
      if (value.from === value.to) return value.from;
      return `${value.from} → ${value.to}`;
    }
    if (value.from) return `>= ${value.from}`;
    return `<= ${value.to}`;
  }
  return "…";
}

// ── Main factory ─────────────────────────────────────────────────────────────
export function createFilterBuilder({ container, enabledKeys, initialDsl, onChange, hiddenInput }) {
  if (!container) return null;

  const enabled = enabledKeys || Object.keys(KEY_META);

  // Internal chip array: [{ id, key, kind, value }]
  let chips = [];
  let _idCounter = 0;
  const _nextId = () => `fb-chip-${++_idCounter}`;

  // Currently-open dropdown state
  let _openDropdown = null; // { el: DOMElement, chipId|null }

  // Debounce timer
  let _emitTimer = null;

  // ── DOM scaffolding ──────────────────────────────────────────────────────
  container.classList.add("fb-bar");
  container.setAttribute("role", "group");
  container.setAttribute("aria-label", "Filter chips");

  // Empty-state hint
  const hintEl = document.createElement("span");
  hintEl.className = "fb-empty-hint";
  hintEl.textContent = "Filter by league, team, date…";
  container.appendChild(hintEl);

  // "+ Add filter" button
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "fb-add-btn";
  addBtn.setAttribute("aria-label", "Add filter");
  addBtn.innerHTML = `<span class="fb-add-icon">+</span>Add filter`;
  container.appendChild(addBtn);

  // Clear-all button (hidden until chips exist)
  const clearAllBtn = document.createElement("button");
  clearAllBtn.type = "button";
  clearAllBtn.className = "fb-clear-all";
  clearAllBtn.setAttribute("aria-label", "Clear all filters");
  clearAllBtn.textContent = "Clear all";
  container.appendChild(clearAllBtn);

  // ── Emit helper ───────────────────────────────────────────────────────────
  function emit() {
    clearTimeout(_emitTimer);
    _emitTimer = setTimeout(() => {
      const dsl = chipsToDsl(chips);
      if (hiddenInput) hiddenInput.value = dsl;
      if (onChange) onChange(dsl);
    }, 0);
  }

  // ── Update container class for CSS hooks ──────────────────────────────────
  function syncContainerClass() {
    if (chips.length > 0) {
      container.classList.add("has-chips");
      hintEl.style.display = "none";
    } else {
      container.classList.remove("has-chips");
      hintEl.style.display = "";
    }
  }

  // ── Close any open dropdown ───────────────────────────────────────────────
  function closeDropdown() {
    if (_openDropdown) {
      _openDropdown.remove();
      _openDropdown = null;
    }
  }

  // ── Render a chip into the DOM ─────────────────────────────────────────────
  // Returns the chip element. Chips are inserted before the addBtn.
  function renderChip(chip, insertBefore) {
    const meta = KEY_META[chip.key];
    const chipEl = document.createElement("span");
    chipEl.className = "fb-chip";
    chipEl.dataset.chipId = chip.id;

    // Key label half
    const keyEl = document.createElement("span");
    keyEl.className = "fb-chip-key";
    keyEl.style.background = meta.color;
    keyEl.textContent = meta.label;
    chipEl.appendChild(keyEl);

    // Value half
    const valEl = document.createElement("span");
    valEl.className = "fb-chip-val";
    _renderChipValue(valEl, chip);
    chipEl.appendChild(valEl);

    // Delete button
    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "fb-chip-del";
    delBtn.setAttribute("aria-label", `Remove ${meta.label} filter`);
    delBtn.textContent = "×";
    delBtn.addEventListener("click", e => {
      e.stopPropagation();
      removeChip(chip.id);
    });
    chipEl.appendChild(delBtn);

    // Click on value area → re-edit
    valEl.addEventListener("click", e => {
      e.stopPropagation();
      openValueEditor(chip.id, chipEl);
    });
    // Keyboard: Enter/Space on value → edit
    valEl.setAttribute("tabindex", "0");
    valEl.setAttribute("role", "button");
    valEl.setAttribute("aria-label", `Edit ${meta.label} filter`);
    valEl.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openValueEditor(chip.id, chipEl);
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        removeChip(chip.id);
      }
    });

    if (insertBefore) {
      container.insertBefore(chipEl, insertBefore);
    } else {
      container.insertBefore(chipEl, addBtn);
    }
    return chipEl;
  }

  // Render the value portion of a chip el
  function _renderChipValue(valEl, chip) {
    valEl.innerHTML = "";
    const { kind, value } = chip;

    if (kind === "enum") {
      if (!value || value.length === 0) {
        const span = document.createElement("span");
        span.className = "fb-val-text";
        span.textContent = "…";
        valEl.appendChild(span);
        return;
      }
      value.forEach((v, i) => {
        if (i > 0) {
          const or = document.createElement("span");
          or.className = "fb-val-or";
          or.textContent = "OR";
          valEl.appendChild(or);
        }
        const span = document.createElement("span");
        span.className = "fb-val-text";
        span.textContent = v;
        valEl.appendChild(span);
      });
      return;
    }

    // numeric / date — single text label
    const span = document.createElement("span");
    span.className = "fb-val-text";
    span.textContent = chipValueLabel(chip);
    valEl.appendChild(span);
  }

  // Update existing chip DOM after value change
  function refreshChipEl(chipId) {
    const chip = chips.find(c => c.id === chipId);
    if (!chip) return;
    const chipEl = container.querySelector(`[data-chip-id="${chipId}"]`);
    if (!chipEl) return;
    const valEl = chipEl.querySelector(".fb-chip-val");
    if (valEl) _renderChipValue(valEl, chip);
  }

  // ── Insert AND dividers between chips ─────────────────────────────────────
  function rebuildAndDividers() {
    // Remove old dividers
    container.querySelectorAll(".fb-and-sep").forEach(el => el.remove());
    const chipEls = Array.from(container.querySelectorAll(".fb-chip"));
    chipEls.forEach((el, i) => {
      if (i > 0) {
        const div = document.createElement("span");
        div.className = "fb-and-sep";
        div.setAttribute("aria-hidden", "true");
        div.textContent = "AND";
        container.insertBefore(div, el);
      }
    });
  }

  // ── Add a chip ────────────────────────────────────────────────────────────
  function addChip(key, value) {
    const meta = KEY_META[key];
    if (!meta) return null;

    // Auto-merge: if same key exists and kind === enum, merge values
    const existing = chips.find(c => c.key === key && c.kind === "enum");
    if (existing && meta.kind === "enum" && Array.isArray(value)) {
      value.forEach(v => {
        if (!existing.value.includes(v)) existing.value.push(v);
      });
      refreshChipEl(existing.id);
      rebuildAndDividers();
      syncContainerClass();
      emit();
      return existing;
    }

    const chip = {
      id: _nextId(),
      key,
      kind: meta.kind,
      value: value !== undefined ? value : (meta.kind === "enum" ? [] : meta.kind === "date" ? { from: "", to: "" } : { op: ">", a: "", b: undefined }),
    };
    chips.push(chip);
    renderChip(chip, addBtn);
    rebuildAndDividers();
    syncContainerClass();
    emit();
    return chip;
  }

  // ── Remove a chip ─────────────────────────────────────────────────────────
  function removeChip(chipId) {
    closeDropdown();
    const idx = chips.findIndex(c => c.id === chipId);
    if (idx === -1) return;
    chips.splice(idx, 1);
    const chipEl = container.querySelector(`[data-chip-id="${chipId}"]`);
    if (chipEl) {
      chipEl.style.animation = "fb-chip-out 100ms ease-in both";
      setTimeout(() => chipEl.remove(), 110);
    }
    rebuildAndDividers();
    syncContainerClass();
    emit();
  }

  // ── Category picker dropdown ───────────────────────────────────────────────
  function openCategoryPicker(anchorEl) {
    closeDropdown();

    const dd = document.createElement("div");
    dd.className = "fb-dropdown";
    _openDropdown = dd;
    document.body.appendChild(dd);

    // Position
    _positionDropdown(dd, anchorEl);

    // Header
    const header = document.createElement("div");
    header.className = "fb-dd-header";
    header.textContent = "Choose category";
    dd.appendChild(header);

    // Search input
    const search = document.createElement("input");
    search.type = "text";
    search.className = "fb-dd-search";
    search.placeholder = "Search…";
    search.setAttribute("aria-label", "Search filter categories");
    dd.appendChild(search);

    // List
    const list = document.createElement("ul");
    list.className = "fb-dd-list";
    list.setAttribute("role", "listbox");
    dd.appendChild(list);

    // Currently-used keys (for duplicate warning)
    const usedKeys = new Set(chips.map(c => c.key));

    function buildList(filter) {
      list.innerHTML = "";
      const lf = filter.toLowerCase();
      let focusIdx = 0;
      const items = [];

      enabled.forEach(key => {
        const meta = KEY_META[key];
        if (!meta) return;
        if (lf && !meta.label.toLowerCase().includes(lf) && !key.includes(lf)) return;

        const li = document.createElement("li");
        li.className = "fb-dd-item";
        li.setAttribute("role", "option");
        li.setAttribute("data-key", key);
        if (usedKeys.has(key) && meta.kind === "numeric") {
          li.style.opacity = "0.5";
        }

        // Colour dot
        const dot = document.createElement("span");
        dot.className = "fb-key-dot";
        dot.style.background = meta.color;
        li.appendChild(dot);

        const labelWrap = document.createElement("span");
        labelWrap.style.cssText = "display:flex;flex-direction:column;gap:1px;";
        const labelEl = document.createElement("span");
        labelEl.textContent = meta.label;
        labelWrap.appendChild(labelEl);
        if (meta.hint) {
          const hintEl = document.createElement("span");
          hintEl.style.cssText = "font-size:9px;color:rgba(255,255,255,0.38);font-weight:400;";
          hintEl.textContent = meta.hint;
          labelWrap.appendChild(hintEl);
        }
        li.appendChild(labelWrap);

        if (usedKeys.has(key) && meta.kind === "enum") {
          const hint = document.createElement("span");
          hint.style.cssText = "margin-left:auto;font-size:10px;color:rgba(255,255,255,0.35);";
          hint.textContent = "(add more)";
          li.appendChild(hint);
        }

        li.addEventListener("click", () => {
          selectCategory(key, anchorEl);
        });
        list.appendChild(li);
        items.push(li);
      });

      if (items.length === 0) {
        const msg = document.createElement("li");
        msg.className = "fb-dd-msg";
        msg.textContent = "No matching categories";
        list.appendChild(msg);
      }

      return items;
    }

    let listItems = buildList("");
    let _focusedItemIdx = -1;

    function focusItem(idx) {
      listItems.forEach(li => li.classList.remove("is-focused"));
      if (idx >= 0 && idx < listItems.length) {
        listItems[idx].classList.add("is-focused");
        listItems[idx].scrollIntoView({ block: "nearest" });
        _focusedItemIdx = idx;
      }
    }

    search.addEventListener("input", () => {
      listItems = buildList(search.value);
      _focusedItemIdx = -1;
    });

    search.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        focusItem(Math.min(_focusedItemIdx + 1, listItems.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        focusItem(Math.max(_focusedItemIdx - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (_focusedItemIdx >= 0 && listItems[_focusedItemIdx]) {
          const key = listItems[_focusedItemIdx].dataset.key;
          if (key) selectCategory(key, anchorEl);
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeDropdown();
        addBtn.focus();
      } else if (e.key === "Tab") {
        // Tab out → close, focus add button
        e.preventDefault();
        closeDropdown();
        addBtn.focus();
      }
    });

    // Focus search immediately
    requestAnimationFrame(() => search.focus());
  }

  // ── Category selected: open value editor for that key ─────────────────────
  function selectCategory(key, anchorEl) {
    closeDropdown();
    // Check if we should edit existing chip or create new one
    const meta = KEY_META[key];
    if (!meta) return;

    const existingChip = chips.find(c => c.key === key);

    if (existingChip && meta.kind !== "enum") {
      // For non-enum keys, open editor on existing chip
      const chipEl = container.querySelector(`[data-chip-id="${existingChip.id}"]`);
      if (chipEl) {
        openValueEditor(existingChip.id, chipEl);
        return;
      }
    }

    // Create new chip (possibly merging for enum)
    const chip = addChip(key, meta.kind === "enum" ? [] : meta.kind === "date" ? { from: "", to: "" } : { op: ">", a: "", b: undefined });
    if (!chip) return;
    const chipEl = container.querySelector(`[data-chip-id="${chip.id}"]`);
    if (chipEl) {
      openValueEditor(chip.id, chipEl);
    } else {
      addBtn.focus();
    }
  }

  // ── Value editor per key kind ──────────────────────────────────────────────
  function openValueEditor(chipId, anchorEl) {
    closeDropdown();
    const chip = chips.find(c => c.id === chipId);
    if (!chip) return;
    const meta = KEY_META[chip.key];

    if (meta.kind === "enum") {
      openEnumEditor(chip, anchorEl);
    } else if (meta.kind === "numeric") {
      openNumericEditor(chip, anchorEl);
    } else if (meta.kind === "date") {
      openDateEditor(chip, anchorEl);
    }
  }

  // ── Enum editor ────────────────────────────────────────────────────────────
  async function openEnumEditor(chip, anchorEl) {
    const meta = KEY_META[chip.key];
    const dd = document.createElement("div");
    dd.className = "fb-dropdown";
    _openDropdown = dd;
    document.body.appendChild(dd);
    _positionDropdown(dd, anchorEl);

    // Header
    const header = document.createElement("div");
    header.className = "fb-dd-header";
    header.textContent = `Select ${meta.label} (multi-select)`;
    dd.appendChild(header);

    // Search
    const search = document.createElement("input");
    search.type = "text";
    search.className = "fb-dd-search";
    search.placeholder = "Search…";
    dd.appendChild(search);

    // Loading message while fetching
    const loadMsg = document.createElement("div");
    loadMsg.className = "fb-dd-msg";
    loadMsg.textContent = "Loading values…";
    dd.appendChild(loadMsg);

    // List (populated after fetch)
    const list = document.createElement("ul");
    list.className = "fb-dd-list";
    list.setAttribute("role", "listbox");
    list.setAttribute("aria-multiselectable", "true");
    dd.appendChild(list);

    // Selected set (copy from chip.value so edits can be cancelled via Escape).
    // Convert stored DSL values → canonical display labels for enum keys with dedup.
    // e.g. stored "1" → display "Home win (1)" so the list item shows as checked.
    const _dslToLabel = (v) => _ENUM_CANONICAL_LABELS[v] || _ENUM_CANONICAL_LABELS[v.toLowerCase()] || v;
    const isGameEnumKey = (chip.key === "outcome" || chip.key === "prediction" || chip.key === "result");
    const selected = new Set((chip.value || []).map(v => isGameEnumKey ? _dslToLabel(v) : v));

    // Apply button
    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "fb-dd-apply";
    applyBtn.textContent = "Apply";
    dd.appendChild(applyBtn);

    let listItems = [];
    let _focusedIdx = -1;

    function buildEnumList(values, filterStr) {
      list.innerHTML = "";
      listItems = [];
      const lf = (filterStr || "").toLowerCase();

      const filtered = lf ? values.filter(v => v.toLowerCase().includes(lf)) : values;

      if (filtered.length === 0) {
        const msg = document.createElement("li");
        msg.className = "fb-dd-msg";
        msg.textContent = lf ? "No matches" : "No values available";
        list.appendChild(msg);
        return;
      }

      filtered.forEach(v => {
        const li = document.createElement("li");
        li.className = "fb-dd-item";
        if (selected.has(v)) li.classList.add("is-selected");
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", selected.has(v) ? "true" : "false");
        li.textContent = v;

        li.addEventListener("click", () => {
          if (selected.has(v)) {
            selected.delete(v);
            li.classList.remove("is-selected");
            li.setAttribute("aria-selected", "false");
          } else {
            selected.add(v);
            li.classList.add("is-selected");
            li.setAttribute("aria-selected", "true");
          }
        });
        list.appendChild(li);
        listItems.push(li);
      });
    }

    function applySelection() {
      closeDropdown();
      const rawSelected = Array.from(selected);
      // Map canonical display labels back to preferred DSL tokens when deduped
      const newVal = rawSelected.map(v => _LABEL_TO_DSL[v] || v);
      if (newVal.length === 0) {
        // Empty selection: keep chip empty rather than delete
        chip.value = [];
      } else {
        chip.value = newVal;
      }
      refreshChipEl(chip.id);
      emit();
      addBtn.focus();
    }

    applyBtn.addEventListener("click", applySelection);

    // Keyboard on search
    search.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        _focusedIdx = Math.min(_focusedIdx + 1, listItems.length - 1);
        listItems.forEach((li, i) => li.classList.toggle("is-focused", i === _focusedIdx));
        if (listItems[_focusedIdx]) listItems[_focusedIdx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        _focusedIdx = Math.max(_focusedIdx - 1, 0);
        listItems.forEach((li, i) => li.classList.toggle("is-focused", i === _focusedIdx));
        if (listItems[_focusedIdx]) listItems[_focusedIdx].scrollIntoView({ block: "nearest" });
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (_focusedIdx >= 0 && listItems[_focusedIdx]) {
          listItems[_focusedIdx].click();
        } else {
          applySelection();
        }
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeDropdown();
        if (chip.value.length === 0) removeChip(chip.id);
        else addBtn.focus();
      } else if (e.key === "Tab") {
        e.preventDefault();
        applySelection();
        addBtn.focus();
      } else if (e.key === "Backspace" && search.value === "") {
        e.preventDefault();
        // Back to category picker
        closeDropdown();
        if (chip.value.length === 0) {
          removeChip(chip.id);
          openCategoryPicker(addBtn);
        }
      }
    });

    search.addEventListener("input", () => {
      _focusedIdx = -1;
      buildEnumList(_allValues, search.value);
    });

    // Fetch values from API
    let _allValues = [];
    // Whether values displayed are canonical labels (need DSL mapping on apply)
    let _isDeduped = false;
    const apiData = await fetchValues(chip.key);

    // Remove loading message
    loadMsg.remove();

    if (apiData && apiData.kind === "enum" && apiData.values) {
      _allValues = _dedupeEnumValues(chip.key, apiData.values);
      _isDeduped = (_allValues !== apiData.values); // true when deduplication ran
    } else if (STATIC_FALLBACKS[chip.key]) {
      _allValues = _dedupeEnumValues(chip.key, STATIC_FALLBACKS[chip.key]);
      _isDeduped = true;
    } else {
      // Endpoint unavailable: free-text fallback
      const unavailMsg = document.createElement("div");
      unavailMsg.className = "fb-dd-msg";
      unavailMsg.textContent = "Values unavailable — type freely";
      dd.insertBefore(unavailMsg, applyBtn);
      // Add a text input for free-form entry
      const freeInput = document.createElement("input");
      freeInput.type = "text";
      freeInput.className = "fb-dd-search";
      freeInput.placeholder = `Enter ${meta.label.toLowerCase()}…`;
      freeInput.style.marginTop = "4px";
      dd.insertBefore(freeInput, applyBtn);
      search.style.display = "none";
      freeInput.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === "Tab") {
          e.preventDefault();
          const v = freeInput.value.trim();
          if (v) { selected.clear(); selected.add(v); }
          applySelection();
        } else if (e.key === "Escape") {
          e.preventDefault();
          closeDropdown();
          if (chip.value.length === 0) removeChip(chip.id);
        }
      });
      requestAnimationFrame(() => freeInput.focus());
      _positionDropdown(dd, anchorEl);
      return;
    }

    buildEnumList(_allValues, "");
    _positionDropdown(dd, anchorEl);
    requestAnimationFrame(() => search.focus());
  }

  // ── Numeric editor ─────────────────────────────────────────────────────────
  async function openNumericEditor(chip, anchorEl) {
    const meta = KEY_META[chip.key];
    const dd = document.createElement("div");
    dd.className = "fb-dropdown";
    _openDropdown = dd;
    document.body.appendChild(dd);
    _positionDropdown(dd, anchorEl);

    const header = document.createElement("div");
    header.className = "fb-dd-header";
    header.textContent = meta.label;
    dd.appendChild(header);

    // Fetch range info for placeholder
    let minVal = "", maxVal = "";
    const apiData = await fetchValues(chip.key);
    if (apiData && apiData.kind === "numeric") {
      minVal = apiData.min !== undefined ? String(apiData.min) : "";
      maxVal = apiData.max !== undefined ? String(apiData.max) : "";
    }

    const editor = document.createElement("div");
    editor.className = "fb-numeric-editor";
    dd.appendChild(editor);

    const initValue = chip.value || { op: ">", a: "", b: undefined };

    // Row 1: operator + value A
    const row1 = document.createElement("div");
    row1.className = "fb-num-row";

    const opSel = document.createElement("select");
    opSel.className = "fb-num-op-sel";
    [
      { val: ">",       label: ">"  },
      { val: ">=",      label: ">=" },
      { val: "<",       label: "<"  },
      { val: "<=",      label: "<=" },
      { val: "between", label: "…–…" },
    ].forEach(({ val, label }) => {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = label;
      if (val === (initValue.op || ">")) opt.selected = true;
      opSel.appendChild(opt);
    });
    row1.appendChild(opSel);

    const inputA = document.createElement("input");
    inputA.type = "number";
    inputA.className = "fb-num-input";
    inputA.value = initValue.a || "";
    inputA.placeholder = minVal ? `min ${minVal}` : "value";
    inputA.step = "0.01";
    row1.appendChild(inputA);

    // Row 2: "to" input (shown only for "between")
    const row2 = document.createElement("div");
    row2.className = "fb-num-row";
    const betweenSep = document.createElement("span");
    betweenSep.className = "fb-num-between-sep";
    betweenSep.textContent = "to";
    row2.appendChild(betweenSep);
    const inputB = document.createElement("input");
    inputB.type = "number";
    inputB.className = "fb-num-input";
    inputB.value = initValue.b || "";
    inputB.placeholder = maxVal ? `max ${maxVal}` : "value";
    inputB.step = "0.01";
    row2.appendChild(inputB);

    editor.appendChild(row1);
    editor.appendChild(row2);

    function syncBetweenVisibility() {
      row2.style.display = opSel.value === "between" ? "flex" : "none";
    }
    syncBetweenVisibility();
    opSel.addEventListener("change", syncBetweenVisibility);

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "fb-dd-apply";
    applyBtn.textContent = "Apply";
    dd.appendChild(applyBtn);

    function applyNumeric() {
      const a = inputA.value.trim();
      const b = inputB.value.trim();
      const op = opSel.value;
      if (!a) {
        closeDropdown();
        if (!chip.value || !chip.value.a) removeChip(chip.id);
        return;
      }
      chip.value = { op, a, b: op === "between" ? b : undefined };
      refreshChipEl(chip.id);
      closeDropdown();
      emit();
      addBtn.focus();
    }

    applyBtn.addEventListener("click", applyNumeric);

    // Keyboard in inputs
    function numKeydown(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        applyNumeric();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeDropdown();
        if (!chip.value || !chip.value.a) removeChip(chip.id);
      } else if (e.key === "Tab") {
        // Tab inside: move between fields, then apply on final tab
        if (e.target === inputA && opSel.value === "between" && !e.shiftKey) {
          // Let default tab go to inputB
          return;
        }
        e.preventDefault();
        applyNumeric();
        addBtn.focus();
      }
    }
    inputA.addEventListener("keydown", numKeydown);
    inputB.addEventListener("keydown", numKeydown);

    _positionDropdown(dd, anchorEl);
    requestAnimationFrame(() => inputA.focus());
  }

  // ── Date editor ────────────────────────────────────────────────────────────
  async function openDateEditor(chip, anchorEl) {
    const dd = document.createElement("div");
    dd.className = "fb-dropdown";
    _openDropdown = dd;
    document.body.appendChild(dd);
    _positionDropdown(dd, anchorEl);

    const header = document.createElement("div");
    header.className = "fb-dd-header";
    header.textContent = "Date range";
    dd.appendChild(header);

    // Fetch range for min/max hints
    let minDate = "", maxDate = "";
    const apiData = await fetchValues("date");
    if (apiData && apiData.kind === "date") {
      minDate = apiData.min || "";
      maxDate = apiData.max || "";
    }

    const initVal = chip.value || { from: "", to: "" };

    const editor = document.createElement("div");
    editor.className = "fb-date-editor";
    dd.appendChild(editor);

    function makeRow(labelText, id, initValStr) {
      const row = document.createElement("div");
      row.className = "fb-date-row";
      const lbl = document.createElement("label");
      lbl.className = "fb-date-label";
      lbl.textContent = labelText;
      lbl.setAttribute("for", id);
      const inp = document.createElement("input");
      inp.type = "date";
      inp.className = "fb-date-input";
      inp.id = id;
      inp.value = initValStr || "";
      if (minDate) inp.min = minDate;
      if (maxDate) inp.max = maxDate;
      row.appendChild(lbl);
      row.appendChild(inp);
      return { row, inp };
    }

    const { row: rowFrom, inp: inpFrom } = makeRow("From", `fb-date-from-${chip.id}`, initVal.from);
    const { row: rowTo,   inp: inpTo   } = makeRow("To",   `fb-date-to-${chip.id}`,   initVal.to);
    editor.appendChild(rowFrom);
    editor.appendChild(rowTo);

    const applyBtn = document.createElement("button");
    applyBtn.type = "button";
    applyBtn.className = "fb-dd-apply";
    applyBtn.textContent = "Apply";
    dd.appendChild(applyBtn);

    function applyDate() {
      const from = inpFrom.value;
      const to   = inpTo.value;
      if (!from && !to) {
        closeDropdown();
        removeChip(chip.id);
        return;
      }
      chip.value = { from, to };
      refreshChipEl(chip.id);
      closeDropdown();
      emit();
      addBtn.focus();
    }

    applyBtn.addEventListener("click", applyDate);

    function dateKeydown(e) {
      if (e.key === "Enter") {
        e.preventDefault();
        applyDate();
      } else if (e.key === "Escape") {
        e.preventDefault();
        closeDropdown();
        if (!chip.value || (!chip.value.from && !chip.value.to)) removeChip(chip.id);
      } else if (e.key === "Tab") {
        if (e.target === inpFrom && !e.shiftKey) return; // let Tab go to inpTo naturally
        e.preventDefault();
        applyDate();
        addBtn.focus();
      }
    }

    inpFrom.addEventListener("keydown", dateKeydown);
    inpTo.addEventListener("keydown", dateKeydown);

    _positionDropdown(dd, anchorEl);
    requestAnimationFrame(() => inpFrom.focus());
  }

  // ── Dropdown positioning ───────────────────────────────────────────────────
  function _positionDropdown(dd, anchor) {
    const aRect = anchor.getBoundingClientRect();
    const scrollY = window.scrollY || document.documentElement.scrollTop;
    const scrollX = window.scrollX || document.documentElement.scrollLeft;

    dd.style.position = "absolute";
    dd.style.top  = (aRect.bottom + scrollY + 6) + "px";
    dd.style.left = (aRect.left  + scrollX) + "px";

    // Clamp to viewport width
    requestAnimationFrame(() => {
      const ddW = dd.offsetWidth;
      const vw  = window.innerWidth;
      let left = aRect.left + scrollX;
      if (left + ddW > vw - 8) left = Math.max(8, vw - ddW - 8);
      dd.style.left = left + "px";
    });
  }

  // ── Wire addBtn ───────────────────────────────────────────────────────────
  addBtn.addEventListener("click", () => openCategoryPicker(addBtn));
  addBtn.addEventListener("keydown", e => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openCategoryPicker(addBtn);
    }
    // Backspace on add button → focus previous chip's value for editing
    if (e.key === "Backspace") {
      e.preventDefault();
      if (chips.length > 0) {
        const lastChip = chips[chips.length - 1];
        const chipEl = container.querySelector(`[data-chip-id="${lastChip.id}"]`);
        if (chipEl) {
          const valEl = chipEl.querySelector(".fb-chip-val");
          if (valEl) {
            valEl.focus();
            openValueEditor(lastChip.id, chipEl);
          }
        }
      }
    }
  });

  // ── Wire clearAllBtn ──────────────────────────────────────────────────────
  clearAllBtn.addEventListener("click", () => {
    closeDropdown();
    chips.forEach(c => {
      const el = container.querySelector(`[data-chip-id="${c.id}"]`);
      if (el) el.remove();
    });
    chips = [];
    container.querySelectorAll(".fb-and-sep").forEach(el => el.remove());
    syncContainerClass();
    emit();
    addBtn.focus();
  });

  // ── Close dropdown on outside click ──────────────────────────────────────
  document.addEventListener("click", e => {
    if (_openDropdown && !_openDropdown.contains(e.target) && !container.contains(e.target)) {
      closeDropdown();
    }
  }, true);

  // ── Escape key handling ───────────────────────────────────────────────────
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && _openDropdown) {
      closeDropdown();
    }
  });

  // ── Public API ────────────────────────────────────────────────────────────
  function getDsl() {
    return chipsToDsl(chips);
  }

  function setDsl(dsl) {
    // Clear existing chips
    chips.forEach(c => {
      const el = container.querySelector(`[data-chip-id="${c.id}"]`);
      if (el) el.remove();
    });
    chips = [];
    container.querySelectorAll(".fb-and-sep").forEach(el => el.remove());

    // Parse new chips
    const parsed = parseDslToChips(dsl, enabled);
    parsed.forEach(({ key, kind, value }) => {
      const chip = { id: _nextId(), key, kind, value };
      chips.push(chip);
      renderChip(chip, addBtn);
    });
    rebuildAndDividers();
    syncContainerClass();
    // Don't emit on setDsl — it's called for URL restore, not user action
  }

  function clear() {
    clearAllBtn.click();
  }

  // ── Initial load from URL ─────────────────────────────────────────────────
  if (initialDsl && initialDsl.trim()) {
    setDsl(initialDsl);
  }

  return { getDsl, setDsl, clear };
}
