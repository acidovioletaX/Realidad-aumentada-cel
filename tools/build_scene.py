"""Genera orbes.usdz: escena AR anclada para AR Quick Look (iPhone).

Uso:  python3 tools/build_scene.py   (requiere: pip install usd-core numpy)
"""
import math
import os
import shutil
import tempfile
import wave

import numpy as np
from pxr import Gf, Sdf, Usd, UsdGeom, UsdMedia, UsdShade, UsdUtils, Vt

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FPS = 30
LOOP_S = 8
FRAMES = FPS * LOOP_S
rng = np.random.default_rng(7)


# ---------------------------------------------------------------- geometría
class MeshBuf:
    """Acumula varias piezas en una sola malla (una por material)."""

    def __init__(self):
        self.pts, self.counts, self.idx = [], [], []

    def add(self, pts, faces):
        base = len(self.pts)
        self.pts.extend(map(tuple, pts))
        for f in faces:
            self.counts.append(len(f))
            self.idx.extend(base + i for i in f)

    def write(self, stage, path, material):
        if not self.pts:
            return
        m = UsdGeom.Mesh.Define(stage, path)
        m.CreatePointsAttr(Vt.Vec3fArray([Gf.Vec3f(*p) for p in self.pts]))
        m.CreateFaceVertexCountsAttr(self.counts)
        m.CreateFaceVertexIndicesAttr(self.idx)
        m.CreateSubdivisionSchemeAttr("none")
        m.CreateDoubleSidedAttr(True)
        pts = np.array(self.pts)
        m.CreateExtentAttr([Gf.Vec3f(*pts.min(0)), Gf.Vec3f(*pts.max(0))])
        # normales suaves por vértice
        n = np.zeros_like(pts)
        k = 0
        for c in self.counts:
            f = self.idx[k:k + c]
            fn = np.cross(pts[f[1]] - pts[f[0]], pts[f[2]] - pts[f[0]])
            n[f] += fn
            k += c
        n /= np.maximum(np.linalg.norm(n, axis=1, keepdims=True), 1e-9)
        m.CreateNormalsAttr(Vt.Vec3fArray([Gf.Vec3f(*v) for v in n]))
        m.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
        UsdShade.MaterialBindingAPI.Apply(m.GetPrim()).Bind(material)


def tube(curve, radii, sides=6):
    """Tubo a lo largo de una curva (N,3) con radio por punto."""
    curve = np.asarray(curve)
    n = len(curve)
    t = np.gradient(curve, axis=0)
    t /= np.linalg.norm(t, axis=1, keepdims=True)
    ref = np.array([0, 1, 0]) if abs(t[0][1]) < .9 else np.array([1, 0, 0])
    u = np.cross(t[0], ref); u /= np.linalg.norm(u)
    pts = []
    for i in range(n):
        u = u - t[i] * np.dot(u, t[i]); u /= np.linalg.norm(u)  # transporte paralelo
        v = np.cross(t[i], u)
        for s in range(sides):
            a = 2 * math.pi * s / sides
            pts.append(curve[i] + radii[i] * (math.cos(a) * u + math.sin(a) * v))
    pts.append(curve[-1])  # punta
    tip = len(pts) - 1
    faces = []
    for i in range(n - 1):
        for s in range(sides):
            a, b = i * sides + s, i * sides + (s + 1) % sides
            faces.append([a, b, b + sides, a + sides])
    for s in range(sides):
        faces.append([(n - 1) * sides + s, (n - 1) * sides + (s + 1) % sides, tip])
    return pts, faces


def ellipsoid(center, axes, rot=np.eye(3), seg=14, rings=9):
    pts, faces = [], []
    for i in range(rings + 1):
        th = math.pi * i / rings
        for j in range(seg):
            ph = 2 * math.pi * j / seg
            p = np.array([math.sin(th) * math.cos(ph), math.cos(th), math.sin(th) * math.sin(ph)]) * axes
            pts.append(center + rot @ p)
    for i in range(rings):
        for j in range(seg):
            a, b = i * seg + j, i * seg + (j + 1) % seg
            faces.append([a, a + seg, b + seg, b])
    return pts, faces


def fib_dirs(n):
    i = np.arange(n) + .5
    phi = np.arccos(1 - 2 * i / n)
    th = math.pi * (1 + 5 ** .5) * i
    return np.stack([np.cos(th) * np.sin(phi), np.cos(phi), np.sin(th) * np.sin(phi)], 1)


def frame_from(d):
    """Base ortonormal cuyo eje Y apunta en d."""
    d = d / np.linalg.norm(d)
    ref = np.array([1, 0, 0]) if abs(d[0]) < .9 else np.array([0, 0, 1])
    x = np.cross(ref, d); x /= np.linalg.norm(x)
    z = np.cross(x, d)
    return np.stack([x, d, z], 1)


def spike_curve(d, r0, length, curl, n=12):
    swirl = np.cross(d, [0, 1, 0])
    if np.linalg.norm(swirl) < 1e-3:
        swirl = np.cross(d, [1, 0, 0])
    swirl /= np.linalg.norm(swirl)
    s = np.linspace(0, 1, n)[:, None]
    return d * (r0 + length * s) + swirl * curl * length * s ** 2


