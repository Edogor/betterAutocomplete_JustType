# JustType – lebender Projektplan

> Stand: 1. September 2026  
> Phase: Phase-1-Completion-Kern implementiert und lokal validiert; Phase 2 folgt  
> Rohnotizen: [GrundIdee.md](./GrundIdee.md)

Dieses Dokument ist der geordnete, fortlaufend aktualisierte Plan. Die ursprünglichen Notizen bleiben unverändert; neue Ideen werden hier an der passenden Stelle ergänzt.

## 1. Das Projekt auf einen Blick

| Frage | Aktuelle Antwort |
|---|---|
| Was ist JustType? | Ein prädiktiver Coding-Begleiter, der vorausdenkt, während der Mensch selbst programmiert. |
| Was ist der Kern? | Live-Ghost-Text plus eine fortlaufende Hypothese darüber, was der Nutzer erreichen will. |
| Was unterscheidet es von Coding-Agenten? | Es ändert nichts ungefragt. Der Nutzer bleibt Autor und entscheidet über jedes Einfügen. |
| Erste Oberfläche | Kleine VS-Code-Extension, kein eigener Editor. |
| Erste Sprache | Python; die Architektur bleibt sprachunabhängig. |
| Erstes Modell | Lokales FIM-Modell, zunächst Qwen2.5-Coder 1.5B. |
| Inferenz | `llama.cpp` über den nativen `/infill`-Endpunkt. |
| Wichtigste technische Idee | Ein rollender Prediction Buffer wird wiederverwendet und nur bei echter Abweichung neu berechnet. |
| Nächster Meilenstein | Kerngefühl mit `llama.vscode` messen, dann eine fokussierte eigene Extension bauen. |

**Kernsatz:** Der Mensch schreibt; das System denkt voraus.

**Zentrale Produktgrenze:** Das System darf fortlaufend vorausdenken, aber nur begrenzt unterbrechen.

## 2. Vision und Problem

Heutige Autocompletes sind häufig kurzsichtig. Autonome Coding-Agenten gehen in die andere Richtung und übernehmen schnell die eigentliche Arbeit. JustType soll die Lücke dazwischen schließen:

- schneller schreiben, ohne die Autorschaft abzugeben;
- Syntax, APIs und bekannte Muster nicht ständig nachschlagen müssen;
- Voraussetzungen und mögliche Probleme rechtzeitig sehen;
- mögliche nächste Implementierungsschritte entdecken;
- Inspiration erhalten, ohne dafür in einen Chat wechseln zu müssen.

„Anti vibe coding“ bedeutet hier nicht „gegen KI“. Es bedeutet: Die KI bereitet vor, erinnert und prognostiziert; der Programmierer versteht, schreibt, korrigiert und entscheidet.

## 3. Leitprinzipien

1. **Der Nutzer bleibt Autor.** Keine stillen Dateiänderungen, Installationen oder Terminalbefehle.
2. **Ziel vor bloßer Textfortsetzung.** Die Completion soll zum Vorhaben passen, nicht nur statistisch zum letzten Token.
3. **Ablehnung ist Information.** Weiterschreiben, Editieren und Verwerfen aktualisieren die Vorhersage.
4. **Kontinuierlich vorbereiten, sparsam anzeigen.** Hintergrundarbeit darf die Oberfläche nicht flackern lassen.
5. **Unsicherheit bleibt sichtbar.** Das System zeigt eine „Ziel-Hypothese“, keine angebliche Gewissheit.
6. **Relevanz vor Vollständigkeit.** Ein jetzt benötigter Hinweis ist wertvoller als zehn allgemein richtige Tipps.
7. **Lokal und schlank beginnen.** Kein unnötiger Server-Stack und kein Agenten-Framework im MVP.

## 4. Gewünschtes Nutzungserlebnis

