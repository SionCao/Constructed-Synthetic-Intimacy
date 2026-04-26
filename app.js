import "dotenv/config";
import OpenAI from "openai";
import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import { fileURLToPath } from "url";

// ===== 基础路径 =====
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===== 服务器 =====
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const port = process.env.PORT || 3000;

// ===== OpenAI 初始化 =====
const apiKey = process.env.OPENAI_API_KEY || "";

console.log("========== OPENAI DEBUG ==========");
console.log("API key exists:", !!apiKey);
console.log("API key prefix:", apiKey ? apiKey.slice(0, 12) : "NO KEY");
console.log("=================================");

const openai = new OpenAI({
  apiKey: apiKey
});

// ===== 静态文件 =====
app.use(express.static(path.join(__dirname, "public")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// ===== 启动 =====
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});

// ===== Socket =====
io.on("connection", (socket) => {
  console.log("🟢 user connected");

  socket.on("generate-portrait", async (payload) => {
    console.log("📨 received questionnaire");

    const answers = payload?.answers || {};
    const normalized = normalizeAnswers(answers);

    try {
      // ===== 没 key → fallback =====
      if (!apiKey) {
        console.log("⚠️ No API key → fallback");
        socket.emit("portrait-result", buildFallbackPortrait(normalized));
        return;
      }

      const prompt = buildPrompt(normalized);

      console.log("🚀 TRYING OPENAI REQUEST");

      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "Return ONLY JSON. No explanation."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      });

      console.log("✅ OPENAI RESPONSE OK");

      let parsed;
      try {
        parsed = JSON.parse(response.choices[0].message.content);
      } catch (err) {
        console.error("❌ JSON parse failed → fallback");
        socket.emit("portrait-result", buildFallbackPortrait(normalized));
        return;
      }

      socket.emit("portrait-result", sanitize(parsed, normalized));

    } catch (err) {
      console.error("❌ OPENAI FAILED");
      console.error("message:", err?.message);
      console.error("status:", err?.status);
      console.error("code:", err?.code);
      console.error("type:", err?.type);

      socket.emit("portrait-result", buildFallbackPortrait(normalized));
    }
  });

  socket.on("disconnect", () => {
    console.log("🔴 user disconnected");
  });
});


// ===== 数据处理 =====

function normalizeAnswers(answers) {
  return {
    basic: answers,
    personality: answers,
    interests: answers.interests || []
  };
}

function buildPrompt(data) {
  return `
Generate a speculative user persona.

Return JSON:
{
  "archetype": "",
  "summary": "",
  "words": [],
  "phrases": [],
  "recommendations": []
}

User data:
${JSON.stringify(data)}
`;
}

function sanitize(data, input) {
  return {
    archetype: data.archetype || "generated persona",
    summary: data.summary || "a shifting identity",
    words: Array.isArray(data.words) ? data.words : [],
    phrases: Array.isArray(data.phrases) ? data.phrases : [],
    recommendations: Array.isArray(data.recommendations)
      ? data.recommendations
      : []
  };
}

// ===== fallback =====

function buildFallbackPortrait(data) {
  return {
    archetype: "fallback persona",
    summary: "openai not connected, using local data",
    words: [
      "curious",
      "adaptive",
      "observant",
      "shifting",
      "reflective",
      "sensitive"
    ],
    phrases: [
      "becoming through interaction",
      "identity in motion"
    ],
    recommendations: [
      "creative coding",
      "art",
      "design"
    ]
  };
}