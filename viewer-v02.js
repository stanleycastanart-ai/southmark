import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const container = document.querySelector('#viewer');
const input = document.querySelector('#model-input');
const loading = document.querySelector('#loading');
const errorBox = document.querySelector('#error');
const fullscreenButton = document.querySelector('#fullscreen');
const viewButtons = [...document.querySelectorAll('.view-button')];
const modeButtons = [...document.querySelectorAll('[data-mode]')];
const topButton = document.querySelector('#top-view');
const sectionButton = document.querySelector('#section-view');
const sectionPanel = document.querySelector('#section-panel');
const sectionRange = document.querySelector('#section-height');
const sectionReadout = document.querySelector('#section-readout');
const measureButton = document.querySelector('#measure-mode');
const measurementPanel = document.querySelector('#measurement-panel');
const measurementCopy = document.querySelector('#measurement-copy');
const measurementResult = document.querySelector('#measurement-result');
const gestureCopy = document.querySelector('#gesture-copy');
const lensRange = document.querySelector('#lens-range');
const lensReadout = document.querySelector('#lens-readout');
const sunRange = document.querySelector('#sun-range');
const sunReadout = document.querySelector('#sun-readout');
const autoRotateButton = document.querySelector('#auto-rotate');
const spotlightTool = document.querySelector('#spotlight-tool');
const spotlightPanel = document.querySelector('#spotlight-panel');
const closeSpotlight = document.querySelector('#close-spotlight');
const spotlightToggle = document.querySelector('#spotlight-toggle');
const spotlightPlace = document.querySelector('#spotlight-place');
const spotlightCount = document.querySelector('#spotlight-count');
const spotlightOutputRange = document.querySelector('#spotlight-output-range');
const spotlightOutput = document.querySelector('#spotlight-output');
const spotlightBeamRange = document.querySelector('#spotlight-beam-range');
const spotlightBeam = document.querySelector('#spotlight-beam');
const spotlightInstruction = document.querySelector('#spotlight-instruction');
const joystick = document.querySelector('#walk-joystick');
const joystickRing = joystick.querySelector('.joystick-ring');
const joystickKnob = joystick.querySelector('.joystick-knob');
const lightingButtons = [...document.querySelectorAll('[data-lighting]')];

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xe9ece7);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 10000);
camera.position.set(4, 3, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = 1.1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.append(renderer.domElement);

const environment = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(environment).texture;
scene.environmentIntensity = .72;
environment.dispose();
pmrem.dispose();

// Neutral architectural fill with a subtle 4500K key light. One shadow-casting
// light keeps the interior soft while limiting GPU cost on iPad Safari.
const hemisphereLight = new THREE.HemisphereLight(0xf5f7ff, 0xb8ad9d, .32);
scene.add(hemisphereLight);
const architecturalLight = new THREE.DirectionalLight(0xfff1dc, 2.8);
architecturalLight.castShadow = true;
architecturalLight.shadow.mapSize.set(innerWidth > 900 ? 2048 : 1024, innerWidth > 900 ? 2048 : 1024);
architecturalLight.shadow.bias = -.00015;
architecturalLight.shadow.normalBias = .025;
architecturalLight.shadow.radius = 4;
scene.add(architecturalLight, architecturalLight.target);
const architecturalFill = new THREE.DirectionalLight(0xe8f1ff, .62);
scene.add(architecturalFill, architecturalFill.target);
let enhancedLighting = true;
let modelHasEmbeddedLights = false;

function updateSunlight() {
  const hour = Number(sunRange.value);
  const minutes = Math.round((hour % 1) * 60);
  sunReadout.value = `${String(Math.floor(hour)).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  if (!modelBox) return;
  const daylight = THREE.MathUtils.clamp((hour - 7) / 12, 0, 1);
  const altitude = Math.max(.18, Math.sin(daylight * Math.PI));
  const size = modelBox.getSize(new THREE.Vector3());
  architecturalLight.position.set(
    THREE.MathUtils.lerp(modelBox.max.x + size.x * .18, modelBox.min.x - size.x * .12, daylight),
    modelBox.min.y + size.y * (.42 + altitude * .58),
    modelBox.max.z + size.z * .12,
  );
  architecturalLight.target.position.set(
    modelBox.min.x + size.x * .74,
    modelBox.min.y + size.y * .12,
    modelBox.min.z + size.z * .79,
  );
  architecturalLight.intensity = enhancedLighting
    ? (modelHasEmbeddedLights ? .45 + altitude * .55 : 1.35 + altitude * 1.75)
    : 0;
  architecturalLight.target.updateMatrixWorld();
  architecturalLight.shadow.needsUpdate = true;
}

function setLightingMode(mode) {
  const enhanced = mode === 'enhanced';
  enhancedLighting = enhanced;
  renderer.toneMapping = enhanced ? THREE.AgXToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = enhanced ? 1.1 : 1.0;
  renderer.shadowMap.enabled = enhanced;
  renderer.shadowMap.needsUpdate = true;
  scene.environmentIntensity = enhanced ? .72 : 1;
  hemisphereLight.intensity = enhanced ? .32 : 0;
  architecturalLight.intensity = enhanced ? (modelHasEmbeddedLights ? .9 : 2.8) : 0;
  architecturalFill.intensity = enhanced ? .62 : 0;
  lightingButtons.forEach((button) => {
    const active = button.dataset.lighting === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  currentModel?.traverse((node) => {
    if (node.isMesh && node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => { material.needsUpdate = true; });
    }
  });
  updateSunlight();
  updateSpotlight();
}

function updateSpotlight() {
  const output = Number(spotlightOutputRange.value) / 100;
  const beam = Number(spotlightBeamRange.value);
  spotlightOutput.value = `${Math.round(output * 100)}%`;
  spotlightBeam.value = `${beam}°`;
  spotlights.forEach((spot) => {
    spot.light.intensity = spotlightsOn ? 170 * output : 0;
    spot.light.angle = THREE.MathUtils.degToRad(beam / 2);
    spot.light.visible = spotlightsOn;
    spot.glow.emissiveIntensity = spotlightsOn ? .75 + output * 1.65 : 0;
    spot.led.visible = spotlightsOn;
    spot.light.shadow.needsUpdate = true;
  });
}

function refreshSpotlightCount() {
  spotlightCount.textContent = `${spotlights.length} ${spotlights.length === 1 ? 'SPOT' : 'SPOTS'}`;
  updateSpotlight();
}

function setSpotlightEditMode(mode = '') {
  spotlightEditMode = mode;
  spotlightPlace.classList.toggle('armed', mode === 'place');
  if (mode) {
    if (measureMode) setMeasureMode(false);
    controls.enabled = false;
    document.body.classList.add('placing-light');
    spotlightInstruction.textContent = 'Tap the ceiling repeatedly to add lights. Press Add lights again when finished.';
  } else {
    controls.enabled = true;
    document.body.classList.remove('placing-light');
    spotlightInstruction.textContent = 'Press Add lights, then tap the ceiling repeatedly.';
  }
}

function setSpotlightPanel(open) {
  spotlightPanel.hidden = !open;
  spotlightTool.classList.toggle('active', open);
  if (!open) setSpotlightEditMode();
}

function setSpotlightPositionFromPoint(point, spot) {
  if (!modelBox) return;
  if (!spot) return;
  const size = modelBox.getSize(new THREE.Vector3());
  // Use the actual visible ceiling underside instead of the model's global
  // maximum height, which may be a roof, façade or other upper-floor object.
  spot.fixture.position.set(point.x, point.y - .006, point.z);
  spot.light.position.copy(spot.fixture.position).add(new THREE.Vector3(0, -.018, 0));
  spot.light.target.position.set(point.x, modelBox.min.y + size.y * .12, point.z);
  spot.light.target.updateMatrixWorld();
  updateSpotlight();
}

function pickModelPoint(event) {
  if (!currentModel) return null;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  return raycaster.intersectObject(currentModel, true)[0]?.point ?? null;
}

function applySpotlightPick(event) {
  const point = pickModelPoint(event);
  if (!point) return;
  if (spotlightEditMode === 'place') {
    const spot = createSpotlight();
    setSpotlightPositionFromPoint(point, spot);
    refreshSpotlightCount();
  }
}

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.screenSpacePanning = true;

const grid = new THREE.GridHelper(20, 20, 0x344050, 0x202733);
scene.add(grid);
const measurementGroup = new THREE.Group();
scene.add(measurementGroup);

// Multiple lightweight WebGL fixtures, shaped as a 10 mm silver trim ring
// with a white luminous centre. Only the selected light casts a shadow, which
// keeps the system responsive on iPad when several spots are added.
const spotlights = [];
let spotlightsOn = true;
let spotlightEditMode = '';
let spotlightPointer;

function createSpotlight() {
  const fixture = new THREE.Group();
  const silver = new THREE.MeshStandardMaterial({ color: 0xd5d8d6, roughness: .18, metalness: .82 });
  const glow = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff8e8, emissiveIntensity: 1.6, roughness: .2 });
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(.075, .075, .01, 28, 1, true), silver);
  ring.position.y = -.005;
  const trim = new THREE.Mesh(new THREE.TorusGeometry(.065, .01, 10, 32), silver);
  trim.rotation.x = Math.PI / 2; trim.position.y = -.011;
  const led = new THREE.Mesh(new THREE.CircleGeometry(.054, 28), glow);
  led.rotation.x = -Math.PI / 2; led.position.y = -.012;
  fixture.add(ring, trim, led);
  scene.add(fixture);
  const light = new THREE.SpotLight(0xfff8ed, 119, 7, THREE.MathUtils.degToRad(11), .62, 1.6);
  light.shadow.mapSize.set(1024, 1024);
  light.shadow.bias = -.00015;
  light.shadow.normalBias = .018;
  scene.add(light, light.target);
  // Limit shadow maps to the first light for predictable mobile performance.
  light.castShadow = spotlights.length === 0;
  const spot = { fixture, light, glow, led };
  spotlights.push(spot);
  return spot;
}

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const sectionPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 100000);
renderer.localClippingEnabled = true;

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/gltf/');
loader.setDRACOLoader(dracoLoader);
let currentModel;
let currentSphere;
let activeView = 'overview';
let transition;
let modelBox;
let savedViews = JSON.parse(localStorage.getItem('stanspace-saved-views') || '[]');
let entranceView = JSON.parse(localStorage.getItem('stanspace-entrance-view') || 'null');
let navigationMode = 'orbit';
let measureMode = false;
let measurementPoints = [];
let measurementPointer;
let joystickPointerId;
const joystickInput = new THREE.Vector2();
const keyboardInput = new THREE.Vector2();
const pressedKeys = new Set();
const walkEyeHeight = 1.5;
const walkSpeed = 2.1;
let previousFrameTime = performance.now();

function updateLens() {
  const focalLength = Number(lensRange.value);
  // Full-frame 24 mm sensor height, converted to Three.js's vertical field of view.
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(12 / focalLength));
  camera.updateProjectionMatrix();
  lensReadout.value = `${focalLength} mm`;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
  loading.hidden = true;
}

function frameModel(model) {
  const box = new THREE.Box3().setFromObject(model);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  if (!Number.isFinite(sphere.radius) || sphere.radius === 0) return;
  const distance = sphere.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  const direction = new THREE.Vector3(1, 0.65, 1).normalize();
  camera.position.copy(sphere.center).addScaledVector(direction, distance * 0.72);
  camera.near = Math.max(sphere.radius / 1000, 0.001);
  camera.far = Math.max(sphere.radius * 100, 1000);
  camera.updateProjectionMatrix();
  controls.target.copy(sphere.center);
  controls.minDistance = sphere.radius * 0.04;
  controls.maxDistance = sphere.radius * 12;
  controls.update();
  grid.position.y = box.min.y;
  grid.scale.setScalar(Math.max(sphere.radius / 8, 1));
  currentSphere = sphere.clone();
  modelBox = box.clone();
  const size = box.getSize(new THREE.Vector3());
  const shadowExtent = Math.max(size.x, size.z) * .55;
  architecturalLight.position.set(
    box.min.x + size.x * .58,
    box.min.y + size.y * .84,
    box.min.z + size.z * .62,
  );
  architecturalLight.target.position.set(
    box.min.x + size.x * .82,
    box.min.y + size.y * .08,
    box.min.z + size.z * .86,
  );
  architecturalFill.position.set(
    box.min.x + size.x * .9,
    box.min.y + size.y * .52,
    box.min.z + size.z * .9,
  );
  architecturalFill.target.position.set(
    box.min.x + size.x * .68,
    box.min.y + size.y * .18,
    box.min.z + size.z * .72,
  );
  architecturalLight.shadow.camera.left = -shadowExtent;
  architecturalLight.shadow.camera.right = shadowExtent;
  architecturalLight.shadow.camera.top = shadowExtent;
  architecturalLight.shadow.camera.bottom = -shadowExtent;
  architecturalLight.shadow.camera.near = .1;
  architecturalLight.shadow.camera.far = Math.max(size.y * 2.5, shadowExtent * 2);
  architecturalLight.shadow.camera.updateProjectionMatrix();
  updateSunlight();
  moveToNamedView('entrance', false);
}

function setActiveView(name) {
  activeView = name;
  viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === name));
}

function applyEntrance(animate = true) {
  if (!entranceView?.position || !entranceView?.target) return false;
  const toPosition = new THREE.Vector3().fromArray(entranceView.position);
  const toTarget = new THREE.Vector3().fromArray(entranceView.target);
  if (animate) {
    transition = {
      start: performance.now(), duration: 760,
      fromPosition: camera.position.clone(), fromTarget: controls.target.clone(),
      toPosition, toTarget,
    };
  } else {
    camera.position.copy(toPosition);
    controls.target.copy(toTarget);
    controls.update();
  }
  setActiveView('entrance');
  return true;
}

function moveToView(name = 'overview') {
  if (!currentSphere) return;
  if (name === 'entrance' && applyEntrance(true)) return;
  const { center, radius } = currentSphere;
  const directions = {
    overview: new THREE.Vector3(1, 0.65, 1),
    front: new THREE.Vector3(0, 0.22, 1),
    side: new THREE.Vector3(1, 0.22, 0),
  };
  const direction = directions[name] ?? directions.overview;
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * (name === 'overview' ? 0.72 : 0.8);
  const targetPosition = center.clone().addScaledVector(direction.normalize(), distance);
  transition = {
    start: performance.now(), duration: 760,
    fromPosition: camera.position.clone(), fromTarget: controls.target.clone(),
    toPosition: targetPosition, toTarget: center.clone(),
  };
  setActiveView(name);
}

function namedWalkView(name) {
  if (!modelBox) return;
  const size = modelBox.getSize(new THREE.Vector3());
  const min = modelBox.min;
  const center = modelBox.getCenter(new THREE.Vector3());
  const point = (x, z) => new THREE.Vector3(min.x + size.x * x, min.y + walkEyeHeight, min.z + size.z * z);
  const views = {
    // Locations 1–5 follow the marked top-view plan supplied for Southmark.
    entrance: { position: point(.74, .66), target: point(.72, .78) },
    'tree-a': { position: point(.83, .84), target: point(.72, .76) },
    'tree-b': { position: point(.65, .86), target: point(.72, .76) },
    meeting: { position: point(.51, .81), target: point(.58, .77) },
    corridor: { position: point(.67, .67), target: point(.72, .78) },
  };
  return views[name] ?? { position: center.clone().setY(min.y + walkEyeHeight), target: center };
}

function moveToNamedView(name, animate = true) {
  const view = namedWalkView(name);
  if (!view) return;
  if (animate) {
    transition = { start: performance.now(), duration: 1050, fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), toPosition: view.position, toTarget: view.target };
  } else {
    camera.position.copy(view.position); controls.target.copy(view.target); controls.update();
  }
  setActiveView(name);
}

function moveToTopView() {
  if (!currentSphere) return;
  const { center, radius } = currentSphere;
  const position = center.clone().add(new THREE.Vector3(0, radius * 2.15, .001));
  transition = { start: performance.now(), duration: 760, fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), toPosition: position, toTarget: center.clone() };
  setActiveView('');
}

function setNavigationMode(mode) {
  if (measureMode) setMeasureMode(false);
  navigationMode = mode;
  const walk = mode === 'walk';
  if (walk && controls.autoRotate) {
    controls.autoRotate = false;
    autoRotateButton.classList.remove('active');
    autoRotateButton.setAttribute('aria-pressed', 'false');
  }
  controls.enabled = true;
  controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;
  controls.touches.ONE = THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.screenSpacePanning = true;
  modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  joystick.hidden = !walk;
  document.body.classList.toggle('walking', walk);
  gestureCopy.textContent = walk ? 'Use the joystick to walk · Drag to look' : 'Drag to orbit';
}

function clearMeasurement() {
  measurementPoints = [];
  measurementGroup.clear();
  measurementResult.textContent = '';
  measurementCopy.textContent = 'Tap the first point';
  measurementPanel.classList.remove('on-line');
  measurementPanel.style.removeProperty('left');
  measurementPanel.style.removeProperty('top');
}

function setMeasureMode(enabled) {
  // Measure and Touch Move are separate tools.  A measuring tap must never
  // also trigger a camera move.
  if (enabled && navigationMode === 'walk') setNavigationMode('orbit');
  measureMode = enabled;
  controls.enabled = !enabled;
  measureButton.classList.toggle('active', enabled);
  measurementPanel.hidden = !enabled;
  document.body.classList.toggle('measuring', enabled);
  if (enabled && measurementPoints.length === 2) clearMeasurement();
}

function addMeasurementPoint(event) {
  if (!measureMode || !currentModel) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(currentModel, true)[0];
  if (!hit) return;
  if (measurementPoints.length === 2) clearMeasurement();
  const point = hit.point.clone();
  measurementPoints.push(point);
  const markerRadius = Math.max((currentSphere?.radius ?? 1) * .0022, .004);
  const marker = new THREE.Mesh(new THREE.SphereGeometry(markerRadius, 16, 10), new THREE.MeshBasicMaterial({ color: 0x185b4c, depthTest: false }));
  marker.position.copy(point); marker.renderOrder = 10; measurementGroup.add(marker);
  if (measurementPoints.length === 1) {
    measurementCopy.textContent = 'Tap the second point';
    return;
  }
  const measurementLine = new THREE.LineCurve3(measurementPoints[0], measurementPoints[1]);
  const line = new THREE.Mesh(
    new THREE.TubeGeometry(measurementLine, 1, markerRadius * .32, 8, false),
    new THREE.MeshBasicMaterial({ color: 0x185b4c, depthTest: false }),
  );
  line.renderOrder = 9; measurementGroup.add(line);
  const distanceMm = measurementPoints[0].distanceTo(measurementPoints[1]) * 1000;
  measurementCopy.textContent = 'Distance';
  measurementResult.textContent = `${Math.round(distanceMm).toLocaleString()} mm`;
  measurementPanel.classList.add('on-line');
}

function updateMeasurementLabelPosition() {
  if (measurementPoints.length !== 2 || measurementPanel.hidden) return;
  const midpoint = measurementPoints[0].clone().lerp(measurementPoints[1], .5).project(camera);
  const x = (midpoint.x * .5 + .5) * innerWidth;
  const y = (-midpoint.y * .5 + .5) * innerHeight;
  measurementPanel.style.left = `${x}px`;
  measurementPanel.style.top = `${Math.max(44, y - 18)}px`;
}


function setSection(enabled) {
  sectionPanel.hidden = !enabled;
  sectionButton.classList.toggle('active', enabled);
  const apply = (enabled && modelBox);
  scene.traverse((node) => {
    if (node.isMesh && node.material) {
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((material) => { material.clippingPlanes = apply ? [sectionPlane] : null; material.needsUpdate = true; });
    }
  });
  if (enabled) updateSection();
}

function updateSection() {
  if (!modelBox) return;
  const y = THREE.MathUtils.lerp(modelBox.min.y, modelBox.max.y, Number(sectionRange.value) / 100);
  sectionPlane.constant = y;
  sectionReadout.value = `${Math.round((y - modelBox.min.y) * 1000)} mm`;
}

viewButtons.forEach((button) => button.addEventListener('click', () => moveToNamedView(button.dataset.view)));
lightingButtons.forEach((button) => button.addEventListener('click', () => setLightingMode(button.dataset.lighting)));
modeButtons.forEach((button) => button.addEventListener('click', () => setNavigationMode(button.dataset.mode)));
measureButton.addEventListener('click', () => setMeasureMode(!measureMode));
topButton.addEventListener('click', moveToTopView);
sectionButton.addEventListener('click', () => setSection(sectionPanel.hidden));
document.querySelector('#close-section').addEventListener('click', () => setSection(false));
sectionRange.addEventListener('input', updateSection);
lensRange.addEventListener('input', updateLens);
sunRange.addEventListener('input', updateSunlight);
autoRotateButton.addEventListener('click', () => {
  if (navigationMode === 'walk') setNavigationMode('orbit');
  controls.autoRotate = !controls.autoRotate;
  controls.autoRotateSpeed = .55;
  autoRotateButton.classList.toggle('active', controls.autoRotate);
  autoRotateButton.setAttribute('aria-pressed', String(controls.autoRotate));
});
spotlightTool.addEventListener('click', () => setSpotlightPanel(spotlightPanel.hidden));
closeSpotlight.addEventListener('click', () => setSpotlightPanel(false));
spotlightToggle.addEventListener('click', () => {
  spotlightsOn = !spotlightsOn;
  spotlightToggle.classList.toggle('active', spotlightsOn);
  spotlightToggle.textContent = spotlightsOn ? 'ALL ON' : 'ALL OFF';
  updateSpotlight();
});
spotlightPlace.addEventListener('click', () => setSpotlightEditMode(spotlightEditMode === 'place' ? '' : 'place'));
spotlightOutputRange.addEventListener('input', updateSpotlight);
spotlightBeamRange.addEventListener('input', updateSpotlight);
fullscreenButton.addEventListener('click', async () => {
  if (document.fullscreenElement) await document.exitFullscreen();
  else await document.documentElement.requestFullscreen();
});
document.addEventListener('fullscreenchange', () => {
  fullscreenButton.setAttribute('aria-label', document.fullscreenElement ? 'Exit fullscreen' : 'Enter fullscreen');
  fullscreenButton.title = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
  fullscreenButton.querySelector('span').textContent = document.fullscreenElement ? '×' : '⛶';
});

function loadModel(url, revokeAfter = false) {
  loading.hidden = false;
  errorBox.hidden = true;
  loader.load(url, (gltf) => {
    if (currentModel) scene.remove(currentModel);
    currentModel = gltf.scene;
    modelHasEmbeddedLights = false;
    currentModel.traverse((node) => {
      if (node.isLight) {
        modelHasEmbeddedLights = true;
        // Retain Blender illumination while keeping one predictable shadow map
        // from the viewer's architectural sun for iPad performance.
        node.castShadow = false;
        return;
      }
      if (!node.isMesh) return;
      const materials = Array.isArray(node.material) ? node.material : [node.material];
      node.castShadow = materials.every((material) => !material.transparent && material.opacity > .85);
      node.receiveShadow = true;
      materials.forEach((material) => {
        if ('envMapIntensity' in material) material.envMapIntensity = .85;
        ['map','normalMap','roughnessMap','metalnessMap','aoMap'].forEach((key) => {
          if (material[key]) material[key].anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
        });
        material.needsUpdate = true;
      });
    });
    scene.add(currentModel);
    frameModel(currentModel);
    setLightingMode('enhanced');
    sectionRange.value = '72';
    setSection(true);
    document.body.classList.add('model-loaded');
    loading.hidden = true;
    if (revokeAfter) URL.revokeObjectURL(url);
  }, undefined, (error) => {
    console.error(error);
    showError('Could not open this GLB. Please check the export and try again.');
    if (revokeAfter) URL.revokeObjectURL(url);
  });
}

input.addEventListener('change', () => {
  const file = input.files?.[0];
  if (file) loadModel(URL.createObjectURL(file), true);
});

window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => {
  event.preventDefault();
  const file = event.dataTransfer?.files?.[0];
  if (file?.name.toLowerCase().endsWith('.glb')) loadModel(URL.createObjectURL(file), true);
  else showError('Please drop a .glb file.');
});

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (measureMode) measurementPointer = { x: event.clientX, y: event.clientY };
  if (spotlightEditMode) spotlightPointer = { x: event.clientX, y: event.clientY };
});
window.addEventListener('pointerup', (event) => {
  if (measurementPointer) {
    const isTap = Math.hypot(event.clientX - measurementPointer.x, event.clientY - measurementPointer.y) < 12;
    measurementPointer = undefined;
    if (isTap) addMeasurementPoint(event);
  }
  if (spotlightPointer) {
    const isTap = Math.hypot(event.clientX - spotlightPointer.x, event.clientY - spotlightPointer.y) < 12;
    spotlightPointer = undefined;
    if (isTap) applySpotlightPick(event);
  }
});

function updateJoystick(event) {
  const rect = joystickRing.getBoundingClientRect();
  const radius = rect.width * .5;
  const dx = event.clientX - (rect.left + radius);
  const dy = event.clientY - (rect.top + radius);
  const distance = Math.min(Math.hypot(dx, dy), radius * .62);
  const angle = Math.atan2(dy, dx);
  const x = Math.cos(angle) * distance;
  const y = Math.sin(angle) * distance;
  joystickInput.set(x / (radius * .62), y / (radius * .62));
  joystickKnob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`;
}

function releaseJoystick(event) {
  if (event.pointerId !== joystickPointerId) return;
  joystickPointerId = undefined;
  joystickInput.set(0, 0);
  joystickKnob.style.transform = 'translate(-50%, -50%)';
}

joystickRing.addEventListener('pointerdown', (event) => {
  if (navigationMode !== 'walk') return;
  joystickPointerId = event.pointerId;
  joystickRing.setPointerCapture(event.pointerId);
  updateJoystick(event);
});
joystickRing.addEventListener('pointermove', (event) => { if (event.pointerId === joystickPointerId) updateJoystick(event); });
joystickRing.addEventListener('pointerup', releaseJoystick);
joystickRing.addEventListener('pointercancel', releaseJoystick);

function keepWalkInside(position) {
  if (!modelBox) return position;
  const padding = Math.max(.22, Math.min(modelBox.getSize(new THREE.Vector3()).x, modelBox.getSize(new THREE.Vector3()).z) * .025);
  position.x = THREE.MathUtils.clamp(position.x, modelBox.min.x + padding, modelBox.max.x - padding);
  position.z = THREE.MathUtils.clamp(position.z, modelBox.min.z + padding, modelBox.max.z - padding);
  // A small protected central core.  Interior partitions remain passable so the tour stays easy.
  const center = modelBox.getCenter(new THREE.Vector3());
  const size = modelBox.getSize(new THREE.Vector3());
  const coreHalfX = size.x * .07;
  const coreHalfZ = size.z * .12;
  if (Math.abs(position.x - center.x) < coreHalfX && Math.abs(position.z - center.z) < coreHalfZ) {
    position.x = center.x + Math.sign(position.x - center.x || 1) * coreHalfX;
  }
  return position;
}

function walk(deltaSeconds) {
  keyboardInput.set(
    (pressedKeys.has('KeyD') ? 1 : 0) - (pressedKeys.has('KeyA') ? 1 : 0),
    (pressedKeys.has('KeyS') ? 1 : 0) - (pressedKeys.has('KeyW') ? 1 : 0),
  );
  const input = joystickInput.clone().add(keyboardInput);
  if (navigationMode !== 'walk' || input.lengthSq() < .002 || !modelBox) return;
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); forward.y = 0;
  if (forward.lengthSq() < .001) return;
  forward.normalize();
  const right = new THREE.Vector3(-forward.z, 0, forward.x);
  const movement = forward.multiplyScalar(-input.y).addScaledVector(right, input.x);
  if (movement.lengthSq() < .001) return;
  movement.normalize().multiplyScalar(walkSpeed * deltaSeconds * Math.min(1, input.length()));
  const next = keepWalkInside(camera.position.clone().add(movement));
  const applied = next.clone().sub(camera.position);
  camera.position.copy(next);
  controls.target.add(applied);
}

