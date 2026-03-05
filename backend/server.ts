import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { z } from "zod";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: "20mb" }));

const supportedLanguages = [
  { code: "en", name: "English" },
  { code: "es", name: "Espanol" },
  { code: "fr", name: "Francais" },
  { code: "de", name: "Deutsch" },
  { code: "hi", name: "Hindi" },
  { code: "ar", name: "Arabic" }
] as const;

const languageCodes = supportedLanguages.map((language) => language.code);
const LanguageCodeSchema = z.enum(languageCodes as [string, ...string[]]);

const severitySchema = z.enum(["critical", "high", "medium", "low"]);
const riskBandSchema = z.enum(["critical", "high", "moderate", "low"]);

const analyzeRequestSchema = z.object({
  documentText: z
    .string()
    .min(80, "Document text must be at least 80 characters."),
  outputLanguage: LanguageCodeSchema.default("en"),
  documentType: z
    .enum([
      "commercial_contract",
      "nda",
      "employment",
      "lease",
      "privacy_policy",
      "terms_of_service",
      "other"
    ])
    .default("other"),
  jurisdiction: z.string().max(100).optional()
});

const analyzeUploadRequestSchema = z.object({
  fileName: z.string().min(1),
  fileContentBase64: z.string().min(10),
  outputLanguage: LanguageCodeSchema.default("en"),
  documentType: z
    .enum([
      "commercial_contract",
      "nda",
      "employment",
      "lease",
      "privacy_policy",
      "terms_of_service",
      "other"
    ])
    .default("other"),
  jurisdiction: z.string().max(100).optional()
});

const analysisResponseSchema = z.object({
  outputLanguage: LanguageCodeSchema,
  summary: z.string(),
  overallRiskScore: z.number().int().min(0).max(100),
  riskBand: riskBandSchema,
  keyRisks: z
    .array(
      z.object({
        title: z.string(),
        severity: severitySchema,
        clauseSnippet: z.string(),
        whyItMatters: z.string(),
        recommendation: z.string()
      })
    )
    .max(12),
  missingClauses: z.array(z.string()).max(10),
  nextActions: z.array(z.string()).max(10),
  disclaimer: z.string()
});

const textByLanguage: Record<
  string,
  {
    summaryPrefix: string;
    disclaimer: string;
    likelyMissing: string;
    fallbackAction: string;
    recommendationPrefix: string;
  }
> = {
  en: {
    summaryPrefix: "Automated legal risk summary:",
    disclaimer:
      "This is an AI-generated legal risk review and not legal advice. Consult a qualified lawyer before acting.",
    likelyMissing: "Likely missing clause",
    fallbackAction: "Run lawyer review on high-risk clauses before signing.",
    recommendationPrefix: "Suggested revision"
  },
  es: {
    summaryPrefix: "Resumen automatizado de riesgo legal:",
    disclaimer:
      "Esta revision fue generada por IA y no constituye asesoramiento legal. Consulte con un abogado calificado antes de actuar.",
    likelyMissing: "Clausula posiblemente ausente",
    fallbackAction:
      "Solicite revision legal de las clausulas de alto riesgo antes de firmar.",
    recommendationPrefix: "Revision sugerida"
  },
  fr: {
    summaryPrefix: "Resume automatise du risque juridique :",
    disclaimer:
      "Cette analyse est generee par IA et ne constitue pas un conseil juridique. Consultez un avocat qualifie avant toute decision.",
    likelyMissing: "Clause probablement manquante",
    fallbackAction:
      "Faites verifier les clauses a risque eleve par un avocat avant signature.",
    recommendationPrefix: "Revision suggeree"
  },
  de: {
    summaryPrefix: "Automatisierte rechtliche Risikoanalyse:",
    disclaimer:
      "Diese KI-Analyse ist keine Rechtsberatung. Lassen Sie die Ergebnisse vor einer Entscheidung juristisch pruefen.",
    likelyMissing: "Wahrscheinlich fehlende Klausel",
    fallbackAction:
      "Lassen Sie hochriskante Klauseln vor Unterzeichnung rechtlich pruefen.",
    recommendationPrefix: "Empfohlene Anpassung"
  },
  hi: {
    summaryPrefix: "Swayanchalit kanuni risk summary:",
    disclaimer:
      "Yeh AI dwara bana hua kanuni risk review hai, legal advice nahin. Koi kadam lene se pehle lawyer se salah lein.",
    likelyMissing: "Sambhavit roop se gaayab clause",
    fallbackAction:
      "Sign karne se pehle high-risk clauses ka lawyer review karwayen.",
    recommendationPrefix: "Sujhavita sanshodhan"
  },
  ar: {
    summaryPrefix: "Mulakhas mukhatar qanuniya alii:",
    disclaimer:
      "hadha altaqyeem tam intajuh bwasitat aldhaka alais tinaei walaysa nashihat qanuniya. astashir muhamian qabl aitikhadh ay qrar.",
    likelyMissing: "band muhtamal ghyabuh",
    fallbackAction:
      "aqm bimurajaeat albunudh dhat almukhatar alealiya mae muhamiin qabl altawqie.",
    recommendationPrefix: "tadil muqtarah"
  }
};

