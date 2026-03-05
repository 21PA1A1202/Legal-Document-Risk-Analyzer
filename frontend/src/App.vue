<template>
  <main class="page">
    <section class="hero">
      <p class="eyebrow">DRA</p>
      <h1>Multilingual Legal Document Risk Analyzer</h1>
      <p class="subtitle">
        Paste your contract, policy, or terms document and receive a structured
        legal risk summary with actionable clause-level guidance.
      </p>
    </section>

    <section class="panel">
      <div class="form-grid">
        <label>
          Output language
          <select v-model="outputLanguage">
            <option v-for="language in languages" :key="language.code" :value="language.code">
              {{ language.name }}
            </option>
          </select>
        </label>

        <label>
          Document type
          <select v-model="documentType">
            <option value="commercial_contract">Commercial Contract</option>
            <option value="nda">NDA</option>
            <option value="employment">Employment Agreement</option>
            <option value="lease">Lease Agreement</option>
            <option value="privacy_policy">Privacy Policy</option>
            <option value="terms_of_service">Terms of Service</option>
            <option value="other">Other</option>
          </select>
        </label>

        <label>
          Jurisdiction (optional)
          <input
            v-model="jurisdiction"
            type="text"
            placeholder="e.g. California, USA"
          />
        </label>
      </div>

      <label class="doc-label">
        Upload document (txt/pdf/docx)
        <input
          type="file"
          accept=".txt,.pdf,.docx"
          @change="onFileChange"
        />
      </label>

      <p v-if="selectedFile" class="upload-meta">
        Selected file: <strong>{{ selectedFile.name }}</strong>
      </p>

      <label class="doc-label">
        Document text
        <textarea
          v-model="documentText"
          rows="16"
          placeholder="Paste legal document text here..."
        />
      </label>

      <div class="actions">
        <button class="secondary" @click="loadSample">Load sample</button>
        <button :disabled="loading" class="primary" @click="analyzeDocument">
          {{ loading ? "Analyzing..." : "Analyze Legal Risk" }}
        </button>
      </div>

      <p v-if="error" class="error">{{ error }}</p>
      <p v-if="extractionNote" class="upload-meta">{{ extractionNote }}</p>
    </section>

    <section v-if="analysis" class="results">
      <article class="summary-card">
        <h2>Risk Summary</h2>
        <p>{{ analysis.summary }}</p>
        <div class="score-wrap">
          <div>
            <p class="meta-label">Overall risk score</p>
            <p class="score">{{ analysis.overallRiskScore }}/100</p>
          </div>
          <span class="risk-badge" :class="analysis.riskBand">{{ analysis.riskBand }}</span>
        </div>
      </article>

      <article class="risk-card">
        <h3>Key Risks</h3>
        <ul v-if="analysis.keyRisks.length > 0">
          <li v-for="(risk, idx) in analysis.keyRisks" :key="idx">
            <div class="risk-head">
              <strong>{{ risk.title }}</strong>
              <span class="severity" :class="risk.severity">{{ risk.severity }}</span>
            </div>
            <p class="snippet">{{ risk.clauseSnippet }}</p>
            <p><strong>Why it matters:</strong> {{ risk.whyItMatters }}</p>
            <p><strong>Recommendation:</strong> {{ risk.recommendation }}</p>
          </li>
        </ul>
        <p v-else>No major risky wording detected in the submitted text.</p>
      </article>

      <article class="risk-card">
        <h3>Likely Missing Clauses</h3>
        <ul>
          <li v-for="(clause, idx) in analysis.missingClauses" :key="idx">{{ clause }}</li>
        </ul>
      </article>

      <article class="risk-card">
        <h3>Recommended Next Actions</h3>
        <ol>
          <li v-for="(action, idx) in analysis.nextActions" :key="idx">{{ action }}</li>
        </ol>
      </article>

      <p class="disclaimer">{{ analysis.disclaimer }}</p>
    </section>
  </main>
