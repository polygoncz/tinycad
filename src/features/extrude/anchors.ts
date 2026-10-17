import type { Anchor } from '@/interaction';

/**
 * The anchors of the extrude (M20, ADR 0021): 'base', the center of the regions in the sketch
 * plane and the sketch normal, only for 'blind' and 'symmetric'. The core computes them, the
 * manipulator reads them; flip is in the params, so the manipulator applies it itself. A type
 * alias, so it fits FeatureAnchors.
 */
export type ExtrudeAnchors = { readonly base?: Anchor };
