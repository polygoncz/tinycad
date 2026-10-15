// The ambient occlusion pipeline of the viewport (spec 09, "Víceprůchodové vykreslování (AO)",
// ADR 0026). Every pass draws into the one render target of the composer and none swaps buffers
// (needsSwap = false), so the depth of the model survives up to the interaction pass:
//   1. model: the scene with the interaction hidden, clears colour and depth; the only pass that
//      draws scene.background (the gradient of Realistic, M24);
//   2. AO: GTAOPass computes the AO texture only, then it is multiplied into the target in place;
//   3. interaction: the scene with the model hidden, no clear (the depth of the model stays);
//   4. output: OutputPass converts to sRGB onto the canvas.
// Needs WebGL: verified by e2e and by hand, no unit test.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOBlendShader } from 'three/addons/shaders/GTAOShader.js';
import type { Disposable } from '@/core';
import type { AoParameters } from './ao-parameters';
import { aoExcluded, hideDuring, withoutBackground, type ScenePartition } from './scene-partition';

export interface AoPipeline extends Disposable {
  /** CSS px; the target and the G-buffer are multiplied by the pixel ratio of the renderer. */
  setSize(width: number, height: number): void;
  /** Passes 1–4, output onto the canvas. */
  render(partition: ScenePartition, params: AoParameters): void;
}

/** MSAA of the render target (ADR 0026, point 6): FXAA or SMAA would blur the thin edges. */
const TARGET_SAMPLES = 4;

/** What the passes of one frame work with; set by render before the composer runs. */
interface Frame {
  readonly partition: ScenePartition;
  readonly params: AoParameters;
}

export function createAoPipeline(deps: {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** OrthographicCamera of the rig; GTAOPass reads the camera type when it is created. */
  camera: THREE.Camera;
  /** CSS px. */
  width: number;
  height: number;
}): AoPipeline {
  const { renderer, scene, camera } = deps;
  const pixelRatio = renderer.getPixelRatio();
  let frame: Frame | null = null;
  const currentFrame = (): Frame => {
    // The passes run only inside render, which sets the frame first.
    if (frame === null) throw new Error('AO pass outside of AoPipeline.render');
    return frame;
  };

  // Linear HalfFloat like the default target of the composer, plus MSAA.
  const target = new THREE.WebGLRenderTarget(deps.width * pixelRatio, deps.height * pixelRatio, {
    type: THREE.HalfFloatType,
    samples: TARGET_SAMPLES,
  });
  const composer = new EffectComposer(renderer, target);
  // The composer takes the size of a given target as CSS px; set the real one before addPass,
  // which sizes every pass by it.
  composer.setSize(deps.width, deps.height);

  const modelPass = new TargetClearPass(new RenderPass(scene, camera));
  composer.addPass(new HidingPass(modelPass, () => currentFrame().partition.interaction, null));

  const aoPass = new AoPass(
    scene,
    camera,
    deps.width * pixelRatio,
    deps.height * pixelRatio,
    () => {
      const { partition, params } = currentFrame();
      return { hidden: [...partition.interaction, ...aoExcluded(partition.model)], params };
    },
  );
  composer.addPass(aoPass);

  const interactionPass = new RenderPass(scene, camera);
  // Keeps the colour with AO and the depth of the model: sketches behind a body stay hidden.
  interactionPass.clear = false;
  // Without the background: it would cover the model drawn already (it ignores the depth).
  composer.addPass(new HidingPass(interactionPass, () => currentFrame().partition.model, scene));

  const outputPass = new OutputPass();
  composer.addPass(outputPass);

  return {
    setSize(width: number, height: number): void {
      composer.setSize(width, height);
    },
    render(partition: ScenePartition, params: AoParameters): void {
      frame = { partition, params };
      try {
        composer.render();
      } finally {
        // The frame holds scene objects; do not keep them past the frame.
        frame = null;
      }
    },
    dispose(): void {
      aoPass.dispose();
      modelPass.dispose();
      interactionPass.dispose();
      outputPass.dispose();
      composer.dispose();
    },
  };
}

/**
 * Runs a RenderPass so that its clear uses the clear colour in the colour space of the render
 * target. three converts the clear colour for the current target only in setClearColor and in
 * render, and RenderPass clears after setRenderTarget but before render: it would clear the linear
 * target with the sRGB values left by the last frame on the canvas, and the background would come
 * out lighter (spec 09, "Barvy"). So this pass sets the target and the clear colour again before
 * it delegates.
 */
class TargetClearPass extends Pass {
  private readonly inner: RenderPass;
  private readonly scratch = new THREE.Color();

  constructor(inner: RenderPass) {
    super();
    this.inner = inner;
    this.needsSwap = inner.needsSwap;
  }

  override setSize(width: number, height: number): void {
    this.inner.setSize(width, height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    // The composer sets renderToScreen on this wrapper, not on the inner pass.
    this.inner.renderToScreen = this.renderToScreen;
    if (this.inner.clear && !this.renderToScreen) {
      renderer.setRenderTarget(readBuffer);
      renderer.setClearColor(renderer.getClearColor(this.scratch), renderer.getClearAlpha());
    }
    this.inner.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
  }

  override dispose(): void {
    this.inner.dispose();
  }
}

/**
 * Runs `inner` with the objects of `hidden()` invisible (spec 09, passes 1 and 3) and, when
 * `backgroundOf` is a scene, without its background (M24).
 */
class HidingPass extends Pass {
  private readonly inner: Pass;
  private readonly hidden: () => readonly THREE.Object3D[];
  private readonly backgroundOf: THREE.Scene | null;

