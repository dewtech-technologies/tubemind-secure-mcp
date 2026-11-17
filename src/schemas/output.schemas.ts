/**
 * Schemas de validação para outputs LLM (RS-3.3, RS-4.3, RS-2.5).
 *
 * Defense-in-depth: mesmo após sanitização de input, validamos a SAÍDA do LLM
 * para detectar:
 * 1. Vazamento de instruções do prompt do sistema (markers de prompt injection bem-sucedida)
 * 2. Tentativa de role manipulation (`assistant:`, `system:` aparecendo no texto)
 * 3. Estrutura fora do schema esperado (LLM "halucinou" formato)
 */

import { z } from 'zod'

// ─── Detector de leakage genérico ─────────────────────────────────────────────

/**
 * Lista de markers que indicam que o LLM pode ter sido manipulado para vazar
 * partes do prompt do sistema OU adotar persona não-intencional.
 */
const LEAKAGE_MARKERS = [
  /\b(system|assistant|user)\s*:/i,
  /<\/?(system|comment|niche|topic|audience)\b/i,
  /\[INST\]|\[\/INST\]/i, // Llama-style instruction markers
  /<\|im_(start|end)\|>/i, // ChatML markers
  /ignore (all |the )?(previous|above) (instructions|prompts)/i,
]

export function hasLeakageMarkers(text: string): boolean {
  return LEAKAGE_MARKERS.some((re) => re.test(text))
}

// ─── Schemas das tools ───────────────────────────────────────────────────────

/**
 * Vision Thumbnail — output esperado de `analyze_thumbnail_visuals`
 */
export const VisionThumbnailItemSchema = z.object({
  dominant_colors: z
    .array(
      z.object({
        hsl: z.string(),
        coverage_pct: z.number().min(0).max(100),
      }),
    )
    .max(5),
  face_analysis: z.object({
    present: z.boolean(),
    count: z.number().int().min(0).max(20),
    dominant_expression: z.enum(['sorriso', 'choque', 'raiva', 'neutro', 'multipla']).optional(),
  }),
  text_overlay: z.object({
    present: z.boolean(),
    word_count: z.number().int().min(0).max(50),
    content_preview: z.string().max(100).optional(),
    size_pct: z.number().min(0).max(100),
  }),
  mobile_readability_score: z.number().min(0).max(100),
  dominant_pattern: z.enum([
    'face-grande',
    'texto-grande',
    'mockup-produto',
    'lifestyle',
    'before-after',
    'grafico-chart',
    'outro',
  ]),
  clickability_score: z.number().min(0).max(100),
  clickability_justification: z.string().max(300),
})

export const VisionThumbnailOutputSchema = z
  .object({
    thumbnails: z.array(VisionThumbnailItemSchema).min(1).max(20),
  })
  .refine((data) => !hasLeakageMarkers(JSON.stringify(data)), {
    message: 'Output contém markers de instrução vazada (prompt injection)',
  })

/**
 * NLP Comments — output esperado de `analyze_video_comments`
 */
export const NLPCommentsOutputSchema = z
  .object({
    sentiment: z.object({
      positive_pct: z.number().min(0).max(100),
      negative_pct: z.number().min(0).max(100),
      neutral_pct: z.number().min(0).max(100),
      confidence: z.enum(['baixa', 'media', 'alta']),
    }),
    pains: z
      .array(
        z.object({
          text: z.string().max(200),
          frequency: z.number().int().min(1),
        }),
      )
      .max(10),
    questions: z.array(z.string().max(200)).max(10),
    theme_requests: z
      .array(
        z.object({
          theme: z.string().max(150),
          mentions: z.number().int().min(1),
        }),
      )
      .max(10),
    next_video_ideas: z
      .array(
        z.object({
          title: z.string().max(120),
          justification: z.string().max(300),
        }),
      )
      .length(5),
    anchor_comments: z
      .array(
        z.object({
          author: z.string().max(100),
          excerpt: z.string().max(300),
          likes: z.number().int().min(0),
          replies: z.number().int().min(0),
        }),
      )
      .max(5),
  })
  .refine((data) => !hasLeakageMarkers(JSON.stringify(data)), {
    message: 'Output NLP contém markers de instrução vazada',
  })

/**
 * NLP Transcript — output esperado de `analyze_video_transcript`
 */
export const NLPTranscriptOutputSchema = z
  .object({
    hook: z.object({
      timestamp_end: z.string(),
      type: z.enum(['problema', 'pergunta', 'estatistica', 'historia', 'controversia', 'outro']),
      summary: z.string().max(300),
    }),
    intro: z.object({
      timestamp_end: z.string(),
      promise: z.string().max(400),
    }),
    sections: z
      .array(
        z.object({
          timestamp: z.string(),
          title: z.string().max(200),
          summary: z.string().max(500),
        }),
      )
      .min(1)
      .max(10),
    ctas: z
      .array(
        z.object({
          timestamp: z.string(),
          type: z.enum(['inscricao', 'like', 'comentario', 'link', 'proximo_video']),
          context: z.string().max(300),
        }),
      )
      .max(15),
    retention_techniques: z.array(z.string()).max(10),
    spoken_keywords: z.array(z.string()).max(30),
    words_per_minute_avg: z.number().min(0).max(500),
  })
  .refine((data) => !hasLeakageMarkers(JSON.stringify(data)), {
    message: 'Output Transcript contém markers de leakage',
  })

/**
 * Description optimizer output
 */
export const DescriptionOutputSchema = z
  .object({
    description: z.string().min(50).max(2000),
    first_sentence_has_main_keyword: z.boolean(),
    chapters: z
      .array(
        z.object({
          time: z.string().regex(/^\d{1,2}:\d{2}$/),
          title: z.string().max(200),
        }),
      )
      .max(30)
      .optional(),
    hashtags: z.array(z.string()).min(3).max(5),
    utm_template: z.string().max(300).optional(),
  })
  .refine((data) => !hasLeakageMarkers(JSON.stringify(data)), {
    message: 'Output Description contém markers de leakage',
  })

/**
 * Pipeline Script — output esperado de `generate_full_script`
 */
export const ScriptOutputSchema = z
  .object({
    hooks: z
      .array(
        z.object({
          type: z.string().max(50),
          text: z.string().max(500),
          recommended: z.boolean(),
        }),
      )
      .length(3),
    intro: z.string().min(50).max(800),
    sections: z
      .array(
        z.object({
          timestamp: z.string().regex(/^\d{1,2}:\d{2}$/),
          title: z.string().max(120),
          points: z.array(z.string()).min(1),
          b_roll_suggestion: z.string().max(300).optional(),
        }),
      )
      .min(3)
      .max(5),
    cta_1: z.object({
      timestamp: z.string().regex(/^\d{1,2}:\d{2}$/),
      text: z.string().max(300),
    }),
    cta_2: z.object({
      timestamp: z.string().regex(/^\d{1,2}:\d{2}$/),
      text: z.string().max(300),
    }),
    closing: z.string().max(800),
    next_video_suggestion: z.string().max(200),
  })
  .refine((data) => !hasLeakageMarkers(JSON.stringify(data)), {
    message: 'Output Script contém markers de instrução vazada',
  })