1. Der Nutzer schreibt normalen Code oder beschreibt das Ziel in einem Kommentar.
2. JustType hält eine kompakte, korrigierbare Ziel-Hypothese, zum Beispiel „lokalen Netzwerk-Scanner implementieren“.
3. Im Editor erscheint höchstens eine unmittelbar passende Ghost-Text-Completion.
4. Im Hintergrund liegt eine längere, aber begrenzte mögliche Fortsetzung im Prediction Buffer.
5. Tippt der Nutzer in die Vorhersage hinein, wird sie lokal weiterverwendet.
6. Weicht er ab, verschwindet der unpassende Text sofort; erst nach einer kurzen Schreibpause wird neu gerechnet.
7. Relevante Voraussetzungen, Risiken oder Alternativen erscheinen später als wenige priorisierte Sidecards.

### Vier Vorhersagehorizonte

| Horizont | Frage | Darstellung |
|---|---|---|
| H0 | Welche Tokens oder Zeile kommen jetzt? | Ghost Text im Editor |
| H1 | Welcher Codeblock kommt danach? | Prediction Buffer, auf Wunsch teilweise annehmbar |
| H2 | Was ist der nächste Arbeitsschritt? | kompakte Sidecard |
| H3 | Welche Alternative oder neue Möglichkeit gibt es? | ruhige Inspirations-Warteschlange |

„Nicht aufhören zu generieren“ wird deshalb nicht als unendliche Inferenz umgesetzt. Es bedeutet einen **rollenden, begrenzten Zukunftspuffer**:

- in kurzen Bursts von ungefähr 128 Tokens generieren;
- sichtbar höchstens etwa acht Zeilen zeigen;
- nachfüllen, wenn weniger als ungefähr 32 Tokens oder zwei Zeilen übrig sind;
- für H0/H1 nur auf wenigen aktuellen Codepfaden vorhersagen und genau einen davon anzeigen;
- für H2/H3 höchstens zwei ruhige Alternativen in einer getrennten Explorations-Warteschlange halten;
- Exploration nur im Leerlauf ausführen und niemals eine Completion verzögern;
- alte Kandidaten automatisch verfallen lassen;
- bei Aktivität des Nutzers hat die UI immer Vorrang vor Hintergrundarbeit.

## 5. Technischer Spike und Produkt-MVP

Der **technische Spike** beweist zuerst Latenz, Ghost Text und Wiederverwendung. Das ist noch nicht das fertige JustType-Produkt. Das **Produkt-MVP** ist erst erreicht, wenn zusätzlich eine sichtbare, korrigierbare Ziel-Hierarchie sowie mindestens ein priorisierter Hinweis und ein ruhiger Inspirations-Teaser funktionieren. Sonst wäre das Ergebnis lediglich ein gutes lokales Autocomplete.

### Im technischen Spike enthalten

- VS-Code-Extension in TypeScript;
- zunächst Python und ein einzelner Cursor;
- lokales Fill-in-the-Middle aus Präfix und Suffix;
- mehrzeiliger Ghost Text;
- vollständige, zeilenweise und wortweise Annahme;
- `Esc` zum Verwerfen;
- Debounce, Request-Abbruch und Schutz vor verspäteten Antworten;
- Wiederverwendung, solange getippter Text zur Vorhersage passt;
- kleiner In-Memory-LRU-Cache;
- lokale Latenz- und Cache-Messwerte für die Entwicklung.

### Zusätzlich im Produkt-MVP enthalten

- Ziel-Hierarchie aus Projektziel, aktueller Aufgabe und Cursor-Intention;
- manuelle Korrektur und Anheften des Ziels;
- stabil abgeleitete Ziel-Hypothese mit Evidenz und Konfidenz;
- dauerhaft sichtbares Ziel, maximal eine dringende Karte und ein Inspirations-Teaser;
- begrenzte H2/H3-Explorations-Warteschlange, die den Completion-Pfad nie blockiert.

### Bewusst nicht enthalten

- eigener Editor;
- autonome Dateiänderungen oder automatisch ausgeführte Befehle;
- Chat als primäre Oberfläche;
- Agentenschwarm;
- eigener Language Server;
- Tree-sitter, Vektordatenbank oder vollständiger Repository-Index;
- Cloud-Accounts und Teamfunktionen;
- mehrere frei schwebende Fenster.

