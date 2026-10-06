"""Bake the generated skin swatch onto the existing rigged human models.

Blender 4.2+, Cycles CPU. Keeps body geometry, joints, and weights unchanged.
See assets/textures/README.md for provenance and reproduction instructions.
"""

import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

parser = argparse.ArgumentParser()
parser.add_argument("--root", type=Path, required=True)
parser.add_argument("--size", type=int, default=2048)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
texture_dir = args.root / "assets" / "textures"


def node(material, kind):
    return material.node_tree.nodes.new(kind)


def link(material, a, b):
    material.node_tree.links.new(a, b)


def active(obj):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def make_uv(obj):
    """Pack source UDIM islands into one glTF-compatible 0–1 UV atlas."""
    active(obj)
    layer = obj.data.uv_layers.get("SkinUV")
    if layer:
        obj.data.uv_layers.active = layer
        return
    layer = obj.data.uv_layers.new(name="SkinUV", do_init=True)
    obj.data.uv_layers.active = layer
    layer.active_render = True
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(udim_source="ACTIVE_UDIM", rotate=True, scale=True,
                          margin_method="FRACTION", margin=0.006)
    bpy.ops.object.mode_set(mode="OBJECT")
    # Only the atlas should be exported; the original asset remains downloadable.
    for name in [uv.name for uv in obj.data.uv_layers]:
        if name != "SkinUV":
            obj.data.uv_layers.remove(obj.data.uv_layers[name])
    assert all(-0.001 <= value <= 1.001 for item in obj.data.uv_layers.active.data for value in item.uv), "UVs must fit one tile"