  constructor(
    inner: Pass,
    hidden: () => readonly THREE.Object3D[],
    backgroundOf: THREE.Scene | null,
  ) {
    super();
    this.inner = inner;
    this.hidden = hidden;
    this.backgroundOf = backgroundOf;
    this.needsSwap = inner.needsSwap;
  }

  override setSize(width: number, height: number): void {
    this.inner.setSize(width, height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    // The composer sets renderToScreen on this wrapper, not on the inner pass.
    this.inner.renderToScreen = this.renderToScreen;
    const run = (): void => {
      hideDuring(this.hidden(), () => {
        this.inner.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      });
    };
    if (this.backgroundOf === null) run();
    else withoutBackground(this.backgroundOf, run);
  }

  override dispose(): void {
    this.inner.dispose();
  }
}

/** What the AO pass needs in a frame: objects hidden in the G-buffer and the parameters. */
interface AoFrame {
  readonly hidden: readonly THREE.Object3D[];
  readonly params: AoParameters;
}

/**
 * GTAOPass computes the AO only (OUTPUT.Off, into its pdRenderTarget); this pass then multiplies it
 * into the colour of readBuffer in place, like the blend of GTAOPass (ADR 0026, point 2). Hides the
 * interaction and aoExcluded of the model in the G-buffer: GTAOPass hides only Points, Line and
 * Line2, a LineSegments2 is a Mesh and would draw as a mess of quads, and glass would darken what
 * is seen through it (M24).
 */
class AoPass extends Pass {
  private readonly gtao: GTAOPass;
  private readonly blendMaterial: THREE.ShaderMaterial;
  private readonly quad: FullScreenQuad;
  /** The uniforms of GTAOBlendShader, typed. */
  private readonly blendUniforms = {
    tDiffuse: new THREE.Uniform<THREE.Texture | null>(null),
    intensity: new THREE.Uniform(1),
  };
  /**
   * Last values given to updateGtaoMaterial that recompile the shader there (distanceFallOff
   * always sets needsUpdate, samples when it changes); they are passed only on a change.
   */
  private appliedDistanceFallOff: number | null = null;
  private appliedSamples: number | null = null;
  private readonly frame: () => AoFrame;
  private readonly scene: THREE.Scene;

  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    width: number,
    height: number,
    frame: () => AoFrame,
  ) {
    super();
    this.frame = frame;
    this.scene = scene;
    // In place: the result stays in readBuffer, together with the depth of the model.
    this.needsSwap = false;
    this.gtao = new GTAOPass(scene, camera, width, height);
    this.gtao.output = GTAOPass.OUTPUT.Off;
    this.blendMaterial = new THREE.ShaderMaterial({
      uniforms: this.blendUniforms,
      vertexShader: GTAOBlendShader.vertexShader,
      fragmentShader: GTAOBlendShader.fragmentShader,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      // result = source · destination: the AO darkens the colour already in the target.
      blending: THREE.CustomBlending,
      blendSrc: THREE.DstColorFactor,
      blendDst: THREE.ZeroFactor,
      blendEquation: THREE.AddEquation,
      blendSrcAlpha: THREE.DstAlphaFactor,
      blendDstAlpha: THREE.ZeroFactor,
      blendEquationAlpha: THREE.AddEquation,
    });
    this.quad = new FullScreenQuad(this.blendMaterial);
  }

  override setSize(width: number, height: number): void {
    this.gtao.setSize(width, height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    const { hidden, params } = this.frame();
    this.applyParameters(params);
    // The G-buffer without the background of Realistic (M24): three would draw it into the
    // normals and the depth like a screen-filling body.
    withoutBackground(this.scene, () => {
      hideDuring(hidden, () => {
        this.gtao.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
      });
    });

    this.blendUniforms.tDiffuse.value = this.gtao.pdRenderTarget.texture;
    this.blendUniforms.intensity.value = params.intensity;
    const autoClear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setRenderTarget(readBuffer);
    this.quad.render(renderer);
    renderer.autoClear = autoClear;
  }

  /** Radius and thickness follow the zoom every frame; the others only on a change. */
  private applyParameters(params: AoParameters): void {
    this.gtao.updateGtaoMaterial({
      radius: params.radius,
      thickness: params.thickness,
      scale: params.scale,
      ...(params.distanceFallOff === this.appliedDistanceFallOff
        ? {}
        : { distanceFallOff: params.distanceFallOff }),
      ...(params.samples === this.appliedSamples ? {} : { samples: params.samples }),
    });
    this.appliedDistanceFallOff = params.distanceFallOff;
    this.appliedSamples = params.samples;
  }

  override dispose(): void {
    this.gtao.dispose();
    // GTAOPass.dispose (three 0.186) leaves its own GTAO and blend materials behind.
    this.gtao.gtaoMaterial.dispose();
    this.gtao.blendMaterial.dispose();
    this.blendMaterial.dispose();
    this.quad.dispose();
  }
}