### Fertig-Kriterien

- Passendes Weitertippen erzeugt keinen neuen Modellaufruf.
- Ein schneller Tipp-Burst erzeugt nach der Pause höchstens einen neuen Request.
- Eine Antwort wird nur angezeigt, wenn Datei, Version, Cursor und Request-Epoche noch passen.
- Eine alte Completion kann niemals an einer neuen Cursorposition eingefügt werden.
- Ohne ausdrückliche Annahme wird kein Arbeitsstand verändert.
- Die erste sichtbare Completion erscheint auf der Zielhardware typischerweise innerhalb von etwa einer Sekunde; der genaue Grenzwert wird im Spike gemessen.
- Die Zahl der Modellaufrufe pro 100 getippten Zeichen sowie Annahmerate und „angezeigt, aber nicht angenommen“ sind messbar.
- Für nicht angenommene Vorschläge wird „angezeigt, aber nicht angenommen“ gemessen; `Esc`, Invalidierung und Provider-Abbruch sind mit der stabilen API nicht immer sicher unterscheidbar.
- Für das Produkt-MVP werden außerdem Korrekturrate der Ziel-Hypothese, Nutzung/Verwerfen von Sidecards, Unterbrechungen pro Minute und Zeit bis zur Fortsetzung gemessen.

## 6. Schlanke technische Architektur

```text
VS-Code-Events
      │
      ▼
CompletionSessionController
  ├── Diff- und Invalidierungslogik
  ├── Debounce + Abort + Request-Epoche
  ├── Prediction Buffer + LRU
  ├── GoalState
  └── ExplorationQueue
      │
      ├──────────────► InlineCompletionProvider ─► Ghost Text
      │
      ▼
GoalState ─► ContextBuilder ─► InferenceClient ─► llama.cpp /infill
      │
      └────────────────────────────► Sidecards (spätere Phase)
```

Alles läuft zunächst in einer Extension. `llama.cpp` ist der einzige separate lokale Prozess. Es gibt keine Datenbank, Queue, Backend-Anwendung oder Framework-Schicht.

| Komponente | Verantwortung |
|---|---|
| `CompletionSessionController` | Hält pro aktivem Dokument Version, Cursoranker, Epoche, laufenden Request und Buffer. |
| `ContextBuilder` | Schneidet Präfix, Suffix, Sprache, Dateiname, angeheftetes Ziel und knappe Zusatzinformationen innerhalb eines Token-/Zeichenbudgets aus. |
| `InferenceClient` | Ruft `POST /infill` auf und verwaltet getrennte Abbrüche für den aktuellen Provider-Aufruf und den länger lebenden Session-/Prefetch-Request. |
| `PredictionBuffer` | Speichert Completion, sichtbaren Ausschnitt, Resttext, Herkunfts-Hash und Ablaufzeit. |
| `InlineCompletionProvider` | Gibt nur den noch gültigen sichtbaren Buffer-Teil an VS Code zurück. |
| `GoalTracker` | Aktualisiert die dreistufige Ziel-Hierarchie außerhalb des latenzkritischen Completion-Pfads. |
| `ExplorationQueue` | Hält höchstens zwei niedrig priorisierte H2/H3-Alternativen, die nur im Leerlauf entstehen. |
| `SidecardProvider` | Erzeugt später wenige deduplizierte Hinweise aus einem stabilen Snapshot. |

Die stabile VS-Code-API ist request/response-orientiert. Deshalb wächst Ghost Text im MVP bei Editor-Ereignissen oder partieller Annahme weiter, nicht als tokenweise Animation im Stillstand. Eine echte tokenweise Live-Animation würde eine experimentelle API oder einen eigenen Editor erfordern und gehört nicht in den technischen Spike.

