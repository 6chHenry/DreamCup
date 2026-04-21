import { z } from "zod";

const nullableString = z.string().nullable().optional().transform(v => v ?? undefined);
const nullableNumber = z.number().nullable().optional().transform(v => v ?? undefined);
const nullableBoolean = z.boolean().nullable().optional().transform(v => v ?? undefined);

export const SceneSchema = z.object({
  id: z.string(),
  description: z.string(),
  lighting: nullableString,
  weather: nullableString,
  colorTone: nullableString,
  spatialLayout: nullableString,
});

export const CharacterSchema = z.object({
  id: z.string(),
  identity: z.string(),
  name: nullableString,
  appearance: nullableString,
  relationship: nullableString,
});

export const NarrativeEventSchema = z.object({
  description: z.string(),
  cause: nullableString,
  isTurningPoint: nullableBoolean,
});

export const NarrativeSchema = z.object({
  events: z.array(NarrativeEventSchema),
  summary: z.string(),
});

export const EmotionSchema = z.object({
  timestamp: nullableString,
  type: z.string(),
  intensity: z.number().min(0).max(10),
  trigger: nullableString,
});

export const SensorySchema = z.object({
  auditory: nullableString,
  tactile: nullableString,
  olfactory: nullableString,
  temperature: nullableString,
  kinesthetic: nullableString,
});

export const AnomalySchema = z.object({
  description: z.string(),
  type: z.enum(["physics_violation", "spatial_jump", "time_distortion", "identity_shift", "other"]),
});

export const DreamMetaSchema = z.object({
  isLucidDream: nullableBoolean,
  isDreamWithinDream: nullableBoolean,
  isRecurringDream: nullableBoolean,
  recurrenceCount: nullableNumber,
  dreamDate: nullableString,
  dreamTime: nullableString,
});

export const LowConfidenceItemSchema = z.object({
  field: z.string(),
  value: z.string(),
  reason: z.string(),
});

export const DreamStructuredSchema = z.object({
  scenes: z.array(SceneSchema),
  characters: z.array(CharacterSchema),
  narrative: NarrativeSchema,
  emotions: z.array(EmotionSchema),
  sensory: SensorySchema,
  anomalies: z.array(AnomalySchema),
  meta: DreamMetaSchema,
  lowConfidence: z.array(LowConfidenceItemSchema),
});

export const DreamSceneImageSchema = z.object({
  id: z.string(),
  sceneIndex: z.number(),
  imageUrl: z.string(),
  promptUsed: z.string(),
  isSelected: z.boolean(),
});

export const DreamSchema = z.object({
  id: z.string(),
  title: z.string(),
  rawText: z.string(),
  structured: DreamStructuredSchema,
  audioUrl: z.string().optional(),
  scenes: z.array(DreamSceneImageSchema),
  createdAt: z.string(),
  updatedAt: z.string(),
});
