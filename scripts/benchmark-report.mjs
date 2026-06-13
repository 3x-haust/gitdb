export function parseBenchmarkOutput(text) {
  const trimmed = text.trim()
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    return parseJsonResults(trimmed)
  }
  return parseMarkdownResults(text)
}

export function buildBenchmarkEvidence({
  baseline,
  baselineLabel,
  baselineSource,
  current,
  currentLabel,
  currentSource,
}) {
  const baselineByKey = new Map()
  for (const row of baseline) {
    baselineByKey.set(scenarioKey(row.label), row)
  }

  const comparisons = []
  for (const currentRow of current) {
    const key = scenarioKey(currentRow.label)
    const baselineRow = baselineByKey.get(key)
    if (baselineRow !== undefined) {
      comparisons.push(compareRows(key, baselineRow, currentRow))
    }
  }

  if (comparisons.length === 0) {
    throw new Error("no comparable benchmark rows found")
  }

  return {
    baseline: {
      label: baselineLabel,
      source: baselineSource,
    },
    comparisons,
    current: {
      label: currentLabel,
      source: currentSource,
    },
    generatedAt: new Date().toISOString(),
    headline: headline(comparisons),
  }
}

export function formatComparisonMarkdown(evidence) {
  const lines = [
    "| Scenario | Previous writes/s | Current writes/s | Change | Write ms change | Join ms change |",
    "| --- | ---: | ---: | ---: | ---: | ---: |",
  ]
  for (const item of evidence.comparisons) {
    lines.push(
      `| ${item.scenario} | ${fixed(item.baseline.writesPerSecond)} | ${fixed(item.current.writesPerSecond)} | ${formatPct(item.writesPerSecondChangePct)} | ${formatPct(item.writeMsChangePct)} | ${formatPct(item.joinMsChangePct)} |`,
    )
  }
  return `${lines.join("\n")}\n`
}

function parseJsonResults(text) {
  const parsed = JSON.parse(text)
  const rows = Array.isArray(parsed) ? parsed : parsed.results
  if (!Array.isArray(rows)) {
    throw new Error("benchmark JSON must be an array or contain a results array")
  }
  return rows.map((row) => normalizeResult(row))
}

function parseMarkdownResults(text) {
  const results = []
  for (const line of text.split("\n")) {
    if (!line.trim().startsWith("|")) {
      continue
    }
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.replaceAll("`", "").trim())
    if (cells.length < 6 || cells[0] === "Scenario" || cells[0].startsWith("---")) {
      continue
    }
    const row = normalizeMarkdownRow(cells)
    if (row !== undefined) {
      results.push(row)
    }
  }
  if (results.length === 0) {
    throw new Error("no benchmark rows found")
  }
  return results
}

function normalizeMarkdownRow(cells) {
  const rows = parseFiniteNumber(cells[1])
  const writeMs = parseFiniteNumber(cells[2])
  const writesPerSecond = parseFiniteNumber(cells[3])
  const joinMs = parseFiniteNumber(cells[4])
  const reopenMs = parseFiniteNumber(cells[5])
  if (
    rows === undefined ||
    writeMs === undefined ||
    writesPerSecond === undefined ||
    joinMs === undefined ||
    reopenMs === undefined
  ) {
    return undefined
  }
  return {
    joinMs,
    label: cells[0],
    reopenMs,
    rows,
    writeMs,
    writesPerSecond,
  }
}

function normalizeResult(row) {
  return {
    joinMs: finiteNumber(row.joinMs, "joinMs"),
    label: String(row.label),
    reopenMs: finiteNumber(row.reopenMs, "reopenMs"),
    rows: finiteNumber(row.rows, "rows"),
    writeMs: finiteNumber(row.writeMs, "writeMs"),
    writesPerSecond: finiteNumber(row.writesPerSecond, "writesPerSecond"),
  }
}

function compareRows(key, baselineRow, currentRow) {
  return {
    baseline: baselineRow,
    current: currentRow,
    joinMsChangePct: latencyChangePct(baselineRow.joinMs, currentRow.joinMs),
    key,
    reopenMsChangePct: latencyChangePct(baselineRow.reopenMs, currentRow.reopenMs),
    rows: currentRow.rows,
    scenario: currentRow.label,
    writeMsChangePct: latencyChangePct(baselineRow.writeMs, currentRow.writeMs),
    writeSpeedup: ratio(currentRow.writesPerSecond, baselineRow.writesPerSecond),
    writesPerSecondChangePct: throughputChangePct(
      baselineRow.writesPerSecond,
      currentRow.writesPerSecond,
    ),
  }
}

function scenarioKey(label) {
  const normalized = label.toLowerCase()
  if (normalized.startsWith("local plaintext")) {
    return "local plaintext"
  }
  if (normalized.startsWith("local encrypted")) {
    return "local encrypted"
  }
  if (normalized.startsWith("postgres facade")) {
    return "postgres facade"
  }
  if (normalized.startsWith("github plaintext")) {
    return "github plaintext"
  }
  return normalized
}

function headline(comparisons) {
  const localPlaintext = comparisons.find((row) => row.key === "local plaintext")
  if (localPlaintext === undefined) {
    return "Benchmark comparison generated"
  }
  return `Local plaintext writes are ${formatRatio(localPlaintext.writeSpeedup)} of the previous documented run`
}

function latencyChangePct(before, after) {
  if (before <= 0) {
    return null
  }
  return ((before - after) / before) * 100
}

function throughputChangePct(before, after) {
  if (before <= 0) {
    return null
  }
  return ((after - before) / before) * 100
}

function ratio(after, before) {
  if (before <= 0) {
    return null
  }
  return after / before
}

function formatPct(value) {
  return value === null ? "n/a" : `${value >= 0 ? "+" : ""}${fixed(value)}%`
}

function formatRatio(value) {
  return value === null ? "n/a" : `${fixed(value)}x`
}

function fixed(value) {
  return value.toFixed(2)
}

function parseFiniteNumber(value) {
  const parsed = Number.parseFloat(value.replaceAll(",", ""))
  return Number.isFinite(parsed) ? parsed : undefined
}

function finiteNumber(value, field) {
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value))
  if (!Number.isFinite(parsed)) {
    throw new Error(`${field} must be a finite number`)
  }
  return parsed
}
