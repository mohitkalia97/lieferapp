LieferRoute V5

GitHub Pages Update:
1. ZIP entpacken.
2. Die Dateien im bestehenden GitHub-Repository durch diese Dateien ersetzen.
3. Commit changes.
4. GitHub Pages aktualisiert die App automatisch.

Neu in V5:
- Touren dauerhaft in IndexedDB speichern
- Aktive Tour fortsetzen
- Gespeicherte / abgeschlossene Touren
- Zugestellt / Nicht zugestellt / Später
- Kundennotizen
- Stopps bearbeiten, hinzufügen, löschen und verschieben
- Backup aller Touren als JSON + Wiederherstellung
- CSV-Export
- Waze + Google Maps
- PDF-/Foto-/TXT-/CSV-Import

Hinweis: Für OCR von PDF/Fotos wird beim Import Internet benötigt, da PDF.js und Tesseract.js extern geladen werden. Die gespeicherten Touren selbst bleiben lokal auf dem Gerät.


V5.1 OCR-Fix:
- Morawa-PDFs werden nur in der Kundenspalte gelesen.
- TSV/Koordinaten statt reiner OCR-Textreihenfolge.
- Keine doppelte Fallback-Mischung mehr.
- Eintrag braucht Adresse + PLZ; 'nicht beliefert'-Zeilen ohne PLZ werden nicht als Zustellstopp importiert.

V5.5 Tourenoptimierung:
- In der aktiven Tour oder Tourliste auf "Tour optimieren" tippen.
- Start: aktueller GPS-Standort, eigene Startadresse oder erster offener Stopp.
- Vorschau mit Reihenfolge, Fahrzeit, Strecke und geschätzter Zeitersparnis.
- Nur offene Stopps werden sortiert. "Später" wird optional einbezogen.
- Zustellstatus, Notizen und bereits bearbeitete Stopps bleiben erhalten.
- "Sortierung zurücksetzen" stellt die letzte Reihenfolge wieder her, auch nach Neuladen.
  Manuelles Verschieben, Hinzufügen, Entfernen oder "Später"-Verschieben beendet diese Rückgängig-Option.
- Uneindeutige Adressen müssen ausgewählt oder korrigiert werden; kein Stopp wird übersprungen.
- Erkannte Standorte werden lokal zwischengespeichert, getrennt nach Adresse und Land.
- Bis zu 80 Stopps pro Berechnung, ohne Rückfahrt zum Start. Der erste offene Stopp
  bleibt fest, wenn er als Startpunkt gewählt wird.

Kartendienste:
Die Berechnung benötigt Internet. Photon erhält nur Straße und PLZ/Ort, OSRM nur
Koordinaten. Kundenname und Notiz werden nicht gesendet. GPS wird erst bei einer
gestarteten Berechnung angefragt; HTTPS oder localhost ist dafür erforderlich.
OSRM liefert eine heuristische Reihenfolge auf Basis des Straßennetzes. Diese wird
mit der aktuellen Reihenfolge verglichen; eine langsamere Variante wird verworfen.
Die Schätzung enthält keinen Live-Verkehr, keine Zustellzeiten, Zeitfenster oder
Fahrzeugbeschränkungen und garantiert kein globales Optimum.

Standarddienste (in routing.js unter SERVICES austauschbar):
- https://photon.komoot.io / https://github.com/komoot/photon
- https://router.project-osrm.org / https://project-osrm.org
- Daten: https://www.openstreetmap.org/copyright
Die öffentlichen Dienste haben keine Verfügbarkeitsgarantie. Aufrufe erfolgen
einzeln, mit mindestens 1,1 Sekunden Abstand und lokalem Adresscache. Für größere
Nutzerzahlen oder regelmäßige umfangreiche Nutzung eigene/vertragliche Dienste einsetzen.

Prüfung: node --test tests/*.test.cjs
Lokale Vorschau (GPS und Offline-App): python -m http.server 8765 --bind 127.0.0.1
