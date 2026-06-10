# AI-Powered Teams - Framework & Delivery: Kickoff Meeting

## 1. Team Initilal Profiling

### 1.1 Work & Domain Mapping
Map all distinct domains the team operates across (some teams span multiple).
For each domain:
	- Document all recurring work categories:
		- Code implementation
		- Debugging
		- Log analysis
		- Algorithm design
		- Research
		- Architecture planning
		- POC
		- And more
	- Identify undocumented knowledge that lives only in specific people's heads - not visible from code or process.
	
### 1.2 AI Readiness
1. Identify domains/tasks ready to leverage AI.
2. Identify domains that may not fit AI, are problematic to start with, or require deep dives before they can be prioritized.
3. Prioritize the domains that are AI-ready.

### 1.3 Team Coding Agents Current Status
1. Assess Claude Code usage: who is using it, to what extent, which task types are covered and which are not.
2. Assess curation status (context docs, skills, agents, and more): None / Initialized / Curated and Updated / Curated and Needs Update Cycle.

## 2. Team Claude Code Setup - Context % & Tooling

What we build to make Claude Code deliver better results for the team.

### 2.1 Layer 1: Context Curation
1. Create major context files for the team (CLAUDE.md for starters, and additional files as needed).
2. The CLAUDE.md should contain or point to files covering:
	- Overview of each team's domain.
	- Key files and coding patterns the team uses.
	- Coding conventions and architecture the team follws.
	- Tech stack inventory.
3. Consider this approach:
		- Multiple context files in hierarchy, with an index for fast code retrieval.
		- Context files don't contain current code - Claude always reads fresh code.
		- Context files capture deep project architecture decisions and coding patterns.
		- An index guides fast code retrieval when needed.
		
### 2.2 Layer 2: Build Skills & Agents Inventory
1. External skills and agents:
	- Use off-the-shelf. Github-starred, well-used skills and agents from the internet.
	- Examples of agent/skills domains and types:
		- Coding languages (Python, C++, JavaScript, etc.).
		- Role-based expertise (product manager, architect, mathematician, algorithm developer, etc.).
		- Domain knowledge (backend, frontend, firmware, etc.).
	- Can be narrow (e.g.: API developer, Quantum Mechanics expert), but not tied to specific team work or intellectual property.
	- Must be Internet-searchable and publicly available.
2. 	Internal skills and agents - team-specific or intelectual property:
		- Specific workflows that need to be skillified or identified as agents.
		- Knowledge too specific or proprietary to be found externally.
3. Skills and agents inventory management:
	- Maintain a structured inventory of all skills, agents, and context files in git.
	- Track metadata per entry: origin (source URL, or repo, current version, status (supported/deprecated), popularity (e.g.: start count).
	- Document how to install the inventory on new user's Claude setup.
	- Document update and versioning procedures (e.g.: Confluence page).
	
### 2.3 Layer 3: E2E Workflows
1. Build multi-step workflows using the "skill of skills" approach:
	- A skill mapped as a sequence of skills/phases carried outn one after anotehr, usually by expert agents.
	- Formalizes a repeatable team or team-member procedure into an automated workflow.
2. Each workflow defines its phases and for each phase:
	- The skills and agents assigned.
	- What the phase should achieve or work on - its target output.
	- Whether it requires a human checkpoint before proceeding.
	- How it hands off to the next phase.

## 3. Team Task Delivery

How the team uses Claude Code to deliver work, prioritized by effort.

### 3.1 Suggest Tackle-First Domains
There are the areas that give immediate, measurable impact with minimal setup:
	1. Tedious, rather-simple task that slow the team down.
	2. Infamous manual work that can be automated using Claude and some access to resources.
	3. Boilerplate reduction.
	4. Low-hanging fruits.
	5. Automation tasks for repeatable work.
	6. Tasks that don't require large effort to make Claude-accessible and can be implemented immediately.

### 3.2 Medium-Effort Domains
The reaminng AI-ready domains from section 1.2.1 that require more effort to automate:
		1. Need reeper context curation before Claude can handle them effectively.
		2. Require more complex E2E workflows of custom skills/agents.
		3. Are more noisy or complex to success with Claude:
			- Without proper harnessing, results are diverse: sometimes they work, sometimes they don't.
			- Thes tasks require team member research to adjust a better harness, turning them into streamlined tasks that can be succesffuly implemented repeatedly.
		4. How to approach:
			- Tackle after the tackle-first domains are in place.
			- Build out Layer 1-2 setup (context, skills, agents) before workflows can be designed.
			- Break a single complex task or routine into multiple smaller workflows Claude can execute.
			
### 3.3 Temporarily Less Prioritized Domains
Domains identified in section 1 as not fitting AI at this stage:
	1. Do not declare and domain permanently out of scope.
	2. Periodically retry with each new model release to test if it can now handle the domain.
	3. Re-evaluate and move to AI-ready if progress is made.
	4. Tackle once 3.1 & 3.2 get good coverage, a new domain pops up, or existing domains get re-prioritized.
	
## 4. Model Feedback & Remediation

The models we run in the air-gap environment have limits. Documenting failures turns subjective feedback into actionable data. This is seperate from the curated task evals - it captures real-time breakdowns that hurt confidence and adoption.

- If you or your team hit a case where Claude fails at a task, document it:
	- What the task was.
	- What propmpts, skills, agents, and context were provided.
	- What the result was and why it fell short.
- Bring this to the champion sessions (weekly/bi-weekly).
- I will review each case, come to the team, and attempt remediation:
	- Fix the process, add skills/agents, guide the team member, or run a session together.
	- Determine whether the failure is a model limitation, a process gap, or a setup issue.
- This builds real data on where our models succeed, where they fail, and what needs attention.

## 5. Champion Sessions

- Weekly/bi-weekly sessions with team champions.
- Champions bring documented model breakdowns, blokcers, and team feedback.
- Review progress, remediate problems, and start building team workflows together (see section 2.3).
