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