window.addEventListener('keydown', (event) => {
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(event.code)) {
    pressedKeys.add(event.code);
    if (navigationMode === 'walk') event.preventDefault();
  }
});
window.addEventListener('keyup', (event) => pressedKeys.delete(event.code));
window.addEventListener('blur', () => pressedKeys.clear());

renderer.setAnimationLoop(() => {
  const now = performance.now();
  const deltaSeconds = Math.min((now - previousFrameTime) / 1000, .05);
  previousFrameTime = now;
  if (transition) {
    const progress = Math.min((performance.now() - transition.start) / transition.duration, 1);
    // Smooth acceleration and deceleration for Touch Move and camera presets.
    const eased = progress * progress * (3 - 2 * progress);
    camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
    controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased);
    if (progress === 1) transition = undefined;
  }
  walk(deltaSeconds);
  controls.update();
  updateMeasurementLabelPosition();
  renderer.render(scene, camera);
});

const presentationModelUrl = 'https://pub-257e1c9ebc594af190aa6d311fcb5e4d.r2.dev/20260908_enhanced_web.glb?v=blender-51-v1';
fetch(presentationModelUrl, { method: 'HEAD' }).then((response) => {
  if (response.ok) loadModel(presentationModelUrl);
}).catch(() => {});

updateLens();
updateSpotlight();
setNavigationMode('orbit');
setLightingMode('enhanced');
