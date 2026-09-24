"use client";

import { useMemo } from "react";
import * as THREE from "three";
import { useGLTF, useTexture } from "@react-three/drei";
import { RigidBody, TrimeshCollider } from "@react-three/rapier";
import { PathPoint, TRACK, generateCenterline } from "./trackPath";
import { getMap } from "./maps";
import { getTerrain } from "./terrain";
import { useGameStore } from "./store";
import { MapFeatures } from "./MapFeatures";
import { InstancedProps, Placement, Prop } from "./Props";

const ROAD_Y = 0.03;
const SHOULDER_EDGE = 9.9;

function normalOf(p: PathPoint): [number, number] {
  return [Math.cos(p.heading), -Math.sin(p.heading)];
}

/** Flat ribbon between two lateral offsets of the centerline. Coloured ribbons get unshared vertices per segment for hard stripe edges. */
function buildRibbon(
  path: PathPoint[],
  from: number,
  to: number,
  y: number,
  vScale: number,
  colorAt?: (segment: number) => THREE.Color
): THREE.BufferGeometry {
  const n = path.length;
  const positions: number[] = [];
  const uvs: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const dists: number[] = [0];
  for (let i = 1; i <= n; i++) {
    const p = path[i % n];
    const q = path[(i - 1) % n];
    dists.push(dists[i - 1] + Math.hypot(p.x - q.x, p.z - q.z));
  }
  const edge = (i: number) => {
    const p = path[i % n];
    const [nx, nz] = normalOf(p);
    return [p.x + nx * from, p.z + nz * from, p.x + nx * to, p.z + nz * to, p.y];
  };
  for (let i = 0; i < n; i++) {
    const e0 = edge(i);
    const e1 = edge(i + 1);
    const base = positions.length / 3;
    positions.push(e0[0], y + e0[4], e0[1], e0[2], y + e0[4], e0[3], e1[0], y + e1[4], e1[1], e1[2], y + e1[4], e1[3]);
    uvs.push(0, dists[i] / vScale, 1, dists[i] / vScale, 0, dists[i + 1] / vScale, 1, dists[i + 1] / vScale);
    if (colorAt) {
      const c = colorAt(Math.floor(i / 4));
      for (let k = 0; k < 4; k++) colors.push(c.r, c.g, c.b);
    }
    indices.push(base, base + 2, base + 1, base + 1, base + 2, base + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  if (colorAt) g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  const normals = new Float32Array(positions.length);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  g.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  return g;
}

/** Closed extruded barrier wall along one side of the road (hard-edged red/white blocks). */
function buildWall(
  path: PathPoint[],
  side: 1 | -1,
  height: number,
  thickness: number,
  colorA: string,
  colorB: string
): THREE.BufferGeometry {
  const n = path.length;
  const inner = TRACK.wallOffset * side;
  const outer = (TRACK.wallOffset + thickness) * side;
  const prof: [number, number][] = [
    [inner, -1.5],
    [inner, height],
    [outer, height],
    [outer, -1.5],
  ];
  const positions: number[] = [];
  const colors: number[] = [];
  const indices: number[] = [];
  const red = new THREE.Color(colorA);
  const white = new THREE.Color(colorB);
  const at = (i: number, k: number) => {
    const p = path[i % n];
    const [nx, nz] = normalOf(p);
    return [p.x + nx * prof[k][0], p.y + prof[k][1], p.z + nz * prof[k][0]];
  };
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / 5) % 2 === 0 ? red : white;
    for (let k = 0; k < 3; k++) {
      const base = positions.length / 3;
      positions.push(...at(i, k), ...at(i + 1, k), ...at(i, k + 1), ...at(i + 1, k + 1));
      for (let j = 0; j < 4; j++) colors.push(c.r, c.g, c.b);
      indices.push(base, base + 1, base + 2, base + 2, base + 1, base + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeLineTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, 256, 256);
  g.fillStyle = "rgba(255,255,255,0.92)";
  g.fillRect(8, 0, 6, 256); // left edge line
  g.fillRect(242, 0, 6, 256); // right edge line
  g.fillStyle = "rgba(255,225,80,0.9)";
  g.fillRect(125, 20, 6, 96); // dashed centre
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

function makeCheckerTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 16;
  const g = c.getContext("2d")!;
  for (let x = 0; x < 16; x++) {
    for (let y = 0; y < 2; y++) {
      g.fillStyle = (x + y) % 2 === 0 ? "#f4f4f4" : "#151515";
      g.fillRect(x * 8, y * 8, 8, 8);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.NearestFilter;
  return t;
}

export function Track() {
  const mapId = useGameStore((st) => st.mapId);
  const map = getMap(mapId);
  const theme = map.theme;
  const path = useMemo(() => generateCenterline(mapId), [mapId]);

  const g = theme.ground.key;
  const [asphaltD, asphaltN, asphaltR, groundD, groundN, groundR] = useTexture(
    [
      "/tex/asphalt_diff.jpg",
      "/tex/asphalt_nor.jpg",
      "/tex/asphalt_rough.jpg",
      `/tex/${g}_diff.jpg`,
      `/tex/${g}_nor.jpg`,
      `/tex/${g}_rough.jpg`,
    ],
    (textures) => {
      (textures as THREE.Texture[]).forEach((t, i) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = 8;
        if (i === 0 || i === 3) t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
      });
    }
  );

  const geo = useMemo(() => {
    const w = TRACK.roadWidth;
    const k = TRACK.kerbWidth;
    const c1 = new THREE.Color(theme.kerb[0]);
    const c2 = new THREE.Color(theme.kerb[1]);
    const kerbColor = (s: number) => (s % 2 === 0 ? c1 : c2);
    return {
      road: buildRibbon(path, -w / 2, w / 2, ROAD_Y, 8),
      lines: buildRibbon(path, -w / 2, w / 2, ROAD_Y + 0.02, w),
      kerbL: buildRibbon(path, -w / 2 - k, -w / 2, ROAD_Y + 0.02, 1, kerbColor),
      kerbR: buildRibbon(path, w / 2, w / 2 + k, ROAD_Y + 0.02, 1, kerbColor),
      // Drivable shoulders out to (just under) the barriers, exactly following the road height.
      shoulderL: buildRibbon(path, -SHOULDER_EDGE, -w / 2, -0.02, 7.5),
      shoulderR: buildRibbon(path, w / 2, SHOULDER_EDGE, -0.02, 7.5),
      wallL: buildWall(path, -1, 1.4, 1.2, theme.wall[0], theme.wall[1]),
      wallR: buildWall(path, 1, 1.4, 1.2, theme.wall[0], theme.wall[1]),
    };
  }, [path, theme]);

  const lineTex = useMemo(() => makeLineTexture(), []);
  const checkerTex = useMemo(() => makeCheckerTexture(), []);
  // Physics-only walls are much taller than the visible barrier so a car that jumps at an angle can't escape the track.
  const wallData = useMemo(
    () =>
      ([-1, 1] as const).map((side) => {
        const gm = buildWall(path, side, 16, 1.2, theme.wall[0], theme.wall[1]);
        const data = {
          vertices: new Float32Array(gm.getAttribute("position").array),
          indices: new Uint32Array(gm.getIndex()!.array),
        };
        gm.dispose();
        return data;
      }),
    [path, theme]
  );

  const terrain = useMemo(() => getTerrain(mapId), [mapId]);
  const terrainGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(terrain.vertices, 3));
    g.setAttribute("uv", new THREE.BufferAttribute(terrain.uvs, 2));
    g.setAttribute("color", new THREE.BufferAttribute(terrain.colors, 3));
    g.setIndex(new THREE.BufferAttribute(terrain.indices, 1));
    g.computeVertexNormals();
    return g;
  }, [terrain]);
  const roadData = useMemo(
    () =>
      [geo.road, geo.shoulderL, geo.shoulderR].map((g) => ({
        vertices: new Float32Array(g.getAttribute("position").array),
        indices: new Uint32Array(g.getIndex()!.array),
      })),
    [geo]
  );

  const scenery = useMemo(() => {
    const rand = mulberry32(1337 + mapId.length * 7919);
    const minClear = TRACK.wallOffset + 9;
    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (const p of path) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minZ = Math.min(minZ, p.z);
      maxZ = Math.max(maxZ, p.z);
    }
    const x0 = minX - 150;
    const x1 = maxX + 150;
    const z0 = minZ - 150;
    const z1 = maxZ + 150;
    const far = (x: number, z: number) => {
      for (let i = 0; i < path.length; i += 2) {
        if (Math.hypot(path[i].x - x, path[i].z - z) < minClear) return false;
      }
      return true;
    };
    const groups = theme.scenery.map((grp) => {
      const placements: Placement[] = [];
      let attempts = 0;
      while (placements.length < grp.count && attempts < grp.count * 25) {
        attempts++;
        const x = x0 + rand() * (x1 - x0);
        const z = z0 + rand() * (z1 - z0);
        if (!far(x, z)) continue;
        placements.push({ x, z, y: terrain.heightAt(x, z), rot: rand() * 6.28, scale: grp.scale[0] + rand() * (grp.scale[1] - grp.scale[0]) });
      }
      return { url: grp.url, placements };
    });
    // A few of the first group lining the outside of the barriers.
    const lining: Placement[] = [];
    for (let i = 0; i < path.length; i += 9) {
      const p = path[i];
      const [nx, nz] = normalOf(p);
      const side = rand() < 0.5 ? -1 : 1;
      const off = TRACK.wallOffset + 6 + rand() * 10;
      lining.push({ x: p.x + nx * off * side, z: p.z + nz * off * side, y: terrain.heightAt(p.x + nx * off * side, p.z + nz * off * side), rot: rand() * 6.28, scale: 5 + rand() * 3 });
    }
    const posts: Placement[] = [];
    for (let i = 0; i < path.length; i += 28) {
      const p = path[i];
      const [nx, nz] = normalOf(p);
      const off = TRACK.wallOffset + 2.2;
      posts.push({ x: p.x + nx * off, z: p.z + nz * off, y: terrain.heightAt(p.x + nx * off, p.z + nz * off), rot: p.heading + Math.PI / 2, scale: 6 });
    }
    return { groups, lining, posts };
  }, [path, theme, mapId, terrain]);

  const start = path[0];
  const [snx, snz] = normalOf(start);
  const standOff = TRACK.wallOffset + 9;
  const neon = !!theme.neon;

  return (
    <group>
      <mesh geometry={terrainGeo} receiveShadow>
        <meshStandardMaterial map={groundD} normalMap={groundN} roughnessMap={groundR} color={theme.ground.tint} vertexColors />
      </mesh>
      <RigidBody type="fixed" colliders={false} friction={1}>
        <TrimeshCollider args={[terrain.vertices, terrain.indices]} />
        {roadData.map((d, i) => (
          <TrimeshCollider key={i} args={[d.vertices, d.indices]} />
        ))}
      </RigidBody>

      {[geo.shoulderL, geo.shoulderR].map((gm, i) => (
        <mesh key={`sh${i}`} geometry={gm} receiveShadow>
          <meshStandardMaterial map={groundD} normalMap={groundN} roughnessMap={groundR} color={theme.ground.tint} side={THREE.DoubleSide} />
        </mesh>
      ))}
      <mesh geometry={geo.road} receiveShadow>
        <meshStandardMaterial
          map={asphaltD}
          normalMap={asphaltN}
          roughnessMap={asphaltR}
          color={theme.roadTint}
          side={THREE.DoubleSide}
          polygonOffset
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
        />
      </mesh>
      <mesh geometry={geo.lines}>
        <meshBasicMaterial map={lineTex} transparent depthWrite={false} side={THREE.DoubleSide} toneMapped={!neon} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
      </mesh>
      {[geo.kerbL, geo.kerbR].map((gm, i) => (
        <mesh key={i} geometry={gm} receiveShadow>
          {neon ? (
            <meshBasicMaterial vertexColors side={THREE.DoubleSide} toneMapped={false} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
          ) : (
            <meshStandardMaterial vertexColors roughness={0.7} side={THREE.DoubleSide} polygonOffset polygonOffsetFactor={-4} polygonOffsetUnits={-4} />
          )}
        </mesh>
      ))}

      {[geo.wallL, geo.wallR].map((gm, i) => (
        <mesh key={i} geometry={gm} castShadow receiveShadow>
          {neon ? (
            <meshBasicMaterial vertexColors side={THREE.DoubleSide} toneMapped={false} />
          ) : (
            <meshStandardMaterial vertexColors roughness={0.8} side={THREE.DoubleSide} />
          )}
        </mesh>
      ))}
      <RigidBody type="fixed" colliders={false} friction={0.05} restitution={0.15}>
        {wallData.map((d, i) => (
          <TrimeshCollider key={i} args={[d.vertices, d.indices]} />
        ))}
      </RigidBody>

      {/* Start/finish line and gantry */}
      <mesh position={[start.x, ROAD_Y + 0.04, start.z]} rotation={[-Math.PI / 2, 0, -start.heading]}>
        <planeGeometry args={[TRACK.roadWidth, 2.4]} />
        <meshBasicMaterial map={checkerTex} />
      </mesh>
      <Prop url="/models/overhead.glb" x={start.x} z={start.z} rot={start.heading} scale={8.4} />
      <Prop
        url="/models/grandStand.glb"
        x={start.x + snx * standOff}
        z={start.z + snz * standOff}
        rot={start.heading + Math.PI / 2}
        scale={9}
      />
      <Prop
        url="/models/grandStand.glb"
        x={start.x + snx * standOff + Math.sin(start.heading) * 16}
        z={start.z + snz * standOff + Math.cos(start.heading) * 16}
        rot={start.heading + Math.PI / 2}
        scale={9}
      />
      <Prop
        url="/models/bannerTowerRed.glb"
        x={start.x - snx * (TRACK.wallOffset + 3) + Math.sin(start.heading) * 10}
        z={start.z - snz * (TRACK.wallOffset + 3) + Math.cos(start.heading) * 10}
        rot={start.heading}
        scale={7}
      />
      <Prop
        url="/models/billboard.glb"
        x={start.x - snx * (TRACK.wallOffset + 7) - Math.sin(start.heading) * 14}
        z={start.z - snz * (TRACK.wallOffset + 7) - Math.cos(start.heading) * 14}
        rot={start.heading + Math.PI}
        scale={9}
      />

      {scenery.groups.map((grp, i) => (
        <InstancedProps key={grp.url + i} url={grp.url} placements={grp.placements} castShadow />
      ))}
      {theme.scenery[0] && <InstancedProps url={theme.scenery[0].url} placements={scenery.lining} castShadow />}
      <InstancedProps url="/models/lightPostModern.glb" placements={scenery.posts} castShadow />

      <MapFeatures />
    </group>
  );
}

useGLTF.preload("/models/overhead.glb");
