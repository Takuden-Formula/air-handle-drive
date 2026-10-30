import bpy, math
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
def mat(name, base, rough=0.5, metal=0.0, emit=None):
    m = bpy.data.materials.new(name); m.use_nodes = True; b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1); b.inputs['Roughness'].default_value = rough; b.inputs['Metallic'].default_value = metal
    return m
ORANGE = mat('o', (0.80, 0.14, 0.012), 0.38); WHITE = mat('w', (0.85, 0.85, 0.83), 0.25); BLACK = mat('k', (0.015, 0.015, 0.016), 0.7)
def prim(op, m, **kw):
    op(**kw); o = bpy.context.object; o.data.materials.append(m)
    for p in o.data.polygons: p.use_smooth = True
    return o
# 本体（円錐。上 0.04 → 下 0.16）、反射帯2本、四角いベース
cone = prim(bpy.ops.mesh.primitive_cone_add, ORANGE, vertices=64, radius1=0.16, radius2=0.035, depth=0.62, location=(0, 0, 0.38))
cone.modifiers.new('b', 'BEVEL').width = 0.004
for z, r1, r2, d in [(0.46, 0.108, 0.088, 0.085), (0.325, 0.133, 0.11, 0.085)]:
    prim(bpy.ops.mesh.primitive_cone_add, WHITE, vertices=64, radius1=r1 + 0.002, radius2=r2 + 0.002, depth=d, location=(0, 0, z))
base = prim(bpy.ops.mesh.primitive_cube_add, BLACK, size=1, location=(0, 0, 0.035)); base.scale = (0.38, 0.38, 0.07)
bpy.ops.object.transform_apply(scale=True); base.modifiers.new('b', 'BEVEL').width = 0.03; base.modifiers['b'].segments = 4
prim(bpy.ops.mesh.primitive_uv_sphere_add, ORANGE, radius=0.045, location=(0, 0, 0.69)).scale = (1, 1, 0.5)
sc.render.engine = 'CYCLES'; sc.cycles.samples = 64; sc.cycles.use_denoising = True; sc.render.film_transparent = True
sc.render.resolution_x = 200; sc.render.resolution_y = 250
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; wn = w.node_tree
sky = wn.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'NISHITA'; sky.sun_disc = False; wn.links.new(sky.outputs['Color'], wn.nodes['Background'].inputs['Color']); wn.nodes['Background'].inputs['Strength'].default_value = 0.5
sun = bpy.data.lights.new('s', 'SUN'); sun.energy = 3.2; so = bpy.data.objects.new('s', sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(50), 0, math.radians(-120))
cam = bpy.data.cameras.new('c'); cam.type = 'ORTHO'; cam.ortho_scale = 0.9; co = bpy.data.objects.new('c', cam); sc.collection.objects.link(co); sc.camera = co
co.location = (0, -3, 0.65); co.rotation_euler = (math.radians(84), 0, 0)
sc.render.filepath = r'C:\w\repo\air-handle-drive\assets\cone.png'; bpy.ops.render.render(write_still=True)
