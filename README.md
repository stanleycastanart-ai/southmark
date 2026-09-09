# WING HAN GROUP 3D Interior Viewer

A clean, touch-friendly architectural Three.js viewer for SketchUp-exported GLB models.

Current review build: basic platform UI with a lightweight placeholder interior.

## Add the presentation model

Export the SketchUp model as GLB, name it `model.glb`, and place it in `assets/model.glb`. The public viewer will load it automatically. Without a bundled model, visitors can choose a local GLB file for a private preview in their browser.

## Preview locally

Run a local static server in this folder, then open the shown address in a browser:

```sh
npx serve .
```

## Deploy

The site is intentionally build-free and can be published directly with GitHub Pages.
