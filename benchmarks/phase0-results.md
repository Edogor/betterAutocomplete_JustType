# Phase 0 – erster lokaler Referenzlauf

Datum: 1. September 2026. Dieser Lauf prüft die Kompatibilität des Kernpfads, nicht die endgültige Zielhardware-Grenze.

| Komponente | Wert |
|---|---|
| Hardware | Ryzen 5 5625U, CPU-only |
| Server | llama.cpp 0.3.0-dev, lokal gebaut |
| Modell | vorhandener `qwen2.5-coder:7b`-GGUF-Blob, nicht das spätere 1.5B-Zielmodell |
| Kontext | 4096, `--cache-reuse 256` |
| FIM-Aufgabe | `def normalize_host(host: str) -> str:` mit `return ` als Prompt |
| Antwort | `host.lower()` |

| Lauf | Prompt-Evaluation | Generierung | Gesamtdauer / Roundtrip | Ergebnis |
|---|---:|---:|---:|---|
| erster Lauf | 756 ms für 24 Tokens | 418 ms für 4 Tokens (7,17 Tokens/s) | 1.174 ms | korrektes FIM-Ergebnis |
| warmer Lauf | 143 ms für 1 neuen Token, 27 gecacht | 438 ms für 4 Tokens (6,85 Tokens/s) | 591 ms | korrektes FIM-Ergebnis |

Der reproduzierbare Prüfbefehl ist `npm run smoke:llama`. Die vollständige Phase-0-Tabelle in `phase0.md` bleibt für die Messung mit dem vorgesehenen 1.5B-Modell und echten Editorsequenzen offen.

## Zielmodell-Baseline – 2. September 2026

Dieser automatisierte Lauf misst ausschließlich den lokalen `/infill`-Pfad. Er speichert keine Prompts oder Modellantworten; die vollständigen aggregierten JSON-Berichte liegen lokal unter `benchmarks/results/` und sind Git-ignoriert.

| Komponente | Wert |
|---|---|
| Hardware | AMD Ryzen 5 5625U, 12 logische Kerne, 30 GiB RAM |
| Server | llama.cpp `0.2.0-dev` (Commit `eb25b72`), CPU-only |
| Modell | `Qwen2.5-Coder-1.5B-Q8_0` (1,70 GB GGUF) |
| Server-Parameter | `--ctx-size 4096 --cache-reuse 256 --parallel 1 --n-gpu-layers 0` |
| Messung | 1 Warm-up + 5 gemessene Läufe je Szenario, `n_predict=32`, Client-Timeout 2,5 s |

| Szenario | frischer KV-Cache* | Warm p50 | Warm p90 | Tokens/s (p50) | Erwartungs-Matches |
|---|---:|---:|---:|---:|---:|
| Host normalisieren | 504 ms | 1.485 ms | 1.799 ms | 17,60 | 5/5 |
| Funktionsrumpf | 1.072 ms | 934 ms | 976 ms | 18,09 | 5/5 |
| FIM mit rechtem Kontext | 432 ms | 112 ms | 119 ms | 18,03 | 5/5 |
| Gesamt (15 warme Läufe) | – | 565 ms | 1.486 ms | 18,03 | 15/15 |

\* Der frische KV-Cache wurde jeweils nach einem Server-Neustart gemessen; die Modellladezeit von etwa 1,3 Sekunden ist nicht Teil des HTTP-Requests. Die Unterschiede folgen vor allem der generierten Länge (2 bis 32 Tokens), nicht allein dem Cache.

**Befund:** Der lokale 1,5B-Kern ist funktional und für kurze FIM-Antworten sehr schnell. Lange, nicht gestreamte Antworten können die Ein-Sekunden-Marke jedoch überschreiten. Vor einem Produktentscheid sollte deshalb ein kleineres sichtbares/erzeugtes Token-Budget (z. B. 16 statt 32) gegen Relevanz getestet werden. Die Erwartungs-Matches sind nur eine grobe, synthetische Plausibilitätsprüfung und ersetzen keine Editor-UX- oder Akzeptanzmessung.