Für FIM werden vollständige Zeilen vor dem Cursor als `input_prefix`, der rechte Cursorrest plus Folgezeilen als `input_suffix` und der linke Teil der aktuellen Zeile als `/infill`-`prompt` gesendet. Das hält den häufig geänderten Teil am Prompt-Ende und verbessert die Cache-Wiederverwendung. Das Kontextbudget reserviert immer Platz für `n_predict`; feste Zeilenzahlen allein reichen nicht.

Steht rechts vom Cursor bereits Text, zeigt der technische Spike nur eine einzeilige Completion. Mehrzeiliger Ghost Text ist zunächst nur am Zeilenende erlaubt, damit Einfügebereich und Suffix nicht miteinander kollidieren.

## 7. Intelligente Wiederverwendung und Invalidierung

### Regel 1: Vorhersage lokal verbrauchen

Wenn der Nutzer am ursprünglichen Anker exakt den Anfang von `buffer.remaining` tippt **und der rechte Kontext unverändert ist**, werden diese Zeichen nur aus dem Buffer entfernt. Der laufende Pfad bleibt gültig; kein Modellaufruf ist nötig. Auto-Closing, Formatierer oder Änderungen rechts vom Cursor verhindern diese Wiederverwendung, damit keine Klammern oder Zeichen doppelt entstehen.

### Regel 2: Abweichung weich behandeln

Bei einer Abweichung:

1. unpassenden Ghost Text sofort ausblenden;
2. Request-Epoche erhöhen;
3. laufenden HTTP-Request abbrechen;
4. nicht sofort neu rechnen;
5. nach einer kurzen Ruhephase genau einen neuen Request starten.

Debounce ist die sichere MVP-Näherung, aber noch nicht das Ende der „intelligenten“ Abweichungslogik. Als nächstes Experiment bleiben nicht passende Kandidaten kurz unsichtbar erhalten. Der komplette Tipp-Burst wird dann gegen weitere gecachte Kandidaten sowie eine whitespace-normalisierte Variante geprüft. Passt ein anderer Kandidat sicher, wird er ohne Modellaufruf hochgestuft; andernfalls folgt die neue Inferenz. Near-Matches werden niemals ungeprüft eingefügt.

Startwerte:

- normale Eingabe: 120 ms Debounce;
- Paste, größere Löschung oder Formatierung: 250 ms;
- später adaptiv: ungefähr `1,5 × medianer Tastenabstand`, begrenzt auf 80–250 ms.

### Regel 3: Alte Antworten sind wertlos

Jeder Request merkt sich:

```text
documentUri + documentVersion + cursorOffset + epoch
```

Die Antwort wird nur verwendet, wenn alle vier Werte noch aktuell sind. Andernfalls wird sie lautlos verworfen. Ein HTTP-Abbruch beendet die Serverarbeit nicht unter allen Umständen sofort; deshalb bleiben ein serverseitiges Zeitlimit wie `t_max_predict_ms` und dieses Epochen-Gate notwendig.

### Regel 4: Drei Cache-Ebenen

1. **Typed-prefix reuse:** Der Nutzer tippt in eine vorhandene Vorhersage hinein.
2. **Result-LRU und Kandidaten-Re-Ranking:** Ein Hash aus Präfix, Suffix und Cursorfragment findet frühere Completions wieder; ein Tipp-Burst kann zu einem anderen gecachten Kandidaten wechseln.
3. **Serverseitiger KV-Cache:** `llama.cpp` wertet bei ähnlichem Kontext nur den neuen Anteil aus.

Beim Nachfüllen wird `tatsächliches Präfix + bisheriger Prediction Buffer` als spekulatives Präfix mit demselben tatsächlichen Suffix gesendet. Neue Tokens werden nur angehängt, wenn die Session-Epoche weiterhin identisch ist.

### Regel 5: Semantische Auslöser

Neue Inferenz wird bevorzugt nach einer tatsächlichen Pause oder einer sinnvollen Grenze geplant, etwa nach Zeilenumbruch, Kommentar, Funktionskopf oder abgeschlossenem Ausdruck. Cursorwechsel, Mehrfachauswahl, große Löschung oder Änderung an anderer Stelle invalidieren den lokalen Pfad hart.

