# 🤝 Contributing to `cloudflaredjs`

First off — **thank you for considering contributing!** 🙏  
Your time and effort are truly appreciated. Every contribution helps make `cloudflaredjs` better.

We welcome **all kinds of contributions**, including:

- 🐛 Bug reports
- 💡 Feature suggestions
- 🧑‍💻 Code contributions (pull requests)
- 📝 Documentation improvements

---

## 🐞 Reporting Bugs

If you find a bug, please [open an issue](../../issues) and include the following details:

1. **Clear title and description** of the problem.
2. **Steps to reproduce** the issue.
3. **Expected behavior** vs. **actual behavior**.
4. **Environment details**:
   - Node.js version
   - cloudflared version
   - Operating System
5. **Relevant logs**, especially if `verbose: true` was enabled.

> Example:  
> _“When I start a tunnel with autoFaultDetectionAndUpdate enabled, the process doesn’t restart after failure on macOS Ventura (Node v20.11.0, cloudflared 2024.10.2).”_

---

## 🚀 Suggesting Enhancements

Got an idea to improve `cloudflaredjs`? Great! 🎉

Before coding, please:

- [Open an issue](../../issues) describing your enhancement idea.
- Use a **clear and descriptive title**.
- Explain **why** the feature is useful and **how** it might work.
- Include **pseudo-code** or **example snippets** if it helps illustrate your idea.

---

## 🔧 Pull Requests

We ❤️ pull requests!  
If you’re ready to contribute code, please follow these steps:

### 1. Fork the repository

Click the **Fork** button on GitHub and clone your fork locally.

```bash
git clone https://github.com/your-username/cloudflaredjs.git
cd cloudflaredjs
```

### 2. Create a new branch

Use a descriptive branch name for your work.

```bash
# For new features
git checkout -b feature/my-awesome-feature

# For bug fixes
git checkout -b fix/some-nasty-bug
```

### 3. Make your changes

- Follow the existing **code style** (indentation, naming, structure).
- Add **JSDoc comments** for any new functions, parameters, or exports.
- Update the **README.md** if you modify or add API functionality.
- Run any existing **linter** or **tests** (if applicable).

### 4. Commit your work

Use clear and descriptive commit messages.

```bash
git commit -m "Feat: Add auto-retry interval configuration option"
```

Examples of good commit prefixes:

- `Feat:` — for new features
- `Fix:` — for bug fixes
- `Docs:` — for documentation updates
- `Refactor:` — for internal changes

### 5. Push your branch

```bash
git push origin feature/my-awesome-feature
```

### 6. Open a Pull Request

From your fork, open a PR targeting the **main** branch of the original repo.
Provide:

- A **summary** of your changes
- **Screenshots or logs** if relevant
- Any **known limitations** or follow-up work

---

## 🧭 Code of Conduct

This project is governed by a **Code of Conduct**.
Please be respectful, kind, and constructive when engaging with others.

If you haven’t already, you can add a [`CODE_OF_CONDUCT.md`](./CODE_OF_CONDUCT.md) file and link to it here.

> By participating in this project, you agree to uphold the Code of Conduct.

---

## 🪶 Style Guide

**Code:**
Follow the existing style and patterns — consistency is key.

**Comments:**
Use [JSDoc](https://jsdoc.app/) for all public functions and parameters.

**Commits:**
Write short, clear messages (max 72 chars). Example:

- `Feat: Add configurable health check endpoint`
- `Fix: Prevent crash on process exit`
- `Docs: Improve README usage section`

---

## 🙌 Thank You

Your contributions make `cloudflaredjs` stronger, more stable, and more useful for everyone.
Every issue, suggestion, and PR — big or small — matters. 💙
