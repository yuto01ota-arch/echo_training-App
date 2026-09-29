import { FRAME_COUNT, EDITOR, CAMERA } from "../../src/config.js";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { createViewer } from "../../src/three/viewer.js";
import {
  bodyMesh,
  cameraSetting,
  planeFromCamera,
  pointInPlane,
  surfaceContact,
  settingsProbeOrientation,
  createSurfaceSnapshot,
} from "../../src/three/customScan.js";
import { renderSnapshot } from "../../src/three/renderSnapshot.js";
import { placeProbe } from "../../src/three/probe.js";

export function createModelEditor(canvas, onChange, onStatus) {
  let ready = false,
    disposed = false,
    mode = "camera",
    plane = null,
    path = {},
    frame = 1,
    frameCount = FRAME_COUNT,
    rotate = 0,
    pending,
    motion = {},
    loadSequence = 0,
    loadedModel = null,
    surface = null;
  const contacts = new Map();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, CAMERA.near, CAMERA.far);
  camera.position.set(0, 0.95, 3);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.95, 0);
  controls.minZoom = EDITOR.minZoom;
  controls.maxZoom = EDITOR.maxZoom;
  controls.enableDamping = false;
  controls.update();
  const viewer = createViewer(
    (model) => {
      loadedModel = model.id;
      ready = true;
      resetPoints();
      draw();
    },
    (status) => {
      if (status.loading) ready = false;
      onStatus(status);
    },
    { authoring: true },
  );
  function clearContacts() {
    contacts.clear();
    surface?.geometry.dispose();
    surface = null;
  }
  function contact(t) {
    if (path.start.x === path.end.x && path.start.y === path.end.y) t = 0;
    if (!contacts.has(t)) {
      const body = bodyMesh(viewer.editorContext().object);
      surface ??= createSurfaceSnapshot(body);
      contacts.set(
        t,
        surfaceContact(
          body,
          plane,
          {
            x: path.start.x + (path.end.x - path.start.x) * t,
            y: path.start.y + (path.end.y - path.start.y) * t,
          },
          surface,
        ),
      );
    }
    return contacts.get(t);
  }
  function project(point) {
    const p = point.clone().project(camera);
    return { x: (p.x + 1) * 50, y: (1 - p.y) * 50 };
  }
  function draw() {
    if (disposed || !ready || !canvas.clientWidth) return;
    const { renderer, scene, object, probe } = viewer.editorContext();
    let error = "",
      markers = {};
    try {
      const body = bodyMesh(object);
      for (const [name, point] of Object.entries(path))
        markers[name] = project(
          (path.start && path.end
            ? contact(name === "start" ? 0 : 1)
            : surfaceContact(body, plane, point)
          ).point,
        );
      if (path.start && path.end) {
        placeProbe(
          probe,
          contact((frame - 1) / (frameCount - 1)),
          settingsProbeOrientation({ ...motion, rotate }, (frame - 1) / (frameCount - 1)),
        );
        probe.visible = true;
      }
    } catch (cause) {
      error = cause.message;
    }
    try {
      renderSnapshot(
        renderer,
        scene,
        camera,
        canvas,
        canvas.clientWidth,
        canvas.clientHeight,
      );
    } finally {
      probe.visible = false;
    }
    onChange({
      path: { ...path },
      plane,
      camera: cameraSetting(camera, controls.target),
      markers,
      error,
      mode,
    });
  }
  function schedule() {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(draw);
  }
  function resize() {
    const aspect = canvas.clientWidth / canvas.clientHeight;
    if (!Number.isFinite(aspect)) return;
    camera.top = EDITOR.cameraSpan / 2;
    camera.bottom = -camera.top;
    camera.right = camera.top * aspect;
    camera.left = -camera.right;
    camera.updateProjectionMatrix();
    schedule();
  }
  controls.addEventListener("change", schedule);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  function resetPoints() {
    mode = "camera";
    controls.enabled = true;
    path = {};
    plane = null;
    clearContacts();
    schedule();
  }
  function pick(event) {
    if (mode === "camera" || !ready || event.button !== 0) return;
    const bounds = canvas.getBoundingClientRect();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(
        ((event.clientX - bounds.left) / bounds.width) * 2 - 1,
        1 - ((event.clientY - bounds.top) / bounds.height) * 2,
      ),
      camera,
    );
    const body = bodyMesh(viewer.editorContext().object);
    const hit = ray.intersectObject(body, false)[0];
    if (!hit) {
      onStatus({ loading: false, error: "人体の表面をクリックしてください。" });
      return;
    }
    const nextPlane = plane ?? planeFromCamera(camera);
    const point = pointInPlane(hit.point, nextPlane);
    // Once chosen, both endpoints belong to the same projection plane.
    // A view from the opposite side must not silently pick a different skin surface.
    if (
      surfaceContact(body, nextPlane, point).point.distanceTo(hit.point) > EDITOR.surfacePickTolerance
    ) {
      onStatus({
        loading: false,
        error:
          "最初の点と同じ側の体表を選んでください。別の面に変更する場合は「点をクリア」を押してください。",
      });
      return;
    }
    plane = nextPlane;
    path = { ...path, [mode]: point };
    clearContacts();
    mode = mode === "start" ? "end" : "camera";
    controls.enabled = mode === "camera";
    onStatus({ loading: false, error: "" });
    draw();
  }
  canvas.addEventListener("pointerup", pick);
  return {
    loadModel: (id) => {
      loadSequence++;
      return viewer.loadBuiltin(id);
    },
    async loadScan(scan) {
      const sequence = ++loadSequence;
      if (!ready || loadedModel !== (scan.model ?? "male"))
        await viewer.loadBuiltin(scan.model ?? "male");
      if (disposed || sequence !== loadSequence) return null;
      resetPoints();
      if (!ready)
        throw new Error(
          "人体モデルを読み込めませんでした。部位を再読み込みしてください。",
        );
      const setting = scan.camera
        ? scan
        : viewer.scanSettings(scan.id, scan.model ?? "male");
      viewer.setPose(setting.pose);
      path = structuredClone(setting.path);
      plane = structuredClone(setting.plane);
      clearContacts();
      motion = scan;
      frameCount = scan.frameCount;
      frame = 1;
      rotate = setting.rotate;
      camera.position.fromArray(setting.camera.position);
      camera.up.fromArray(setting.camera.up);
      controls.target.fromArray(setting.camera.target);
      camera.zoom = EDITOR.cameraSpan / setting.camera.span;
      camera.updateProjectionMatrix();
      controls.update();
      draw();
      return setting;
    },
    newScan() {
      motion = {};
      frameCount = FRAME_COUNT;
      frame = 1;
      rotate = 0;
      resetPoints();
      this.view("front");
      return this.loadModel("male");
    },
    setPose(id) {
      viewer.setPose(id);
      resetPoints();
    },
    setMode(next) {
      mode = next;
      controls.enabled = next === "camera";
      draw();
    },
    resetPoints,
    setCoordinate(name, axis, value) {
      if (path[name] && Number.isFinite(value)) {
        path = { ...path, [name]: { ...path[name], [axis]: value } };
        clearContacts();
        draw();
      }
    },
    setPreview(nextFrame, nextRotate) {
      frame = nextFrame;
      rotate = nextRotate;
      schedule();
    },
    view(side) {
      controls.target.set(0, 0.95, 0);
      camera.up.set(0, 1, 0);
      camera.zoom = 1;
      camera.position.set(
        ...{
          front: [0, 0.95, 3],
          back: [0, 0.95, -3],
          right: [-3, 0.95, 0],
          left: [3, 0.95, 0],
        }[side],
      );
      camera.updateProjectionMatrix();
      controls.update();
      schedule();
    },
    async validatePath(onProgress) {
      if (!ready || !path.start || !path.end)
        throw new Error("開始点と終了点を指定してください。");
      for (let i = 0; i < frameCount; i++) {
        if (disposed) throw new Error("操作が中断されました。");
        contact(i / (frameCount - 1));
        if (i % EDITOR.validationYieldEvery === 0) {
          onProgress(i + 1);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      }
    },
    dispose() {
      disposed = true;
      loadSequence++;
      cancelAnimationFrame(pending);
      observer.disconnect();
      canvas.removeEventListener("pointerup", pick);
      controls.dispose();
      clearContacts();
      viewer.dispose();
    },
  };
}