function extractJSON(text: string): string {
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first < 0 || last < 0 || last <= first) {
    throw new Error("Model response did not contain JSON.");
  }
  return cleaned.slice(first, last + 1);
}

function normalizeSnippet(snippet: string): string {
  const trimmed = snippet.replace(/\s+/g, " ").trim();
  return trimmed.length > 180 ? `${trimmed.slice(0, 177)}...` : trimmed;
}

function heuristicRiskAnalysis(payload: z.infer<typeof analyzeRequestSchema>) {
  const localized = textByLanguage[payload.outputLanguage] ?? textByLanguage.en;
  const text = payload.documentText;
  const lowered = text.toLowerCase();

  const riskRules = [
    {
      matcher: /\b(unlimited liability|strict liability)\b/,
      title: "Unlimited liability exposure",
      severity: "critical" as const,
      why: "Uncapped liability can create disproportionate financial exposure."
    },
    {
      matcher: /\b(indemnif(y|ication)|hold harmless)\b/,
      title: "Broad indemnity obligations",
      severity: "high" as const,
      why: "One-sided indemnity wording can shift major legal costs to you."
    },
    {
      matcher: /\b(auto(?:matic)? renewal|renews automatically|evergreen)\b/,
      title: "Automatic renewal commitment",
      severity: "medium" as const,
      why: "Auto-renewal can lock parties into unwanted future terms."
    },
    {
      matcher: /\b(immediate termination|terminate without notice)\b/,
      title: "Unbalanced termination terms",
      severity: "high" as const,
      why: "Termination rights without notice can cause abrupt operational risk."
    },
    {
      matcher: /\b(governing law|jurisdiction|exclusive venue)\b/,
      title: "Jurisdiction and venue risk",
      severity: "medium" as const,
      why: "Cross-border jurisdiction terms may increase litigation cost and complexity."
    },
    {
      matcher: /\b(arbitration|waiver of jury)\b/,
      title: "Dispute resolution constraints",
      severity: "medium" as const,
      why: "Mandatory arbitration and waivers can limit dispute remedies."
    }
  ];

  const keyRisks = riskRules
    .filter((rule) => rule.matcher.test(lowered))
    .slice(0, 6)
    .map((rule) => ({
      title: rule.title,
      severity: rule.severity,
      clauseSnippet: normalizeSnippet(text.match(rule.matcher)?.[0] ?? rule.title),
      whyItMatters: rule.why,
      recommendation: `${localized.recommendationPrefix}: ${rule.title} should be narrowed and negotiated with balanced wording.`
    }));

  const missingChecks = [
    {
      clause: "Limitation of liability",
      matcher: /\b(limit(?:ation)? of liability|liability cap)\b/
    },
    { clause: "Data protection obligations", matcher: /\b(data protection|gdpr|privacy)\b/ },
    { clause: "Confidentiality protections", matcher: /\b(confidential|non-disclosure|nda)\b/ },
    { clause: "Termination notice period", matcher: /\b(termination notice|notice period)\b/ },
    { clause: "Force majeure", matcher: /\b(force majeure|act of god)\b/ }
  ];

  const missingClauses = missingChecks
    .filter((item) => !item.matcher.test(lowered))
    .slice(0, 5)
    .map((item) => `${localized.likelyMissing}: ${item.clause}`);

  const weightedScore =
    keyRisks.reduce((score, risk) => {
      if (risk.severity === "critical") return score + 26;
      if (risk.severity === "high") return score + 18;
      if (risk.severity === "medium") return score + 10;
      return score + 5;
    }, 15) + missingClauses.length * 6;

  const overallRiskScore = Math.max(8, Math.min(95, weightedScore));
  const riskBand =
    overallRiskScore >= 75
      ? "critical"
      : overallRiskScore >= 55
        ? "high"
        : overallRiskScore >= 30
          ? "moderate"
          : "low";

  return {
    outputLanguage: payload.outputLanguage,
    summary: `${localized.summaryPrefix} ${keyRisks.length} notable risk patterns and ${missingClauses.length} likely clause gaps were identified in this ${payload.documentType} draft.`,
    overallRiskScore,
    riskBand,
    keyRisks,
    missingClauses,
    nextActions: [
      localized.fallbackAction,
      "Confirm governing law, liability caps, and indemnity obligations in a redline version.",
      "Map each high-impact clause to business owners before final approval."
    ],
    disclaimer: localized.disclaimer
  };
}

