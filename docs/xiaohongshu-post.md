# 小红书文案 · skill-to-workflow

> 直接复制下面这段即可发帖。配图用 `assets/xiaohongshu-poster.png`。

---

**标题（任选其一）：**

- 我让 Claude 的 Skill 学会了「并行」⚡
- Skill 一键编译成多智能体 Workflow🧠
- 你的 AI 技能，还在单线程一步步跑？

---

**正文：**

姐妹们，最近搞 AI agent 的应该都囤了一堆 Skill 吧📦

但你有没有发现一个问题——
市面上的 skill 是真的多，可**含金量参差不齐**，
而且不管多复杂，它都只能在**一个 agent 里、单线程、一步一步**地跑😮‍💨

比如一个「文档审查」的 skill 写着：
「检查死链、检查过时代码、检查缺失章节、再逐条核实」
听起来四件事对吧？可单个 agent 只能 A→B→C→D 排队做，
还经常**自己说有问题、自己又不复核**，误报一堆🙃

于是我做了个东西：**skill-to-workflow** 🚀
一个「能造 workflow 的 workflow」（对，meta 到家了）

它会读你的 SKILL.md，把藏在文字里的「依赖结构」还原出来，
**自动编译成一个多智能体的 Workflow**👇

⚡ **并行 fan-out**：四件独立的事，从排队变成同时开跑
🧪 **对抗式自校验**：每条结论派 N 个「杠精 agent」去反驳，多数驳不倒才留下
🔗 **类型化交接**：stage 之间用 JSON Schema 传数据，不再靠 prose 猜

最骚的是它**还会校验自己的产出**——
真·V8 解析 + 三个对抗审查视角（保真 / 并行合理性 / 规范），
跑一个修复循环，直到生成的 workflow 真的能跑、且没漏掉原 skill 任何一步✅

同样一套流程，墙上时间砍掉一大截，误报还更少🎯

一行命令装：
`npx github:democra-ai/skill-to-workflow`

然后在 Claude Code 里：
`Workflow({ name: "skill-to-workflow", args: { skillName: "doc-audit" } })`

开源在这 👉 github.com/democra-ai/skill-to-workflow
配套还有个 claude-workflow-viz 能把生成的 workflow 跑起来可视化，绝配🤝

有在玩 Claude Code / agent 的扣 1，一起卷起来～

---

**话题标签：**

#ClaudeCode #Claude #AIagent #智能体 #AI编程 #程序员 #开源项目 #效率工具 #vibecoding #Anthropic #workflow #独立开发
