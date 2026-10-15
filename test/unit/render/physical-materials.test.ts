import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { MATERIAL_PRESETS, REALISTIC_EXPOSURE } from '@/render/material-presets';
import {
  applyAgxToneMapping,
  createPhysicalMaterial,
  injectAgxToneMapping,
} from '@/render/physical-materials';

const SHADER = [
  '#include <common>',
  'void main() {',
  '\tgl_FragColor = vec4( 1.0 );',
  '\t#include <tonemapping_fragment>',
  '\t#include <colorspace_fragment>',
  '}',
].join('\n');

const AGX_CALL = 'gl_FragColor.rgb = AgXToneMapping( gl_FragColor.rgb );';

describe('shader chunks of three (canary)', () => {
  it('the physical fragment shader includes common and the tone mapping', () => {
    const shader = THREE.ShaderLib.physical.fragmentShader;
    expect(shader).toContain('#include <common>');
    expect(shader).toContain('#include <tonemapping_fragment>');
  });

  it('the tone mapping pars chunk defines AgX and declares the exposure', () => {
    const chunk = THREE.ShaderChunk.tonemapping_pars_fragment;
    expect(chunk).toContain('vec3 AgXToneMapping( vec3 color )');
    expect(chunk).toContain('uniform float toneMappingExposure;');
  });
});

describe('injectAgxToneMapping', () => {
  it('inserts the tone mapping pars right after common', () => {
    const result = injectAgxToneMapping(SHADER);
    expect(result).toContain(`#include <common>\n${THREE.ShaderChunk.tonemapping_pars_fragment}`);
    expect(result.indexOf('#include <common>')).toBeLessThan(result.indexOf('AgXToneMapping'));
  });

  it('replaces the tone mapping include by the AgX call', () => {
    const result = injectAgxToneMapping(SHADER);
    expect(result).not.toContain('#include <tonemapping_fragment>');
    expect(result).toContain(`\t${AGX_CALL}\n\t#include <colorspace_fragment>`);
  });

  it('keeps the rest of the shader', () => {
    const result = injectAgxToneMapping(SHADER);
    expect(result.startsWith('#include <common>\n')).toBe(true);
    expect(result).toContain('gl_FragColor = vec4( 1.0 );');
  });

  it('works on the physical fragment shader of three', () => {
    const result = injectAgxToneMapping(THREE.ShaderLib.physical.fragmentShader);
    expect(result).toContain(AGX_CALL);
    expect(result).not.toContain('#include <tonemapping_fragment>');
    expect(result).toContain('uniform float toneMappingExposure;');
  });

  it('throws without the tone mapping include', () => {
    expect(() => injectAgxToneMapping('#include <common>\nvoid main() {}')).toThrow();
  });

  it('throws without the common include', () => {
    expect(() =>
      injectAgxToneMapping('void main() {\n#include <tonemapping_fragment>\n}'),
    ).toThrow();
  });
});

/** Runs onBeforeCompile of a material on a minimal shader, as the renderer would. */
function compile(material: THREE.Material): {
  fragmentShader: string;
  uniforms: Record<string, THREE.IUniform>;
} {
  const shader = { fragmentShader: SHADER, vertexShader: '', uniforms: {} };
  // The renderer passes the full program parameters; the callback reads only the shader and the
  // uniforms, so a partial object stands in for them. Same for the renderer, which it ignores.
  material.onBeforeCompile(
    shader as unknown as THREE.WebGLProgramParametersWithUniforms,
    {} as THREE.WebGLRenderer,
  );
  return shader;
}

describe('applyAgxToneMapping', () => {
  it('injects the AgX curve and the exposure uniform at compile time', () => {
    const material = new THREE.MeshPhysicalMaterial();
    applyAgxToneMapping(material);
    const shader = compile(material);
    expect(shader.fragmentShader).toBe(injectAgxToneMapping(SHADER));
    expect(shader.uniforms.toneMappingExposure?.value).toBe(REALISTIC_EXPOSURE);
  });

  it('sets its own program cache key', () => {
    const material = new THREE.MeshPhysicalMaterial();
    applyAgxToneMapping(material);
    expect(material.customProgramCacheKey()).toBe('tinycad-agx');
  });
});

describe('createPhysicalMaterial', () => {
  it('sets the values of the preset and the colour', () => {
    const preset = MATERIAL_PRESETS.glass;
    const material = createPhysicalMaterial(preset, 0x123456, null);
    expect(material).toBeInstanceOf(THREE.MeshPhysicalMaterial);
    expect(material.color.getHex()).toBe(0x123456);
    expect(material.metalness).toBe(preset.metalness);
    expect(material.roughness).toBe(preset.roughness);
    expect(material.clearcoat).toBe(preset.clearcoat);
    expect(material.clearcoatRoughness).toBe(preset.clearcoatRoughness);
    expect(material.transmission).toBe(preset.transmission);
    expect(material.ior).toBe(preset.ior);
    expect(material.thickness).toBe(preset.thickness);
    expect(material.envMapIntensity).toBe(preset.envMapIntensity);
    material.dispose();
  });

  it('pushes the faces back in depth like the shaded faces, so the edges win', () => {
    const material = createPhysicalMaterial(MATERIAL_PRESETS.plastic, 0xffffff, null);
    expect(material.polygonOffset).toBe(true);
    expect(material.polygonOffsetFactor).toBe(1);
    expect(material.polygonOffsetUnits).toBe(1);
  });

  it('turns the environment from Y up (RoomEnvironment) to Z up (the scene)', () => {
    const material = createPhysicalMaterial(MATERIAL_PRESETS.steel, 0xffffff, null);
    expect(material.envMapRotation.toArray()).toEqual([Math.PI / 2, 0, 0, 'XYZ']);
    // three samples the map in the direction R^T · normal: the world up (+Z) must read the
    // ceiling of the room (+Y).
    const rotation = new THREE.Matrix4().makeRotationFromEuler(material.envMapRotation);
    const sampled = new THREE.Vector3(0, 0, 1).applyMatrix4(rotation.transpose());
    expect(sampled.x).toBeCloseTo(0);
    expect(sampled.y).toBeCloseTo(1);
    expect(sampled.z).toBeCloseTo(0);
  });

  it('sets the environment map, or none', () => {
    const envMap = new THREE.Texture();
    expect(createPhysicalMaterial(MATERIAL_PRESETS.steel, 0xffffff, envMap).envMap).toBe(envMap);
    expect(createPhysicalMaterial(MATERIAL_PRESETS.steel, 0xffffff, null).envMap).toBeNull();
  });

  it('applies the AgX tone mapping in its shader', () => {
    const material = createPhysicalMaterial(MATERIAL_PRESETS.brass, 0xffffff, null);
    expect(material.customProgramCacheKey()).toBe('tinycad-agx');
    expect(compile(material).fragmentShader).toContain(AGX_CALL);
  });
});
