# ─────────────────────────────────────────────────────────────
#  Figuren aus MakeHuman/MPFB (CC0) bauen – läuft in Blender (Hintergrund)
#  im Workflow „Figuren“:
#    blender -b -P scripts/chars/make_chars.py -- <out> <chars.json> [asset-pack.zip]
#  Je Figur: Körper (Statur, Alter, Herkunft), Low-Poly-Körper, Haut,
#  Spiel-Skelett (game_engine), Augen, Brauen, Haare, Kleidung – dann eine
#  Export-Kopie mit eingebackenen Formen als GLB (mit Skinning) und ein
#  Vorschaubild (Cycles). Dazu out/assets.json mit allen verfügbaren Assets.
# ─────────────────────────────────────────────────────────────
import bpy, sys, os, json, zipfile, importlib, math, traceback

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath(argv[0] if len(argv) > 0 else 'out/chars')
CFG = json.load(open(argv[1] if len(argv) > 1 else 'scripts/chars/chars.json', encoding='utf8'))
PACK = argv[2] if len(argv) > 2 else None
os.makedirs(OUT, exist_ok=True)
REPORT = {'chars': {}, 'errors': []}


def log(*a):
    print('[figuren]', *a, flush=True)


def dynamic_import(absolute_package_str, key):
    for amod in list(sys.modules):
        if amod.endswith(absolute_package_str):
            mod = importlib.import_module(amod)
            return getattr(mod, key)
    raise ValueError('Modul nicht gefunden: ' + absolute_package_str)


# MPFB muss als Erweiterung installiert und aktiv sein
import addon_utils
for mod in addon_utils.modules():
    if mod.__name__.endswith('.mpfb') or mod.__name__ == 'mpfb':
        addon_utils.enable(mod.__name__, default_set=True, persistent=True)
        log('MPFB aktiv:', mod.__name__)

HumanService = dynamic_import('mpfb.services.humanservice', 'HumanService')
TargetService = dynamic_import('mpfb.services.targetservice', 'TargetService')
AssetService = dynamic_import('mpfb.services.assetservice', 'AssetService')
ExportService = dynamic_import('mpfb.services.exportservice', 'ExportService')
ObjectService = dynamic_import('mpfb.services.objectservice', 'ObjectService')
LocationService = dynamic_import('mpfb.services.locationservice', 'LocationService')
HumanObjectProperties = dynamic_import('mpfb.entities.objectproperties', 'HumanObjectProperties')

# ── Asset-Paket installieren ─────────────────────────────────
data_dir = LocationService.get_user_data()
os.makedirs(data_dir, exist_ok=True)
if PACK and os.path.exists(PACK):
    with zipfile.ZipFile(PACK) as z:
        z.extractall(data_dir)
    log('Asset-Paket entpackt nach', data_dir)
AssetService.update_all_asset_lists()

SUBDIRS = ['skins', 'clothes', 'hair', 'eyes', 'eyebrows', 'eyelashes', 'proxymeshes', 'teeth', 'tongue']
ASSETS = {}
for sub in SUBDIRS:
    try:
        paths = AssetService.list_mhmat_assets(sub) if sub == 'skins' else (AssetService.list_proxy_assets(sub) if sub == 'proxymeshes' else AssetService.list_mhclo_assets(sub))
        ASSETS[sub] = sorted(str(p) for p in paths)
    except Exception as e:  # noqa
        ASSETS[sub] = []
        REPORT['errors'].append(f'Liste {sub}: {e}')
json.dump({k: [os.path.basename(p) for p in v] for k, v in ASSETS.items()}, open(os.path.join(OUT, 'assets.json'), 'w'), indent=1)
log('Assets:', {k: len(v) for k, v in ASSETS.items()})


def find(sub, wanted):
    """Ersten passenden Pfad finden: genauer Name (ohne Endung), sonst Teilwort."""
    if not wanted:
        return None
    if isinstance(wanted, str):
        wanted = [wanted]
    paths = ASSETS.get(sub, [])
    base = lambda p: os.path.basename(p).rsplit('.', 1)[0].lower()
    for w in wanted:
        for p in paths:
            if base(p) == w.lower():
                return p
    for w in wanted:
        for p in paths:
            if w.lower() in base(p):
                return p
    return None


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete()
    for coll in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.images, bpy.data.cameras, bpy.data.lights):
        for item in list(coll):
            if item.users == 0:
                coll.remove(item)


def apply_shape_keys(obj):
    if obj.type != 'MESH' or not obj.data.shape_keys:
        return
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.shape_key_remove(all=True, apply_mix=True)


