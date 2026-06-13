const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

const percentFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
  signDisplay: "always",
})

const fallbackData = {
  comparisons: [],
  headline: "Run pnpm benchmark:compare to refresh benchmark evidence",
}

render(await loadBenchmark())

async function loadBenchmark() {
  try {
    const response = await fetch("./benchmark.json", { cache: "no-store" })
    if (!response.ok) {
      return fallbackData
    }
    return await response.json()
  } catch {
    return fallbackData
  }
}

function render(data) {
  const local = data.comparisons.find((item) => item.key === "local plaintext")
  setText("hero-speedup", formatRatio(local?.writeSpeedup))
  setText("hero-current-wps", formatNumber(local?.current.writesPerSecond))
  setText("hero-baseline-wps", formatNumber(local?.baseline.writesPerSecond))
  renderRows(data.comparisons)
  renderBars(data.comparisons)
}

function renderRows(comparisons) {
  const target = document.getElementById("benchmark-rows")
  if (target === null) {
    return
  }
  target.replaceChildren()
  if (comparisons.length === 0) {
    const row = document.createElement("tr")
    row.append(tableCell("Benchmark evidence pending", "left"))
    row.append(tableCell("n/a"))
    row.append(tableCell("n/a"))
    row.append(tableCell("n/a"))
    target.append(row)
    return
  }
  for (const item of comparisons) {
    const row = document.createElement("tr")
    row.append(tableCell(item.scenario, "left"))
    row.append(tableCell(formatNumber(item.baseline.writesPerSecond)))
    row.append(tableCell(formatNumber(item.current.writesPerSecond)))
    row.append(tableCell(formatPercent(item.writesPerSecondChangePct)))
    target.append(row)
  }
}

function renderBars(comparisons) {
  const target = document.getElementById("chart-bars")
  if (target === null) {
    return
  }
  target.replaceChildren()
  const max = maxThroughput(comparisons)
  if (max === 0) {
    target.append(emptyState())
    return
  }
  for (const item of comparisons) {
    target.append(barRow(item, max))
  }
}

function barRow(item, max) {
  const row = document.createElement("div")
  row.className = "bar-row"

  const label = document.createElement("div")
  label.className = "bar-label"
  label.append(span(item.scenario))
  label.append(span(formatPercent(item.writesPerSecondChangePct)))

  const bars = document.createElement("div")
  bars.className = "bars"
  bars.append(bar("previous", item.baseline.writesPerSecond, max))
  bars.append(bar("current", item.current.writesPerSecond, max))

  row.append(label)
  row.append(bars)
  return row
}

function bar(kind, value, max) {
  const element = document.createElement("div")
  element.className = `bar ${kind}`
  element.style.width = `${Math.max(4, (value / max) * 100)}%`
  return element
}

function tableCell(value, align = "right") {
  const cell = document.createElement("td")
  cell.textContent = value
  if (align === "left") {
    cell.style.textAlign = "left"
  }
  return cell
}

function span(value) {
  const element = document.createElement("span")
  element.textContent = value
  return element
}

function emptyState() {
  const element = document.createElement("p")
  element.textContent = "Benchmark evidence pending."
  return element
}

function maxThroughput(comparisons) {
  return comparisons.reduce((max, item) => {
    return Math.max(max, item.baseline.writesPerSecond, item.current.writesPerSecond)
  }, 0)
}

function setText(id, value) {
  const element = document.getElementById(id)
  if (element !== null) {
    element.textContent = value
  }
}

function formatNumber(value) {
  return typeof value === "number" ? numberFormatter.format(value) : "n/a"
}

function formatPercent(value) {
  return typeof value === "number" ? `${percentFormatter.format(value)}%` : "n/a"
}

function formatRatio(value) {
  return typeof value === "number" ? `${numberFormatter.format(value)}x` : "n/a"
}
