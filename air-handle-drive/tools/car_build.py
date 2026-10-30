import bpy, bmesh, math, sys, os
from mathutils import Vector, Euler

OUT = r'C:\w\repo\air-handle-drive\assets'
os.makedirs(OUT, exist_ok=True)
FRAMES = int(os.environ.get('CAR_FRAMES', '9'))
SAMPLES = int(os.environ.get('CAR_SAMPLES', '80'))
ONLY = os.environ.get('CAR_ONLY')   # 例 "4,0" で中央のブレーキ無しだけ

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

# ---------------- 材質 ----------------
def mat(name, base, metal=0.0, rough=0.5, coat=0.0, coat_rough=0.03, emit=None, emit_str=0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*base, 1)
    b.inputs['Metallic'].default_value = metal; b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat; b.inputs['Coat Roughness'].default_value = coat_rough
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1); b.inputs['Emission Strength'].default_value = emit_str
    return m

def srgb(h):
    h = h.lstrip('#'); r, g, b = (int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b))

PAINT = mat('paint', srgb('#1565c0'), 0.55, 0.28, 1.0, 0.02)
PAINT_D = mat('paint_dark', srgb('#0b3d82'), 0.55, 0.3, 1.0, 0.02)
RED = mat('red', srgb('#e53935'), 0.2, 0.3, 1.0, 0.03)
WHITE = mat('white', srgb('#f4f6fa'), 0.0, 0.25, 1.0, 0.02)
YELLOW = mat('yellow', srgb('#ffd400'), 0.0, 0.35)
BLACK = mat('black', (0.01, 0.01, 0.011), 0.0, 0.45)
RUBBER = mat('rubber', (0.012, 0.012, 0.013), 0.0, 0.88)
ALU = mat('alu', (0.75, 0.76, 0.78), 1.0, 0.22)
FRAME = mat('frame', (0.045, 0.047, 0.052), 0.75, 0.38)
SUSP = mat('susp', (0.03, 0.03, 0.035), 0.8, 0.3)
BRAKE_OFF = mat('brake_off', srgb('#5a1010'), 0.0, 0.2, 0.5, 0.05)
BRAKE_ON = mat('brake_on', srgb('#ff1020'), 0.0, 0.2, 0.5, 0.05, emit=srgb('#ff1020'), emit_str=9)

# カーボンの織り目（チェッカーを凹凸に）
CARBON = bpy.data.materials.new('carbon'); CARBON.use_nodes = True
nt = CARBON.node_tree; bs = nt.nodes['Principled BSDF']
tc = nt.nodes.new('ShaderNodeTexCoord'); ck = nt.nodes.new('ShaderNodeTexChecker'); ck.inputs['Scale'].default_value = 260
ck.inputs['Color1'].default_value = (0.006, 0.006, 0.007, 1); ck.inputs['Color2'].default_value = (0.03, 0.03, 0.034, 1)
nt.links.new(tc.outputs['Object'], ck.inputs['Vector']); nt.links.new(ck.outputs['Color'], bs.inputs['Base Color'])
bp = nt.nodes.new('ShaderNodeBump'); bp.inputs['Strength'].default_value = 0.15
nt.links.new(ck.outputs['Fac'], bp.inputs['Height']); nt.links.new(bp.outputs['Normal'], bs.inputs['Normal'])
bs.inputs['Roughness'].default_value = 0.28; bs.inputs['Coat Weight'].default_value = 0.9; bs.inputs['Coat Roughness'].default_value = 0.03

def put(obj, m, smooth=True):
    obj.data.materials.clear(); obj.data.materials.append(m)
    if smooth:
        for p in obj.data.polygons: p.use_smooth = True
    return obj

def subsurf(o, lv=2):
    md = o.modifiers.new('s', 'SUBSURF'); md.levels = lv; md.render_levels = lv

def bevel(o, w=0.01, seg=3):
    md = o.modifiers.new('b', 'BEVEL'); md.width = w; md.segments = seg; md.limit_method = 'ANGLE'

