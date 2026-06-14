import { execFile } from "node:child_process"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname } from "node:path"
import { promisify } from "node:util"
import {
  buildBenchmarkEvidence,
  formatComparisonMarkdown,
  parseBenchmarkOutput,
} from "./benchmark-report.mjs"

const execFileAsync = promisify(execFile)
const options = parseArgs(process.argv.slice(2))
const currentPath = requireValue(options.current, "--current")
const baselineSource = await loadBaselineSource(options)
const currentText = await readFile(currentPath, "utf8")
const baselineText = baselineSource.text
const evidence = buildBenchmarkEvidence({
  baseline: parseBenchmarkOutput(baselineText),
  baselineLabel: options.baselineLabel ?? "previous documented run",
  baselineSource: baselineSource.source,
  current: parseBenchmarkOutput(currentText),
  currentLabel: options.currentLabel ?? "current working tree",
  currentSource: currentPath,
})
const markdown = formatComparisonMarkdown(evidence)

if (options.output !== undefined) {
  await writeJson(options.output, evidence)
}

if (options.markdown !== undefined) {
  await writeText(options.markdown, markdown)
}

process.stdout.write(markdown)

function parseArgs(argv) {
  const parsed = {}
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    switch (arg) {
      case "--baseline":
      case "--baseline-label":
      case "--baseline-path":
      case "--baseline-ref":
      case "--current":
      case "--current-label":
      case "--markdown":
      case "--output":
        parsed[toCamelCase(arg.slice(2))] = readArgValue(argv, index, arg)
        index += 1
        break
      default:
        throw new Error(`unknown argument: ${arg}`)
    }
  }
  return parsed
}

function readArgValue(argv, index, name) {
  const value = argv[index + 1]
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`)
  }
  return value
}

function toCamelCase(value) {
  return value.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase())
}

async function loadBaselineSource(parsed) {
  if (parsed.baseline !== undefined) {
    return {
      source: parsed.baseline,
      text: await readFile(parsed.baseline, "utf8"),
    }
  }

  const baselinePath = parsed.baselinePath ?? "docs/BENCHMARKS.md"
  const baselineRef = parsed.baselineRef ?? process.env.GITDB_BENCH_BASE_REF ?? "HEAD~1"
  const { stdout } = await execFileAsync("git", ["show", `${baselineRef}:${baselinePath}`], {
    maxBuffer: 1024 * 1024,
  })
  return {
    source: `${baselineRef}:${baselinePath}`,
    text: stdout,
  }
}

async function writeJson(path, value) {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value, "utf8")
}

function requireValue(value, name) {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required`)
  }
  return value
}
