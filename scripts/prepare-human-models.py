"""Prepare Blender's CC0 Human Base Meshes as editable rigs and web GLBs.

Run with Blender 4.2+ (see assets/source/README.md). Only source geometry is
loaded; embedded scripts are never needed. No animation clips are generated.
"""

import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

parser = argparse.ArgumentParser()
parser.add_argument("--source", required=True, type=Path)
parser.add_argument("--output", required=True, type=Path)
args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])


def make_material():
    material = bpy.data.materials.new("Warm anatomical clay")
    material.diffuse_color = (0.53, 0.37, 0.27, 1)
    material.use_nodes = True
    shader = material.node_tree.nodes.get("Principled BSDF")
    shader.inputs["Base Color"].default_value = material.diffuse_color
    shader.inputs["Roughness"].default_value = 0.7
    shader.inputs["Metallic"].default_value = 0
    return material


def create_rig(kind, floor):
    """Basic FK rig aligned to each source model's A-pose; no finger/face rig."""
    armature = bpy.data.armatures.new(f"{kind}-skeleton")
    rig = bpy.data.objects.new(f"{kind}-rig", armature)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")

    def bone(name, head, tail, parent=None):
        item = armature.edit_bones.new(name)
        item.head = Vector(head) - Vector((0, 0, floor))
        item.tail = Vector(tail) - Vector((0, 0, floor))
        # Stable local Z faces backwards, making shared static pose offsets usable.
        item.align_roll(Vector((0, 1, 0)))
        if parent:
            item.parent = armature.edit_bones[parent]
        return item

    female = kind == "female"
    pelvis_z = 0.86 if female else 0.88
    chest_z = 1.25 if female else 1.28
    neck_z = 1.39 if female else 1.42
    bone("hips", (0, 0.015, pelvis_z), (0, 0.015, 1.02))
    bone("spine", (0, 0.015, 1.02), (0, 0.01, 1.16), "hips")
    bone("chest", (0, 0.01, 1.16), (0, 0.01, chest_z + 0.07), "spine")
    bone("neck", (0, 0.01, chest_z + 0.07), (0, -0.01, neck_z + 0.055), "chest")
    bone("head", (0, -0.01, neck_z + 0.055), (0, -0.035, 1.63 if female else 1.675), "neck")
    for side, sign in [("L", 1), ("R", -1)]:
        shoulder = (sign * (0.165 if female else 0.195), 0.005, 1.32 if female else 1.35)
        elbow = (sign * (0.26 if female else 0.295), -0.018, 1.09 if female else 1.105)
        wrist = (sign * (0.345 if female else 0.375), -0.044, 0.91 if female else 0.895)
        hand = (sign * (0.388 if female else 0.414), -0.064, 0.795 if female else 0.78)
        hip = (sign * 0.092, 0.02, pelvis_z)
        knee = (sign * (0.115 if female else 0.14), -0.015, 0.455 if female else 0.46)
        ankle = (sign * (0.132 if female else 0.173), 0.045, 0.085)
        toe = (ankle[0], -0.10, 0.035)
        bone(f"clavicle.{side}", (sign * 0.035, 0.005, chest_z + 0.06), shoulder, "chest")
        bone(f"upper_arm.{side}", shoulder, elbow, f"clavicle.{side}")
        bone(f"forearm.{side}", elbow, wrist, f"upper_arm.{side}")
        bone(f"hand.{side}", wrist, hand, f"forearm.{side}")
        bone(f"thigh.{side}", hip, knee, "hips")
        bone(f"shin.{side}", knee, ankle, f"thigh.{side}")
        bone(f"foot.{side}", ankle, toe, f"shin.{side}")
    bpy.ops.object.mode_set(mode="OBJECT")
    rig.show_in_front = True
    return rig