def box(name, loc, size, m, rot=(0, 0, 0), bev=0.012, sub=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc); o = bpy.context.object; o.name = name
    o.scale = size; o.rotation_euler = rot; bpy.ops.object.transform_apply(scale=True)
    if bev: bevel(o, bev)
    if sub: subsurf(o, sub)
    return put(o, m)

def cyl(name, p1, p2, r, m, verts=24):
    p1, p2 = Vector(p1), Vector(p2); d = p2 - p1
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=d.length, vertices=verts, location=(p1 + p2) / 2); o = bpy.context.object; o.name = name
    o.rotation_euler = d.to_track_quat('Z', 'Y').to_euler(); return put(o, m)

def solid_from_loops(name, loops, m, sub=0, bev=0):
    """loops: 断面（点のリスト）を前後に並べて面を張る。各断面は同じ点数"""
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    rings = [[bm.verts.new(p) for p in lp] for lp in loops]
    n = len(rings[0])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(rings[0][::-1]); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o)
    if bev: bevel(o, bev)
    if sub: subsurf(o, sub)
    return put(o, m)

def rbox(x, yh, z0, z1, taper=1.0, rz=0.0):
    """角丸四角の断面（x の位置、半幅 yh、下 z0・上 z1）"""
    yt = yh * taper; zc = (z0 + z1) / 2; h = (z1 - z0) / 2 * (1.0 if taper >= 1 else 1.0)
    pts = [(x, -yh, z0), (x, yh, z0), (x, yt, z1 - rz), (x, -yt, z1 - rz)]
    return pts

def airfoil(name, x_te, z, half_w, chord, thick, camber, aoa_deg, m):
    N = 28; top = []; bot = []
    for i in range(N + 1):
        t = (1 - math.cos(i / N * math.pi)) / 2
        yt = 5 * thick * (0.2969 * math.sqrt(t) - 0.126 * t - 0.3516 * t * t + 0.2843 * t ** 3 - 0.1036 * t ** 4)
        yc = camber * math.sin(math.pi * t)
        top.append((-t * chord, -(yc) + yt * chord)); bot.append((-t * chord, -(yc) - yt * chord))
    prof = top + bot[::-1][1:-1]
    me = bpy.data.meshes.new(name); bm = bmesh.new()
    a = [bm.verts.new((px, -half_w, pz)) for px, pz in prof]; b = [bm.verts.new((px, half_w, pz)) for px, pz in prof]
    n = len(prof)
    for i in range(n): bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(a[::-1]); bm.faces.new(b)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(me); bm.free()
    o = bpy.data.objects.new(name, me); sc.collection.objects.link(o)
    o.location = (x_te + chord, 0, z); o.rotation_euler = (0, math.radians(-aoa_deg), 0)   # 後ろ縁が上がる向き
    return put(o, m)

# ---------------- 骨組み（car.glb）----------------
bpy.ops.import_scene.gltf(filepath=r'C:\w\repo\car.glb')
fr = [o for o in sc.objects if o.type == 'MESH'][0]
root = fr.parent
if root: fr.parent = None; bpy.data.objects.remove(root)
fr.scale = (0.001, 0.001, 0.001); fr.location = (0, 0, 0); bpy.context.view_layer.update()
bpy.ops.object.select_all(action='DESELECT'); fr.select_set(True); bpy.context.view_layer.objects.active = fr
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
put(fr, FRAME, smooth=True)
bb = [fr.matrix_world @ Vector(c) for c in fr.bound_box]
print('frame bbox', min(v.x for v in bb), max(v.x for v in bb), min(v.y for v in bb), max(v.y for v in bb), min(v.z for v in bb), max(v.z for v in bb))

car = bpy.data.objects.new('car', None); sc.collection.objects.link(car)
parts = []   # 車に付ける物
def add(o): parts.append(o); return o
add(fr)