# ---------------------------------------------------------------- materiales
def material(stage, name, diffuse, emissive=(0, 0, 0), metallic=0., rough=.4, opacity=1.):
    mat = UsdShade.Material.Define(stage, f"/Scene/Looks/{name}")
    sh = UsdShade.Shader.Define(stage, f"/Scene/Looks/{name}/PBR")
    sh.CreateIdAttr("UsdPreviewSurface")
    sh.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*diffuse))
    sh.CreateInput("emissiveColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*emissive))
    sh.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(metallic)
    sh.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(rough)
    sh.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(opacity)
    mat.CreateSurfaceOutput().ConnectToSource(sh.ConnectableAPI(), "surface")
    return mat


# ---------------------------------------------------------------- orbes
def urchin(stage, path, M, n, length, curl, glow, all_glow=False):
    """Erizo: espinas curvas negras con puntas luminosas."""
    base, tips, halo = MeshBuf(), MeshBuf(), MeshBuf()
    for d in fib_dirs(n):
        d = d + rng.normal(0, .06, 3); d /= np.linalg.norm(d)
        L = length * rng.uniform(.75, 1.1)
        c = spike_curve(d, .03, L, curl)
        r = np.linspace(.006, .0008, len(c))
        cut = 5
        if not all_glow:
            base.add(*tube(c[:cut + 1], r[:cut + 1]))
        tips.add(*tube(c[0 if all_glow else cut:], r[0 if all_glow else cut:]))
        halo.add(*tube(c[cut:], r[cut:] * 2.6, 5))
    base.write(stage, path + "/Spines", M["black"])
    tips.write(stage, path + "/Tips", M[glow])
    halo.write(stage, path + "/Halo", M[glow + "_halo"])
    core = MeshBuf(); core.add(*ellipsoid(np.zeros(3), np.array([.045] * 3)))
    core.write(stage, path + "/Core", M[glow])


def shell_ring(stage, path, M, glow):
    """Anillo de conchas: cuencos negros con borde luminoso, girando."""
    ring = UsdGeom.Xform.Define(stage, path + "/Ring")
    spin = ring.AddRotateZOp()
    for f in range(0, FRAMES + 1, 10):
        spin.Set(-720 * f / FRAMES, f)
    rim, inner = MeshBuf(), MeshBuf()
    N, R = 13, .28
    for k in range(N):
        a = 2 * math.pi * k / N
        c = np.array([math.cos(a) * R, math.sin(a) * R, 0])
        radial = c / R
        tang = np.array([-math.sin(a), math.cos(a), 0])
        out = np.cross(radial, tang)
        tilt = math.radians(40)
        ax_long = math.cos(tilt) * tang + math.sin(tilt) * out
        ax_norm = np.cross(ax_long, radial)
        rot = np.stack([ax_long, ax_norm, radial], 1)
        rim.add(*ellipsoid(c, np.array([.1, .022, .068]), rot))
        for side in (1, -1):  # centro negro en ambas caras: solo brilla el borde
            inner.add(*ellipsoid(c + ax_norm * .01 * side, np.array([.078, .016, .05]), rot))
    rim.write(stage, path + "/Ring/Rims", M[glow + "_shell"])
    inner.write(stage, path + "/Ring/Cups", M["black"])
    urchin(stage, path + "/Star", M, 26, .16, .25, glow)


def flower(stage, path, M, glow):
    """Flor: pétalos negros brillantes con filamentos violeta."""
    petals, fil, tips = MeshBuf(), MeshBuf(), MeshBuf()
    for d in fib_dirs(22):
        rot = frame_from(d)
        petals.add(*ellipsoid(d * .17, np.array([.035, .11, .055]), rot, 10, 7))
        tips.add(*ellipsoid(d * .265, np.array([.012, .025, .018]), rot, 8, 5))
    for d in fib_dirs(14):
        d = d + rng.normal(0, .1, 3); d /= np.linalg.norm(d)
        c = spike_curve(d, .05, .38, .9, 16)
        fil.add(*tube(c, np.linspace(.004, .001, len(c)), 5))
    petals.write(stage, path + "/Petals", M["gloss"])
    fil.write(stage, path + "/Filaments", M[glow])
    tips.write(stage, path + "/PetalTips", M[glow])
    core = MeshBuf(); core.add(*ellipsoid(np.zeros(3), np.array([.07] * 3)))
    core.write(stage, path + "/Core", M[glow])


# ---------------------------------------------------------------- sonido
def write_tone(path, f0, sr=22050):
    """Zumbido electrónico de LOOP_S segundos, que empalma sin cortes."""
    t = np.arange(sr * LOOP_S) / sr
    lfo = .5 + .5 * np.sin(2 * math.pi * t / LOOP_S * 4)
    s = (np.sin(2 * math.pi * f0 * t + 1.2 * np.sin(2 * math.pi * f0 * 2 * t))
         * (.55 + .25 * lfo)
         + .25 * np.sin(2 * math.pi * (f0 * 2 + .25) * t))
    # pulsos cortos y agudos, 2 por segundo
    ph = (t * 2) % 1
    s += .35 * np.sin(2 * math.pi * f0 * 6 * t) * np.exp(-ph * 18)
    s = s / np.abs(s).max() * .7
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr)
        w.writeframes((s * 32767).astype("<i2").tobytes())


