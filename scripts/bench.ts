import { spawn } from "node:child_process";
import { cpus } from "node:os";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { BurstResult } from "./burst";
import { loadBurstSource, runBurst } from "./burst";
import type { RenderCase, RenderResult } from "./render-bench";
import { runRenderBench } from "./render-bench";

/**
 * The only place benchmark numbers are produced (ADR 0006): writes
 * `bench/results.json` and rewrites the README table between its markers, so
 * a published number can always be traced to a run on a named machine.
 * Never run in CI.
 */

const RATES = [1_000, 10_000, 50_000, 100_000] as const;
const SECONDS = 5;
const LIVE_RATE = 30;
const PORT = 4183;
const CASES: ReadonlyArray<RenderCase> = [
  { label: "desktop", width: 1500, height: 820, dpr: 1, cadence: "60" },
  { label: "phone", width: 390, height: 844, dpr: 3, cadence: "60" },
];

/** What a run publishes. */
export type BenchResults = {
  readonly ranAt: string;
  readonly machine: { readonly cpu: string; readonly cores: number; readonly node: string };
  readonly recording: string;
  /** Observed stream mix in the recording the synthetic burst is built from. */
  readonly mix: Readonly<Record<string, number>>;
  readonly liveRate: number;
  readonly burst: ReadonlyArray<BurstResult>;
  readonly render: ReadonlyArray<RenderResult>;
};

async function main(): Promise<void> {
  const recording = "fixtures/btc-perp-active.jsonl.gz";
  const source = loadBurstSource(recording);
  const burst = RATES.map((rate) => runBurst(source, rate, SECONDS));
  for (const r of burst) {
    process.stdout.write(`burst ${r.rate}/s -> ${r.sustained}/s sustained, p99 ${r.applyP99Us} us\n`);
  }

  const preview = await serve();
  let render: ReadonlyArray<RenderResult>;
  try {
    render = await runRenderBench(`http://localhost:${PORT}`, CASES, 15);
  } finally {
    preview.kill("SIGTERM");
  }

  const cpu = cpus()[0]?.model ?? "unknown";
  const results: BenchResults = {
    ranAt: new Date().toISOString(),
    machine: { cpu, cores: cpus().length, node: process.version },
    recording,
    mix: source.mix,
    liveRate: LIVE_RATE,
    burst,
    render,
  };
  mkdirSync("bench", { recursive: true });
  writeFileSync("bench/results.json", `${JSON.stringify(results, null, 2)}\n`);
  writeFileSync("README.md", withTable(readFileSync("README.md", "utf8"), results));
  process.stdout.write("wrote bench/results.json and the README table\n");
}

/** Build the demo and serve it, resolving once the port answers. */
async function serve(): Promise<{ readonly kill: (signal: NodeJS.Signals) => void }> {
  await run("npx", ["vite", "build"]);
  const child = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.ok) return child;
    } catch {
      // Not listening yet.
    }
    await sleep(500);
  }
  child.kill("SIGTERM");
  throw new Error("preview server did not start");
}

function run(command: string, args: ReadonlyArray<string>): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn(command, [...args], { stdio: "inherit" });
  child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} exited ${code ?? -1}`))));
  return promise;
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

/** Replace the generated block in the README; markers are the contract. */
export function withTable(readme: string, results: BenchResults): string {
  const start = "<!-- bench:start -->";
  const end = "<!-- bench:end -->";
  const from = readme.indexOf(start);
  const to = readme.indexOf(end);
  if (from === -1 || to === -1) throw new Error("README is missing the bench markers");
  return `${readme.slice(0, from + start.length)}\n${table(results)}\n${readme.slice(to)}`;
}

function table(r: BenchResults): string {
  const machine = `${r.machine.cpu} (${r.machine.cores} cores), Node ${r.machine.node}, ${r.ranAt.slice(0, 10)}`;
  const burst = r.burst.map(
    (b) =>
      `| ${fmt(b.rate)}/s (${Math.round(b.rate / r.liveRate)}x live) | ${fmt(b.sustained)}/s | ${b.applyP50Us} us | ${b.applyP99Us} us | ${b.heapDeltaMb} MB |`,
  );
  const render = r.render.map(
    (x) =>
      `| ${x.label} ${x.width}x${x.height} DPR ${x.dpr}, ${x.cadence} fps cap | ${x.fps} fps | ${x.frameP50Ms} ms | ${x.frameP95Ms} ms |`,
  );
  return [
    `Measured on ${machine}.`,
    "",
    `**Engine burst — synthetic.** Real frames from \`${r.recording}\` re-stamped onto a faster clock and replayed back to back. The live feed peaks near ${r.liveRate} events/s, so these rates say how much headroom there is, not what the venue does.`,
    "",
    "| Synthetic rate | Sustained | apply p50 | apply p99 | Heap delta |",
    "| --- | --- | --- | --- | --- |",
    ...burst,
    "",
    `**Render — emulated.** The widget replaying \`${r.recording.split("/").pop() ?? r.recording}\` at speed 1 in headless Chromium, telemetry read from its own HUD.`,
    "",
    "Scope: two viewports at the 60 fps cadence, sampled for 15 s after a 5 s warm-up. The 30 fps and on-update cadences and the trails/tape permutations are **not** benchmarked — they reduce work rather than add it, so the figures below are the expensive case. `frame p50` and `frame p95` are medians of the HUD's rolling per-frame percentiles across the run, not percentiles over every frame in it.",
    "",
    "| Viewport | fps | frame p50 | frame p95 |",
    "| --- | --- | --- | --- |",
    ...render,
  ].join("\n");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

await main();
