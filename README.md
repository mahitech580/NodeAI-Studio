# 🤖 NodeAI Studio

An AI-powered developer assistant built with **Node.js and Express** that provides a unified interface for **AI chat, code generation, code debugging, and SQL assistance**.

> **One Node.js API. Every AI workflow.**

## ✨ Features

* 💬 **AI Chat** — Interact with an AI assistant through a simple interface.
* 💻 **Code Generation** — Generate code from natural-language requirements.
* 🐛 **Code Debugging** — Analyze code and identify potential issues.
* 🗄️ **SQL Assistant** — Generate and improve SQL queries.
* ⚡ **REST API** — Backend endpoints for different AI workflows.
* 🌐 **Responsive Web Interface** — Clean browser-based developer interface.
* 🔐 **Environment Variables** — API credentials are managed through `.env`.
* 🧪 **Demo Mode** — Application can run without an AI API key using demo responses.

## 🛠️ Tech Stack

### Frontend

* HTML5
* CSS3
* JavaScript

### Backend

* Node.js
* Express.js
* REST APIs

### AI

* OpenAI API
* Prompt Engineering
* Generative AI

### Development Tools

* Git
* GitHub
* npm
* VS Code

## 🏗️ Architecture

```text
User
 │
 ▼
Web Interface
 │
 ▼
Node.js + Express Server
 │
 ├── /api/ai/code
 │
 ├── /api/ai/debug
 │
 └── /api/ai/sql
 │
 ▼
OpenAI API
 │
 ▼
AI Response
 │
 ▼
Web Interface
```

## 📡 API Endpoints

| Endpoint        | Method | Purpose                 |
| --------------- | ------ | ----------------------- |
| `/api/ai/code`  | POST   | Generate code           |
| `/api/ai/debug` | POST   | Analyze and debug code  |
| `/api/ai/sql`   | POST   | Generate or improve SQL |

## 🚀 Getting Started

### 1. Clone the repository

```bash
git clone https://github.com/mahitech580/NodeAI-Studio.git
cd NodeAI-Studio
```

### 2. Install dependencies

```bash
npm install
```

### 3. Configure environment variables

Create a `.env` file in the project root:

```env
AI_API_KEY=your_api_key_here
```

Replace `your_api_key_here` with your API key.

### 4. Start the application

```bash
node server.js
```

Open the application in your browser using the local address displayed by the server.

## 🧪 Demo Mode

NodeAI Studio supports **Demo Mode** when an AI API key is not configured.

This allows the interface and application flow to be tested without connecting to an external AI service.

For full AI functionality, configure the `AI_API_KEY` environment variable.

## 📂 Project Structure

```text
NodeAI-Studio/
│
├── public/
│   ├── index.html
│   ├── style.css
│   └── script.js
│
├── server.js
├── package.json
├── package-lock.json
├── .env
├── .gitignore
└── README.md
```

> **Note:** Do not commit your `.env` file or expose API keys in the repository.

## 🔄 How It Works

### Code Generation

The user describes a programming requirement, and NodeAI Studio sends the request to the backend. The backend processes the request and returns the generated code.

### Code Debugging

The user submits code and describes the issue. The debugging workflow analyzes the input and provides an explanation and suggested correction.

### SQL Assistance

Users can describe a database requirement or provide an SQL query. The SQL workflow can generate, improve, or explain SQL queries.

## 🔒 Security

API keys should be stored in environment variables rather than directly inside frontend or backend source code.

Example:

```env
AI_API_KEY=your_api_key_here
```

Add `.env` to `.gitignore`:

```gitignore
node_modules/
.env
```

## 🎯 Project Goals

NodeAI Studio was developed to demonstrate how **Generative AI can be integrated into a full-stack JavaScript application** using a Node.js and Express backend.

The project focuses on:

* REST API development
* AI API integration
* Prompt-based workflows
* Backend/frontend communication
* Environment configuration
* Developer productivity tools

## 🔮 Future Enhancements

* 🔐 User authentication
* 💾 Conversation history
* 📋 Code copy/export functionality
* 🌙 Dark/light theme
* 🧠 Multiple AI model support
* 📊 Usage tracking
* 🗂️ Saved AI sessions
* ⚡ Streaming AI responses
* 🧩 Additional developer tools
* 🚀 Production deployment

## 👨‍💻 Author

**Mahendra**

GitHub: https://github.com/mahitech580

## 📄 License

This project is licensed under the **MIT License**.

Copyright © 2026 Mahendra.
