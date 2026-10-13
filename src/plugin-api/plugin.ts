import type { FeatureSchema } from '@/document';
import type { ToolDescriptor } from '@/interaction';
import type { FeatureBuilder } from '@/regen';

/**
 * Unit of extensibility (spec 11): each layer has its own registry and knows only its part.
 * Fields grow with milestones: M6 has schema and builder, M9 adds tools, M12 adds ops.
 */
export interface FeaturePlugin<P = unknown> {
  /** Goes to FeatureSchemaRegistry (document). */
  readonly schema: FeatureSchema<P>;
  /** Goes to BuilderRegistry (regen). */
  readonly builder: FeatureBuilder<P>;
  /** Goes to ToolRegistry (interaction). */
  readonly tools?: readonly ToolDescriptor[];
}
