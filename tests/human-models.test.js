import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Box3, Texture, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MODELS } from "../src/three/models.js";
import { createPoseController } from "../src/three/poses.js";
import { disposeObject } from "../src/three/viewer.js";

for (const model of MODELS) {
  test(`${model.id}: self-contained human GLB has a working static-pose rig`, async () => {
    const buffer = await readFile(
      new URL(`../public/models/${model.file}`, import.meta.url),
    );
    assert.equal(buffer.readUInt32LE(0), 0x46546c67);
    assert.equal(buffer.readUInt32LE(8), buffer.length);
    const json = JSON.parse(
      buffer.subarray(20, 20 + buffer.readUInt32LE(12)).toString(),
    );
    assert.equal(json.animations?.length ?? 0, 0);
    assert.ok(json.buffers.every((item) => !item.uri));
    assert.equal(json.skins[0].joints.length, 19);
    const skin = json.materials.find((material) =>
      material.name.startsWith("Skin PBR"),
    );
    assert.ok(
      skin?.pbrMetallicRoughness.baseColorTexture,
      "body has a skin color texture",
    );
    assert.ok(skin?.normalTexture, "skin has a normal map");
    assert.ok(
      skin?.pbrMetallicRoughness.metallicRoughnessTexture,
      "skin has a roughness map",
    );
    const binaryStart = 28 + buffer.readUInt32LE(12);
    for (const image of json.images) {
      assert.equal(image.uri, undefined, "textures must be embedded for Pages");
      assert.equal(image.mimeType, "image/png");
      const view = json.bufferViews[image.bufferView];
      const offset = binaryStart + (view.byteOffset ?? 0);
      assert.equal(buffer.subarray(offset + 1, offset + 4).toString(), "PNG");
      assert.ok(buffer.readUInt32BE(offset + 16) >= 256);
    }
    // Node has no image decoder. Validate embedded PNGs above and load dummy
    // textures for the geometry/rig tests; Playwright renders the real images.
    const loader = new GLTFLoader().register(() => ({
      name: "TestTextureDecoder",
      loadTexture: () => Promise.resolve(new Texture()),
    }));
    const gltf = await loader.parseAsync(
      buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      ),
      "",
    );
    const object = gltf.scene;
    const pose = createPoseController(object);
    pose("standing");
    const initial = new Box3().setFromObject(object);
    const size = initial.getSize(new Vector3());
    assert.ok(size.y > 1.6 && size.y < 1.8);
    assert.ok(
      size.x > 0.7 && size.x < 1.0,
      "all parts stay within the human body's width",
    );
    let vertexCount = 0;
    let mesh;
    object.traverse((child) => {
      if (!child.isSkinnedMesh) return;
      assert.ok(
        child.geometry.attributes.uv,
        "textured mesh has UV coordinates",
      );
      vertexCount += child.geometry.attributes.position.count;
      if (
        !mesh ||
        child.geometry.attributes.position.count >
          mesh.geometry.attributes.position.count
      )
        mesh = child;
      const weights = child.geometry.attributes.skinWeight;
      for (let i = 0; i < weights.count; i++) {
        const total =
          weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i);
        assert.ok(Math.abs(total - 1) < 1e-4, `unweighted vertex ${i}`);
      }
    });
    assert.ok(vertexCount > 40000, "export retains detailed source anatomy");
    const bodyBounds = new Box3().setFromObject(mesh).expandByScalar(0.01);
    object.traverse((child) => {
      if (child.isSkinnedMesh && child !== mesh) {
        assert.ok(
          bodyBounds.containsPoint(
            new Box3().setFromObject(child).getCenter(new Vector3()),
          ),
          "eye remains inside the head/body bounds",
        );
      }
    });
    const before = [];
    for (let i = 0; i < mesh.geometry.attributes.position.count; i += 40)
      before.push([i, mesh.getVertexPosition(i, new Vector3())]);
    pose("armsOpen");
    const opened = new Box3().setFromObject(object);
    assert.ok(
      opened.getSize(new Vector3()).x > size.x + 0.35,
      "arms move outward",
    );
    assert.ok(
      before.some(
        ([index, position]) =>
          mesh.getVertexPosition(index, new Vector3()).distanceTo(position) >
          0.1,
      ),
      "skin follows bones",
    );
    pose("standing");
    before.forEach(([index, position]) =>
      assert.ok(
        mesh.getVertexPosition(index, new Vector3()).distanceTo(position) <
          1e-6,
      ),
    );
    disposeObject(object);
  });
}