## 8. Ziel-Hypothese

Das Ziel ist für das Produkt zentral, darf aber die Ghost-Text-Latenz nicht blockieren.

```text
GoalState = {
  projectGoal,       // langfristiges Vorhaben
  taskGoal,          // aktuelle Aufgabe
  cursorIntent,      // unmittelbare Absicht an dieser Stelle
  confidence,
  evidence,
  contextHash,
  pinned
}
```

Eine ausdrückliche, angeheftete Nutzerangabe hat immer Vorrang. Die erste Version benötigt danach kein zweites Modell. Automatische Evidenz wird je Ebene getrennt bewertet:

1. manuell gesetztes oder angeheftetes Ziel;
2. Projektdateien und Dateiname für `projectGoal`;
3. TODO, Docstring und umgebender Klassen-/Funktionsname für `taskGoal`;
4. nächster Kommentar, aktueller Ausdruck, Imports und neue Bezeichner für `cursorIntent`.

So überschreibt ein lokaler Kommentar nicht versehentlich das gesamte Projektziel. Aktualisierung erfolgt erst nach ungefähr 700 ms Ruhe oder bei strukturellen Ereignissen wie Kommentar, `import`, `class` oder `def`. Hysterese verhindert Flackern: Eine bestehende Hypothese wird nur ersetzt, wenn die neue Evidenz deutlich stärker ist.

Das Ziel wird in der nativen View angezeigt. Korrektur erfolgt im MVP über einen Command mit Eingabefeld; eine Tree-View selbst ist nicht inline editierbar. Pin-/Später-/Verwerfen-Aktionen können als Tree-Item-Aktionen bleiben. Ein angeheftetes Ziel kann später über `input_extra` in die Completion einfließen; sein Einfluss wird gegen eine Variante ohne Zielkontext gemessen.

Ein separates Modell darf später im Leerlauf eine bessere Formulierung erzeugen, aber niemals den Completion-Hotpath blockieren.

## 9. Sidecards statt Fensterflut

Später gibt es eine einzige ruhige Seitenleiste, vorzugsweise als native VS-Code-Tree-View. Gleichzeitig sichtbar sind genau drei Ebenen: das Ziel dauerhaft, höchstens eine dringende Karte und höchstens ein Inspirations-Teaser. Weitere Ergebnisse warten eingeklappt und nach Priorität sortiert.

| Karte | Inhalt |
|---|---|
| Ziel | aktuelle, per Command korrigierbare Ziel-Hypothese |
| Jetzt wichtig | tatsächlicher Blocker, Fehler oder Voraussetzung |
| Nächster Schritt | wahrscheinliche Implementierungsrichtung |
| Entdecken | passende Alternative, Bibliothek oder Syntax-Idee |

Priorität:

1. Sicherheits- oder Korrektheitsproblem;
2. tatsächlicher Blocker;
3. unmittelbar benötigte Voraussetzung;
4. nächster Implementierungsschritt;
5. passende Syntax- oder API-Hilfe;
6. Alternative oder Inspiration;
7. allgemeine Dokumentation.

Jede Karte braucht `Anheften`, `Später`, `Verwerfen` und eine Ablaufzeit. Mehrere Helfer oder Provider liefern keine eigenen Fenster, sondern Vorschläge an eine gemeinsame Priorisierung.

Beispiel: Bei `import numpy` wird eine Installationskarte nur prominent, wenn NumPy in der gewählten Umgebung tatsächlich fehlt. Matrixmultiplikation wird erst vorgeschlagen, wenn Kommentar, Code oder Ziel auf Matrizen hindeuten. Befehle werden angezeigt, aber nie ungefragt ausgeführt.

## 10. Vorhandene Projekte und getroffene Entscheidung

Stand der Prüfung: 1. September 2026.