# ---------------------------------------------------------------- escena
ORBS = [
    # nombre, tipo, posición (m), escala, brillo, nota Hz, giro (vueltas por ciclo)
    ("Cian",    "urchin", (-1.1, 1.5, -2.6), 1.0, "cyan",   110.0,  1),
    ("Azul",    "urchin_glow", (.7, 1.35, -3.2), 1.15, "blue", 146.75, -1),
    ("Anillo",  "ring",   (-.35, 1.25, -1.5), 1.0, "cyan",   220.0,  1),
    ("Violeta", "flower", (.85, 1.15, -1.8), 1.0, "violet", 164.75, -1),
    ("Chispa",  "urchin_small", (-.2, 1.8, -4.2), .7, "ice", 329.5, 2),
]


def build(out_dir):
    usda = os.path.join(out_dir, "orbes.usdc")
    stage = Usd.Stage.CreateNew(usda)
    UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
    UsdGeom.SetStageMetersPerUnit(stage, 1.0)
    stage.SetStartTimeCode(0); stage.SetEndTimeCode(FRAMES)
    stage.SetTimeCodesPerSecond(FPS); stage.SetFramesPerSecond(FPS)
    scene = UsdGeom.Xform.Define(stage, "/Scene")
    stage.SetDefaultPrim(scene.GetPrim())

    M = {
        "black": material(stage, "Black", (.01, .01, .015), metallic=.6, rough=.25),
        "gloss": material(stage, "Gloss", (.0, .0, .0), metallic=.9, rough=.12),
    }
    for name, col in {"cyan": (0, .85, 1), "blue": (.15, .35, 1), "violet": (.45, .2, 1), "ice": (.7, .95, 1)}.items():
        M[name] = material(stage, name.title(), (0, 0, 0), emissive=col, rough=.3)
        M[name + "_shell"] = material(stage, name.title() + "Shell", col, emissive=tuple(c * .55 for c in col), metallic=.5, rough=.15)
        M[name + "_halo"] = material(stage, name.title() + "Halo", (0, 0, 0), emissive=col, opacity=.18)

    # Disco invisible a la altura del piso: fija la base de la escena en el suelo
    floor = MeshBuf()
    floor.add([(-.05, 0, -.05), (.05, 0, -.05), (.05, 0, .05), (-.05, 0, .05)], [[0, 3, 2, 1]])
    floor.write(stage, "/Scene/FloorAnchor", material(stage, "Invisible", (0, 0, 0), opacity=0.))

    for name, kind, pos, scale, glow, note, turns in ORBS:
        p = f"/Scene/{name}"
        x = UsdGeom.Xform.Define(stage, p)
        tr, ry, rx = x.AddTranslateOp(), x.AddRotateYOp(), x.AddRotateXOp()
        x.AddScaleOp().Set(Gf.Vec3f(scale))
        ph = rng.uniform(0, 2 * math.pi)
        for f in range(0, FRAMES + 1, 5):
            a = 2 * math.pi * f / FRAMES
            tr.Set(Gf.Vec3d(pos[0] + .12 * math.cos(a + ph), pos[1] + .07 * math.sin(2 * a + ph),
                            pos[2] + .12 * math.sin(a + ph)), f)
            ry.Set(360. * turns * f / FRAMES, f)
            rx.Set(18 * math.sin(a + ph), f)
        body = p + "/Body"
        UsdGeom.Xform.Define(stage, body)
        if kind == "urchin":
            urchin(stage, body, M, 44, .34, .35, glow)
        elif kind == "urchin_glow":
            urchin(stage, body, M, 36, .4, .5, glow, all_glow=True)
        elif kind == "urchin_small":
            urchin(stage, body, M, 30, .28, .2, glow)
        elif kind == "ring":
            shell_ring(stage, body, M, glow)
        elif kind == "flower":
            flower(stage, body, M, glow)

        wav = f"tono_{name.lower()}.wav"
        write_tone(os.path.join(out_dir, wav), note)
        snd = UsdMedia.SpatialAudio.Define(stage, p + "/Sonido")
        snd.CreateFilePathAttr(Sdf.AssetPath(wav))
        snd.CreateAuralModeAttr(UsdMedia.Tokens.spatial)
        snd.CreatePlaybackModeAttr(UsdMedia.Tokens.loopFromStage)
        snd.CreateGainAttr(.8)

    stage.GetRootLayer().Save()
    return usda


if __name__ == "__main__":
    tmp = tempfile.mkdtemp()
    src = build(tmp)
    out = os.path.join(ROOT, "orbes.usdz")
    UsdUtils.CreateNewARKitUsdzPackage(src, out)
    shutil.rmtree(tmp)
    print("escrito", out, os.path.getsize(out) // 1024, "KB")
