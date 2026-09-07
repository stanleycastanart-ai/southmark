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
const objectInfo = document.querySelector('#object-info');
const walkUi = document.querySelector('#walk-ui');
const walkStick = document.querySelector('#walk-stick');
const saveViewButton = document.querySelector('#save-view');
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
let navigationMode = 'orbit';
let selectedMesh;
let savedViews = JSON.parse(localStorage.getItem('stanspace-saved-views') || '[]');
let tourTimer;
let walkVelocity = new THREE.Vector2();
let touchVector = new THREE.Vector2();
let lookPointer;
const keys = new Set();

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
}

function setActiveView(name) {
  activeView = name;
  viewButtons.forEach((button) => button.classList.toggle('active', button.dataset.view === name));
}

function moveToView(name = 'overview') {
  if (!currentSphere) return;
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

function setMode(mode) {
  navigationMode = mode;
  const walking = mode === 'walk';
  controls.enabled = !walking;
  walkUi.hidden = !walking;
  document.body.classList.toggle('walking', walking);
  modeButtons.forEach((button) => button.classList.toggle('active', button.dataset.mode === mode));
  if (walking && currentSphere) {
    const center = currentSphere.center;
    camera.position.set(center.x, modelBox.min.y + 1.62, center.z + currentSphere.radius * .7);
    controls.target.copy(center);
  }
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

function selectObject(event) {
  if (navigationMode !== 'orbit' || !currentModel || event.target.closest('button, input, label')) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hit = raycaster.intersectObject(currentModel, true)[0];
  if (!hit) return;
  if (selectedMesh?.material?.emissive) selectedMesh.material.emissive.setHex(0x000000);
  selectedMesh = hit.object;
  if (selectedMesh.material?.emissive) selectedMesh.material.emissive.setHex(0x113f34);
  const bounds = new THREE.Box3().setFromObject(selectedMesh);
  const size = bounds.getSize(new THREE.Vector3());
  document.querySelector('#object-name').textContent = selectedMesh.name || selectedMesh.parent?.name || 'Interior element';
  document.querySelector('#object-width').textContent = `${Math.round(size.x * 1000)} mm`;
  document.querySelector('#object-depth').textContent = `${Math.round(size.z * 1000)} mm`;
  document.querySelector('#object-height').textContent = `${Math.round(size.y * 1000)} mm`;
  objectInfo.hidden = false;
}

function saveCurrentView() {
  const view = { position: camera.position.toArray(), target: controls.target.toArray(), name: `View ${savedViews.length + 1}` };
  savedViews = [...savedViews.slice(-5), view];
  localStorage.setItem('stanspace-saved-views', JSON.stringify(savedViews));
  saveViewButton.querySelector('span')?.replaceWith(document.createTextNode('✓'));
  saveViewButton.textContent = '✓';
  setTimeout(() => { saveViewButton.textContent = '＋'; }, 1100);
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
resetButton.addEventListener('click', () => moveToView('overview'));
modeButtons.forEach((button) => button.addEventListener('click', () => setMode(button.dataset.mode)));
topButton.addEventListener('click', moveToTopView);
sectionButton.addEventListener('click', () => setSection(sectionPanel.hidden));
document.querySelector('#close-section').addEventListener('click', () => setSection(false));
sectionRange.addEventListener('input', updateSection);
document.querySelector('#close-info').addEventListener('click', () => { objectInfo.hidden = true; });
saveViewButton.addEventListener('click', saveCurrentView);
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

renderer.domElement.addEventListener('click', selectObject);
window.addEventListener('keydown', (event) => { keys.add(event.key.toLowerCase()); });
window.addEventListener('keyup', (event) => { keys.delete(event.key.toLowerCase()); });
renderer.domElement.addEventListener('pointerdown', (event) => { if (navigationMode === 'walk' && event.pointerType === 'mouse') lookPointer = { x: event.clientX, y: event.clientY }; });
window.addEventListener('pointerup', () => { lookPointer = undefined; });
window.addEventListener('pointermove', (event) => {
  if (!lookPointer || navigationMode !== 'walk') return;
  const deltaX = event.clientX - lookPointer.x; const deltaY = event.clientY - lookPointer.y; lookPointer = { x: event.clientX, y: event.clientY };
  const direction = new THREE.Vector3(); camera.getWorldDirection(direction); const spherical = new THREE.Spherical().setFromVector3(direction);
  spherical.theta -= deltaX * .005; spherical.phi = THREE.MathUtils.clamp(spherical.phi - deltaY * .005, .2, Math.PI - .2);
  camera.lookAt(camera.position.clone().add(new THREE.Vector3().setFromSpherical(spherical)));
});
walkStick.addEventListener('pointerdown', (event) => { walkStick.setPointerCapture(event.pointerId); });
walkStick.addEventListener('pointermove', (event) => {
  if (!walkStick.hasPointerCapture(event.pointerId)) return;
  const rect = walkStick.getBoundingClientRect(); touchVector.set((event.clientX - rect.left) / rect.width * 2 - 1, (event.clientY - rect.top) / rect.height * 2 - 1).clampLength(0, 1);
  walkStick.querySelector('i').style.transform = `translate(calc(-50% + ${touchVector.x * 31}px), calc(-50% + ${touchVector.y * 31}px))`;
});
walkStick.addEventListener('pointerup', () => { touchVector.set(0, 0); walkStick.querySelector('i').style.transform = 'translate(-50%,-50%)'; });

renderer.setAnimationLoop(() => {
  if (transition) {
    const progress = Math.min((performance.now() - transition.start) / transition.duration, 1);
    const eased = 1 - (1 - progress) ** 3;
    camera.position.lerpVectors(transition.fromPosition, transition.toPosition, eased);
    controls.target.lerpVectors(transition.fromTarget, transition.toTarget, eased);
    if (progress === 1) transition = undefined;
  }
  if (navigationMode === 'walk' && modelBox) {
    const forward = new THREE.Vector3(); camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
    const right = new THREE.Vector3().crossVectors(forward, camera.up).normalize();
    const forwardAmount = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0) - touchVector.y;
    const rightAmount = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0) + touchVector.x;
    const step = .055; camera.position.addScaledVector(forward, forwardAmount * step); camera.position.addScaledVector(right, rightAmount * step);
    camera.position.y = modelBox.min.y + 1.62;
    camera.position.x = THREE.MathUtils.clamp(camera.position.x, modelBox.min.x + .15, modelBox.max.x - .15);
    camera.position.z = THREE.MathUtils.clamp(camera.position.z, modelBox.min.z + .15, modelBox.max.z - .15);
  }
  controls.update();
  renderer.render(scene, camera);
});

fetch('./assets/model.glb', { method: 'HEAD' }).then((response) => {
  if (response.ok) loadModel('./assets/model.glb');
}).catch(() => {});