</template>

<script setup lang="ts">
import { ref } from "vue";

type Language = { code: string; name: string };
type Severity = "critical" | "high" | "medium" | "low";
type RiskBand = "critical" | "high" | "moderate" | "low";

type Analysis = {
  outputLanguage: string;
  summary: string;
  overallRiskScore: number;
  riskBand: RiskBand;
  keyRisks: Array<{
    title: string;
    severity: Severity;
    clauseSnippet: string;
    whyItMatters: string;
    recommendation: string;
  }>;
  missingClauses: string[];
  nextActions: string[];
  disclaimer: string;
  sourceFileName?: string;
  extractedCharacters?: number;
  extractedTextPreview?: string;
};

const languages = ref<Language[]>([
  { code: "en", name: "English" },
  { code: "es", name: "Espanol" },
  { code: "fr", name: "Francais" },
  { code: "de", name: "Deutsch" },
  { code: "hi", name: "Hindi" },
  { code: "ar", name: "Arabic" }
]);

const outputLanguage = ref("en");
const documentType = ref("commercial_contract");
const jurisdiction = ref("");
const documentText = ref("");
const analysis = ref<Analysis | null>(null);
const error = ref("");
const loading = ref(false);
const selectedFile = ref<File | null>(null);
const extractionNote = ref("");

const loadSample = () => {
  documentText.value = `This Agreement renews automatically for additional one-year terms unless terminated in writing 30 days before expiration. Vendor shall indemnify and hold harmless Client from all third-party claims, losses, damages, and legal fees. Client may terminate immediately for breach. Governing law shall be the State of New York and disputes must be resolved by binding arbitration.`;
};

const analyzeDocument = async () => {
  error.value = "";
  analysis.value = null;
  extractionNote.value = "";

  if (selectedFile.value) {
    await analyzeUploadedDocument();
    return;
  }

  if (documentText.value.trim().length < 80) {
    error.value = "Please provide at least 80 characters of legal document text.";
    return;
  }

  try {
    loading.value = true;
    const response = await fetch("http://localhost:4000/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        documentText: documentText.value,
        outputLanguage: outputLanguage.value,
        documentType: documentType.value,
        jurisdiction: jurisdiction.value || undefined
      })
    });

    const data = await response.json();
    if (!response.ok) {
      error.value = data?.error ?? "Unable to analyze document.";
      return;
    }

    analysis.value = data;
  } catch (caughtError) {
    error.value = (caughtError as Error).message;
  } finally {
    loading.value = false;
  }
};

const onFileChange = (event: Event) => {
  const input = event.target as HTMLInputElement;
  selectedFile.value = input.files?.[0] ?? null;
};

const fileToBase64 = async (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result ?? "");
      const base64 = dataUrl.includes(",") ? (dataUrl.split(",")[1] ?? "") : dataUrl;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });

const analyzeUploadedDocument = async () => {
  if (!selectedFile.value) return;

  try {
    loading.value = true;
    const base64 = await fileToBase64(selectedFile.value);
    const response = await fetch("http://localhost:4000/api/analyze-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fileName: selectedFile.value.name,
        fileContentBase64: base64,
        outputLanguage: outputLanguage.value,
        documentType: documentType.value,
        jurisdiction: jurisdiction.value || undefined
      })
    });

    const data = await response.json();
    if (!response.ok) {
      error.value = data?.error ?? "Unable to analyze uploaded document.";
      return;
    }

    analysis.value = data;
    extractionNote.value = `Extracted ${data.extractedCharacters ?? 0} characters from ${data.sourceFileName ?? selectedFile.value.name}.`;
    if (data.extractedTextPreview) {
      documentText.value = data.extractedTextPreview;
    }
  } catch (caughtError) {
    error.value = (caughtError as Error).message;
  } finally {
    loading.value = false;
  }
};
</script>
