# Kneipenquiz – Halloween-Ausgabe

Ein Bildschirm (Laptop am Beamer oder Fernseher) zeigt die Fragen, jedes Team antwortet mit seinem Handy.
Mitspieler brauchen kein Konto und nichts zu installieren: QR-Code scannen, Teamnamen eingeben, fertig.

## Ausprobieren ohne Einrichtung (Demo-Modus)

Solange in `config.js` `null` steht, läuft die App im Demo-Modus. Dann funktioniert alles, aber nur
zwischen Tabs im selben Browser auf einem Computer. Gut zum Testen, nicht für den Kneipenabend.

## Einmalige Einrichtung (ca. 20 Minuten, kostenlos)

Du brauchst ein Google-Konto (für Firebase) und ein GitHub-Konto (für das Hosting).

### 1. Firebase: die Live-Verbindung zwischen den Geräten

1. Auf <https://console.firebase.google.com> **Projekt hinzufügen**, z. B. „kneipenquiz“. Google Analytics brauchst du nicht.
2. Links **Build → Authentication → Jetzt starten → Anmeldemethode → Anonym** einschalten und speichern.
3. Links **Build → Realtime Database → Datenbank erstellen**. Standort **Belgien (europe-west1)**, Start im **gesperrten Modus**.
4. In der Datenbank auf den Reiter **Regeln**, alles löschen, den Inhalt von `database.rules.json` einfügen, **Veröffentlichen**.
5. Zahnrad oben links → **Projekteinstellungen → Allgemein → Meine Apps → Web-App (Symbol `</>`)** hinzufügen. Firebase Hosting nicht ankreuzen.
6. Firebase zeigt dir ein `firebaseConfig = { ... }`. Kopiere die Werte in `config.js`, sodass es so aussieht:

```js
window.FIREBASE_CONFIG = {
  apiKey: "…",
  authDomain: "kneipenquiz-xxxx.firebaseapp.com",
  databaseURL: "https://kneipenquiz-xxxx-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "kneipenquiz-xxxx",
  appId: "…"
};
```

Wichtig ist `databaseURL`. Falls sie im angezeigten Code fehlt, findest du sie oben auf der Realtime-Database-Seite.
Die Werte sind nicht geheim, sie dürfen öffentlich im Code stehen. Geschützt wird alles über die Regeln aus Schritt 4.

### 2. GitHub Pages: die App ins Internet stellen

1. Auf <https://github.com/new> ein neues **öffentliches** Repository anlegen, z. B. `kneipenquiz`.
2. Auf der Repository-Seite **Add file → Upload files** und alle Dateien aus diesem Ordner hineinziehen
   (`index.html`, `app.js`, `style.css`, `questions.js`, `config.js`, `sw.js`, `manifest.webmanifest`, die Icons).
   Dann **Commit changes**.
3. **Settings → Pages → Branch: main, Ordner: / (root) → Save**. Nach ein bis zwei Minuten steht oben die Adresse,
   z. B. `https://deinname.github.io/kneipenquiz/`.

### 3. Die Adresse in Firebase freigeben

Firebase → **Authentication → Einstellungen → Autorisierte Domains → Domain hinzufügen** → `deinname.github.io`.
Ohne diesen Schritt klappt die Anmeldung auf der echten Seite nicht.

## Als App aufs Handy oder den Laptop

Die Seite ist eine installierbare Web-App (PWA). Sie läuft dann im Vollbild mit eigenem Kürbis-Symbol:

- **iPhone (Safari):** Seite öffnen → Teilen-Symbol → **Zum Home-Bildschirm**.
- **Android (Chrome):** Seite öffnen → Menü ⋮ → **App installieren** bzw. **Zum Startbildschirm hinzufügen**.
- **Laptop (Chrome/Edge):** In der Adressleiste auf das Installieren-Symbol klicken.

Ein Eintrag im App Store oder Play Store ist dafür nicht nötig. Das wäre deutlich aufwendiger
(Entwicklerkonto, 99 $ pro Jahr bei Apple, Prüfung durch den Store) und bringt für ein Quiz kaum Vorteile.

## So läuft ein Abend

1. Laptop an den Beamer, Seite öffnen, **Neues Quiz eröffnen**, Runden und Zeit wählen, **Spiel eröffnen**.
2. Auf der Leinwand erscheinen Spielcode und QR-Code. Jedes Team scannt ihn mit einem Handy und gibt seinen Namen ein.
3. **Quiz starten.** Vor jeder Runde können Teams am Handy ihren Joker setzen (einmal pro Spiel, doppelte Punkte).
4. Bei jeder Frage brennt die Kerze herunter. Teams tippen ihre Antwort, die Leinwand zeigt nur, *wer* schon geantwortet hat.
5. **Antwort zeigen**: Jetzt erscheinen alle Antworten. Richtige antippen, schon sind die Punkte vergeben.
   Bei Schätzfragen tippst du das Team an, das am nächsten dran war.
6. Nach jeder Runde der Zwischenstand auf Grabsteinen, am Ende die Siegerehrung.

Tastatur für den Quizmaster: **Leertaste** weiter, **T** Kerze anhalten/weiter, **1–9** Punkt für Team 1–9.

## Eigene Fragen

- Schnell für einen Abend: beim Eröffnen **Eigene Runde schreiben**, eine Frage pro Zeile: `Frage | Antwort`.
- Dauerhaft: `questions.js` bearbeiten und die Datei neu zu GitHub hochladen.