| Baustein | Verwendung für JustType | Entscheidung |
|---|---|---|
| [`ggml-org/llama.vscode`](https://github.com/ggml-org/llama.vscode) (MIT) | Besitzt bereits lokales FIM-Ghost-Text, Teilannahme, Debounce, LRU, Prefix-Reuse und Future-Prefetch. | Unverändert als Hardware-/UX-Spike testen. Nicht den heutigen Gesamtumfang mit Chat, Agent, RAG und Modellverwaltung forken. Relevante Completion-Algorithmen gezielt übernehmen und MIT-Hinweis erhalten. |
| [`llama.cpp`](https://github.com/ggml-org/llama.cpp) (MIT) | Schlankes lokales Backend; [`/infill`](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md#post-infill-for-code-infilling) unterstützt Präfix, Suffix, Zusatzkontext und Cache-Reuse. | Backend für den eigenen MVP. |
| [Offizielles VS-Code-Inline-Completion-Beispiel](https://github.com/microsoft/vscode-extension-samples/tree/main/inline-completions) | Minimaler, offizieller Extension-Ausgangspunkt. | Grundlage des eigenen Extension-Shells. |
| [Continue](https://github.com/continuedev/continue) (Apache-2.0) | Gute Referenz für Debounce, Postprocessing und Kontextauswahl; der Codebestand ist inzwischen read-only. | Studieren, aber nicht als Produktbasis verwenden. |
| [Tabby](https://github.com/TabbyML/tabby) | Vollständiger selbst gehosteter Completion-Server mit Editor-Clients. | Für den Ein-Nutzer-MVP zu schwer; später als Architekturvergleich nützlich. |
| [Ollama](https://github.com/ollama/ollama) (MIT) | Sehr einfaches Modellmanagement, Streaming und `suffix`-Parameter. | Gut für einen schnellen Alternativtest; weniger completion-spezifische Kontrolle als `llama.cpp`. |
| [Tree-sitter](https://tree-sitter.github.io/tree-sitter/) | Schnelle inkrementelle Syntaxbäume, auch bei unfertigem Code. | Erst hinzufügen, wenn einfacherer Editor-/LSP-Kontext nachweislich nicht reicht. |

Die passende Basis ist daher **kein großes bestehendes Produkt**, sondern eine kleine eigene Extension, die die bewährten Completion-Ideen aus `llama.vscode` mit JustTypes eigener Produktlogik kombiniert.

## 11. Konkretes Start-Setup

### Schritt A: Ohne eigenen Code das Kerngefühl testen

1. `llama.vscode` in VS Code installieren.
2. Nur ein Completion-Modell aktivieren und RAG zunächst ausschalten.
3. Für die vorhandene CPU Qwen2.5-Coder 1.5B Q8_0 wählen.
4. Mit festen Python-Beispielen Latenz, Qualität, Flackern und Teilannahme notieren.
5. Festhalten, was bereits gut ist und welches Verhalten JustType konkret anders machen soll.

Das ist ein Vergleichstest, keine spätere Abhängigkeit.

### Schritt B: Eigene minimale Extension

Benötigt werden:

- Node.js 24 LTS;
- VS Code;
- TypeScript-Extension-Shell aus dem offiziellen Generator;
- lokaler `llama-server`;
- Qwen2.5-Coder 1.5B als FIM-fähiges GGUF-Modell.

Der offizielle Scaffold-Befehl lautet:

```bash
npx --package yo --package generator-code -- yo code
```

Für einen CPU-only-Test dokumentiert `llama.vscode` beispielsweise:

```bash
llama-server \
  -hf ggml-org/Qwen2.5-Coder-1.5B-Q8_0-GGUF \
  --host 127.0.0.1 \
  --port 8012 \
  -ub 512 \
  -b 512 \
  --ctx-size 0 \
  --cache-reuse 256
```

Die erste eigene Version benötigt nur `package.json`, wenige TypeScript-Dateien und Tests. Weder ein Python-Backend noch Docker sind erforderlich.

### Aktueller Zustand dieses Rechners

- Ubuntu 26.04 LTS;
- Ryzen 5 5625U, 6 Kerne/12 Threads;
- 30 GiB RAM, keine NVIDIA-GPU erkannt;
- Ollama-Client 0.32.3 vorhanden, Server aktuell nicht aktiv;
- Node und npm noch nicht installiert;
- `llama-server` noch nicht installiert.

Damit ist ein 1.5B-Modell auf der CPU ein vernünftiger Start. Die tatsächliche Geschwindigkeit muss im Spike gemessen werden; bei zu hoher Latenz dient die 0.5B-Variante als schnelle Qualitätsuntergrenze.

## 12. Entwicklungsphasen

### Phase 0 – Referenz messen

- `llama.vscode` mit dem 1.5B-Modell testen;
- feste Eingabesequenzen anlegen;
- Time-to-first-ghost, Tokens/s, Cache-Verhalten und Bediengefühl erfassen;
- konkrete JustType-Differenz festhalten.

**Fertig, wenn:** bekannt ist, ob die lokale Hardware für den Kernloop reicht und welches Verhalten wir verbessern müssen.

### Phase 1 – Eigener Completion-Kern

- Extension scaffolden;
- `/infill`-Adapter bauen;
- Ghost Text anzeigen;
- Debounce, Abort, Epochenprüfung und exaktes Prefix-Reuse implementieren;
- vollständige und partielle Annahme;
- LRU und minimale Messwerte.

**Fertig, wenn:** passendes Weitertippen keinen Request erzeugt, ein Tipp-Burst höchstens einen Request auslöst und nie eine veraltete Completion erscheint.

### Phase 2 – Fortlaufender Buffer und Ziel

- Low-/High-Watermark für den Prediction Buffer;
- kontrolliertes Future-Prefetch;
- Ziel-Hierarchie mit Evidenz, Konfidenz und Hysterese;
- Korrektur-/Pin-Aktion;
- dauerhaft sichtbares Ziel, eine priorisierte Karte und ein Inspirations-Teaser;
- kleine H2/H3-Explorations-Warteschlange außerhalb des Completion-Hotpaths.

**Fertig, wenn:** nach Teilannahmen flüssig weiterer Ghost Text bereitsteht, die Zielanzeige stabil und korrigierbar ist und mindestens ein Kontext-/Inspirationshinweis nachweislich hilft. Mit Abschluss dieser Phase ist das **Produkt-MVP** erreicht.

### Phase 3 – Kontext und Inspiration

- weitere Dependency- und Syntax-Provider;
- Umgebungsprüfung vor Installationshinweisen;
- Kontext aus wenigen offenen oder kürzlich bearbeiteten Dateien;
- optional LSP und danach erst Tree-sitter;
- Modi `Fokus`, `Ausgewogen` und `Entdecken` testen.

**Fertig, wenn:** Sidecards nachweislich helfen, ohne den Schreibfluss oder Tastaturfokus zu stören.

### Phase 4 – Erweiterung nur nach Messwerten

- weitere Sprachen;
- optional Cloud-/Hybridmodelle;
- Repository-Kontext;
- komplexere Planungsmodelle;
- andere Editoren über einen kleinen gemeinsamen Kern.

## 13. Risiken und Gegenmaßnahmen

| Risiko | Gegenmaßnahme |
|---|---|
| Ghost Text flackert oder lenkt ab | Debounce, Hysterese, Anzeige-Budget und maximal ein sichtbarer Vorschlag |
| Ziel wird falsch erkannt | als Hypothese kennzeichnen, Evidenz zeigen, Pin/Korrektur erlauben |
| Modell halluziniert APIs oder Befehle | Projektumgebung, Diagnostik und später LSP prüfen; nie automatisch ausführen |
| Vorschlag kommt verspätet am falschen Ort | harte Versions-, Cursor- und Epochenprüfung |
| Kleine Modelle liefern schwachen Code | kleine Modelle für H0/H1, optional stärkeres Modell später nur für H2/H3 |
| Dauerinferenz belastet CPU/Akku | begrenzte Bursts, Idle-/Refill-Regeln und Energiesparmodus |
| KI beeinflusst die eigene Denkrichtung zu stark | Alternativen auf Abruf, geringe visuelle Dominanz und einfaches Verwerfen |
| Übernahme fremden MIT-Codes | Copyright- und Lizenzhinweise in den übernommenen Dateien erhalten |

## 14. Offene Entscheidungen mit empfohlenem Startwert

| Entscheidung | Startwert | Später neu bewerten, wenn … |
|---|---|---|
| Editor | VS Code | der Kernloop stabil ist und echte Nachfrage nach anderen Editoren besteht |
| Sprache | Python | die Zustandslogik zuverlässig getestet ist |
| Inferenz | lokal mit `llama.cpp` | Qualität oder Hardware den Nutzen klar begrenzt |
| Modell | Qwen2.5-Coder 1.5B Base/FIM | Messwerte eine kleinere oder größere Variante rechtfertigen |
| sichtbare Länge | maximal etwa acht Zeilen | Nutzerstudien mehr oder weniger als angenehmer zeigen |
| Anzahl sichtbarer Kandidaten | eins | explizites Wechseln zwischen Alternativen erwünscht ist |
| Zielermittlung | Regeln + Nutzerkorrektur | diese Evidenz für echte Projekte nicht ausreicht |
| Sidecards | eine native View | komplexere Darstellung belegbaren Zusatznutzen hat |

Noch zu entscheiden:

- genauer Projektname und Lizenz;
- endgültige Tastenkombinationen für Wort, Zeile und Block;
- welche lokalen Messwerte gespeichert werden dürfen;
- wann Inspiration automatisch sichtbar werden darf;
- ob ein angeheftetes Ziel projekt-, datei- oder sitzungsbezogen ist.

## 15. Erste umsetzbare Tickets

### JT-001 – Technischer Prediction-Loop-Spike

Gegeben ist eine Python-Datei mit einem Kommentar und teilweise geschriebenem Code. Nach einer kurzen Pause erscheint genau eine lokale FIM-Completion. Tippt der Nutzer passende Zeichen, wird der Rest aus dem Buffer angezeigt, ohne das Modell erneut aufzurufen. Bei einer Abweichung verschwindet die alte Completion sofort und nach Ende des Tipp-Bursts wird genau einmal neu inferiert. Kein Code wird ohne ausdrückliche Annahme eingefügt.

Dieses Ticket beweist nur die technische Grundlage.

### JT-002 – Zielbewusster Produkt-Spike

Zusätzlich zeigt JustType getrennt das angeheftete Projektziel, die vermutete aktuelle Aufgabe und die Cursor-Intention. Der Nutzer kann sie korrigieren. Ein angeheftetes Ziel beeinflusst messbar die Completion. Neben dem Ziel sind höchstens eine dringende Karte und ein Inspirations-Teaser sichtbar; beide entstehen außerhalb des Completion-Hotpaths.

Erst JT-001 plus JT-002 beweisen den eigentlichen JustType-Produktkern. Weitere Provider, Sprachen und Helfer bauen darauf auf.

## 16. Entscheidungslog und neue Ideen

### 1. September 2026

- JustType wird als prädiktiver Begleiter, nicht als autonomer Agent definiert.
- Eine VS-Code-Extension ist der kleinste sinnvolle Start.
- `llama.vscode` wird als Referenztest verwendet, aber nicht vollständig geforkt.
- Der eigene MVP nutzt `llama.cpp /infill` und einen rollenden Prediction Buffer.
- Technischer Spike und Produkt-MVP werden getrennt bewertet.
- Ziel-Hierarchie, ruhige Exploration und streng begrenzte Sidecards sind der eigene Produktwert.

### Eingang für neue, noch unsortierte Ideen

Neue Gedanken können zunächst hier notiert werden. Beim nächsten Planungsschritt werden sie in Vision, MVP, Architektur, Backlog oder offene Entscheidungen einsortiert.
