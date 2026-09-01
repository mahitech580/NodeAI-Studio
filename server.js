require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const fs = require("fs").promises;
const path = require("path");
const OpenAI = require("openai");

const app = express();
const PORT = process.env.PORT || 3000;

const historyFile = path.join(__dirname, "storage", "history.json");

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

const ai = process.env.AI_API_KEY
    ? new OpenAI({
        apiKey: process.env.AI_API_KEY
      })
    : null;

async function readHistory() {
    try {
        const data = await fs.readFile(historyFile, "utf8");
        return JSON.parse(data);
    } catch {
        return [];
    }
}

async function saveHistory(item) {
    const history = await readHistory();

    history.unshift(item);

    await fs.writeFile(
        historyFile,
        JSON.stringify(history.slice(0, 50), null, 2)
    );
}

function demoResponse(mode, prompt) {
    if (mode === "code") {
        return `DEMO MODE

// Example Node.js code
const express = require("express");

const app = express();

app.get("/api/hello", (req, res) => {
    res.json({
        message: "Hello from NodeAI Studio"
    });
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});

// Your request:
// ${prompt}`;
    }

    if (mode === "debug") {
        return `DEMO MODE

Problem:
A real AI model is required to analyze your code.

Explanation:
Your request was received successfully.

Fixed Code:
Add your AI API key to .env to receive an AI-generated solution.

Prevention Tip:
Always read the complete error message and stack trace.

Your request:
${prompt}`;
    }

    if (mode === "sql") {
        return `DEMO MODE

SQL:

SELECT customer_id,
       SUM(revenue) AS total_revenue
FROM orders
GROUP BY customer_id
ORDER BY total_revenue DESC
LIMIT 10;

Explanation:
This query groups orders by customer, calculates total revenue,
sorts customers from highest to lowest revenue, and returns
the top 10.

Your request:
${prompt}`;
    }

    return `DEMO MODE

NodeAI Studio received your question:

${prompt}

Add AI_API_KEY to your .env file to enable real AI responses.`;
}

function getSystemPrompt(mode) {
    if (mode === "code") {
        return "You are a senior software engineer. Generate clean, readable and production-quality code. Explain important parts briefly.";
    }

    if (mode === "debug") {
        return "You are an expert debugger. Identify the problem, explain the cause, provide corrected code and prevention tips.";
    }

    if (mode === "sql") {
        return "You are an SQL expert. Generate correct SQL and explain the query clearly. Never execute SQL.";
    }

    return "You are NodeAI Studio, a helpful senior software engineer. Give accurate and practical developer-focused answers.";
}

app.get("/api/health", (req, res) => {
    res.json({
        success: true,
        message: "NodeAI Studio is running",
        demoMode: !ai
    });
});

app.post("/api/ai", async (req, res, next) => {
    try {
        const { mode = "chat", prompt } = req.body;

        if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
            return res.status(400).json({
                success: false,
                error: "Prompt is required."
            });
        }

        const validModes = ["chat", "code", "debug", "sql"];

        if (!validModes.includes(mode)) {
            return res.status(400).json({
                success: false,
                error: "Invalid AI mode."
            });
        }

        let answer;

        if (!ai) {
            answer = demoResponse(mode, prompt.trim());
        } else {
            const result = await ai.chat.completions.create({
                model: process.env.AI_MODEL || "gpt-4o-mini",
                messages: [
                    {
                        role: "system",
                        content: getSystemPrompt(mode)
                    },
                    {
                        role: "user",
                        content: prompt.trim()
                    }
                ]
            });

            answer =
                result.choices?.[0]?.message?.content ||
                "No response received.";
        }

        await saveHistory({
            id: Date.now(),
            mode,
            prompt: prompt.trim(),
            answer,
            demoMode: !ai,
            createdAt: new Date().toISOString()
        });

        res.json({
            success: true,
            answer,
            demoMode: !ai
        });

    } catch (error) {
        console.error("AI Error:", error);
        next(error);
    }
});

app.get("/api/history", async (req, res, next) => {
    try {
        const history = await readHistory();

        res.json({
            success: true,
            history
        });

    } catch (error) {
        next(error);
    }
});

app.delete("/api/history", async (req, res, next) => {
    try {
        await fs.writeFile(historyFile, "[]");

        res.json({
            success: true,
            message: "History cleared."
        });

    } catch (error) {
        next(error);
    }
});

app.use((error, req, res, next) => {
    console.error(error);

    res.status(500).json({
        success: false,
        error: "Something went wrong."
    });
});

app.listen(PORT, () => {
    console.log("");
    console.log("====================================");
    console.log("       NODEAI STUDIO");
    console.log("====================================");
    console.log(`Server: http://localhost:${PORT}`);
    console.log(`AI Mode: ${ai ? "LIVE AI" : "DEMO MODE"}`);
    console.log("====================================");
    console.log("");
});
