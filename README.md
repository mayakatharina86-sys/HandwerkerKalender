# Einsatzplanung für Handwerksbetriebe – Cloudflare Workers + D1

Alles läuft auf Cloudflare: Oberfläche (`public/`), Backend (`src/worker.js`) und Datenbank (D1).
Es ist keine lokale Installation und keine Code-Änderung nötig. Bereitstellung über GitHub + Cloudflare-Dashboard.

Legende: **[BESTÄTIGEN]** = Schritt, den du selbst im Dashboard/auf GitHub ausführen oder bestätigen musst.
Nichts davon ist von mir eingerichtet worden.

## Dateien
| Datei | Zweck |
|---|---|
| `wrangler.jsonc` | Cloudflare-Konfiguration (Worker-Name, statische Dateien, D1-Anbindung `DB`) |
| `package.json` | Abhängigkeit `wrangler` (wird von Cloudflare automatisch installiert) |
| `src/worker.js` | Backend/API (`/api/*`), legt die Datenbanktabellen beim ersten Aufruf selbst an |
| `src/schema.js` | Datenbankschema (nur an dieser einen Stelle definiert) |
| `public/index.html`, `style.css`, `app.js` | Oberfläche (verbunden über relative Aufrufe an `/api/...`) |

## Teil 1 – GitHub vorbereiten [BESTÄTIGEN]
1. Auf github.com anmelden (Konto nötig) → **New repository** → Name z. B. `handwerk-planer` → **Private** → **Create repository**.
2. ZIP entpacken. Im neuen Repository **Add file → Upload files** wählen und den **Inhalt** des Ordners `handwerk-planer` hineinziehen
   (`wrangler.jsonc`, `package.json`, `README.md`, Ordner `src` und `public`). Wichtig: `wrangler.jsonc` muss direkt im Hauptverzeichnis des Repositories liegen.
3. **Commit changes** bestätigen.

## Teil 2 – Worker aus GitHub in Cloudflare erstellen [BESTÄTIGEN]
(Die Bezeichnungen im Dashboard können sich leicht ändern; sinngemäß vorgehen.)
1. dash.cloudflare.com → anmelden → **Workers & Pages**.
2. **Create application** → **Import a repository** (Git verbinden).
3. GitHub mit Cloudflare verbinden und den Zugriff auf das Repository freigeben **[BESTÄTIGEN – GitHub-Berechtigung]**.
4. Repository `handwerk-planer` auswählen.
5. Projekt-/Worker-Name: **`handwerk-planer`** (muss exakt dem Wert `name` in `wrangler.jsonc` entsprechen, sonst schlägt der Build fehl).
6. Build-Einstellungen:
   - Root directory: leer lassen (`/`)
   - Build command: **leer lassen** (es gibt keinen Build-Schritt)
   - Deploy command: **`npx wrangler deploy`**
   - Production branch: `main`
7. **Save and Deploy** **[BESTÄTIGEN]**.

## Teil 3 – Datenbank (D1)
Die `wrangler.jsonc` enthält die D1-Anbindung `DB` mit Namen `handwerk-planer-db` **ohne** feste ID.
Wrangler (ab Version 4.45) legt die Datenbank beim ersten Deploy automatisch an und verbindet sie. Die Tabellen legt der Worker beim ersten Aufruf selbst an.
- Prüfen **[BESTÄTIGEN]**: Dashboard → **Storage & Databases → D1 SQL database** → es sollte `handwerk-planer-db` existieren.
- Falls der Build-Log einen D1-/Datenbankfehler meldet (z. B. fehlende `database_id` oder fehlende Berechtigung):
  1. Im Dashboard unter **D1 → Create database** die Datenbank `handwerk-planer-db` selbst anlegen **[BESTÄTIGEN]** und die angezeigte **Database ID** kopieren.
  2. Auf GitHub `wrangler.jsonc` öffnen → Stift-Symbol (Edit) → bei `"database_name": "handwerk-planer-db"` ein Komma anhängen und darunter `"database_id": "KOPIERTE-ID"` einfügen → **Commit changes**. Der Build startet automatisch erneut.
  (Das ist nur der Ausweichweg; im Normalfall nicht nötig. Ob die automatische Anlage in deinem Konto funktioniert, kann ich nicht vorab prüfen.)
- Der API-Token für Builds benötigt Rechte für D1; Cloudflare bietet dazu beim Einrichten der Builds an, einen Token zu erstellen **[BESTÄTIGEN]**.

## Teil 4 – Öffnen und testen
1. Nach erfolgreichem Build: Worker `handwerk-planer` → Adresse `https://handwerk-planer.<dein-subdomain>.workers.dev` öffnen.
2. Unter „Mitarbeiter“ einen Mitarbeiter anlegen → im Kalender erscheint die Zeile. Seite neu laden: Daten bleiben erhalten (= D1 funktioniert).
3. Unter „Einstellungen“ → „Gesetzliche Feiertage … eintragen“ ausführen (optional).

## Teil 5 – Zugriffsschutz (dringend empfohlen) [BESTÄTIGEN]
Die App hat keinen Login. Wer die Adresse kennt, kann alles lesen/ändern. Schutz ohne Code-Änderung:
Dashboard → **Zero Trust → Access → Applications → Add an application → Self-hosted** → die Worker-Adresse eintragen → Regel „Erlaubte E-Mail-Adressen“ anlegen.
(Zero Trust muss einmalig aktiviert werden; für kleine Teams gibt es einen kostenlosen Tarif – aktuelle Konditionen bitte bei Cloudflare prüfen.)

## Änderungen später
Dateien auf GitHub bearbeiten und committen → Cloudflare baut und veröffentlicht automatisch neu.

## Hinweise
- Datensicherung: D1 „Time Travel“ (Wiederherstellung auf frühere Zeitpunkte) + Export-JSON unter Einstellungen.
- Mehrere Geräte: Aktualisierung alle 15 Sekunden; bei gleichzeitiger Änderung desselben Eintrags gilt „letzte Speicherung gewinnt“.
- PDF-Erstellung lädt jsPDF von cdnjs.cloudflare.com (Internet im Browser nötig).
- Mitarbeiter „löschen“ blendet nur aus (wiederherstellbar). Baustellen werden nie gelöscht.
- Feiertage: Button trägt bundesweite deutsche Feiertage ein; andere manuell ergänzen.
- Drag-and-Drop nur mit Maus; auf Touchgeräten Eintrag antippen und Datum/Mitarbeiter im Dialog ändern.