RX, FX = 0.20, 1.75           # 後軸・前軸の x
TRACK = 0.60                  # 車輪中心の y（片側）
TR = 0.265                    # タイヤ半径
# ---------------- 車体 ----------------
# 床とバッテリーボックスのカバー（後ろ側）
add(box('floor', (1.2, 0, 0.045), (2.2, 0.62, 0.025), CARBON, bev=0.008))
add(solid_from_loops('rearbody', [
    [(0.02, -0.26, 0.10), (0.02, 0.26, 0.10), (0.02, 0.22, 0.52), (0.02, -0.22, 0.52)],
    [(0.45, -0.31, 0.08), (0.45, 0.31, 0.08), (0.45, 0.27, 0.62), (0.45, -0.27, 0.62)],
    [(0.85, -0.33, 0.08), (0.85, 0.33, 0.08), (0.85, 0.29, 0.66), (0.85, -0.29, 0.66)],
], PAINT, sub=2, bev=0))
# サイドポンツーン
for s in (-1, 1):
    add(solid_from_loops('pod%d' % s, [
        [(0.85, s * 0.30, 0.10), (0.85, s * 0.50, 0.10), (0.85, s * 0.48, 0.47), (0.85, s * 0.31, 0.50)],
        [(1.25, s * 0.30, 0.10), (1.25, s * 0.56, 0.10), (1.25, s * 0.52, 0.44), (1.25, s * 0.31, 0.46)],
        [(1.70, s * 0.28, 0.10), (1.70, s * 0.46, 0.10), (1.70, s * 0.44, 0.34), (1.70, s * 0.29, 0.36)],
    ], PAINT, sub=2))
# ノーズ
add(solid_from_loops('nose', [
    [(1.55, -0.26, 0.10), (1.55, 0.26, 0.10), (1.55, 0.24, 0.40), (1.55, -0.24, 0.40)],
    [(2.10, -0.20, 0.08), (2.10, 0.20, 0.08), (2.10, 0.18, 0.32), (2.10, -0.18, 0.32)],
    [(2.62, -0.09, 0.09), (2.62, 0.09, 0.09), (2.62, 0.08, 0.20), (2.62, -0.08, 0.20)],
], PAINT, sub=2))
# コクピット周りの縁（ヘッドレスト・ロールフープのパッド）
add(box('headrest', (0.95, 0, 0.80), (0.12, 0.26, 0.16), BLACK, bev=0.03, sub=1))
# ドライバー（ヘルメット・肩）
hm = bpy.data.objects.new('helmet_holder', None)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.135, segments=48, ring_count=24, location=(1.12, 0, 0.93)); hel = bpy.context.object; hel.scale = (1.05, 0.95, 1.0)
put(hel, WHITE); add(hel)
bpy.ops.mesh.primitive_torus_add(location=(1.12, 0, 0.93), major_radius=0.133, minor_radius=0.012, major_segments=48, minor_segments=8); st = bpy.context.object
st.rotation_euler = (math.pi / 2, 0, 0); st.scale = (1.05, 1, 1); put(st, PAINT); add(st)   # ヘルメットの青いライン（後ろから見える縦帯）
bpy.ops.mesh.primitive_cube_add(size=1, location=(1.095, 0, 0.93)); band = bpy.context.object; band.scale = (0.30, 0.035, 0.30); put(band, PAINT); band.modifiers.new('b', 'BEVEL').width = 0.01; add(band)
bpy.ops.mesh.primitive_uv_sphere_add(radius=0.18, segments=32, ring_count=16, location=(1.18, 0, 0.66)); sh = bpy.context.object; sh.scale = (0.9, 1.7, 0.9); put(sh, BLACK); add(sh)
add(box('arm_pad', (1.25, 0, 0.58), (0.4, 0.5, 0.12), BLACK, bev=0.04, sub=1))