def render_preview(root, path):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    try:
        scene.cycles.use_denoising = True
    except Exception:  # noqa
        pass
    scene.render.resolution_x, scene.render.resolution_y = 420, 760
    scene.render.film_transparent = False
    world = bpy.data.worlds.new('w') if not scene.world else scene.world
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get('Background')
    if bg:
        bg.inputs[0].default_value = (0.32, 0.33, 0.36, 1)
        bg.inputs[1].default_value = 0.6
    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 55
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.collection.objects.link(cam)
    cam.location = (1.4, -4.2, 1.15)
    direction = (0 - 1.4, 0 + 4.2, 0.92 - 1.15)
    import mathutils
    cam.rotation_euler = mathutils.Vector(direction).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    sun_data = bpy.data.lights.new('sun', 'SUN')
    sun_data.energy = 3.0
    sun = bpy.data.objects.new('sun', sun_data)
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    bpy.context.collection.objects.link(sun)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def build(spec):
    name = spec['name']
    info = {'name': name, 'assets': {}}
    macro = TargetService.get_default_macro_info_dict()
    macro.update({k: v for k, v in spec.get('macro', {}).items()})
    if 'race' in spec:
        macro['race'] = spec['race']
    basemesh = HumanService.create_human(macro_detail_dict=macro)
    proxy = None
    pp = find('proxymeshes', spec.get('proxy'))
    if pp:
        proxy = HumanService.add_mhclo_asset(pp, basemesh, asset_type='Proxymeshes', subdiv_levels=0, material_type='NONE')
        mod = basemesh.modifiers.new('Hide base mesh', 'MASK')
        mod.vertex_group = 'body'
        mod.invert_vertex_group = True
        info['assets']['proxy'] = os.path.basename(pp)
    sk = find('skins', spec.get('skin'))
    if sk:
        HumanService.set_character_skin(sk, basemesh, bodyproxy=proxy, skin_type='GAMEENGINE')
        info['assets']['skin'] = os.path.basename(sk)
    HumanService.add_builtin_rig(basemesh, CFG.get('rig', 'game_engine'))
    for sub, atype in (('eyes', 'Eyes'), ('eyebrows', 'Eyebrows'), ('eyelashes', 'Eyelashes'), ('hair', 'Hair')):
        p = find(sub, spec.get(sub))
        if p:
            HumanService.add_mhclo_asset(p, basemesh, asset_type=atype, subdiv_levels=0, material_type='GAMEENGINE')
            info['assets'][sub] = os.path.basename(p)
    for cand in spec.get('clothes', []):
        p = find('clothes', cand)
        if p:
            HumanService.add_mhclo_asset(p, basemesh, asset_type='Clothes', subdiv_levels=0, material_type='GAMEENGINE')
            info['assets'].setdefault('clothes', []).append(os.path.basename(p))
        else:
            info.setdefault('missing', []).append(cand)

    # Export-Kopie: Masken und Formen einbacken, Hilfsgeometrie weg
    export_root = ExportService.create_character_copy(basemesh, name_suffix='_x')
    export_basemesh = ObjectService.find_object_of_type_amongst_nearest_relatives(export_root, 'Basemesh')
    ExportService.bake_modifiers_remove_helpers(export_basemesh, bake_masks=True, bake_subdiv=True, remove_helpers=True, also_proxy=True)
    objs = [export_root] + ObjectService.get_list_of_children(export_root)
    for o in objs:
        apply_shape_keys(o)
    # Mit Low-Poly-Körper wird der Grundkörper nicht gebraucht
    if proxy:
        for o in list(objs):
            if o.type == 'MESH' and o.name.startswith(export_basemesh.name.split('_x')[0]) and o is export_basemesh:
                objs.remove(o)
                bpy.data.objects.remove(o, do_unlink=True)
    # Original ausblenden (nicht exportieren, nicht rendern)
    for o in [basemesh] + ObjectService.get_list_of_children(basemesh.parent or basemesh):
        o.hide_render = True
        o.hide_set(True)
    stats = {'meshes': [], 'tris': 0}
    for o in objs:
        if o.type == 'MESH':
            me = o.evaluated_get(bpy.context.evaluated_depsgraph_get()).to_mesh()
            me.calc_loop_triangles()
            n = len(me.loop_triangles)
            stats['meshes'].append({'name': o.name, 'tris': n, 'materials': [m.name for m in o.data.materials if m]})
            stats['tris'] += n
    info['stats'] = stats
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.hide_set(False)
        o.select_set(True)
    bpy.context.view_layer.objects.active = export_root
    glb = os.path.join(OUT, name + '.glb')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_animations=False,
                              export_morph=False, export_apply=True, export_skins=True, export_yup=True)
    info['bytes'] = os.path.getsize(glb)
    try:
        render_preview(export_root, os.path.join(OUT, name + '.png'))
    except Exception as e:  # noqa
        info['render_error'] = str(e)
    return info


for spec in CFG.get('chars', []):
    try:
        clear_scene()
        info = build(spec)
        REPORT['chars'][spec['name']] = info
        log('fertig:', spec['name'], json.dumps(info.get('stats', {}).get('tris')), info.get('assets'))
    except Exception as e:  # noqa
        REPORT['errors'].append(f"{spec.get('name')}: {e}\n{traceback.format_exc()}")
        log('FEHLER', spec.get('name'), e)
        traceback.print_exc()

json.dump(REPORT, open(os.path.join(OUT, 'report.json'), 'w'), indent=1)
log('Bericht:', json.dumps({k: v.get('stats', {}).get('tris') for k, v in REPORT['chars'].items()}), 'Fehler:', len(REPORT['errors']))
