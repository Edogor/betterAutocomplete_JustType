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