# ---------------- ウイング ----------------
# リアウイング（フレーム後端のさらに後ろ・上）
RW_X = -0.12
add(airfoil('rw_main', RW_X, 0.95, 0.46, 0.34, 0.07, 0.07, 12, CARBON))
add(airfoil('rw_flap', RW_X - 0.04, 1.10, 0.46, 0.26, 0.07, 0.07, 28, PAINT))
add(airfoil('rw_top', RW_X - 0.10, 1.23, 0.44, 0.20, 0.06, 0.06, 34, CARBON))
for s in (-1, 1):
    add(box('rw_plate%d' % s, (RW_X - 0.05, s * 0.475, 1.06), (0.56, 0.012, 0.42), RED, bev=0.006))
    add(cyl('rw_strut%d' % s, (0.12, s * 0.14, 0.52), (RW_X + 0.05, s * 0.30, 0.95), 0.018, CARBON))
# ディフューザー
add(box('diff_roof', (0.05, 0, 0.19), (0.46, 0.5, 0.02), CARBON, rot=(0, math.radians(-14), 0), bev=0.006))
for i in range(-3, 4):
    add(box('diff_fin%d' % i, (0.0, i * 0.075, 0.15), (0.40, 0.008, 0.12), CARBON, bev=0.003))
add(box('diff_side_l', (0.0, 0.265, 0.14), (0.44, 0.012, 0.14), CARBON, bev=0.004))
add(box('diff_side_r', (0.0, -0.265, 0.14), (0.44, 0.012, 0.14), CARBON, bev=0.004))
# フロントウイング
add(airfoil('fw_main', 2.46, 0.13, 0.62, 0.36, 0.06, 0.06, -4, CARBON))
add(airfoil('fw_flap', 2.40, 0.22, 0.60, 0.20, 0.05, 0.05, 20, PAINT))
for s in (-1, 1): add(box('fw_plate%d' % s, (2.30, s * 0.64, 0.20), (0.52, 0.012, 0.22), RED, bev=0.006))
# 高電圧マーク・ブレーキランプ・ナンバー
tri = bmesh.new(); vv = [tri.verts.new(p) for p in [(0, 0, 0.13), (0, -0.07, 0.0), (0, 0.07, 0.0)]]; tri.faces.new(vv)
me = bpy.data.meshes.new('hv'); tri.to_mesh(me); tri.free(); hv = bpy.data.objects.new('hv', me); sc.collection.objects.link(hv); hv.location = (-0.003, 0, 0.30); hv.scale = (1, 1, 1)
hv.rotation_euler = (0, 0, 0); put(hv, YELLOW); add(hv)
bpy.ops.object.text_add(location=(-0.003, 0, 0.14), rotation=(math.pi / 2, 0, math.pi / 2)); tx = bpy.context.object
tx.data.body = 'TAKUDEN EV'; tx.data.size = 0.055; tx.data.align_x = 'CENTER'; tx.data.extrude = 0.002; put(tx, WHITE, smooth=False); add(tx)
brake = box('brake_light', (-0.01, 0, 0.40), (0.012, 0.16, 0.05), BRAKE_OFF, bev=0.004); add(brake)
add(box('white_band', (0.0, 0, 0.58), (0.012, 0.50, 0.018), WHITE, bev=0.004))

# ---------------- サスペンション ----------------
def arms(x, s, r_hub):
    hub = (x, s * TRACK, TR); ch = s * 0.30
    add(cyl('ua%d%.1f' % (s, x), (x - 0.12, ch, 0.42), hub, 0.011, SUSP)); add(cyl('ua2%d%.1f' % (s, x), (x + 0.12, ch, 0.42), hub, 0.011, SUSP))
    add(cyl('la%d%.1f' % (s, x), (x - 0.12, ch, 0.12), hub, 0.012, SUSP)); add(cyl('la2%d%.1f' % (s, x), (x + 0.12, ch, 0.12), hub, 0.012, SUSP))
    add(cyl('tie%d%.1f' % (s, x), (x + 0.16, ch, 0.18), (x + 0.07, s * (TRACK - 0.08), TR + 0.02), 0.008, SUSP))
for s in (-1, 1): arms(RX, s, TR); arms(FX, s, TR)

