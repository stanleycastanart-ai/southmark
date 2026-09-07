import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const container = document.querySelector('#viewer');
const input = document.querySelector('#model-input');
const loading = document.querySelector('#loading');
const errorBox = document.querySelector('#error');
const resetButton = document.querySelector('#reset-view');
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
const saveViewButton = document.querySelector('#save-view');
const setEntranceButton = document.querySelector('#set-entrance');
const tourButton = document.querySelector('#auto-tour');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0f17);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.01, 10000);
camera.position.set(4, 3, 6);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
container.append(renderer.domElement);

const environment = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(environment).texture;
environment.dispose();
pmrem.dispose();

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.screenSpacePanning = true;

const grid = new THREE.GridHelper(20, 20, 0x344050, 0x202733);
scene.add(grid);
const measurementGroup = new THREE.Group();
scene.add(measurementGroup);

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
let tourTimer;
let navigationMode = 'orbit';
let measureMode = false;
let measurementPoints = [];
let measurementPointer;

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
  if (entranceView) applyEntrance(false);
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
  const touchMove = mode === 'touch-move';
  controls.mouseButtons.LEFT = touchMove ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
  controls.mouseButtons.RIGHT = touchMove ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
  controls.touches.ONE = touchMove ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
  controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
  controls.screenSpacePanning = !touchMove;
  modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  document.body.classList.toggle('touch-moving', touchMove);
  gestureCopy.textContent = touchMove ? 'Drag to move viewpoint' : 'Drag to orbit';
}

function clearMeasurement() {
  measurementPoints = [];
  measurementGroup.clear();
  measurementResult.textContent = '';
  measurementCopy.textContent = 'Tap the first point';
}

function setMeasureMode(enabled) {
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

function saveCurrentView() {
  const view = { position: camera.position.toArray(), target: controls.target.toArray(), name: `View ${savedViews.length + 1}` };
  savedViews = [...savedViews.slice(-5), view];
  localStorage.setItem('stanspace-saved-views', JSON.stringify(savedViews));
  saveViewButton.querySelector('span')?.replaceWith(document.createTextNode('✓'));
  saveViewButton.textContent = '✓';
  setTimeout(() => { saveViewButton.textContent = '＋'; }, 1100);
}

function saveEntranceView() {
  entranceView = { position: camera.position.toArray(), target: controls.target.toArray() };
  localStorage.setItem('stanspace-entrance-view', JSON.stringify(entranceView));
  setActiveView('entrance');
  setEntranceButton.textContent = '✓';
  setTimeout(() => { setEntranceButton.textContent = '⌂'; }, 1100);
}

function startAutoTour() {
  const routes = savedViews.length ? savedViews : ['overview', 'front', 'side'];
  let index = 0;
  clearInterval(tourTimer);
  tourButton.textContent = 'Ⅱ';
  const next = () => {
    const route = routes[index++ % routes.length];
    if (typeof route === 'string') moveToView(route);
    else transition = { start: performance.now(), duration: 1100, fromPosition: camera.position.clone(), fromTarget: controls.target.clone(), toPosition: new THREE.Vector3().fromArray(route.position), toTarget: new THREE.Vector3().fromArray(route.target) };
  };
  next(); tourTimer = setInterval(next, 4200);
}

viewButtons.forEach((button) => button.addEventListener('click', () => moveToView(button.dataset.view)));
modeButtons.forEach((button) => button.addEventListener('click', () => setNavigationMode(button.dataset.mode)));
measureButton.addEventListener('click', () => setMeasureMode(!measureMode));
resetButton.addEventListener('click', () => moveToView('overview'));
topButton.addEventListener('click', moveToTopView);
sectionButton.addEventListener('click', () => setSection(sectionPanel.hidden));
document.querySelector('#close-section').addEventListener('click', () => setSection(false));
sectionRange.addEventListener('input', updateSection);
saveViewButton.addEventListener('click', saveCurrentView);
setEntranceButton.addEventListener('click', saveEntranceView);
lensRange.addEventListener('input', updateLens);
tourButton.addEventListener('click', () => { if (tourTimer) { clearInterval(tourTimer); tourTimer = undefined; tourButton.textContent = '▷'; } else startAutoTour(); });
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
    scene.add(currentModel);
    frameModel(currentModel);
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
  if (navigationMode === 'touch-move') document.body.classList.add('pointer-dragging');
});
window.addEventListener('pointerup', (event) => {
  document.body.classList.remove('pointer-dragging');
  if (!measurementPointer) return;
  const isTap = Math.hypot(event.clientX - measurementPointer.x, event.clientY - measurementPointer.y) < 12;
  measurementPointer = undefined;
  if (isTap) addMeasurementPoint(event);
});
renderer.setAnimationLoop(() => {
  if (transition) {
    const progress = Math.min((performance.now() - transition.start) / transition.duration, 1);
    const eased = 1 - (1 - progress) ** 3;
    camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
    controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased);
    if (progress === 1) transition = undefined;
  }
  controls.update();
  renderer.render(scene, camera);
});

fetch('./assets/model.glb', { method: 'HEAD' }).then((response) => {
  if (response.ok) loadModel('./assets/model.glb');
}).catch(() => {});

updateLens();
