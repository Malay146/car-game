import * as THREE from "three";

/** Shared time uniform for cheap vertex-shader animation (spectators, flags, birds...). Updated once per frame by <VisualClock />. */
export const uTime = { value: 0 };

/**
 * Patch a built-in material so `transformed` (the object-space vertex position) can be animated in the vertex
 * shader. `body` is GLSL run right after `#include <begin_vertex>`; `uTime` and `pre` (declarations) are available.
 * All animation runs on the GPU: no per-frame CPU work or allocation.
 */
export function animateVertices(material: THREE.Material, key: string, pre: string, body: string) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uTime;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>\nuniform float uTime;\n${pre}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\n${body}`);
  };
  material.customProgramCacheKey = () => key;
}