# ---------------- ホイールとタイヤ ----------------
wheels = {}
def make_wheel(name, x, s, steerable):
    h = bpy.data.objects.new(name, None); sc.collection.objects.link(h); h.location = (x, s * TRACK, TR)
    bpy.ops.mesh.primitive_cylinder_add(radius=TR, depth=0.20, vertices=96); t = bpy.context.object; t.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.transform_apply(rotation=True)
    bevel(t, 0.035, 4); put(t, RUBBER); t.parent = h
    bpy.ops.mesh.primitive_cylinder_add(radius=0.17, depth=0.215, vertices=48); r = bpy.context.object; r.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.transform_apply(rotation=True); bevel(r, 0.012, 2); put(r, ALU); r.parent = h
    bpy.ops.mesh.primitive_cylinder_add(radius=0.035, depth=0.23, vertices=6); n = bpy.context.object; n.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.transform_apply(rotation=True); put(n, BLACK); n.parent = h
    # ブレーキディスク
    bpy.ops.mesh.primitive_cylinder_add(radius=0.11, depth=0.01, vertices=48, location=(0, -s * 0.0, 0)); d = bpy.context.object; d.rotation_euler = (math.pi / 2, 0, 0)
    bpy.ops.object.transform_apply(rotation=True); put(d, SUSP); d.parent = h
    parts.append(h); wheels[name] = h; return h
for s in (-1, 1):
    make_wheel('rw%d' % s, RX, s, False); make_wheel('fw%d' % s, FX, s, True)

for o in parts:
    if o.parent is None: o.parent = car

# ---------------- 地面・光・カメラ ----------------
bpy.ops.mesh.primitive_plane_add(size=40, location=(1.2, 0, 0)); gr = bpy.context.object; gr.is_shadow_catcher = True; gr.hide_render = True
sc.render.engine = 'CYCLES'; sc.cycles.samples = SAMPLES; sc.cycles.use_denoising = True
sc.cycles.device = 'CPU'
sc.render.film_transparent = True
sc.render.resolution_x = 640; sc.render.resolution_y = 520; sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
sc.view_settings.view_transform = 'Filmic' if 'Filmic' in bpy.types.ColorManagedViewSettings.bl_rna.properties['view_transform'].enum_items.keys() else 'AgX'
w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True; wn = w.node_tree
sky = wn.nodes.new('ShaderNodeTexSky'); sky.sky_type = 'NISHITA'; sky.sun_elevation = math.radians(40); sky.sun_rotation = math.radians(210); sky.sun_disc = False
bg = wn.nodes['Background']; bg.inputs['Strength'].default_value = 0.45; wn.links.new(sky.outputs['Color'], bg.inputs['Color'])
sun = bpy.data.lights.new('sun', 'SUN'); sun.energy = 3.2; sun.angle = math.radians(1.5); sun.color = (1.0, 0.95, 0.86)
so = bpy.data.objects.new('sun', sun); sc.collection.objects.link(so); so.rotation_euler = (math.radians(52), 0, math.radians(-125))
cam = bpy.data.cameras.new('cam'); cam.lens = 85; cam.clip_end = 100; co = bpy.data.objects.new('cam', cam); sc.collection.objects.link(co); sc.camera = co
CAM = (-4.9, 0, 1.85); TARGET = Vector((0.7, 0, 0.55))
co.location = CAM; co.rotation_euler = (TARGET - Vector(CAM)).to_track_quat('-Z', 'Y').to_euler()

def set_pose(steer, braking):
    car.rotation_euler = (0, 0, math.radians(-steer * 7.0)); car.location = (0, 0, 0)
    for k, h in wheels.items():
        if k.startswith('fw'): h.rotation_euler = (0, 0, math.radians(-steer * 20.0))
    put(brake, BRAKE_ON if braking else BRAKE_OFF)

todo = [(i, b) for b in (0, 1) for i in range(FRAMES)]
if ONLY: a, b = ONLY.split(','); todo = [(int(a), int(b))]
for i, b in todo:
    steer = -1 + 2 * i / (FRAMES - 1)
    set_pose(steer, b)
    sc.render.filepath = os.path.join(OUT, 'car_%d_%d.png' % (i, b))
    bpy.ops.render.render(write_still=True)
print('done')
