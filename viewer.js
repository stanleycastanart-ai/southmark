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

const loader = new GLTFLoader();
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/gltf/');
loader.setDRACOLoader(dracoLoader);
let currentModel;
let currentSphere;
let activeView = 'overview';
let transition;

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

viewButtons.forEach((button) => button.addEventListener('click', () => moveToView(button.dataset.view)));
resetButton.addEventListener('click', () => moveToView('overview'));
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