def prepare(kind):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    collection_name = f"Body {kind.title()} - Realistic"
    with bpy.data.libraries.load(str(args.source), link=False) as (source, target):
        assert collection_name in source.collections
        target.collections = [collection_name]
    collection = target.collections[0]
    bpy.context.scene.collection.children.link(collection)
    collection.hide_viewport = collection.hide_render = False
    body = bpy.data.objects[f"GEO-body_{kind}_realistic"]
    bpy.context.view_layer.update()
    origin_x = body.matrix_world.translation.x
    floor = min((body.matrix_world @ vertex.co).z for vertex in body.data.vertices)
    material = make_material()
    meshes = list(collection.all_objects)
    # Eyes may be parented in the library. Snapshot all world transforms before
    # recentering the body, otherwise a parent's offset is applied twice.
    source_transforms = {obj: obj.matrix_world.copy() for obj in meshes}
    translation = Matrix.Translation((-origin_x, 0, -floor))
    for obj in meshes:
        obj.hide_set(False)
        obj.hide_viewport = obj.hide_render = False
        obj.animation_data_clear()
        obj.parent = None
        obj.matrix_world = translation @ source_transforms[obj]
        bpy.context.view_layer.update()
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        for modifier in list(obj.modifiers):
            if modifier.type == "MULTIRES":
                modifier.levels = 0
                modifier.sculpt_levels = 0
                modifier.render_levels = 0
            else:
                obj.modifiers.remove(modifier)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        obj.data.materials.clear()
        obj.data.materials.append(material)
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
        obj.select_set(False)

    rig = create_rig(kind, floor)
    body.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type="ARMATURE_AUTO")
    bpy.ops.object.select_all(action="DESELECT")
    body.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    unweighted = [v.index for v in body.data.vertices if not any(g.weight > 0 for g in v.groups)]
    if unweighted:
        raise RuntimeError(f"{kind}: {len(unweighted)} vertices have no bone weights")
    # Interpolate the validated weights while adding one level of sculpt detail.
    for modifier in list(body.modifiers):
        if modifier.type == "MULTIRES":
            modifier.levels = modifier.sculpt_levels = modifier.render_levels = 1
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.vertex_group_limit_total(limit=4)
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    for eye in meshes:
        if eye == body:
            continue
        eye.parent = rig
        group = eye.vertex_groups.new(name="head")
        group.add(list(range(len(eye.data.vertices))), 1.0, "REPLACE")
        modifier = eye.modifiers.new("Head attachment", "ARMATURE")
        modifier.object = rig

    rig["source"] = "Blender Human Base Meshes v1.4.1 / Dan Ulrich / CC0"
    rig["rig_note"] = "Basic project-added 19-bone FK rig; automatic skin weights; no finger/face controls"
    bpy.ops.object.select_all(action="SELECT")
    bpy.context.view_layer.objects.active = rig
    output = args.output / "public" / "models"
    output.mkdir(parents=True, exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=str(output / f"human-{kind}.glb"),
        export_format="GLB", use_selection=True,
        export_animations=False, export_skins=True, export_morph=False,
        export_extras=True, export_yup=True, export_texcoords=False,
        export_cameras=False, export_lights=False,
    )
    source_output = args.output / "assets" / "source"
    source_output.mkdir(parents=True, exist_ok=True)
    # Remove unused original sculpt data before saving the editable source.
    bpy.data.orphans_purge(do_recursive=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(source_output / f"human-{kind}.blend"), compress=True)
    return {
        "id": kind, "collection": collection_name,
        "author": collection.asset_data.author, "bones": len(rig.data.bones),
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "triangles": sum(sum(len(face.vertices) - 2 for face in obj.data.polygons) for obj in meshes),
        "bytes": (output / f"human-{kind}.glb").stat().st_size,
        "unweightedVertices": len(unweighted),
        "weightMethod": "Blender automatic bone heat weights on base mesh, interpolated to subdivision level 1",
    }


report = [prepare(kind) for kind in ["male", "female"]]
(args.output / "assets" / "source" / "export-report.json").write_text(json.dumps(report, indent=2) + "\n")
print("EXPORT_REPORT", json.dumps(report))