def make_skin(body, eyes):
    material = bpy.data.materials.new("Human skin — baked PBR")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    coords = node(material, "ShaderNodeTexCoord")
    scale = node(material, "ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs[3].default_value = 8.0
    link(material, coords.outputs["Object"], scale.inputs[0])
    swatch = node(material, "ShaderNodeTexImage")
    swatch.image = bpy.data.images.load(str(texture_dir / "skin-albedo-source.png"))
    swatch.projection = "BOX"
    swatch.projection_blend = 0.3
    link(material, scale.outputs[0], swatch.inputs["Vector"])
    saturation = node(material, "ShaderNodeHueSaturation")
    saturation.inputs["Saturation"].default_value = 0.8
    link(material, swatch.outputs["Color"], saturation.inputs["Color"])

    # Soft local tinting avoids a uniform all-over material. These are aesthetic
    # color masks, not clinical/anatomical measurements.
    centers = [sum((v.co for v in eye.data.vertices), Vector()) / len(eye.data.vertices) for eye in eyes]
    eye_center = sum(centers, Vector()) / len(centers)
    attr = body.data.color_attributes.get("SkinTint") or body.data.color_attributes.new(
        name="SkinTint", type="FLOAT_COLOR", domain="POINT")
    for vertex in body.data.vertices:
        x, y, z = vertex.co
        front = max(0.0, min(1.0, (-y - 0.065) / 0.055))
        lip = math.exp(-((x - eye_center.x) / 0.022) ** 4
                       - ((z - (eye_center.z - 0.067)) / 0.008) ** 4) * front
        cheek = math.exp(-((abs(x - eye_center.x) - 0.043) / 0.026) ** 2
                         - ((z - (eye_center.z - 0.035)) / 0.026) ** 2) * front
        knees = math.exp(-((z - 0.47) / 0.055) ** 2) * max(0, min(1, -y / 0.03))
        attr.data[vertex.index].color = (1.0 - 0.1 * lip,
            1.0 - 0.34 * lip - 0.045 * cheek - 0.025 * knees,
            1.0 - 0.28 * lip - 0.045 * cheek - 0.02 * knees, 1)
    tint = node(material, "ShaderNodeVertexColor")
    tint.layer_name = "SkinTint"
    mix = node(material, "ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1
    link(material, saturation.outputs["Color"], mix.inputs[1])
    link(material, tint.outputs["Color"], mix.inputs[2])
    link(material, mix.outputs[0], shader.inputs["Base Color"])

    grain = node(material, "ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 1400
    grain.inputs["Detail"].default_value = 2
    link(material, coords.outputs["Object"], grain.inputs["Vector"])
    bump = node(material, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.32
    bump.inputs["Distance"].default_value = 0.00025
    link(material, grain.outputs["Fac"], bump.inputs["Height"])
    link(material, bump.outputs["Normal"], shader.inputs["Normal"])
    rough = node(material, "ShaderNodeMapRange")
    rough.inputs["From Min"].default_value = 0
    rough.inputs["From Max"].default_value = 1
    rough.inputs["To Min"].default_value = 0.43
    rough.inputs["To Max"].default_value = 0.62
    link(material, grain.outputs["Fac"], rough.inputs["Value"])
    link(material, rough.outputs[0], shader.inputs["Roughness"])
    shader.inputs["Metallic"].default_value = 0
    shader.inputs["Specular IOR Level"].default_value = 0.3
    body.data.materials.clear()
    body.data.materials.append(material)
    return material, mix.outputs[0], rough.outputs[0]


def bake(obj, material, name, size, mode, socket=None):
    active(obj)
    image = bpy.data.images.new(name, width=size, height=size, alpha=False)
    image.colorspace_settings.name = "sRGB" if mode == "COLOR" else "Non-Color"
    target = node(material, "ShaderNodeTexImage")
    target.image = image
    material.node_tree.nodes.active = target
    output = material.node_tree.nodes.get("Material Output")
    original = output.inputs["Surface"].links[0].from_socket
    if socket:
        emission = node(material, "ShaderNodeEmission")
        link(material, socket, emission.inputs["Color"])
        link(material, emission.outputs[0], output.inputs["Surface"])
    bpy.ops.object.bake(type="NORMAL" if mode == "NORMAL" else "EMIT",
                        normal_space="TANGENT", margin=16, use_clear=True)
    link(material, original, output.inputs["Surface"])
    if socket:
        material.node_tree.nodes.remove(emission)
    image.filepath_raw = str(texture_dir / f"{name}.png")
    image.file_format = "PNG"
    image.save()
    image.pack()
    return image


def apply_baked_material(obj, color, normal=None, roughness=None):
    material = bpy.data.materials.new("Skin PBR" if normal else "Eye PBR")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Metallic"].default_value = 0
    shader.inputs["Roughness"].default_value = 0.5 if normal else 0.25
    shader.inputs["Specular IOR Level"].default_value = 0.3 if normal else 0.5
    texture = node(material, "ShaderNodeTexImage")
    texture.image = color
    link(material, texture.outputs["Color"], shader.inputs["Base Color"])
    if normal:
        texture = node(material, "ShaderNodeTexImage")
        texture.image = normal
        normal_node = node(material, "ShaderNodeNormalMap")
        link(material, texture.outputs["Color"], normal_node.inputs["Color"])
        link(material, normal_node.outputs[0], shader.inputs["Normal"])
    if roughness:
        texture = node(material, "ShaderNodeTexImage")
        texture.image = roughness
        separate = node(material, "ShaderNodeSeparateColor")
        link(material, texture.outputs["Color"], separate.inputs["Color"])
        link(material, separate.outputs["Green"], shader.inputs["Roughness"])
    obj.data.materials.clear()
    obj.data.materials.append(material)


def texture_eye(eye, kind, index):
    make_uv(eye)
    material = bpy.data.materials.new("Natural eye bake")
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    center = sum((v.co for v in eye.data.vertices), Vector()) / len(eye.data.vertices)
    attr = eye.data.color_attributes.get("EyeColor") or eye.data.color_attributes.new(
        name="EyeColor", type="FLOAT_COLOR", domain="POINT")
    for vertex in eye.data.vertices:
        p = vertex.co - center
        radius = math.hypot(p.x, p.z)
        if p.y < -0.004 and radius < 0.0058:
            color = (0.11, 0.055, 0.022, 1) if radius > 0.0028 else (0.004, 0.003, 0.002, 1)
        else:
            color = (0.72, 0.67, 0.61, 1)
        attr.data[vertex.index].color = color
    tint = node(material, "ShaderNodeVertexColor")
    tint.layer_name = "EyeColor"
    eye.data.materials.clear()
    eye.data.materials.append(material)
    image = bake(eye, material, f"{kind}-eye-{index}", 256, "COLOR", tint.outputs["Color"])
    apply_baked_material(eye, image)


report = []
for kind in ["male", "female"]:
    bpy.ops.wm.open_mainfile(filepath=str(args.root / "assets" / "source" / f"human-{kind}.blend"))
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 8
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.target = "IMAGE_TEXTURES"
    body = bpy.data.objects[f"GEO-body_{kind}_realistic"]
    eyes = [obj for obj in bpy.data.objects if obj.type == "MESH" and obj != body]
    make_uv(body)
    material, color_socket, rough_socket = make_skin(body, eyes)
    color = bake(body, material, f"{kind}-skin-color", args.size, "COLOR", color_socket)
    normal = bake(body, material, f"{kind}-skin-normal", args.size, "NORMAL")
    roughness = bake(body, material, f"{kind}-skin-roughness", args.size, "ROUGHNESS", rough_socket)
    apply_baked_material(body, color, normal, roughness)
    for index, eye in enumerate(eyes):
        texture_eye(eye, kind, index)
    bpy.ops.object.select_all(action="SELECT")
    output = args.root / "public" / "models" / f"human-{kind}.glb"
    bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", use_selection=True,
        export_animations=False, export_skins=True, export_morph=False, export_extras=True,
        export_yup=True, export_texcoords=True, export_cameras=False, export_lights=False,
        export_vertex_color="NONE", export_image_format="AUTO")
    bpy.data.orphans_purge(do_recursive=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(args.root / "assets" / "source" / f"human-{kind}.blend"), compress=True)
    report.append({"id": kind, "textureSize": args.size, "bytes": output.stat().st_size,
                   "maps": [color.name, normal.name, roughness.name]})
(texture_dir / "bake-report.json").write_text(json.dumps(report, indent=2) + "\n")
print("TEXTURE_REPORT", json.dumps(report))
