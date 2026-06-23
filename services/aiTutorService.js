/**
 * AI Tutor Service for Fusion High
 * Handles Groq API interactions, curriculum data, and assessment sessions.
 */

const fs = require('fs');
const pdf = require('pdf-parse');
const generalCurriculum = require('./curriculum/general');
const scienceCurriculum = require('./curriculum/science');
const commerceCurriculum = require('./curriculum/commerce');
const tourismCurriculum = require('./curriculum/tourism');

// In-memory storage of active AI assessment sessions.
// NOTE: This will be cleared on server restart. If you scale to multiple instances,
// replace this with a persistent store (DB/Redis) or embed grading keys in the client response.
const activeAssessments = new Map();


// Unified Curriculum: Merge all specialized streams
const aiCurriculum = {};
const curricula = [generalCurriculum, scienceCurriculum, commerceCurriculum, tourismCurriculum];

curricula.forEach(curric => {
  for (const subject in curric) {
    aiCurriculum[subject] = [...(aiCurriculum[subject] || []), ...curric[subject]];
  }
});

async function callAI(prompt, isJson = false, modelOverride = null) {
  try {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is missing");

    const modelName = modelOverride || process.env.GROQ_MODEL || "llama-3.3-70b-versatile";
    const url = 'https://api.groq.com/openai/v1/chat/completions';

    const systemInstruction = `
You are Fusion Tutor, an expert South African CAPS Curriculum teacher for Grades 8-12.
Rules:
- Explanations should be comprehensive, educational, and thorough. Do not limit the length if the topic requires detail.
- Explain concepts clearly using step-by-step logic.
- Use DIVERSE real-world examples (gaming, sports, social media).
- If JSON is requested for tutoring, you MUST use these keys: "explanation" (string), "examples" (string), and "formula" (LaTeX string or "none").
- If generating quiz questions, each question MUST be an object with: 
  "question" (string), "answer" (the short final result for comparison), and 
  "explanation" (a clear, step-by-step correction logic describing how to arrive at the answer). Do NOT include the answer inside the explanation string alone.
- Use LaTeX for formulas where needed.
`;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: systemInstruction },
          { role: "user", content: prompt }
        ],
        response_format: isJson ? { type: "json_object" } : undefined,
        temperature: 0.7,
        max_tokens: 1500
      })
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("[AI HTTP ERROR]", response.status, data);
      throw new Error(data?.error?.message || "AI Service Error");
    }

    if (!data.choices || data.choices.length === 0) {
      throw new Error("AI Error: No response generated from Groq.");
    }
    
    let content = data.choices[0]?.message?.content || "";

    if (isJson) {
      try {
        // Clean potential markdown and trim
        let cleanContent = content.replace(/```json/gi, '').replace(/```/g, '').trim();
        
        // Robust escape handling for LaTeX in JSON strings
        // If JSON.parse fails, we attempt to fix unescaped backslashes commonly found in LaTeX
        try {
            return JSON.parse(cleanContent);
        } catch (firstPassErr) {
            console.warn("[AI JSON] Initial parse failed, attempting LaTeX sanitization...");
            // Replace single backslashes that are not followed by valid escape chars with double backslashes
            const sanitized = cleanContent.replace(/\\(?![bfnrtu"\\\/])/g, "\\\\");
            return JSON.parse(sanitized);
        }
      } catch (parseErr) {
        console.warn("[JSON PARSE ERROR] Failed to parse content:", parseErr.message);
        try {
          let repaired = content.trim();
          if ((repaired.match(/"/g) || []).length % 2 !== 0) repaired += '"';
          if (repaired.startsWith('{') && !repaired.endsWith('}')) repaired += '}';
          if (repaired.startsWith('[') && !repaired.endsWith(']')) repaired += ']';
          return JSON.parse(repaired);
        } catch (innerErr) {
          return { error: "JSON Structure Error", raw: content };
        }
      }
    }
    return { text: content };
  } catch (error) {
    console.error("[AI ERROR]", error.message);
    throw error;
  }
}

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

async function safeAICall(prompt, isJson = false, retries = 2) {
  const fallbackModel = "llama-3.1-8b-instant";
  let currentModel = null;

  for (let i = 0; i <= retries; i++) {
    try {
      const result = await callAI(prompt, isJson, currentModel);
      if (!result.error) return result;
    } catch (err) {
      console.warn(`[RETRY] Attempt ${i + 1} error: ${err.message}`);
      // If we hit a rate limit, switch to the smaller, high-limit model immediately
      if (err.message.includes('Rate limit') || err.message.includes('429')) {
        console.info(`[AI FALLBACK] Rate limit hit. Switching to ${fallbackModel}`);
        currentModel = fallbackModel;
      }
    }
    if (i < retries) {
      const waitTime = (i + 1) * 5000;
      await sleep(waitTime);
    }
  }
  return { error: "AI failed after retries" };
}

/**
 * Simple text-based completion to replace the old aiService
 */
async function getTextCompletion(prompt) {
    const result = await safeAICall(prompt, false);
    if (result.error) throw new Error(result.error);
    return result.text;
}

/**
 * Normalizes subject names to match CAPS curriculum standards
 */
function normalizeSubject(subject) {
    const subLower = (subject || "").toLowerCase().trim();
    if (subLower === 'maths' || subLower === 'mathematics') return 'Mathematics';
    if (subLower === 'physics' || subLower === 'physical sciences') return 'Physical Sciences';
    // Add other normalizations here if needed
    return subject;
}

/**
 * Shared helper to extract content from textbook PDFs
 */
async function getTextbookContent(filePath, maxLength = 10000, topicSearch = null) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const dataBuffer = fs.readFileSync(filePath);
    const pdfData = await pdf(dataBuffer);
    const fullText = pdfData.text || "";

    if (topicSearch) {
        const topicIndex = fullText.toLowerCase().indexOf(topicSearch.toLowerCase());
        if (topicIndex !== -1) {
            const start = Math.max(0, topicIndex - 500);
            return fullText.substring(start, Math.min(fullText.length, start + maxLength));
        }
    }
    return fullText.substring(0, maxLength);
}

/**
 * Shared helper to parse AI JSON responses robustly
 */
function parseAIJSON(response) {
    const rawData = typeof response === 'string' ? JSON.parse(response) : response;
    if (Array.isArray(rawData)) return rawData;
    return rawData.topics || rawData.chapters || rawData.lessons || rawData.questions || rawData.tasks || [];
}

module.exports = {
  aiCurriculum,
  activeAssessments,
  safeAICall,
  getTextCompletion,
  normalizeSubject,
  getTextbookContent,
  parseAIJSON
};
