# Google Kalender Web-App

## Setup

Bevor die App funktioniert, musst du einmalig eine Google Cloud Konfiguration erstellen.

### 1. Google Cloud Projekt erstellen

1. Gehe zu https://console.cloud.google.com
2. Neues Projekt erstellen (z.B. "MeinKalender")
3. Im Menü: **APIs & Dienste** > **Bibliothek**
4. Suche nach **Google Calendar API** und aktiviere sie

### 2. OAuth 2.0 Client-ID erstellen

Einen API-Schlüssel braucht die App nicht (er wäre im Browser-Code öffentlich sichtbar).


1. **Anmeldedaten erstellen** > **OAuth-Client-ID**
2. Anwendungstyp: **Webanwendung**
3. Unter "Autorisierte JavaScript-Ursprünge" hinzufügen:
   - `http://localhost` (zum lokalen Testen)
4. Client-ID kopieren

### 3. Client-ID in app.js eintragen

Öffne `app.js` und ersetze:
```js
const CLIENT_ID = 'DEINE_CLIENT_ID.apps.googleusercontent.com';
```

### 4. App starten

Die App muss über einen lokalen Webserver gestartet werden (nicht direkt als Datei öffnen).

**Mit Python:**
```bash
cd "C:\Users\A0228\OneDrive - Allianz\claude"
python -m http.server 8000
```
Dann im Browser: http://localhost:8000

**Mit Node.js (npx):**
```bash
npx serve .
```
