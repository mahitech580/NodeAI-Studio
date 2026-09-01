const tools = document.querySelectorAll(".tool");
const promptBox = document.getElementById("prompt");
const responseBox = document.getElementById("response");
const generateButton = document.getElementById("generate");
const clearButton = document.getElementById("clear");
const copyButton = document.getElementById("copy");
const historyBox = document.getElementById("history");
const clearHistoryButton = document.getElementById("clearHistory");

const statusBox = document.getElementById("status");
const pageTitle = document.getElementById("pageTitle");
const modeLabel = document.getElementById("modeLabel");
const heroTitle = document.getElementById("heroTitle");
const heroDescription = document.getElementById("heroDescription");

let currentMode = "chat";

const modes = {
    chat: {
        title: "AI Chat",
        label: "CHAT",
        hero: "Build faster with AI",
        description:
            "Ask coding questions, explain concepts, or solve development problems.",
        placeholder:
            "Ask a developer question..."
    },

    code: {
        title: "Code Generator",
        label: "CODE",
        hero: "Turn ideas into code",
        description:
            "Describe what you want to build and NodeAI Studio will generate clean code.",
        placeholder:
            "Create a Node.js REST API for a todo application..."
    },

    debug: {
        title: "AI Debugger",
        label: "DEBUG",
        hero: "Find and fix bugs",
        description:
            "Paste your code and error message to identify the problem and fix it.",
        placeholder:
            "Paste your code and error message here..."
    },

    sql: {
        title: "SQL Assistant",
        label: "SQL",
        hero: "Turn English into SQL",
        description:
            "Describe the data you need and generate an SQL query with an explanation.",
        placeholder:
            "Find the top 10 customers by revenue..."
    }
};


/* =====================================
   TOOL SWITCHING
===================================== */

tools.forEach((tool) => {

    tool.addEventListener("click", () => {

        tools.forEach((item) => {
            item.classList.remove("active");
        });

        tool.classList.add("active");

        currentMode = tool.dataset.mode;

        updateMode();

    });

});


function updateMode() {

    const mode = modes[currentMode];

    pageTitle.textContent = mode.title;

    modeLabel.textContent = mode.label;

    heroTitle.textContent = mode.hero;

    heroDescription.textContent = mode.description;

    promptBox.placeholder = mode.placeholder;

    promptBox.value = "";

    resetResponse();

}


/* =====================================
   RESET RESPONSE
===================================== */

function resetResponse() {

    responseBox.className = "response empty";

    responseBox.innerHTML = `
        <div class="empty-content">

            <div class="empty-icon">
                ?
            </div>

            <h4>
                Ready when you are
            </h4>

            <p>
                Enter a request and click Generate.
            </p>

        </div>
    `;

}


/* =====================================
   GENERATE AI RESPONSE
===================================== */

generateButton.addEventListener("click", generateAI);


async function generateAI() {

    const prompt = promptBox.value.trim();

    if (!prompt) {

        promptBox.focus();

        responseBox.className = "response";

        responseBox.textContent =
            "Please enter a request before generating a response.";

        return;

    }


    generateButton.disabled = true;

    generateButton.textContent = "Generating...";


    responseBox.className = "response loading";

    responseBox.textContent =
        "NodeAI Studio is thinking";


    try {

        const result = await fetch("/api/ai", {

            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify({

                mode: currentMode,

                prompt: prompt

            })

        });


        const data = await result.json();


        if (!result.ok || !data.success) {

            throw new Error(
                data.error || "AI request failed."
            );

        }


        responseBox.className = "response";

        responseBox.textContent = data.answer;


        loadHistory();


    } catch (error) {

        responseBox.className = "response";

        responseBox.textContent =
            "Error\n\n" + error.message;

    } finally {

        generateButton.disabled = false;

        generateButton.textContent =
            "? Generate";

    }

}


/* =====================================
   CLEAR INPUT
===================================== */

clearButton.addEventListener("click", () => {

    promptBox.value = "";

    resetResponse();

    promptBox.focus();

});


/* =====================================
   COPY RESPONSE
===================================== */

copyButton.addEventListener("click", async () => {

    const text = responseBox.textContent.trim();


    if (!text) {

        return;

    }


    try {

        await navigator.clipboard.writeText(text);

        const originalText =
            copyButton.textContent;

        copyButton.textContent =
            "Copied!";


        setTimeout(() => {

            copyButton.textContent =
                originalText;

        }, 1500);


    } catch {

        alert("Could not copy the response.");

    }

});


/* =====================================
   LOAD HISTORY
===================================== */

async function loadHistory() {

    try {

        const result =
            await fetch("/api/history");


        const data =
            await result.json();


        if (!data.success) {

            return;

        }


        historyBox.innerHTML = "";


        const history =
            data.history || [];


        if (history.length === 0) {

            historyBox.innerHTML = `
                <div class="history-empty">
                    No history yet
                </div>
            `;

            return;

        }


        history.slice(0, 12).forEach((item) => {

            const element =
                document.createElement("div");


            element.className =
                "history-item";


            const mode =
                item.mode
                    ? item.mode.toUpperCase()
                    : "CHAT";


            const question =
                item.prompt || "";


            element.textContent =
                `${mode} · ${question.substring(0, 42)}`;


            element.title =
                question;


            element.addEventListener(
                "click",
                () => {

                    currentMode =
                        item.mode || "chat";


                    tools.forEach((tool) => {

                        tool.classList.toggle(
                            "active",
                            tool.dataset.mode === currentMode
                        );

                    });


                    updateMode();


                    promptBox.value =
                        item.prompt || "";


                    responseBox.className =
                        "response";


                    responseBox.textContent =
                        item.answer || "";

                }
            );


            historyBox.appendChild(element);

        });


    } catch (error) {

        console.error(
            "History error:",
            error
        );

    }

}


/* =====================================
   CLEAR HISTORY
===================================== */

clearHistoryButton.addEventListener(
    "click",
    async () => {

        try {

            await fetch(
                "/api/history",
                {
                    method: "DELETE"
                }
            );


            loadHistory();


        } catch (error) {

            console.error(
                "Clear history error:",
                error
            );

        }

    }
);


/* =====================================
   QUICK EXAMPLES
===================================== */

const examples =
    document.querySelectorAll(".example");


examples.forEach((example) => {

    example.addEventListener(
        "click",
        () => {

            promptBox.value =
                example.dataset.example;


            promptBox.focus();

        }
    );

});


/* =====================================
   KEYBOARD SHORTCUT
===================================== */

promptBox.addEventListener(
    "keydown",
    (event) => {

        if (
            event.ctrlKey &&
            event.key === "Enter"
        ) {

            generateAI();

        }

    }
);


/* =====================================
   CHECK SERVER STATUS
===================================== */

async function checkServer() {

    try {

        const result =
            await fetch("/api/health");


        const data =
            await result.json();


        if (data.success) {

            if (data.demoMode) {

                statusBox.textContent =
                    "? DEMO MODE";

                statusBox.style.color =
                    "#f1c96c";

            } else {

                statusBox.textContent =
                    "? AI ONLINE";

                statusBox.style.color =
                    "#7ee0a2";

            }

        }


    } catch {

        statusBox.textContent =
            "? OFFLINE";

        statusBox.style.color =
            "#ff7070";

    }

}


/* =====================================
   START APPLICATION
===================================== */

updateMode();

loadHistory();

checkServer();
