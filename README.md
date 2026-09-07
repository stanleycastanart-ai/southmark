# STANSPACE Web 3D Viewer

A minimal, mobile-friendly Three.js viewer for SketchUp-exported GLB models.

Current public build: V01 presentation and walkthrough controls.

## Add the presentation model

Export the SketchUp model as GLB, name it `model.glb`, and place it in `assets/model.glb`. The public viewer will load it automatically. Without a bundled model, visitors can choose a local GLB file for a private preview in their browser.

## Preview locally

Run a local static server in this folder, then open the shown address in a browser:

```sh
npx serve .
```

## Deploy

The site is intentionally build-free and can be published directly with GitHub Pages.