async function extractTextViaExtractor(fileName: string, fileContentBase64: string) {
  const extractorUrl = process.env.EXTRACTOR_URL ?? "http://localhost:8001";
  const normalizedBase64 = fileContentBase64.replace(/^data:.*?;base64,/, "");
  const fileBuffer = Buffer.from(normalizedBase64, "base64");

  if (!fileBuffer.length) {
    throw new Error("Uploaded file content is empty.");
  }

  const form = new FormData();
  form.append("file", new Blob([fileBuffer]), fileName);

  const response = await fetch(`${extractorUrl}/extract`, {
    method: "POST",
    body: form
  });

  const payload = (await response.json()) as { text?: string; detail?: string };
  if (!response.ok) {
    throw new Error(payload.detail ?? "Extractor service failed.");
  }
  if (!payload.text || payload.text.trim().length < 1) {
    throw new Error("Extractor did not return readable text.");
  }
  return payload.text.trim();
}

async function modelRiskAnalysis(payload: z.infer<typeof analyzeRequestSchema>) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === "your_key_here") {
    return null;
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `
You are a legal document risk analyst.
All instructions in this system prompt are in English only.
Task:
1. Analyze legal risk in the provided document.
2. Return STRICT JSON only (no markdown, no prose).
3. Write all user-facing text in language code "${payload.outputLanguage}".
4. Keep recommendations concrete and practical.
5. The document can be in any language. Understand it and respond in "${payload.outputLanguage}".

Required JSON format:
{
  "outputLanguage": "${payload.outputLanguage}",
  "summary": "string",
  "overallRiskScore": 0,
  "riskBand": "critical|high|moderate|low",
  "keyRisks": [
    {
      "title": "string",
      "severity": "critical|high|medium|low",
      "clauseSnippet": "string",
      "whyItMatters": "string",
      "recommendation": "string"
    }
  ],
  "missingClauses": ["string"],
  "nextActions": ["string"],
  "disclaimer": "string"
}

Document type: ${payload.documentType}
Jurisdiction preference: ${payload.jurisdiction ?? "not specified"}

Document:
${payload.documentText}
`;

  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const parsed = JSON.parse(extractJSON(text));
  const validated = analysisResponseSchema.parse(parsed);
  return validated;
}

async function runAnalysis(payload: z.infer<typeof analyzeRequestSchema>) {
  const aiResult = await modelRiskAnalysis(payload).catch(() => null);
  return aiResult ?? heuristicRiskAnalysis(payload);
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "dra-legal-risk-analyzer" });
});

app.get("/api/languages", (_req, res) => {
  res.json({ languages: supportedLanguages });
});

app.post("/api/analyze", async (req, res) => {
  try {
    const payload = analyzeRequestSchema.parse(req.body);
    const result = await runAnalysis(payload);
    res.json(result);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Invalid request body",
        details: error.flatten()
      });
    }
    return res.status(500).json({
      error: "Failed to analyze document.",
      details: (error as Error).message
    });
  }
});

app.post("/api/analyze-upload", async (req, res) => {
  try {
    const uploadPayload = analyzeUploadRequestSchema.parse(req.body);
    const extractedText = await extractTextViaExtractor(
      uploadPayload.fileName,
      uploadPayload.fileContentBase64
    );

    const payload = analyzeRequestSchema.parse({
      documentText: extractedText,
      outputLanguage: uploadPayload.outputLanguage,
      documentType: uploadPayload.documentType,
      jurisdiction: uploadPayload.jurisdiction
    });

    const result = await runAnalysis(payload);
    return res.json({
      ...result,
      sourceFileName: uploadPayload.fileName,
      extractedCharacters: extractedText.length,
      extractedTextPreview: extractedText.slice(0, 500)
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({
        error: "Invalid upload request body",
        details: error.flatten()
      });
    }
    return res.status(500).json({
      error: "Failed to extract/analyze uploaded document.",
      details: (error as Error).message
    });
  }
});

app.listen(process.env.PORT || 4000, () => {
  console.log("DRA backend running on http://localhost:4000");
});
