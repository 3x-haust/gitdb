const numberFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
})

const emptyBenchmarkData = {
  scenarios: [],
}

render(await loadBenchmark())

async function loadBenchmark() {
  try {
    const response = await fetch("./benchmark.json", { cache: "no-store" })
    if (!response.ok) {
      return emptyBenchmarkData
    }
    return await response.json()
  } catch {
    return emptyBenchmarkData
  }
}

function render(data) {
  const scenarios = data.scenarios ?? []
  const raw = scenarios.find((s) => s.key === "local-plaintext")
  const orm = scenarios.find((s) => s.key === "orm-local-plaintext")
  setText("hero-raw-wps", formatNumber(raw?.writesPerSecond))
  setText("hero-orm-wps", formatNumber(orm?.writesPerSecond))
  setText(
    "hero-join-ms",
    raw?.joinMs !== undefined ? `${numberFormatter.format(raw.joinMs)} ms` : "n/a",
  )
  renderRows(scenarios)
  renderBars(scenarios)
}

function renderRows(scenarios) {
  const target = document.getElementById("benchmark-rows")
  if (target === null) {
    return
  }
  target.replaceChildren()
  if (scenarios.length === 0) {
    const row = document.createElement("tr")
    row.append(tableCell("Benchmark evidence pending", "left"))
    row.append(tableCell("n/a"))
    row.append(tableCell("n/a"))
    row.append(tableCell("n/a"))
    row.append(tableCell("n/a"))
    target.append(row)
    return
  }
  for (const item of scenarios) {
    const row = document.createElement("tr")
    row.append(tableCell(item.label, "left"))
    row.append(tableCell(formatNumber(item.writesPerSecond)))
    row.append(tableCell(`${formatNumber(item.writeMs)} ms`))
    row.append(tableCell(`${formatNumber(item.joinMs)} ms`))
    row.append(tableCell(item.reopenMs > 0 ? `${formatNumber(item.reopenMs)} ms` : "—"))
    target.append(row)
  }
}

function renderBars(scenarios) {
  const target = document.getElementById("chart-bars")
  if (target === null) {
    return
  }
  target.replaceChildren()
  const max = scenarios.reduce((m, s) => Math.max(m, s.writesPerSecond ?? 0), 0)
  if (max === 0) {
    target.append(emptyState())
    return
  }
  for (const item of scenarios) {
    target.append(barRow(item, max))
  }
}

function barRow(item, max) {
  const row = document.createElement("div")
  row.className = "bar-row"

  const label = document.createElement("div")
  label.className = "bar-label"
  label.append(span(item.label))
  label.append(span(`${formatNumber(item.writesPerSecond)} w/s`))

  const bars = document.createElement("div")
  bars.className = "bars"
  bars.append(bar(item.key, item.writesPerSecond, max))

  row.append(label)
  row.append(bars)
  return row
}

function bar(kind, value, max) {
  const element = document.createElement("div")
  element.className = `bar ${kind === "orm-local-plaintext" ? "orm" : "current"}`
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

function setText(id, value) {
  const element = document.getElementById(id)
  if (element !== null) {
    element.textContent = value
  }
}

function formatNumber(value) {
  return typeof value === "number" ? numberFormatter.format(value) : "n/a"
}
