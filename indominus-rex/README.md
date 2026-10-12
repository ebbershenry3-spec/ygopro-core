# Indominus Rex – Statue 1:15

Interaktive 3D-Statue im Stil eines Sammler-Dioramas. Das JWE2-Modell der Indominus Rex steht auf einem erlegten Ankylosaurus. Dazu kommen ein Sockel mit Moos, Farnen, Felsen und Fossil-Relief sowie blaue Zierstreifen.

## Ansehen

`index.html` über einen lokalen Webserver öffnen, zum Beispiel so:

```sh
cd indominus-rex
python3 -m http.server 8000
# dann http://localhost:8000/ im Browser öffnen
```

Die Seite ist ein HTML-Fragment ohne `<!doctype>`, weil sie als Artifact veröffentlicht wird. Moderne Browser zeigen sie trotzdem korrekt an.

Bedienung:

- Drehen und Zoomen mit Maus oder Finger.
- Drei Posen: **Triumph**, **Drohung**, **Wachsam**. Der rechte Fuß bleibt dabei per Bein-IK auf dem Panzer.
- Drei Lichtstimmungen: **Studio**, **Galerie**, **Nacht**.
- **Drehteller** schaltet die automatische Rotation ein.
- **Maße** blendet Lineale in Zentimetern im Maßstab 1:15 ein.

## Dateien

| Pfad | Inhalt |
| --- | --- |
| `assets/indominus_rex.glb` | Ausgangsmodell „Indominus Rex – Idle“, JWE2-Rig mit 158 Knochen |
| `assets/*.glb.b64.txt` | Web-Fassungen, die die Seite lädt: JPEG-Texturen, Base64-kodiert, weil das Artifact-Hosting keine `.glb` ausliefert. Die Indominus-Datei ist das Ausgangsmodell, das Diorama enthält Erde, Felsen, Moospolster und den toten Ankylosaurus |
| `export/indominus_statue_1zu15.glb` | Fertig posierte Statue mit Sockel als eine Datei, etwa 1 m breit, z. B. für Blender |
| `export/statue_*.png` | Produktfotos |
| `js/rig.js` | Prozedurales Rig: Knochenrotationen im Kreaturen-Raum, Zwei-Knochen-IK für die Beine |
| `js/poses.js` | Die drei Statuen-Posen als Parameter |
| `js/plinth.js` | Mehrstufiger Sockel mit Fossil-Relief, blauen Streifen und Namensschild |
| `js/plants.js` | Farne, Blattrosetten, Moos-Büschel mit Sporenkapseln, Laubstreu |
| `js/statue.js` | Szene, Studio-Licht, Kamera, Maße |
| `tools/build_diorama.py` | Erzeugt `diorama.glb`: Signed Distance Fields, Marching Cubes, Vertex-Farben mit Umgebungsverdeckung |
| `tools/sdf.py` | SDF-Bausatz und GLB-Writer |
| `tools/pack_web.py` | Packt ein GLB für das Web: JPEG-Texturen, Base64-Text |

Diorama neu erzeugen:

```sh
pip install numpy scikit-image fast-simplification pillow
cd tools
python build_diorama.py /tmp
python pack_web.py /tmp/diorama.glb ../assets/diorama.glb.b64.txt
python pack_web.py ../assets/indominus_rex.glb ../assets/indominus_rex.glb.b64.txt
```

## Noch nicht fertig

`js/creature.js` mit Gangzyklus und Fußplatzierung sowie `tools/build_creatures.py` mit einem modellierten T‑Rex gehören zu einer Kampfszene. Diese ist noch nicht fertig, und die Statue verwendet sie nicht.

## Lizenz und Credits

- Modell „Indominus Rex – Idle“ von [Nobilis the Palaeovespa 2](https://sketchfab.com/3d-models/indominus-rex-idle-d50bb47c26f445bfbfe518ff79fcb13a), Lizenz [CC BY 4.0](http://creativecommons.org/licenses/by/4.0/). Für die Statue wurde es neu posiert.
- Die Gestaltung orientiert sich an der 1/15-Statue von Prime 1 Studio. Es werden keine Logos oder Markenzeichen übernommen.
