# JustType

JustType is a local predictive coding companion for VS Code. It shows a single inline completion while keeping the programmer in control of every accepted edit.

## Current scope

Version `0.0.2` supports one Python cursor, a manually started local `llama.cpp` server, native Ghost Text, request cancellation, exact prediction reuse and partial acceptance. It does not yet include goal tracking, sidecards, automatic model management or repository indexing.

## Local setup

1. Install Node.js 22 LTS and npm.
2. Start a FIM-capable `llama-server` on `http://127.0.0.1:8012`, for example:

   ```bash
   llama-server -m /path/to/Qwen2.5-Coder-1.5B-Instruct-Q8_0.gguf --port 8012 --cache-reuse 256
   ```

3. Install dependencies with `npm install`.
4. Use `npm run build`, then press F5 in VS Code.

To install the packaged build locally instead, run:

```bash
code --install-extension artifacts/justtype-0.0.2.vsix
```

With the server running, verify the exact API contract and a real FIM completion with:

```bash
npm run smoke:llama
```

Set `JUSTTYPE_LLAMA_ENDPOINT` when the server does not use the default `http://127.0.0.1:8012` endpoint.

For a CPU-only reference setup, use a Qwen2.5-Coder 1.5B Q8_0 GGUF model with `--cache-reuse 256`. JustType does not install, download, start or stop the server.

## Controls

| Key | Action |
|---|---|
| Tab | Accept the visible completion |
| Alt+Right | Accept the next word |
| Shift+Tab | Accept the next line |
| Esc | Dismiss and discard the current inline suggestion |

Use **JustType: Toggle Live Mode** from the Command Palette to switch between the default short completion mode and Live Mode. In Live Mode, at the end of a line, JustType streams up to 512 tokens as growing Ghost Text. Nothing is written until it is accepted; Esc stops the active stream as well.

## Settings

- `justType.enabled`
- `justType.triggerMode`
- `justType.completionMode` (`standard` or `live`)
- `justType.llamaCpp.endpoint`

## Privacy

JustType keeps content-free aggregate counters in memory for the active extension session. Its Output channel uses structured JSON lines for request, suggestion-lifecycle, cache and latency events, but never writes prompts, source code, paths or model responses. Use **JustType: Show Session Metrics** or **JustType: Open Log** to inspect it.

Latency percentiles retain only the most recent 256 completed model-response durations; the all-session mean, min and max are scalar aggregates. JustType also records the time from the last edit or explicit trigger until it offers an inline item. `visibleAccepts` and `visibleAcceptedCharacters` are confirmed through the native item-acceptance command; `typedCharacters` counts matching buffer edits that were not accepted through a JustType command.

## Reproducible inference benchmark

With `llama-server` running, measure the three versioned, synthetic FIM scenarios:

```bash
npm run benchmark -- --runs 5 --warmup 1 --label cpu-reference --model Qwen2.5-Coder-1.5B-Q8_0 --server-label "llama.cpp-<version>; cache-reuse=256"
```

The command writes a timestamped JSON report to `benchmarks/results/` (ignored by Git). It records model/server labels plus local runtime metadata, aggregate timing, token/cache data, HTTP outcome and a simple expected-output check — never prompts or completions. Use `--output -` for stdout only, `--scenario normalize-host` to run one scenario, and `--strict` if a non-matching expected output should fail automation. This is an `/infill` baseline; editor-side debounce, flicker and partial acceptance remain separate VS Code UX measurements.
