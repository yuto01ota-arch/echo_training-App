import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { SCAN_PRESENTATION } from "../echo/scanPresentation.js";
import { SCANS } from "../echo/scans.js";
import { createProbe, placeProbe, probeOrientation } from "./probe.js";
import { MODELS } from "./models.js";
import { createPoseController } from "./poses.js";
import { createRegionAnchors, renderRegionViews } from "./regions.js";
import { createScanAnchors, renderScanBody } from "./scanBody.js";
import { renderCustomScan, pointInPlane } from "./customScan.js";

export function disposeObject(object) {
  const resources = new Set();
  const images = new Set();
  object.traverse((child) => {
    if (child.geometry) resources.add(child.geometry);
    if (child.skeleton) resources.add(child.skeleton);
    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];
    materials.filter(Boolean).forEach((material) => {
      resources.add(material);
      Object.values(material).forEach((value) => {
        if (value?.isTexture) {
          resources.add(value);
          if (value.source?.data?.close) images.add(value.source.data);
        }
      });
    });
  });
  resources.forEach((resource) => resource.dispose());
  images.forEach((bitmap) => bitmap.close());
}

export function createViewer(onModel, onStatus, { authoring = false } = {}) {
  const scene = new THREE.Scene();
  // Let the canvas container supply the theme background without changing
  // model lighting or re-rendering the body when the UI theme changes.
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  scene.add(new THREE.HemisphereLight("#ffffff", "#b3aca1", 1.3));
  const key = new THREE.DirectionalLight("#fff8ee", 2.2);
  key.position.set(3, 5, 4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -3;
  key.shadow.camera.right = 3;
  key.shadow.camera.top = 3;
  key.shadow.camera.bottom = -3;
  key.shadow.normalBias = 0.025;
  scene.add(key);
  const rim = new THREE.DirectionalLight("#e8f3ff", 0.8);
  rim.position.set(-3, 3, -2);
  scene.add(rim);
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.ShadowMaterial({ color: "#405256", opacity: 0.18 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.007;
  floor.receiveShadow = true;
  scene.add(floor);

  const probe = createProbe();
  scene.add(probe);
  const probeContacts = new Map();

  let current;
  let applyPose;
  let currentPose = "standing";
  let renderedPose = "standing";
  let regionAnchors = [];
  let scanAnchors;
  let disposed = false;
  let loadId = 0;
  let pendingRequest;
  // The selected pose and the last rendered pose can differ for side views.
  // Each view requests its own pose; keep it until another view needs a change.
  function ensurePose(pose) {
    if (!applyPose || renderedPose === pose) return;
    applyPose(pose);
    renderedPose = pose;
  }

  function replace(object) {
    if (current) {
      scene.remove(current);
      disposeObject(current);
    }
    current = object;
    probeContacts.clear();
    scanAnchors = null;
    scene.add(current);
    current.updateMatrixWorld(true);
  }

  async function loadModel(read, metadata) {
    const id = ++loadId;
    pendingRequest?.abort();
    pendingRequest = new AbortController();
    onStatus({ loading: true, error: "" });
    let gltf;
    try {
      const data = await read(pendingRequest.signal);
      if (disposed || id !== loadId) return;
      gltf = await new GLTFLoader().parseAsync(data, "");
      if (disposed || id !== loadId) {
        gltf.scenes.forEach(disposeObject);
        return;
      }
      const { object, rigged } = prepareModel(gltf.scene);
      const nextPose =
        metadata.kind === "builtin" ? createPoseController(object) : null;
      replace(object);
      regionAnchors =
        !authoring && metadata.kind === "builtin"
          ? createRegionAnchors(object)
          : [];
      scanAnchors = authoring ? null : createScanAnchors(object);
      applyPose = nextPose;
      currentPose = "standing";
      renderedPose = "standing";
      onModel({ ...metadata, rigged });
      onStatus({ loading: false, error: "" });
    } catch (error) {
      if (gltf) gltf.scenes.forEach(disposeObject);
      if (disposed || id !== loadId) return;
      console.error(error);
      onStatus({
        loading: false,
        error:
          metadata.kind === "builtin"
            ? "人体モデルを読み込めませんでした。接続を確認し、男性・女性ボタンから再読み込みしてください。"
            : "モデルを読み込めませんでした。画像を内包した、圧縮なしのGLBファイルをご確認ください。",
      });
    }
  }

  function prepareModel(modelScene) {
    const object = new THREE.Group();
    object.add(modelScene);
    object.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    if (bounds.isEmpty() || !Number.isFinite(size.length()) || size.y <= 0) {
      throw new Error("表示できる立体が見つかりませんでした。");
    }
    const scale = 1.8 / size.y;
    const center = bounds.getCenter(new THREE.Vector3());
    object.scale.setScalar(scale);
    object.position.set(
      -center.x * scale,
      -bounds.min.y * scale,
      -center.z * scale,
    );
    let rigged = false;
    object.traverse((child) => {
      if (child.isMesh) child.castShadow = child.receiveShadow = true;
      if (child.isSkinnedMesh) rigged = true;
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.filter(Boolean).forEach((material) => {
        if (material.map)
          material.map.anisotropy = Math.min(
            8,
            renderer.capabilities.getMaxAnisotropy(),
          );
      });
    });
    return { object, rigged };
  }

  function loadBuiltin(modelId) {
    const model = MODELS.find((item) => item.id === modelId);
    if (!model) throw new Error("Unknown model");
    return loadModel(
      async (signal) => {
        const response = await fetch(
          `${import.meta.env.BASE_URL}models/${model.file}`,
          { signal },
        );
        if (!response.ok)
          throw new Error(`Model request failed: ${response.status}`);
        return response.arrayBuffer();
      },
      { id: model.id, name: model.name, kind: "builtin" },
    );
  }

  return {
    loadBuiltin,
    scanSettings(id, model) {
      const presentation = SCAN_PRESENTATION[id];
      if (!presentation || !current) throw new Error("部位が見つかりません。");
      if (!scanAnchors) {
        ensurePose("standing");
        scanAnchors = createScanAnchors(current);
      }
      const pose = presentation.pose ?? "standing";
      ensurePose(pose);
      const points = scanAnchors.positions(id);
      const normal = new THREE.Vector3(
        ...{
          front: [0, 0, 1],
          back: [0, 0, -1],
          right: [-1, 0, 0],
          left: [1, 0, 0],
        }[presentation.view],
      );
      const plane = {
        normal: normal.toArray(),
        right: [normal.z, 0, -normal.x],
        up: [0, 1, 0],
      };
      const center = id.startsWith("abs_")
        ? new THREE.Vector3(0, 1.1, 0)
        : points[0].clone().lerp(points[1], 0.5);
      return {
        model,
        pose,
        view: presentation.view,
        rotate: 180 - presentation.rotate,
        plane,
        path: {
          start: pointInPlane(points[0], plane),
          end: pointInPlane(points[1], plane),
        },
        camera: {
          position: center.clone().addScaledVector(normal, 3).toArray(),
          target: center.toArray(),
          up: [0, 1, 0],
          span: presentation.span,
          aspect: 0.72,
        },
      };
    },
    editorContext() {
      return { renderer, scene, object: current, probe };
    },
    renderCustomScan(canvas, scan, progress) {
      if (!current) return null;
      ensurePose(scan.pose);
      return renderCustomScan({
        renderer,
        scene,
        object: current,
        probe,
        canvas,
        scan,
        progress,
        cache: probeContacts,
      });
    },
    renderScanBody(canvas, scanId, progress = 0) {
      if (!current || !scanAnchors) return null;
      const displayPose = SCAN_PRESENTATION[scanId].pose ?? currentPose;
      try {
        ensurePose(displayPose);
        const scan = SCANS.find((item) => item.id === scanId);
        const key = `${scanId}:${displayPose}:${progress}`;
        let contact = probeContacts.get(key);
        if (!contact) {
          contact = scanAnchors.contact(scanId, progress);
          probeContacts.set(key, contact);
        }
        placeProbe(probe, contact, probeOrientation(scan, progress));
        probe.visible = true;
        return renderScanBody({
          renderer,
          scene,
          canvas,
          scanId,
          path: scanAnchors.positions(scanId),
          probe,
          contact,
        });
      } finally {
        probe.visible = false;
      }
    },
    renderRegions(canvases, side) {
      if (!current || !regionAnchors.length) return {};
      const { side: sideCanvas, ...otherCanvases } = canvases;
      const shared = {
        renderer,
        scene,
        object: current,
        anchors: regionAnchors,
        side,
      };
      ensurePose(currentPose);
      const output = renderRegionViews({ ...shared, canvases: otherCanvases });
      if (!sideCanvas) return output;
      ensurePose("armsOpen");
      return {
        ...output,
        ...renderRegionViews({ ...shared, canvases: { side: sideCanvas } }),
      };
    },
    setPose(id) {
      if (!applyPose) return;
      ensurePose(id);
      if (currentPose !== id) probeContacts.clear();
      currentPose = id;
    },
    dispose() {
      disposed = true;
      loadId++;
      pendingRequest?.abort();
      disposeObject(scene);
      key.shadow.dispose();
      renderer.dispose();
    },
  };
}
