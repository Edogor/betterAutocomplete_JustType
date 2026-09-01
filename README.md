# JustType

JustType is a local predictive coding companion for VS Code. It shows a single inline completion while keeping the programmer in control of every accepted edit.

## Current scope

Version `0.0.1` supports one Python cursor, a manually started local `llama.cpp` server, Ghost Text, request cancellation, exact prediction reuse and partial acceptance. It does not yet include goal tracking, sidecards, automatic model management or repository indexing.

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
code --install-extension artifacts/justtype-0.0.1.vsix
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
| Ctrl+Right | Accept the next word |
| Shift+Tab | Accept the next line |
| Esc | Dismiss and discard the current inline suggestion |

## Settings

- `justType.enabled`
- `justType.triggerMode`
- `justType.llamaCpp.endpoint`

## Privacy

JustType only keeps aggregate performance counters in memory for the active extension session. It never persists prompts, source code, paths or model responses.
