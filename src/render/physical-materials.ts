// Physical materials of the bodies in Realistic (spec 09, "Realistic", ADR 0027). The AgX tone
// mapping is applied in their own shader, not by the renderer: renderer.toneMapping stays
// NoToneMapping, so the interactions keep the colours of the palette in every mode, and the AO
// pipeline drawing into render targets tone-maps the bodies too.

import * as THREE from 'three';
import { REALISTIC_EXPOSURE, type PhysicalPreset } from './material-presets';

const COMMON_INCLUDE = '#include <common>';
const TONE_MAPPING_INCLUDE = '#include <tonemapping_fragment>';
const AGX_CALL = 'gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );';
const PROGRAM_CACHE_KEY = 'tinycad-agx';

/**
 * The fragment shader with the AgX curve: the tone mapping pars (AgXToneMapping and the uniform
 * toneMappingExposure) right after common, and the AgX call instead of the tone mapping include.
 * With NoToneMapping the renderer puts the pars into no prefix and defines no TONE_MAPPING, so
 * nothing is declared twice. Throws when an include is missing (three changed its shaders).
 */
export function injectAgxToneMapping(fragmentShader: string): string {
  if (!fragmentShader.includes(COMMON_INCLUDE)) {
    throw new Error(`injectAgxToneMapping: the shader has no ${COMMON_INCLUDE}`);
  }
  if (!fragmentShader.includes(TONE_MAPPING_INCLUDE)) {
    throw new Error(`injectAgxToneMapping: the shader has no ${TONE_MAPPING_INCLUDE}`);
  }
  // Functions as replacements: the chunk text must not be read as a replacement pattern ($&…).
  return fragmentShader
    .replace(
      COMMON_INCLUDE,
      () => `${COMMON_INCLUDE}\n${THREE.ShaderChunk.tonemapping_pars_fragment}`,
    )
    .replace(TONE_MAPPING_INCLUDE, () => AGX_CALL);
}

/**
 * Makes the material tone-map its own output with AgX. The exposure is a uniform of the material:
 * three uploads the renderer's toneMappingExposure too, but the material uniforms come after it,
 * so REALISTIC_EXPOSURE applies regardless of the renderer.
 */
export function applyAgxToneMapping(material: THREE.Material): void {
  material.onBeforeCompile = (shader) => {
    // three's hook works by mutating the shader parameters it passes in.
    shader.fragmentShader = injectAgxToneMapping(shader.fragmentShader);
    shader.uniforms.toneMappingExposure = { value: REALISTIC_EXPOSURE };
  };
  // A program of its own: the same material type without the hook must not share it.
  material.customProgramCacheKey = () => PROGRAM_CACHE_KEY;
}

/**
 * A physical material of a preset in the given colour (physicalColor), with the AgX tone mapping.
 * Faces slightly back in depth like the shaded faces, so the edges and the highlight on them win.
 * RoomEnvironment is Y up, the scene Z up: three samples the map in the direction
 * R^T · normal, so R = Euler(π/2, 0, 0) (Y → Z) makes the world up (+Z) read the room ceiling (+Y).
 */
export function createPhysicalMaterial(
  preset: PhysicalPreset,
  color: number,
  envMap: THREE.Texture | null,
): THREE.MeshPhysicalMaterial {
  const material = new THREE.MeshPhysicalMaterial({
    color,
    metalness: preset.metalness,
    roughness: preset.roughness,
    clearcoat: preset.clearcoat,
    clearcoatRoughness: preset.clearcoatRoughness,
    transmission: preset.transmission,
    ior: preset.ior,
    thickness: preset.thickness,
    envMap,
    envMapIntensity: preset.envMapIntensity,
    envMapRotation: new THREE.Euler(Math.PI / 2, 0, 0),
    polygonOffset: true,
    polygonOffsetFactor: 1,
    polygonOffsetUnits: 1,
  });
  applyAgxToneMapping(material);
  return material;
}
